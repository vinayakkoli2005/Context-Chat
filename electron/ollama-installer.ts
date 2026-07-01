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

// Verify the downloaded installer's Authenticode signature before executing it.
// HTTPS authenticates the download channel but not the bytes; a network attacker
// (rogue CA, MITM proxy, hijacked CDN) could otherwise swap in a trojaned exe
// that we run silently. We can't pin a SHA-256 because the URL is a rolling
// "latest", so instead we require a VALID signature from the expected publisher.
function verifyAuthenticode(filePath: string, expectedSigner: RegExp): Promise<void> {
  return new Promise((resolve, reject) => {
    // Path is app-controlled (userData), but double any quote for a safe PS literal.
    const safePath = filePath.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $s = Get-AuthenticodeSignature -LiteralPath '${safePath}'; Write-Output $s.Status; if ($s.SignerCertificate) { Write-Output $s.SignerCertificate.Subject } else { Write-Output '' }`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    ps.stdout.on('data', d => { out += d.toString(); });
    ps.on('error', reject);
    ps.on('exit', () => {
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const status = lines[0] ?? '';
      const subject = lines.slice(1).join(' ');
      if (status !== 'Valid') {
        reject(new Error(`Installer signature is not valid (status: ${status || 'unknown'}). Refusing to run a possibly tampered file.`));
        return;
      }
      if (!expectedSigner.test(subject)) {
        reject(new Error(`Installer signed by an unexpected publisher (${subject || 'unknown'}). Refusing to run.`));
        return;
      }
      resolve();
    });
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

    // Reject anything not validly signed by Ollama before we execute it.
    await verifyAuthenticode(installerPath, /Ollama/i);

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
