import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { spawn } from 'child_process';
import { IPC } from './ipc-channels';

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download/OllamaSetup.exe';
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
const OLLAMA_EXE_PATH = path.join(LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');

export type InstallStatus =
  | { phase: 'idle' }
  | { phase: 'downloading'; percent: number; bytes: number; total: number }
  | { phase: 'installing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export function isOllamaInstalled(): boolean {
  return fs.existsSync(OLLAMA_EXE_PATH);
}

export function getOllamaExePath(): string {
  return OLLAMA_EXE_PATH;
}

function getInstallerPath(): string {
  const dir = path.join(app.getPath('userData'), 'installers');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'OllamaSetup.exe');
}

function sendProgress(win: BrowserWindow | null, status: InstallStatus): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.OLLAMA_INSTALL_PROGRESS, status);
  }
}

function downloadFile(url: string, dest: string, onProgress: (bytes: number, total: number) => void, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const next = res.headers.location;
        if (!next) {
          reject(new Error('Redirect with no Location header'));
          return;
        }
        downloadFile(next, dest, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', chunk => {
        received += chunk.length;
        onProgress(received, total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', err => {
        fs.unlink(dest, () => reject(err));
      });
    }).on('error', reject);
  });
}

function runSilentInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(installerPath, ['/S'], {
      detached: false,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Installer exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

export async function installOllama(win: BrowserWindow | null): Promise<void> {
  if (isOllamaInstalled()) {
    sendProgress(win, { phase: 'done' });
    return;
  }

  const installerPath = getInstallerPath();

  try {
    sendProgress(win, { phase: 'downloading', percent: 0, bytes: 0, total: 0 });
    await downloadFile(OLLAMA_DOWNLOAD_URL, installerPath, (bytes, total) => {
      const percent = total > 0 ? Math.floor((bytes / total) * 100) : 0;
      sendProgress(win, { phase: 'downloading', percent, bytes, total });
    });

    sendProgress(win, { phase: 'installing' });
    await runSilentInstaller(installerPath);

    // Wait a moment for the install to settle
    await new Promise(r => setTimeout(r, 2000));

    if (!isOllamaInstalled()) {
      throw new Error('Install completed but ollama.exe was not found at expected path');
    }

    sendProgress(win, { phase: 'done' });

    // Clean up installer file
    try { fs.unlinkSync(installerPath); } catch { /* ignore */ }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendProgress(win, { phase: 'error', message });
    throw err;
  }
}
