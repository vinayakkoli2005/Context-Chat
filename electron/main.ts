import { app, ipcMain, BrowserWindow, globalShortcut, clipboard, screen } from 'electron';
import { IPC } from './ipc-channels';
import { createTray } from './tray';
import { showIcon, hideIcon, showPanel, hidePanel, showToast, hideToast, sendToPanel, isPanelOpen, showHistory, showVoiceOverlay, hideVoiceOverlay, showScreenshotBtn, moveScreenshotBtn } from './windows';
import { registerAudioIpc } from './audio-ipc';
import { startSelectionMonitor } from './selection-monitor';
import { startClipboardWatcher } from './clipboard-watcher';
import { listModels, streamChat } from './ai-client';
import { getSettings, setSettings } from './store';
import { detectHardware } from './hardware-detector';
import { createConversation, appendMessage, applyRollingWindow } from './conversation';
import { appendHistory, getHistory, deleteHistoryEntry, exportHistoryMarkdown } from './history-store';
import type { Conversation, Message, HistoryEntry } from '../src/shared/types';
import type { Memory } from '../src/shared/types';
import { initMemoryStore, insertMemory, searchMemories, listAllMemories, deleteMemory, countMemories } from './memory-store';
import { extractMemories } from './memory-extractor';
import { initRagStore, ragSearch } from './rag-store';
import type { RagResult } from './rag-store';
import { registerRagIpc } from './rag-ipc';
import { registerOllamaLifecycleIpc } from './ollama-lifecycle-ipc';
import { ensureOllamaRunning, stopOllama } from './ollama-manager';
import { getActiveSkillPrompt } from './skill-library';

let currentConversation: Conversation | null = null;
let lastSelectionPos = { x: 100, y: 100 };
let pendingScreenshot: string | null = null;
let pendingSelectionText: string | null = null;
let currentAbortController: AbortController | null = null;
let pendingPanelContext: { channel: string; payload: unknown } | null = null;

const ensureSingleInstance = (): boolean => {
  const got = app.requestSingleInstanceLock();
  if (!got) { app.quit(); return false; }
  return true;
};

const setupAutoLaunch = (): void => {
  const settings = getSettings();
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, openAsHidden: true });
};

const handleSelection = (e: { text: string; x: number; y: number }) => {
  if (isPanelOpen()) return;
  lastSelectionPos = { x: e.x, y: e.y };
  pendingScreenshot = null;
  pendingSelectionText = e.text;
  showIcon(e.x + 8, e.y + 8);
};

const openPanelForSelection = () => {
  hideIcon();
  if (!pendingSelectionText) return;
  const settings = getSettings();
  const hw = detectHardware();
  const model = settings.selectedModel || hw.recommendedTextModel;
  currentConversation = createConversation({ type: 'text', value: pendingSelectionText }, model);
  pendingPanelContext = { channel: IPC.CONTEXT_TEXT, payload: pendingSelectionText };
  showPanel(lastSelectionPos.x + 16, lastSelectionPos.y + 16);
};

const openPanelForScreenshot = () => {
  hideToast();
  if (!pendingScreenshot) return;
  const hw = detectHardware();
  const model = hw.recommendedVisionModel;
  currentConversation = createConversation({ type: 'image', value: '[screenshot]' }, model);
  pendingPanelContext = { channel: IPC.CONTEXT_IMAGE, payload: pendingScreenshot };
  showPanel(lastSelectionPos.x, lastSelectionPos.y);
};

const openPanelForClipboard = () => {
  if (isPanelOpen()) return;
  const text = clipboard.readText().trim();
  if (!text) return;
  pendingSelectionText = text;
  const settings = getSettings();
  const hw = detectHardware();
  const model = settings.selectedModel || hw.recommendedTextModel;
  currentConversation = createConversation({ type: 'text', value: text }, model);
  const display = screen.getPrimaryDisplay().workAreaSize;
  pendingPanelContext = { channel: IPC.CONTEXT_TEXT, payload: text };
  showPanel(Math.round(display.width / 2) - 180, Math.round(display.height / 2) - 240);
};

const registerIpc = (): void => {
  ipcMain.on(IPC.PANEL_READY, () => {
    if (pendingPanelContext) {
      sendToPanel(pendingPanelContext.channel, pendingPanelContext.payload);
      pendingPanelContext = null;
    }
  });
  ipcMain.on(IPC.ICON_CLICK, () => openPanelForSelection());
  ipcMain.on(IPC.PANEL_CLOSE, () => {
    hidePanel();
    currentAbortController?.abort();
    currentAbortController = null;
    if (currentConversation) {
      const conv = currentConversation;
      const { ollamaUrl, selectedModel } = getSettings();
      extractMemories(conv, ollamaUrl, selectedModel ?? undefined)
        .then(facts => Promise.all(facts.map(f => insertMemory(f, undefined, ollamaUrl))))
        .catch(err => console.warn('Memory extraction failed:', err));
    }
    currentConversation = null;
  });
  ipcMain.on(IPC.VOICE_CLOSE, () => { hideVoiceOverlay(); });
  ipcMain.on(IPC.TOAST_ACCEPT, () => openPanelForScreenshot());
  ipcMain.on(IPC.TOAST_DISMISS, () => { hideToast(); pendingScreenshot = null; });
  ipcMain.on(IPC.ABORT_CHAT, () => { currentAbortController?.abort(); currentAbortController = null; });

  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());
  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch) => {
    const next = setSettings(patch);
    setupAutoLaunch();
    return next;
  });
  ipcMain.handle(IPC.HARDWARE_INFO, () => detectHardware());
  ipcMain.handle(IPC.MODELS_LIST, async (_e, payload?: { provider?: string; apiKey?: string; ollamaUrl?: string }) => {
    const settings = getSettings();
    const provider = (payload?.provider ?? settings.provider) as 'ollama' | 'openai' | 'anthropic';
    const apiKey = payload?.apiKey ?? (provider === 'openai' ? settings.openaiApiKey : settings.anthropicApiKey);
    const ollamaUrl = payload?.ollamaUrl ?? settings.ollamaUrl;
    return listModels(provider, apiKey, ollamaUrl);
  });

  ipcMain.handle(IPC.CHAT_SEND, async (e, payload: { userMessage: Message; model: string }) => {
    if (!currentConversation) {
      const settings = getSettings();
      const hw = detectHardware();
      const model = settings.selectedModel || hw.recommendedTextModel;
      currentConversation = createConversation({ type: 'text', value: payload.userMessage.content as string }, model);
    }
    currentConversation = appendMessage(currentConversation, payload.userMessage);
    currentConversation = applyRollingWindow(currentConversation);
    currentConversation = { ...currentConversation, model: payload.model };
    const settings = getSettings();
    const [memories, ragChunks] = await Promise.all([
      searchMemories(payload.userMessage.content as string, settings.ollamaUrl).catch(() => [] as Memory[]),
      ragSearch(payload.userMessage.content as string, settings.ollamaUrl).catch(() => [] as RagResult[]),
    ]);

    const memoryBlock = memories.length > 0
      ? `What you remember about this user:\n${memories.map(mem => `- ${mem.content}`).join('\n')}\n\n`
      : '';
    const ragBlock = ragChunks.length > 0
      ? `Relevant context from user's knowledge base:\n${ragChunks.map(c => c.content).join('\n\n')}\n\n`
      : '';
    const skillPrompt = getActiveSkillPrompt();
    const skillBlock = skillPrompt ? `${skillPrompt}\n\n` : '';

    const messagesWithMemory = (skillBlock || memoryBlock || ragBlock)
      ? currentConversation.messages.map((m, i) =>
          i === 0
            ? { ...m, content: `${skillBlock}${memoryBlock}${ragBlock}${m.content}` }
            : m
        )
      : currentConversation.messages;
    const apiKey = settings.provider === 'openai' ? settings.openaiApiKey : settings.anthropicApiKey;
    let assistantBuffer = '';
    const win = BrowserWindow.fromWebContents(e.sender);
    currentAbortController = new AbortController();
    try {
      await streamChat({
        provider: settings.provider,
        apiKey,
        model: payload.model,
        ollamaUrl: settings.ollamaUrl,
        messages: messagesWithMemory,
        onToken: (delta) => {
          assistantBuffer += delta;
          win?.webContents.send(IPC.CHAT_TOKEN, { delta });
        },
        signal: currentAbortController.signal,
      });
      if (ragChunks.length > 0) {
        const uniqueSources = [...new Set(ragChunks.map(c => c.source))];
        assistantBuffer += `\n\n---\n📄 Sources: ${uniqueSources.join(', ')}`;
      }
      currentConversation = appendMessage(currentConversation, { role: 'assistant', content: assistantBuffer });
      win?.webContents.send(IPC.CHAT_DONE, {});
      // Save completed conversation to history
      if (currentConversation) {
        appendHistory({
          id: currentConversation.id,
          startedAt: Date.now(),
          provider: settings.provider,
          model: payload.model,
          context: currentConversation.context,
          messages: currentConversation.messages,
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        if (assistantBuffer) {
          currentConversation = appendMessage(currentConversation, { role: 'assistant', content: assistantBuffer });
        }
        win?.webContents.send(IPC.CHAT_DONE, {});
      } else {
        win?.webContents.send(IPC.CHAT_ERROR, { message: err.message });
      }
    } finally {
      currentAbortController = null;
    }
  });

  ipcMain.handle(IPC.HISTORY_GET, () => getHistory());
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, payload: { id: string }) => {
    deleteHistoryEntry(payload.id);
  });
  ipcMain.handle(IPC.HISTORY_EXPORT, () => exportHistoryMarkdown());

  ipcMain.handle(IPC.MEMORY_LIST, () => listAllMemories());
  ipcMain.handle(IPC.MEMORY_COUNT, () => countMemories());
  ipcMain.handle(IPC.MEMORY_DELETE, (_e, id: string) => deleteMemory(id));
  ipcMain.handle(IPC.MEMORY_ADD, (_e, payload: { content: string; type: Memory['type'] }) => {
    if (!payload?.content?.trim()) return null;
    const { ollamaUrl } = getSettings();
    if (!ollamaUrl) return null;
    return insertMemory({ content: payload.content, type: payload.type, source: 'manual', createdAt: Date.now() }, undefined, ollamaUrl);
  });
  ipcMain.handle(IPC.MEMORY_EXTRACT_FROM_HISTORY, async (_e, entry: HistoryEntry) => {
    const { ollamaUrl, selectedModel } = getSettings();
    const conv: Conversation = { id: entry.id, context: entry.context, model: entry.model, messages: entry.messages };
    const facts = await extractMemories(conv, ollamaUrl, selectedModel ?? undefined).catch(() => []);
    await Promise.all(facts.map(f => insertMemory(f, undefined, ollamaUrl))).catch(() => {});
    return facts.length;
  });

  ipcMain.handle(IPC.OLLAMA_STATUS, async () => {
    const settings = getSettings();
    try {
      const res = await fetch(`${settings.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      return { ok: res.ok, url: settings.ollamaUrl };
    } catch {
      return { ok: false, url: settings.ollamaUrl };
    }
  });

  ipcMain.handle(IPC.OPENAI_STATUS, async () => {
    const settings = getSettings();
    if (!settings.openaiApiKey) return { ok: false };
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${settings.openaiApiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(IPC.ANTHROPIC_STATUS, async () => {
    const settings = getSettings();
    if (!settings.anthropicApiKey) return { ok: false };
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': settings.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(IPC.OLLAMA_PULL, async (e, { model }: { model: string }) => {
    const settings = getSettings();
    try {
      const res = await fetch(`${settings.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model, stream: true }),
      });
      if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status}` };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const win = BrowserWindow.fromWebContents(e.sender);
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            win?.webContents.send(IPC.OLLAMA_PULL_PROGRESS, obj);
          } catch { /* skip malformed */ }
        }
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.SETUP_COMPLETE, async () => {
    return setSettings({ hasCompletedSetup: true });
  });

  ipcMain.handle(IPC.VOICE_SEND, (_e, { text }: { text: string }) => {
    hideVoiceOverlay();
    const settings = getSettings();
    const hw = detectHardware();
    const model = settings.selectedModel || hw.recommendedTextModel;
    currentConversation = createConversation({ type: 'text', value: text }, model);
    const display = screen.getPrimaryDisplay().workAreaSize;
    pendingPanelContext = { channel: IPC.CONTEXT_TEXT, payload: text };
    showPanel(Math.round(display.width / 2) - 180, Math.round(display.height / 2) - 240);
  });

  registerRagIpc();
  registerOllamaLifecycleIpc();
  registerAudioIpc(() => BrowserWindow.getAllWindows()[0] ?? null);

  ipcMain.on(IPC.SCREENSHOT_BTN_CLICK, async () => {
    const { desktopCapturer } = await import('electron');
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor;
    const fullW = Math.round(display.size.width * scale);
    const fullH = Math.round(display.size.height * scale);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: fullW, height: fullH },
    });
    const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0];
    if (!source) return;
    const png = source.thumbnail.toPNG().toString('base64');
    if (!png || png.length < 1000) return; // guard against empty capture
    const hw = detectHardware();
    const model = hw.recommendedVisionModel;
    currentConversation = createConversation({ type: 'image', value: '[screenshot]' }, model);
    pendingPanelContext = { channel: IPC.CONTEXT_IMAGE, payload: png };
    showPanel(Math.round(display.workAreaSize.width / 2) - 180, Math.round(display.workAreaSize.height / 2) - 240);
  });

  ipcMain.on(IPC.SCREENSHOT_BTN_DRAG, (_e, { x, y }: { x: number; y: number }) => {
    moveScreenshotBtn(x, y);
  });
};

const main = async (): Promise<void> => {
  if (!ensureSingleInstance()) return;
  await app.whenReady();
  await initMemoryStore().catch(err => console.warn('Memory store init failed:', err));
  await initRagStore().catch(err => console.warn('RAG store init failed:', err));
  app.setAppUserModelId('com.contextchat.desktop');
  registerIpc();
  createTray();
  setupAutoLaunch();
  startSelectionMonitor(handleSelection, () => {
    // Delay so icon:click IPC (which opens panel) can fire first
    setTimeout(() => { if (pendingSelectionText && !isPanelOpen()) { hideIcon(); pendingSelectionText = null; } }, 150);
  });
  startClipboardWatcher((png) => {
    if (isPanelOpen()) return;
    pendingScreenshot = png;
    showToast();
  });
  globalShortcut.register('CommandOrControl+Shift+Space', openPanelForClipboard);
  globalShortcut.register('CommandOrControl+Shift+V', () => showVoiceOverlay());
  showScreenshotBtn();

  // Zero-terminal: auto-start Ollama in the background if installed.
  ensureOllamaRunning().catch(err => {
    console.warn('[main] Ollama auto-start failed:', err);
  });

  let isQuitting = false;
  app.on('will-quit', (event) => {
    globalShortcut.unregisterAll();
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    // Only kill the Ollama instance we ourselves spawned.
    // stopOllama() is a no-op if Ollama was already running before us.
    stopOllama().catch(() => undefined).finally(() => app.exit(0));
  });
  app.on('window-all-closed', () => { /* keep alive in tray */ });
};

main();
