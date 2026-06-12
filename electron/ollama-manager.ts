import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { getOllamaExePath, isOllamaInstalled } from './ollama-installer';
import { IPC } from './ipc-channels';

const OLLAMA_PORT = 11434;
const HEALTH_INTERVAL_MS = 10_000;
const MAX_RESTARTS = 3;
const LOG_BUFFER_LINES = 500;

let child: ChildProcess | null = null;
let wasSpawnedByApp = false;
let healthTimer: NodeJS.Timeout | null = null;
let restartAttempts = 0;
let lastKnownStatus: 'running' | 'stopped' | 'unknown' = 'unknown';
const logBuffer: string[] = [];
const listeners = new Set<BrowserWindow>();

function getLogFilePath(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'ollama.log');
}

function appendLog(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  logBuffer.push(stamped);
  if (logBuffer.length > LOG_BUFFER_LINES) logBuffer.shift();

  try {
    fs.appendFileSync(getLogFilePath(), stamped + '\n');
  } catch { /* ignore */ }

  broadcastLog(stamped);
}

function broadcastLog(line: string): void {
  for (const win of listeners) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.OLLAMA_LOGS, line);
    }
  }
}

function broadcastStatus(status: 'running' | 'stopped' | 'unknown'): void {
  if (status === lastKnownStatus) return;
  lastKnownStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.OLLAMA_STATUS, { running: status === 'running', spawnedByApp: wasSpawnedByApp });
    }
  }
}

export function registerLogListener(win: BrowserWindow): void {
  listeners.add(win);
  // Send recent buffer on registration
  for (const line of logBuffer.slice(-50)) {
    win.webContents.send(IPC.OLLAMA_LOGS, line);
  }
  win.on('closed', () => listeners.delete(win));
}

export function getLogBuffer(): string[] {
  return [...logBuffer];
}

export function pingOllama(timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function isOllamaRunning(): Promise<boolean> {
  return pingOllama();
}

export function isManagedByApp(): boolean {
  return wasSpawnedByApp && child !== null && !child.killed;
}

export async function startOllama(): Promise<{ started: boolean; alreadyRunning: boolean }> {
  if (await pingOllama()) {
    appendLog('Ollama already running — using existing instance (not managed by app)');
    broadcastStatus('running');
    return { started: false, alreadyRunning: true };
  }

  if (!isOllamaInstalled()) {
    throw new Error('Ollama is not installed at expected path');
  }

  const exe = getOllamaExePath();
  appendLog(`Spawning ollama serve from ${exe}`);

  child = spawn(exe, ['serve'], {
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  wasSpawnedByApp = true;
  restartAttempts = 0;

  child.stdout?.on('data', buf => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) appendLog(`[stdout] ${line}`);
    }
  });
  child.stderr?.on('data', buf => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) appendLog(`[stderr] ${line}`);
    }
  });

  child.on('exit', async code => {
    appendLog(`Ollama process exited with code ${code}`);
    const previouslyManaged = wasSpawnedByApp;
    child = null;
    broadcastStatus('stopped');

    // Auto-restart if we still own it and haven't hit the limit
    if (previouslyManaged && restartAttempts < MAX_RESTARTS) {
      restartAttempts++;
      appendLog(`Auto-restarting (attempt ${restartAttempts}/${MAX_RESTARTS})`);
      await new Promise(r => setTimeout(r, 1500));
      try {
        await startOllama();
      } catch (err) {
        appendLog(`Auto-restart failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (previouslyManaged) {
      appendLog('Auto-restart limit reached — manual intervention required');
      wasSpawnedByApp = false;
    }
  });

  child.on('error', err => {
    appendLog(`Spawn error: ${err.message}`);
  });

  // Wait for the server to become reachable
  const ready = await waitForReady(15_000);
  if (!ready) {
    throw new Error('Ollama failed to become reachable within 15 seconds');
  }

  broadcastStatus('running');
  startHealthCheck();
  return { started: true, alreadyRunning: false };
}

async function waitForReady(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingOllama(1000)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export async function stopOllama(): Promise<void> {
  // ONLY stop instances we spawned
  if (!wasSpawnedByApp || !child) {
    appendLog('Stop requested but no app-managed instance — leaving any existing instance alone');
    return;
  }

  stopHealthCheck();
  appendLog('Killing app-managed Ollama process');

  const c = child;
  wasSpawnedByApp = false;
  child = null;

  return new Promise(resolve => {
    let resolved = false;
    const done = (): void => { if (!resolved) { resolved = true; resolve(); } };

    c.once('exit', done);
    c.kill();

    // Force kill after 5s if needed
    setTimeout(() => {
      if (!c.killed) {
        c.kill('SIGKILL');
      }
      done();
    }, 5000);
  });
}

function startHealthCheck(): void {
  stopHealthCheck();
  healthTimer = setInterval(async () => {
    const running = await pingOllama();
    broadcastStatus(running ? 'running' : 'stopped');
  }, HEALTH_INTERVAL_MS);
}

function stopHealthCheck(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

export async function ensureOllamaRunning(): Promise<{ ready: boolean; managed: boolean; reason?: string }> {
  if (await pingOllama()) {
    broadcastStatus('running');
    startHealthCheck();
    return { ready: true, managed: false };
  }
  if (!isOllamaInstalled()) {
    return { ready: false, managed: false, reason: 'not_installed' };
  }
  try {
    await startOllama();
    return { ready: true, managed: true };
  } catch (err) {
    return { ready: false, managed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
