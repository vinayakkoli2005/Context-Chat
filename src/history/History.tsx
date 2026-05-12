import React, { useEffect, useState } from 'react';
import type { HistoryEntry, Message } from '../shared/types';

export const History: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<string | null>(null);

  const load = async () => {
    const data = await window.cc.invoke(window.cc.channels.HISTORY_GET);
    setEntries(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleExtract = async (entry: HistoryEntry) => {
    setExtracting(true);
    setExtractResult(null);
    const count = await window.cc.invoke(window.cc.channels.MEMORY_EXTRACT_FROM_HISTORY, entry).catch(() => 0);
    setExtracting(false);
    setExtractResult(count > 0 ? `✓ ${count} memor${count === 1 ? 'y' : 'ies'} saved` : 'Nothing worth remembering found');
    setTimeout(() => setExtractResult(null), 3000);
  };

  const handleDelete = async (id: string) => {
    await window.cc.invoke(window.cc.channels.HISTORY_DELETE, { id });
    setEntries(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleExport = async () => {
    const markdown = await window.cc.invoke(window.cc.channels.HISTORY_EXPORT);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `contextchat-history-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const preview = (entry: HistoryEntry): string => {
    const first = entry.messages.find(m => m.role === 'user');
    const text = first?.content ?? entry.context.value;
    return text.slice(0, 60) + (text.length > 60 ? '…' : '');
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) {
    return <div className={`${embedded ? 'h-full' : 'h-screen'} flex items-center justify-center text-white/60 text-sm`}>Loading…</div>;
  }

  return (
    <div className={`${embedded ? 'h-full' : 'h-screen'} flex flex-col bg-gray-900 text-white text-sm`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-white/10">
        <span className="font-semibold">History ({entries.length})</span>
        <button
          onClick={handleExport}
          disabled={entries.length === 0}
          className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs"
        >
          Export All
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: entry list */}
        <div className="w-60 flex-shrink-0 border-r border-white/10 overflow-y-auto">
          {entries.length === 0 && (
            <div className="p-4 text-white/40 text-xs">No history yet</div>
          )}
          {entries.map(e => (
            <button
              key={e.id}
              onClick={() => setSelected(e)}
              className={`w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/5 ${selected?.id === e.id ? 'bg-white/10' : ''}`}
            >
              <div className="text-xs text-white/50 mb-0.5">{formatDate(e.startedAt)}</div>
              <div className="text-xs font-medium text-blue-400 mb-0.5">{e.provider} · {e.model}</div>
              <div className="text-xs text-white/70 truncate">{preview(e)}</div>
            </button>
          ))}
        </div>

        {/* Right: conversation detail */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selected ? (
            <div className="text-white/30 text-xs mt-8 text-center">Select a conversation</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-white/50">{formatDate(selected.startedAt)}</div>
                  <div className="text-xs text-blue-400">{selected.provider} · {selected.model}</div>
                </div>
                <div className="flex items-center gap-2">
                  {extractResult && (
                    <span className="text-xs text-green-400">{extractResult}</span>
                  )}
                  <button
                    onClick={() => handleExtract(selected)}
                    disabled={extracting}
                    className="text-xs text-purple-400 hover:text-purple-300 px-2 py-1 rounded border border-purple-400/30 hover:border-purple-300/50 disabled:opacity-40"
                  >
                    {extracting ? 'Extracting…' : '🧠 Extract to Memory'}
                  </button>
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-400/30 hover:border-red-300/50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {selected.context.type === 'text' && (
                <div className="bg-white/5 rounded p-2 text-xs text-white/60 border-l-2 border-blue-500 italic">
                  "{selected.context.value.slice(0, 120)}{selected.context.value.length > 120 ? '…' : ''}"
                </div>
              )}

              {selected.messages.filter(m => m.role !== 'system').map((msg: Message, i: number) => (
                <div
                  key={i}
                  className={`rounded p-3 text-sm ${msg.role === 'user' ? 'bg-blue-600/20 border border-blue-500/20' : 'bg-white/5 border border-white/10'}`}
                >
                  <div className="text-xs text-white/40 mb-1">{msg.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div className="whitespace-pre-wrap text-white/90">{msg.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
