import { app } from 'electron';
import { join, resolve as resolvePath, dirname, sep } from 'node:path';
import { existsSync, mkdirSync, createWriteStream, createReadStream, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import https from 'node:https';

const whisperDir = () => join(app.getPath('userData'), 'whisper');
const modelPath = () => join(whisperDir(), 'ggml-base.en.bin');

// Binary may live in a subfolder alongside its DLLs — find and cache the path
let _binaryPath: string | null = null;
const binaryPath = (): string => {
  if (_binaryPath && existsSync(_binaryPath)) return _binaryPath;
  for (const name of ['whisper-cli.exe', 'main.exe']) {
    const found = findFile(whisperDir(), name);
    if (found) { _binaryPath = found; return found; }
  }
  return join(whisperDir(), 'whisper-cli.exe'); // fallback (will fail gracefully)
};

const BINARY_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true';

// Pinned SHA-256 of the exact artifacts referenced above. HTTPS authenticates
// the connection but NOT the bytes; verifying these before we extract/run the
// binary prevents a network attacker (rogue CA, MITM proxy, hijacked CDN) from
// substituting a trojaned executable that we would otherwise run silently.
const EXPECTED_BINARY_SHA256 = '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e';
const EXPECTED_MODEL_SHA256 = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';

export type DownloadProgressCallback = (stage: 'binary' | 'model', percent: number) => void;

const sha256File = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(filePath);
    rs.on('data', (d) => hash.update(d));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });

const downloadFile = (url: string, dest: string, onProgress: (percent: number) => void, expectedSha256?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const finish = () => {
      if (!expectedSha256) { resolve(); return; }
      sha256File(dest).then((actual) => {
        if (actual.toLowerCase() === expectedSha256.toLowerCase()) { resolve(); return; }
        try { unlinkSync(dest); } catch { /* best effort */ }
        reject(new Error(`Checksum mismatch for ${dest}: expected ${expectedSha256}, got ${actual}. Refusing to use a tampered download.`));
      }).catch(reject);
    };
    const follow = (u: string, redirects = 0) => {
      if (redirects > 10) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'contextchat-desktop/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
          res.resume();
          if (!res.headers.location) { reject(new Error('Redirect with no location')); return; }
          const next = res.headers.location.startsWith('http') ? res.headers.location : `https://${parsed.hostname}${res.headers.location}`;
          follow(next, redirects + 1);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;
        const stream = createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total) onProgress(Math.round((received / total) * 100));
          stream.write(chunk);
        });
        res.on('end', () => stream.end());
        stream.on('finish', finish);
        stream.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });

// Walk a directory recursively to find a file by name
const findFile = (dir: string, name: string): string | null => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
};

const extractZip = async (zipPath: string, destDir: string): Promise<void> => {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const root = resolvePath(destDir);
  // Zip Slip guard: extract entries manually and reject any whose resolved
  // path escapes destDir (e.g. entries named "..\..\Startup\evil.exe").
  for (const entry of zip.getEntries()) {
    const target = resolvePath(destDir, entry.entryName);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Blocked unsafe zip entry (path traversal): ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
};

export const ensureWhisper = async (onProgress: DownloadProgressCallback): Promise<void> => {
  mkdirSync(whisperDir(), { recursive: true });

  if (!findFile(whisperDir(), 'whisper-cli.exe') && !findFile(whisperDir(), 'main.exe')) {
    const zipPath = join(whisperDir(), 'whisper-bin.zip');
    await downloadFile(BINARY_URL, zipPath, (p) => onProgress('binary', p), EXPECTED_BINARY_SHA256);
    await extractZip(zipPath, whisperDir());
    _binaryPath = null; // reset cache after extraction
  }

  if (!existsSync(modelPath())) {
    await downloadFile(MODEL_URL, modelPath(), (p) => onProgress('model', p), EXPECTED_MODEL_SHA256);
  }
};

export const isWhisperReady = (): boolean =>
  !!(findFile(whisperDir(), 'whisper-cli.exe') || findFile(whisperDir(), 'main.exe')) && existsSync(modelPath());

export const transcribe = (wavPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const bin = binaryPath();
    const proc = spawn(bin, [
      '-m', modelPath(),
      '-f', wavPath,
      '--no-timestamps',
      '-l', 'en',
    ], { cwd: join(bin, '..') });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`whisper exited ${code}: ${err}`));
      else resolve(out.replace(/\[.*?\]/g, '').trim());
    });
  });
