import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { IPC } from './ipc-channels';
import { getSettings } from './store';

// AirLLM is a Python library (lyogavin/airllm) that runs large models
// (up to 70B) on small VRAM (4GB) by loading layers one at a time.
// We spawn it as a sidecar process and stream tokens back over stdout.
//
// Bundle strategy: we look for python in this order:
//   1. resources/python/python.exe (bundled portable Python)
//   2. system `py` launcher (Windows Python Launcher)
//   3. system `python` on PATH
// If none found, AirLLM fallback is unavailable — caller falls back to Ollama.

let activeSidecar: ChildProcess | null = null;

export type AirLlmStatus =
  | { available: false; reason: string }
  | { available: true; pythonPath: string; airllmInstalled: boolean };

function findPython(): string | null {
  // 1. Bundled portable Python
  const bundled = path.join(process.resourcesPath || '', 'python', 'python.exe');
  if (fs.existsSync(bundled)) return bundled;

  // 2. py launcher
  if (canRun('py', ['--version'])) return 'py';

  // 3. python on PATH
  if (canRun('python', ['--version'])) return 'python';

  return null;
}

function canRun(cmd: string, args: string[]): boolean {
  try {
    const result = require('child_process').spawnSync(cmd, args, {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 3000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getAirLlmStatus(): AirLlmStatus {
  if (!getSettings().enableAirLlmFallback) {
    return { available: false, reason: 'disabled_in_settings' };
  }
  const python = findPython();
  if (!python) {
    return { available: false, reason: 'python_not_found' };
  }

  // Check if airllm is importable
  const check = require('child_process').spawnSync(
    python,
    ['-c', 'import airllm; print(airllm.__version__)'],
    { stdio: 'pipe', windowsHide: true, timeout: 10000 }
  );
  const airllmInstalled = check.status === 0;

  return { available: true, pythonPath: python, airllmInstalled };
}

// Whether to delegate the current inference request to AirLLM instead of Ollama.
// Triggered when the chosen model is very large (>20GB) and the user's VRAM
// is below the model's memory requirement.
export function shouldFallbackToAirLlm(modelName: string, vramGB: number): boolean {
  if (!getSettings().enableAirLlmFallback) return false;

  // Heuristic: estimate model RAM from name
  const sizeMatch = modelName.match(/(\d+)b/i);
  if (!sizeMatch) return false;
  const paramsB = parseInt(sizeMatch[1], 10);
  // Rough rule of thumb for Q4 quantization: paramsB * 0.6 GB
  const estimatedGB = paramsB * 0.6;
  return estimatedGB > vramGB * 1.2; // fall back if model is significantly larger than VRAM
}

// Run AirLLM inference as a sidecar. Streams tokens via IPC.
// The Python script is shipped alongside the app as a resource.
export async function runAirLlmInference(opts: {
  model: string;
  prompt: string;
  win: BrowserWindow | null;
  onToken: (tok: string) => void;
}): Promise<void> {
  const status = getAirLlmStatus();
  if (!status.available) {
    throw new Error(`AirLLM unavailable: ${(status as { reason: string }).reason}`);
  }
  if (!status.airllmInstalled) {
    throw new Error('AirLLM not installed in detected Python environment. Run: pip install airllm');
  }

  const scriptPath = path.join(process.resourcesPath || app.getAppPath(), 'airllm-runner.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`AirLLM runner script missing at ${scriptPath}`);
  }

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      status.pythonPath,
      [scriptPath, '--model', opts.model, '--prompt', opts.prompt],
      { detached: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    activeSidecar = child;

    let buffer = '';
    child.stdout?.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) opts.onToken(line);
      }
    });

    child.stderr?.on('data', chunk => {
      const errLine = chunk.toString();
      if (opts.win && !opts.win.isDestroyed()) {
        opts.win.webContents.send(IPC.OLLAMA_LOGS, `[airllm] ${errLine}`);
      }
    });

    child.on('exit', code => {
      activeSidecar = null;
      if (code === 0) {
        if (buffer.trim()) opts.onToken(buffer);
        resolve();
      } else {
        reject(new Error(`AirLLM sidecar exited with code ${code}`));
      }
    });

    child.on('error', err => {
      activeSidecar = null;
      reject(err);
    });
  });
}

export function cancelAirLlmInference(): void {
  if (activeSidecar) {
    activeSidecar.kill();
    activeSidecar = null;
  }
}
