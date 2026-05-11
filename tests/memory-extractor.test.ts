import { describe, it, expect, vi } from 'vitest';
import { extractMemories } from '../electron/memory-extractor';
import type { Conversation } from '../src/shared/types';

const makeConversation = (messages: { role: string; content: string }[]): Conversation => ({
  id: 'test-id',
  context: { type: 'text', value: 'test' },
  model: 'llama3',
  messages: [
    { role: 'system', content: 'You are helpful.' },
    ...messages,
  ] as any,
});

describe('memory-extractor', () => {
  it('returns empty array for short conversations', async () => {
    const conv = makeConversation([{ role: 'user', content: 'Hi' }]);
    const result = await extractMemories(conv, 'http://localhost:11434');
    expect(result).toEqual([]);
  });

  it('parses valid JSON array from LLM response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '[{"content":"User prefers TypeScript","type":"preference"}]' },
      }),
    }) as any;
    const conv = makeConversation([
      { role: 'user', content: 'I prefer TypeScript' },
      { role: 'assistant', content: 'Got it.' },
      { role: 'user', content: 'Always use strict types' },
    ]);
    const result = await extractMemories(conv, 'http://localhost:11434');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('User prefers TypeScript');
    expect(result[0].type).toBe('preference');
    expect(result[0].source).toBe('auto');
  });

  it('returns empty array on JSON parse failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'not json at all' } }),
    }) as any;
    const conv = makeConversation([
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi!' },
      { role: 'user', content: 'Help me code' },
    ]);
    const result = await extractMemories(conv, 'http://localhost:11434');
    expect(result).toEqual([]);
  });
});
