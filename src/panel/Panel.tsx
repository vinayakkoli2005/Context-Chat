import React, { useEffect, useRef, useState } from 'react';
import type { Message } from '../shared/types';
import { ContextPreview } from './ContextPreview';
import { ActionButtons } from './ActionButtons';
import { ChatHistory } from './ChatHistory';
import { ResponseStream } from './ResponseStream';
import { ModelSelector } from './ModelSelector';
import { VoiceButton } from './VoiceButton';

export const Panel: React.FC = () => {
  const [contextText, setContextText] = useState<string>('');
  const [contextImage, setContextImage] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [activeMemoryCount, setActiveMemoryCount] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.cc.send(window.cc.channels.PANEL_READY);
    const offText = window.cc.on(window.cc.channels.CONTEXT_TEXT, (t: string) => {
      setContextText(t);
      setContextImage('');
      window.cc.invoke(window.cc.channels.MEMORY_COUNT)
        .then((count: unknown) => setActiveMemoryCount(Number(count) || 0))
        .catch(() => setActiveMemoryCount(0));
    });
    const offImg  = window.cc.on(window.cc.channels.CONTEXT_IMAGE, (b: string) => {
      setContextImage(b);
      setContextText('');
      window.cc.invoke(window.cc.channels.MEMORY_COUNT)
        .then((count: unknown) => setActiveMemoryCount(Number(count) || 0))
        .catch(() => setActiveMemoryCount(0));
      // Pick best available vision model from installed models
      Promise.all([
        window.cc.invoke(window.cc.channels.HARDWARE_INFO),
        window.cc.invoke(window.cc.channels.MODELS_LIST),
      ]).then(([hw, models]: [any, { name: string }[]]) => {
        const visionKeywords = ['llava', 'moondream', 'bakllava', 'minicpm-v', 'cogvlm', 'vision'];
        const installed = Array.isArray(models) ? models.map(m => m.name) : [];
        const recommended = hw.recommendedVisionModel as string;
        const best =
          installed.find(n => n === recommended) ??
          installed.find(n => visionKeywords.some(k => n.toLowerCase().includes(k))) ??
          installed[0] ??
          recommended;
        setModel(best);
      }).catch((err: Error) => {
        console.error('Failed to auto-select vision model:', err);
      });
    });
    const offTok  = window.cc.on(window.cc.channels.CHAT_TOKEN, (p: { delta: string }) => setStreamBuffer((s) => s + p.delta));
    const offDone = window.cc.on(window.cc.channels.CHAT_DONE, () => {
      setStreaming(false);
      setStreamBuffer((buf) => {
        if (buf) setMessages((m) => [...m, { role: 'assistant', content: buf }]);
        return '';
      });
    });
    const offErr = window.cc.on(window.cc.channels.CHAT_ERROR, (p: { message: string }) => {
      setStreaming(false);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${p.message}` }]);
      setStreamBuffer('');
    });
    window.cc.invoke(window.cc.channels.HARDWARE_INFO).then((hw) => setModel(hw.recommendedTextModel));
    return () => { offText(); offImg(); offTok(); offDone(); offErr(); };
  }, []);

  const send = (prompt: string) => {
    if (streaming || !prompt.trim() || !model) return;
    const userMsg: Message = contextImage
      ? { role: 'user', content: prompt, image: contextImage }
      : { role: 'user', content: prompt };
    setMessages((m) => [...m, userMsg]);
    setStreaming(true);
    setStreamBuffer('');
    setInput('');
    window.cc.invoke(window.cc.channels.CHAT_SEND, { userMessage: userMsg, model }).catch((err: Error) => {
      setStreaming(false);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ IPC error: ${err.message}` }]);
    });
  };

  const abort = () => {
    window.cc.send(window.cc.channels.ABORT_CHAT);
    setStreaming(false);
  };

  const close = () => window.cc.send(window.cc.channels.PANEL_CLOSE);

  return (
    <div className="frosted h-screen w-screen flex flex-col p-3 gap-2">
      <div className="drag-region flex justify-between items-center text-xs text-white/70 select-none">
        <span>ContextChat</span>
        <div className="no-drag flex items-center gap-1">
          {activeMemoryCount > 0 && (
            <span title={`${activeMemoryCount} memories active`} className="text-white/50 text-[10px]">
              🧠 {activeMemoryCount}
            </span>
          )}
          <button onClick={close} className="px-2 hover:text-white">✕</button>
        </div>
      </div>
      <ContextPreview text={contextText} image={contextImage} />
      <div className="border-t border-white/10" />
      <ActionButtons onPick={send} disabled={streaming || !model} />
      <div className="flex-1 overflow-y-auto no-drag">
        <ChatHistory messages={messages} />
        {streaming && <ResponseStream text={streamBuffer} streaming />}
      </div>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
        placeholder="Ask a follow-up..."
        rows={2}
        className="no-drag bg-white/5 rounded p-2 text-sm resize-none focus:outline-none focus:bg-white/10"
      />
      <div className="flex justify-between items-center no-drag">
        <ModelSelector value={model} onChange={setModel} />
        <div className="flex gap-2">
          <VoiceButton
            onTranscript={(text) => setInput((prev) => prev ? `${prev} ${text}` : text)}
            disabled={streaming}
          />
          {streaming && (
            <button onClick={abort} className="px-3 py-1 rounded bg-red-500/80 hover:bg-red-500 text-xs">
              Stop
            </button>
          )}
          <button
            onClick={() => send(input)}
            disabled={streaming || !input.trim()}
            className="px-3 py-1 rounded bg-blue-500/80 hover:bg-blue-500 disabled:opacity-40 text-xs"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
