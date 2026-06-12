import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, spawn } from 'child_process';
import { getSettings } from './store';

// TurboVec (RyanCodrai/turbovec) implements Google's TurboQuant algorithm:
// 16× compression of vectors (1536-dim float32 → 384 bytes at 2-bit) while
// beating FAISS on search speed. We run it as a Python sidecar so we don't
// have to ship a Rust toolchain or a custom N-API addon.
//
// Sidecar protocol (resources/turbovec-runner.py):
//   add    --index <path> --dim <int> --bits <int>  (records JSON on stdin)
//   search --index <path> --dim <int> --bits <int> --top-k <int> --query <json>
//
// On any failure or when the sidecar isn't installed, callers fall back
// to LanceDB. TurboVec is opt-in via the useTurbovec setting flag.

export type TurbovecStatus =
  | { available: false; reason: string }
  | { available: true; pythonPath: string };

export function isTurbovecEnabled(): boolean {
  return getSettings().useTurbovec;
}

function findPython(): string | null {
  const bundled = path.join(process.resourcesPath || '', 'python', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;
  for (const cmd of ['py', 'python']) {
    try {
      const r = spawnSync(cmd, ['--version'], {
        stdio: 'ignore', windowsHide: true, timeout: 3000
      });
      if (r.status === 0) return cmd;
    } catch { /* keep trying */ }
  }
  return null;
}

export function getTurbovecStatus(): TurbovecStatus {
  if (!isTurbovecEnabled()) {
    return { available: false, reason: 'disabled_in_settings' };
  }
  const python = findPython();
  if (!python) return { available: false, reason: 'python_not_found' };

  const check = spawnSync(
    python,
    ['-c', 'import turbovec; print(turbovec.__version__)'],
    { stdio: 'pipe', windowsHide: true, timeout: 10000 }
  );
  if (check.status !== 0) {
    return { available: false, reason: 'turbovec_not_installed' };
  }
  return { available: true, pythonPath: python };
}

export function getTurbovecIndexPath(): string {
  const dir = path.join(app.getPath('userData'), 'turbovec');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'index.tv');
}

function getRunnerPath(): string {
  return path.join(process.resourcesPath || app.getAppPath(), 'turbovec-runner.py');
}

export async function ensureTurbovecReady(): Promise<{ ok: boolean; reason?: string }> {
  const status = getTurbovecStatus();
  if (!status.available) {
    return { ok: false, reason: (status as { reason: string }).reason };
  }
  if (!fs.existsSync(getRunnerPath())) {
    return { ok: false, reason: 'runner_script_missing' };
  }
  return { ok: true };
}

export interface TurbovecRecord {
  id: string;
  content: string;
  source: string;
  chunkIndex: number;
  vector: number[];
}

export interface TurbovecSearchResult {
  id: string;
  content: string;
  source: string;
  chunkIndex: number;
  score: number;
}

// Compression config — 2-bit gives 16× compression for the typical 1536-dim
// embedding model (nomic-embed-text outputs 768-dim, so compression is ~8×).
// Bits can be tuned later via setting; 2 is the published TurboQuant default.
const TURBOVEC_BITS = 2;

async function runSidecar(args: string[], stdinJson?: unknown): Promise<string> {
  const status = getTurbovecStatus();
  if (!status.available) {
    throw new Error(`TurboVec unavailable: ${(status as { reason: string }).reason}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(status.pythonPath, [getRunnerPath(), ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('exit', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`turbovec sidecar exit ${code}: ${err.trim()}`));
    });
    child.on('error', reject);
    if (stdinJson !== undefined) {
      child.stdin.write(JSON.stringify(stdinJson));
    }
    child.stdin.end();
  });
}

export async function turbovecAdd(records: TurbovecRecord[]): Promise<void> {
  if (records.length === 0) return;
  const dim = records[0].vector.length;
  await runSidecar(
    ['add', '--index', getTurbovecIndexPath(), '--dim', String(dim), '--bits', String(TURBOVEC_BITS)],
    { records }
  );
}

export async function turbovecSearch(
  query: number[],
  topK: number
): Promise<TurbovecSearchResult[]> {
  if (!fs.existsSync(getTurbovecIndexPath())) return [];
  const out = await runSidecar(
    [
      'search',
      '--index', getTurbovecIndexPath(),
      '--dim', String(query.length),
      '--bits', String(TURBOVEC_BITS),
      '--top-k', String(topK)
    ],
    { query }
  );
  try {
    const parsed = JSON.parse(out);
    return parsed.results as TurbovecSearchResult[];
  } catch (err) {
    throw new Error(`Failed to parse TurboVec search output: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function turbovecDelete(source: string): Promise<void> {
  await runSidecar(
    ['delete', '--index', getTurbovecIndexPath(), '--source', source]
  );
}
