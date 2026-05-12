import { connect } from '@lancedb/lancedb';
import { join } from 'node:path';
import fs from 'fs/promises';
import path from 'path';
import { embedText } from './embed';

const TABLE_NAME = 'rag_chunks';
const EMBED_DIM = 768;

interface RagChunk {
  id: string;
  content: string;
  source: string;
  chunkIndex: number;
  vector: number[];
}

export interface RagFile {
  source: string;
  chunks: number;
}

export interface RagResult {
  id: string;
  content: string;
  source: string;
  chunkIndex: number;
}

const getDbPath = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'contextchat-rag');
};

export async function initRagStore(): Promise<void> {
  const db = await connect(getDbPath());
  const tables = await db.tableNames();
  if (!tables.includes(TABLE_NAME)) {
    await db.createTable(TABLE_NAME, [
      {
        id: 'init',
        content: '',
        source: '',
        chunkIndex: 0,
        vector: new Array(EMBED_DIM).fill(0),
      },
    ]);
    const table = await db.openTable(TABLE_NAME);
    await table.delete("content = ''");
  }
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const rawChunks: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/);
    if (words.length > 400) {
      // Split at sentence boundaries
      const sentences = para.split(/(?<=\. |\.\n)/);
      let current: string[] = [];
      for (const sentence of sentences) {
        const sentWords = sentence.trim().split(/\s+/);
        if (current.length + sentWords.length > 400) {
          if (current.length > 0) {
            rawChunks.push(current.join(' '));
            current = sentWords;
          } else {
            rawChunks.push(sentence.trim());
          }
        } else {
          current.push(...sentWords);
        }
      }
      if (current.length > 0) rawChunks.push(current.join(' '));
    } else {
      rawChunks.push(para.trim());
    }
  }

  // Discard chunks with fewer than 10 words
  const filtered = rawChunks.filter(c => c.split(/\s+/).filter(Boolean).length >= 10);

  if (filtered.length === 0) return [];

  // Add 1-sentence overlap: append last sentence of chunk N to start of chunk N+1
  const result: string[] = [filtered[0]];
  for (let i = 1; i < filtered.length; i++) {
    const prev = filtered[i - 1];
    const sentences = prev.split(/(?<=\. |\.\n)/);
    const lastSentence = sentences[sentences.length - 1]?.trim() ?? '';
    const withOverlap = lastSentence ? `${lastSentence} ${filtered[i]}` : filtered[i];
    result.push(withOverlap);
  }

  return result;
}

export async function ingestFile(
  filePath: string,
  ollamaUrl: string,
): Promise<{ chunks: number }> {
  const source = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  let text: string;
  if (ext === '.txt' || ext === '.md') {
    text = await fs.readFile(filePath, 'utf-8');
  } else if (ext === '.pdf') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const buf = await fs.readFile(filePath);
    const data = await pdfParse(buf);
    text = data.text;
  } else {
    throw new Error('Unsupported file type');
  }

  const db = await connect(getDbPath());
  const tables = await db.tableNames();
  if (!tables.includes(TABLE_NAME)) {
    await initRagStore();
  }
  const table = await db.openTable(TABLE_NAME);

  // Delete existing chunks for this source (re-index on re-add)
  await table.delete(`source = '${source}'`);

  const chunkStrings = chunkText(text);
  if (chunkStrings.length === 0) return { chunks: 0 };

  const chunks: RagChunk[] = [];
  for (let i = 0; i < chunkStrings.length; i++) {
    const vector = await embedText(chunkStrings[i], ollamaUrl);
    chunks.push({
      id: crypto.randomUUID(),
      content: chunkStrings[i],
      source,
      chunkIndex: i,
      vector,
    });
  }

  await table.add(chunks as unknown as Record<string, unknown>[]);
  return { chunks: chunks.length };
}

export async function listRagFiles(): Promise<RagFile[]> {
  try {
    const db = await connect(getDbPath());
    const tables = await db.tableNames();
    if (!tables.includes(TABLE_NAME)) return [];
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.query().toArray();
    const counts = new Map<string, number>();
    for (const row of rows) {
      const src = row.source as string;
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([source, chunks]) => ({ source, chunks }))
      .sort((a, b) => a.source.localeCompare(b.source));
  } catch {
    return [];
  }
}

export async function deleteRagFile(source: string): Promise<void> {
  try {
    const db = await connect(getDbPath());
    const tables = await db.tableNames();
    if (!tables.includes(TABLE_NAME)) return;
    const table = await db.openTable(TABLE_NAME);
    await table.delete(`source = '${source}'`);
  } catch (err) {
    console.warn('deleteRagFile failed:', err);
  }
}

export async function ragSearch(
  query: string,
  ollamaUrl: string,
  topK = 3,
): Promise<RagResult[]> {
  try {
    const vector = await embedText(query, ollamaUrl);
    const db = await connect(getDbPath());
    const tables = await db.tableNames();
    if (!tables.includes(TABLE_NAME)) return [];
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.vectorSearch(vector).limit(topK).toArray();
    return rows.map(r => ({
      id: r.id as string,
      content: r.content as string,
      source: r.source as string,
      chunkIndex: r.chunkIndex as number,
      // strip the vector field — callers don't need it
    })) as RagResult[];
  } catch (err) {
    console.warn('ragSearch failed:', err);
    return [];
  }
}
