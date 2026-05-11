import { useEffect, useState } from 'react';
import type { Memory } from '../../shared/types';

export default function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<Memory['type']>('fact');
  const [loading, setLoading] = useState(true);

  const load = () => {
    window.cc.invoke(window.cc.channels.MEMORY_LIST)
      .then((list: Memory[]) => { setMemories(list); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    await window.cc.invoke(window.cc.channels.MEMORY_DELETE, id).catch(() => {});
    load();
  };

  const handleAdd = async () => {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    await window.cc.invoke(window.cc.channels.MEMORY_ADD, { content: trimmed, type: newType }).catch(() => {});
    setNewContent('');
    load();
  };

  if (loading) return <div className="p-4 text-sm text-gray-400">Loading memories...</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          placeholder="Add a memory — e.g. I prefer dark mode"
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <select
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-white"
          value={newType}
          onChange={e => setNewType(e.target.value as Memory['type'])}
        >
          <option value="fact">Fact</option>
          <option value="preference">Preference</option>
          <option value="project">Project</option>
        </select>
        <button
          onClick={handleAdd}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          Save
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="text-sm text-gray-400">
          No memories yet. Start chatting and the AI will remember what matters.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...memories].sort((a, b) => b.createdAt - a.createdAt).map(m => (
            <li key={m.id} className="flex items-start justify-between gap-3 rounded-lg bg-gray-800 px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-white">{m.content}</span>
                <div className="flex gap-1.5">
                  <span className="rounded px-1.5 py-0.5 text-xs bg-gray-700 text-gray-300">{m.type}</span>
                  <span className="rounded px-1.5 py-0.5 text-xs bg-gray-700 text-gray-400">{m.source}</span>
                  <span className="text-xs text-gray-500">{new Date(m.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(m.id)}
                className="mt-0.5 text-xs text-red-400 hover:text-red-300 shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
