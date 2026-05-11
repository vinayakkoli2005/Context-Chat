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
): Promise<Omit<Memory, 'id'>[]> => {
  const userMessages = conversation.messages.filter(m => m.role === 'user');
  if (userMessages.length < 2) return [];

  const transcript = conversation.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    const json = await res.json() as { message: { content: string } };
    const raw = json.message.content.trim();

    const parsed = JSON.parse(raw) as { content: string; type: string }[];
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    return parsed
      .filter(f => typeof f.content === 'string' && f.content.split(' ').length >= 3)
      .map(f => ({
        content: f.content,
        type: (['fact', 'preference', 'project'].includes(f.type) ? f.type : 'fact') as Memory['type'],
        source: 'auto' as const,
        createdAt: now,
      }));
  } catch {
    return [];
  }
};
