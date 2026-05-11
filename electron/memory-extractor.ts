import type { Conversation, Memory } from '../src/shared/types';

const EXTRACTION_PROMPT = `You are a memory extraction assistant.
Given the conversation below, extract 0-5 factual statements about the user: their preferences, projects, skills, or goals.
Output ONLY a valid JSON array, no other text. Format:
[{"content": "User prefers TypeScript over JavaScript", "type": "preference"}]
Types must be one of: fact, preference, project.
If nothing is worth remembering, output: []`;

export const extractMemories = async (
  conversation: Conversation,
  ollamaUrl: string,
  model = 'llama3.2',
): Promise<Omit<Memory, 'id'>[]> => {
  const userMessages = conversation.messages.filter(m => m.role === 'user');
  if (userMessages.length < 2) return [];

  const transcript = conversation.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n')
    .slice(-8000);

  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`extractMemories: Ollama returned HTTP ${res.status}`);
      return [];
    }

    const json = await res.json() as { message?: { content?: string } };
    if (!json?.message?.content) {
      console.warn('extractMemories: unexpected response shape', json);
      return [];
    }
    const raw = json.message.content.trim();

    let parsed: { content: string; type: string }[];
    try {
      const p = JSON.parse(raw);
      if (!Array.isArray(p)) return [];
      parsed = p;
    } catch {
      console.warn('extractMemories: JSON parse failed, raw output:', raw.slice(0, 200));
      return [];
    }

    const now = Date.now();
    return parsed
      .filter(f => typeof f.content === 'string' && typeof f.type === 'string' && f.content.split(' ').length >= 3)
      .map(f => ({
        content: f.content,
        type: (['fact', 'preference', 'project'].includes(f.type) ? f.type : 'fact') as Memory['type'],
        source: 'auto' as const,
        createdAt: now,
      }));
  } catch (err) {
    console.warn('extractMemories failed:', err);
    return [];
  }
};
