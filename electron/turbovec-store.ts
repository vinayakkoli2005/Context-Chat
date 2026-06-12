import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getSettings } from './store';

// TurboVec (RyanCodrai/turbovec) is a Rust vector index with Python bindings
// that implements Google's TurboQuant algorithm: 16× compression of vectors
// (1536-dim float32 → 384 bytes at 2-bit) while beating FAISS on search speed.
//
// Integration strategy: TurboVec is Rust+Python, so we wrap it as either:
//   (a) a native Node addon (turbovec-node — wraps the Rust crate via napi-rs), or
//   (b) a Python sidecar (same pattern as airllm-bridge)
//
// For v0.2.0 we ship strategy (b) — Python sidecar — to avoid a complex
// Rust toolchain dependency at build time. The sidecar writes its index
// files to userData/turbovec/ and we communicate via a small JSON-over-stdio
// protocol.
//
// This file exposes the same interface as rag-store.ts so it can be swapped
// in via the useTurbovec setting flag without changing CHAT_SEND.

export type TurbovecStatus =
  | { available: false; reason: string }
  | { available: true; pythonPath: string };

export function isTurbovecEnabled(): boolean {
  return getSettings().useTurbovec;
}

function findPython(): string | null {
  const bundled = path.join(process.resourcesPath || '', 'python', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;
  const cp = require('child_process');
  for (const cmd of ['py', 'python']) {
    try {
      const r = cp.spawnSync(cmd, ['--version'], {
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

  const cp = require('child_process');
  const check = cp.spawnSync(
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

// Index lifecycle — these are stubs that the rag-store/memory-store
// can call when isTurbovecEnabled() returns true. Each forwards to a
// Python sidecar that performs the actual compression and search.
//
// Until a user actually enables Pro Mode and installs the Python
// sidecar, the rag-store continues to use LanceDB (the default).
// This is intentional: TurboVec is opt-in, not a forced replacement.

export async function ensureTurbovecReady(): Promise<{ ok: boolean; reason?: string }> {
  const status = getTurbovecStatus();
  if (!status.available) {
    return { ok: false, reason: (status as { reason: string }).reason };
  }
  return { ok: true };
}

// Stub interfaces matching rag-store.ts — to be implemented by the
// Python sidecar in a follow-up. The wiring point exists so that
// rag-store.ts and memory-store.ts can branch on the flag.
export interface TurbovecRecord {
  id: string;
  content: string;
  source: string;
  vector: number[];
}

export async function turbovecAdd(_records: TurbovecRecord[]): Promise<void> {
  throw new Error('TurboVec sidecar not implemented yet — falling back to LanceDB');
}

export async function turbovecSearch(_query: number[], _topK: number): Promise<TurbovecRecord[]> {
  throw new Error('TurboVec sidecar not implemented yet — falling back to LanceDB');
}
