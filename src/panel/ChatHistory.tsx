import React from 'react';
import type { Message } from '../shared/types';
import { UsedContext } from './UsedContext';

export const ChatHistory: React.FC<{ messages: Message[] }> = ({ messages }) => (
  <div className="flex flex-col gap-2">
    {messages.filter(m => m.role !== 'system').map((m, i) => (
      <div key={i} className={m.role === 'user' ? 'self-end max-w-[85%] bg-blue-500/30 rounded-lg px-2 py-1 text-sm'
                                                : 'self-start max-w-[95%] text-sm text-white/90'}>
        {m.content}
        {m.role === 'assistant' && (
          <UsedContext usedMemories={m.usedMemories} usedSources={m.usedSources} />
        )}
      </div>
    ))}
  </div>
);
