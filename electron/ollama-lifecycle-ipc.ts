import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from './ipc-channels';
import { installOllama, isOllamaInstalled } from './ollama-installer';
import {
  startOllama,
  stopOllama,
  ensureOllamaRunning,
  isOllamaRunning,
  isManagedByApp,
  getLogBuffer,
  registerLogListener
} from './ollama-manager';
import { pullModel, cancelPull, isModelInstalled } from './model-puller';
import { listSkills, setActiveSkill, getActiveSkillId } from './skill-library';
import { getSettings, setSettings } from './store';

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

export function registerOllamaLifecycleIpc(): void {
  // --- Ollama install & status ---
  ipcMain.handle(IPC.OLLAMA_IS_INSTALLED, async () => isOllamaInstalled());

  ipcMain.handle(IPC.OLLAMA_INSTALL, async () => {
    const win = focusedWindow();
    await installOllama(win);
    return { ok: true };
  });

  ipcMain.handle(IPC.OLLAMA_START, async () => {
    return startOllama();
  });

  ipcMain.handle(IPC.OLLAMA_STOP, async () => {
    await stopOllama();
    return { ok: true };
  });

  ipcMain.handle(IPC.OLLAMA_STATUS, async () => {
    const running = await isOllamaRunning();
    return { running, spawnedByApp: isManagedByApp(), installed: isOllamaInstalled() };
  });

  ipcMain.handle(IPC.OLLAMA_LOGS, async () => {
    const win = focusedWindow();
    if (win) registerLogListener(win);
    return getLogBuffer();
  });

  // --- Model pull ---
  ipcMain.handle(IPC.OLLAMA_PULL, async (_e, model: string) => {
    const win = focusedWindow();
    if (!await isOllamaRunning()) {
      const result = await ensureOllamaRunning();
      if (!result.ready) {
        throw new Error(`Ollama is not running and could not be started: ${result.reason || 'unknown'}`);
      }
    }
    await pullModel(model, win);
    return { ok: true };
  });

  ipcMain.handle(IPC.MODEL_PULL_CANCEL, async (_e, model: string) => {
    return cancelPull(model);
  });

  // --- Welcome / onboarding ---
  ipcMain.handle(IPC.WELCOME_GET_STATE, async () => {
    const settings = getSettings();
    return {
      decision: settings.welcomeDecision,
      ollamaInstalled: isOllamaInstalled(),
      ollamaRunning: await isOllamaRunning(),
      hasCompletedSetup: settings.hasCompletedSetup
    };
  });

  ipcMain.handle(IPC.WELCOME_SET_DECISION, async (_e, decision: 'accepted' | 'declined') => {
    setSettings({ welcomeDecision: decision });
    return { ok: true };
  });

  ipcMain.handle(IPC.WELCOME_AUTO_SETUP, async (_e, args: { embedModel: string; chatModel: string }) => {
    const win = focusedWindow();
    const send = (step: string, percent: number, message?: string): void => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.WELCOME_AUTO_SETUP_PROGRESS, { step, percent, message });
      }
    };

    try {
      // Step 1: install Ollama if not present
      if (!isOllamaInstalled()) {
        send('install_ollama', 0, 'Downloading Ollama installer');
        await installOllama(win);
        send('install_ollama', 100, 'Ollama installed');
      } else {
        send('install_ollama', 100, 'Ollama already installed');
      }

      // Step 2: start Ollama
      send('start_ollama', 0, 'Starting Ollama service');
      const startResult = await ensureOllamaRunning();
      if (!startResult.ready) {
        throw new Error(`Failed to start Ollama: ${startResult.reason || 'unknown'}`);
      }
      send('start_ollama', 100, 'Ollama is running');

      // Step 3: pull embedding model
      send('pull_embed', 0, `Pulling ${args.embedModel}`);
      if (!await isModelInstalled(args.embedModel)) {
        await pullModel(args.embedModel, win);
      }
      send('pull_embed', 100, `${args.embedModel} ready`);

      // Step 4: pull chat model
      send('pull_chat', 0, `Pulling ${args.chatModel}`);
      if (!await isModelInstalled(args.chatModel)) {
        await pullModel(args.chatModel, win);
      }
      send('pull_chat', 100, `${args.chatModel} ready`);

      // Step 5: persist settings
      setSettings({
        hasCompletedSetup: true,
        welcomeDecision: 'accepted',
        selectedModel: args.chatModel,
        provider: 'ollama'
      });

      send('done', 100, 'Setup complete');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send('error', 0, message);
      throw err;
    }
  });

  // --- Skills library ---
  ipcMain.handle(IPC.SKILL_LIST, async () => {
    return listSkills().map(({ prompt: _prompt, ...rest }) => rest);
  });

  ipcMain.handle(IPC.SKILL_APPLY, async (_e, skillId: string) => {
    setActiveSkill(skillId);
    return { ok: true };
  });

  ipcMain.handle(IPC.SKILL_CLEAR, async () => {
    setActiveSkill(null);
    return { ok: true };
  });

  ipcMain.handle(IPC.SKILL_GET_ACTIVE, async () => {
    return getActiveSkillId();
  });
}
