/**
 * Shared embedding helper used by memory-store and RAG store.
 * Calls the Ollama embeddings endpoint and returns the embedding vector.
 * Throws on any error — callers are responsible for handling failures.
 */

export const EMBEDDING_MODEL = 'nomic-embed-text';

export async function embedText(text: string, ollamaUrl: string): Promise<number[]> {
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const json = await res.json() as { embedding: number[] };
  if (!Array.isArray(json.embedding)) throw new Error('Invalid embedding response: missing embedding array');
  return json.embedding;
}
