import React, { useState } from 'react';
import type { UsedMemory } from '../shared/types';

/**
 * The "receipt" shown under an assistant answer: exactly which memories and
 * knowledge-base documents were fed to the model for this reply. Each item has
 * a one-click forget button that permanently removes it from the local store
 * (memory → MEMORY_DELETE, source → RAG_DELETE), so the user stays in control
 * of what the AI knows about them.
 */
export const UsedContext: React.FC<{
  usedMemories?: UsedMemory[];
  usedSources?: string[];
}> = ({ usedMemories = [], usedSources = [] }) => {
  const [open, setOpen] = useState(false);
  const [forgotten, setForgotten] = useState<Set<string>>(new Set());

  const total = usedMemories.length + usedSources.length;
  if (total === 0) return null;

  const markForgotten = (key: string) =>
    setForgotten(prev => new Set(prev).add(key));

  const forgetMemory = (id: string) => {
    markForgotten(`m:${id}`);
    window.cc.invoke(window.cc.channels.MEMORY_DELETE, id).catch(() => {});
  };

  const forgetSource = (source: string) => {
    markForgotten(`s:${source}`);
    window.cc.invoke(window.cc.channels.RAG_DELETE, source).catch(() => {});
  };

  const label = [
    usedMemories.length ? `${usedMemories.length} ${usedMemories.length === 1 ? 'memory' : 'memories'}` : '',
    usedSources.length ? `${usedSources.length} ${usedSources.length === 1 ? 'source' : 'sources'}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="mt-1 text-[11px] text-white/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 hover:text-white/80 no-drag"
        title="What the AI used to answer this"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>🔎 Used {label}</span>
      </button>

      {open && (
        <ul className="mt-1 flex flex-col gap-1 pl-3 border-l border-white/10">
          {usedMemories.map(m => {
            const gone = forgotten.has(`m:${m.id}`);
            return (
              <li key={`m:${m.id}`} className="flex items-start justify-between gap-2">
                <span className={gone ? 'line-through text-white/25' : 'text-white/70'}>
                  🧠 {m.content}
                </span>
                {gone ? (
                  <span className="text-white/25 shrink-0">forgotten</span>
                ) : (
                  <button
                    onClick={() => forgetMemory(m.id)}
                    className="text-red-400/80 hover:text-red-300 shrink-0 no-drag"
                    title="Forget this memory permanently"
                  >
                    forget
                  </button>
                )}
              </li>
            );
          })}
          {usedSources.map(s => {
            const gone = forgotten.has(`s:${s}`);
            return (
              <li key={`s:${s}`} className="flex items-start justify-between gap-2">
                <span className={gone ? 'line-through text-white/25' : 'text-white/70'}>
                  📄 {s}
                </span>
                {gone ? (
                  <span className="text-white/25 shrink-0">removed</span>
                ) : (
                  <button
                    onClick={() => forgetSource(s)}
                    className="text-red-400/80 hover:text-red-300 shrink-0 no-drag"
                    title="Remove this document from the knowledge base"
                  >
                    forget
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
