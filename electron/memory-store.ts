import { connect } from '@lancedb/lancedb';
import { join } from 'node:path';
import { v4 as uuid } from 'uuid';
import type { Memory } from '../src/shared/types';

const TABLE_NAME = 'memories';
const EMBED_DIM = 768;

const getDbPath = (override?: string): string => {
  if (override) return override;
  // Dynamic import of app to avoid errors in test environment
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'contextchat-memories');
};

export const _embedText = async (text: string, ollamaUrl: string): Promise<number[]> => {
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const json = await res.json() as { embedding: number[] };
  return json.embedding;
};

export const initMemoryStore = async (dbPathOverride?: string): Promise<void> => {
  const db = await connect(getDbPath(dbPathOverride));
  const tables = await db.tableNames();
  if (!tables.includes(TABLE_NAME)) {
    await db.createTable(TABLE_NAME, [
      {
        id: uuid(),
        content: '',
        type: 'fact',
        source: 'auto',
        createdAt: 0,
        vector: new Array(EMBED_DIM).fill(0),
      },
    ]);
    const table = await db.openTable(TABLE_NAME);
    await table.delete("content = ''");
  }
};

export const insertMemory = async (
  entry: Omit<Memory, 'id'>,
  dbPathOverride?: string,
  ollamaUrl = 'http://localhost:11434',
): Promise<Memory> => {
  const id = uuid();
  let vector: number[];
  try {
    vector = await _embedText(entry.content, ollamaUrl);
  } catch {
    vector = new Array(EMBED_DIM).fill(0);
  }
  const db = await connect(getDbPath(dbPathOverride));
  const table = await db.openTable(TABLE_NAME);
  await table.add([{ id, ...entry, vector }]);
  return { id, ...entry };
};

export const listAllMemories = async (dbPathOverride?: string): Promise<Memory[]> => {
  try {
    const db = await connect(getDbPath(dbPathOverride));
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.query().toArray();
    return rows.map(r => ({
      id: r.id as string,
      content: r.content as string,
      type: r.type as Memory['type'],
      source: r.source as Memory['source'],
      createdAt: r.createdAt as number,
    }));
  } catch {
    return [];
  }
};

export const deleteMemory = async (id: string, dbPathOverride?: string): Promise<void> => {
  const db = await connect(getDbPath(dbPathOverride));
  const table = await db.openTable(TABLE_NAME);
  await table.delete(`id = '${id}'`);
};

export const searchMemories = async (
  query: string,
  ollamaUrl = 'http://localhost:11434',
  topK = 3,
  dbPathOverride?: string,
): Promise<Memory[]> => {
  try {
    const vector = await _embedText(query, ollamaUrl);
    const db = await connect(getDbPath(dbPathOverride));
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.vectorSearch(vector).limit(topK).toArray();
    return rows.map(r => ({
      id: r.id as string,
      content: r.content as string,
      type: r.type as Memory['type'],
      source: r.source as Memory['source'],
      createdAt: r.createdAt as number,
    }));
  } catch {
    return [];
  }
};
