import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const TEST_DB_PATH = join(process.cwd(), 'tests', '_test_memories');

vi.mock('../electron/memory-store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../electron/memory-store')>();
  return {
    ...mod,
    _embedText: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
  };
});

import { initMemoryStore, insertMemory, listAllMemories, deleteMemory, searchMemories } from '../electron/memory-store';

describe('memory-store', () => {
  beforeEach(async () => {
    await initMemoryStore(TEST_DB_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH, { recursive: true });
  });

  it('inserts and lists a memory', async () => {
    await insertMemory({ content: 'User prefers TypeScript', type: 'preference', source: 'auto', createdAt: Date.now() }, TEST_DB_PATH);
    const list = await listAllMemories(TEST_DB_PATH);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('User prefers TypeScript');
  });

  it('deletes a memory by id', async () => {
    const mem = await insertMemory({ content: 'User likes dark mode', type: 'preference', source: 'manual', createdAt: Date.now() }, TEST_DB_PATH);
    await deleteMemory(mem.id, TEST_DB_PATH);
    const list = await listAllMemories(TEST_DB_PATH);
    expect(list).toHaveLength(0);
  });

  it('returns empty array when no memories exist', async () => {
    const list = await listAllMemories(TEST_DB_PATH);
    expect(list).toHaveLength(0);
  });
});
