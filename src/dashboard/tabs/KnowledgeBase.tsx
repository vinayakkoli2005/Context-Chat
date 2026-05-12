import { useEffect, useRef, useState } from 'react';
import type { RagFile } from '../../shared/types';

export default function KnowledgeBase() {
  const [files, setFiles] = useState<RagFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    window.cc.invoke(window.cc.channels.RAG_LIST)
      .then((list: RagFile[]) => { setFiles(list); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFiles = async (filePaths: string[]) => {
    if (filePaths.length === 0) return;
    setIngesting(true);
    setError(null);
    try {
      const result = await window.cc.invoke(window.cc.channels.RAG_INGEST, filePaths);
      if (result.skipped.length > 0) {
        setError(`Skipped: ${result.skipped.join(', ')} — check Ollama is running`);
      }
    } catch {
      setError('Indexing failed — is Ollama running with nomic-embed-text?');
    } finally {
      setIngesting(false);
      load();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const paths: string[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      const fp = (f as unknown as { path: string }).path;
      if (fp) paths.push(fp);
    }
    handleFiles(paths);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const paths: string[] = [];
    if (e.target.files) {
      for (let i = 0; i < e.target.files.length; i++) {
        const f = e.target.files[i];
        const fp = (f as unknown as { path: string }).path;
        if (fp) paths.push(fp);
      }
    }
    handleFiles(paths);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDelete = async (source: string) => {
    if (!window.confirm(`Remove "${source}" from the knowledge base?`)) return;
    await window.cc.invoke(window.cc.channels.RAG_DELETE, source).catch(() => {});
    load();
  };

  if (loading) return <div className="p-4 text-sm text-gray-400">Loading knowledge base...</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-600 hover:border-blue-500 px-6 py-8 cursor-pointer transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf"
          className="hidden"
          onChange={handleInputChange}
        />
        {ingesting ? (
          <span className="text-sm text-blue-400">Indexing…</span>
        ) : (
          <>
            <span className="text-sm text-gray-300">Drop files here or click to browse</span>
            <span className="text-xs text-gray-500">Supports .txt, .md, .pdf</span>
          </>
        )}
      </div>

      {error && (
        <div className="rounded bg-red-900/30 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-gray-400">
          No files indexed yet. Drop files here to add them to your knowledge base.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map(f => (
            <li key={f.source} className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-white">📄 {f.source}</span>
                <span className="text-xs text-gray-400">{f.chunks} chunk{f.chunks !== 1 ? 's' : ''} indexed</span>
              </div>
              <button
                onClick={() => handleDelete(f.source)}
                className="text-xs text-red-400 hover:text-red-300 shrink-0"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
