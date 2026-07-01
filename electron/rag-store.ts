import { connect } from '@lancedb/lancedb';
import { join } from 'node:path';
import fs from 'fs/promises';
import path from 'path';
import { embedText } from './embed';
import {
  isTurbovecEnabled,
  ensureTurbovecReady,
  turbovecAdd,
  turbovecSearch,
  turbovecDelete
} from './turbovec-store';

const TABLE_NAME = 'rag_chunks';
const EMBED_DIM = 768;
const CHUNK_WORD_THRESHOLD = 400;
const MIN_CHUNK_WORDS = 10;

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
    if (words.length > CHUNK_WORD_THRESHOLD) {
      // Split at sentence boundaries
      const sentences = para.split(/(?<=\. |\.\n)/);
      let current: string[] = [];
      for (const sentence of sentences) {
        const sentWords = sentence.trim().split(/\s+/);
        if (current.length + sentWords.length > CHUNK_WORD_THRESHOLD) {
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

  // Discard chunks with fewer than MIN_CHUNK_WORDS words
  const filtered = rawChunks.filter(c => c.split(/\s+/).filter(Boolean).length >= MIN_CHUNK_WORDS);

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
    let pdfParse: (buf: Buffer) => Promise<{ text: string }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      pdfParse = require('pdf-parse');
    } catch {
      throw new Error('pdf-parse module not found — run npm install pdf-parse');
    }
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

  // Delete existing chunks for this source (re-index on re-add).
  // Escape single quotes by doubling them — LanceDB/DataFusion string literals
  // use '' for a literal quote, not backslash. Backslash-escaping leaves a live
  // quote that a crafted filename could use to break out of the predicate.
  const safeSrc = source.replace(/'/g, "''");
  await table.delete(`source = '${safeSrc}'`);

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

  // TurboVec Pro Mode: write to the compressed index if enabled + available.
  // This keeps the vector footprint ~16× smaller than LanceDB's fp32, which
  // is what lets 100K+ chunks fit under 1GB RAM.
  if (isTurbovecEnabled()) {
    const ready = await ensureTurbovecReady();
    if (ready.ok) {
      try {
        // Delete any existing chunks for this source first (re-index on re-add)
        await turbovecDelete(source);
        await turbovecAdd(chunks);
        return { chunks: chunks.length };
      } catch (err) {
        // Fall through to LanceDB on sidecar failure so user never loses data
        console.warn('[rag-store] TurboVec ingest failed, falling back to LanceDB:', err);
      }
    } else {
      console.warn(`[rag-store] TurboVec enabled but unavailable (${ready.reason}); using LanceDB`);
    }
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
  // TurboVec Pro Mode: delete from compressed index when enabled.
  if (isTurbovecEnabled()) {
    const ready = await ensureTurbovecReady();
    if (ready.ok) {
      try { await turbovecDelete(source); } catch (err) {
        console.warn('[rag-store] TurboVec delete failed:', err);
      }
    }
  }
  try {
    const db = await connect(getDbPath());
    const tables = await db.tableNames();
    if (!tables.includes(TABLE_NAME)) return;
    const table = await db.openTable(TABLE_NAME);
    // Double single quotes to escape them for the DataFusion SQL predicate.
    const safeSrc = source.replace(/'/g, "''");
    await table.delete(`source = '${safeSrc}'`);
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

    // TurboVec Pro Mode path
    if (isTurbovecEnabled()) {
      const ready = await ensureTurbovecReady();
      if (ready.ok) {
        try {
          const hits = await turbovecSearch(vector, topK);
          if (hits.length > 0) {
            return hits.map(h => ({
              id: h.id,
              content: h.content,
              source: h.source,
              chunkIndex: h.chunkIndex,
            }));
          }
          // empty result is fine — fall through to LanceDB only if user
          // also has legacy data there
        } catch (err) {
          console.warn('[rag-store] TurboVec search failed, trying LanceDB:', err);
        }
      }
    }

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
