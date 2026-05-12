/**
 * Shared embedding helper used by memory-store and RAG store.
 * Calls the Ollama embeddings endpoint and returns the embedding vector.
 * Throws on any error — callers are responsible for handling failures.
 */
export async function embedText(text: string, ollamaUrl: string): Promise<number[]> {
  const res = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Embed failed: HTTP ${res.status}`);
  const json = await res.json() as { embedding: number[] };
  return json.embedding;
}
