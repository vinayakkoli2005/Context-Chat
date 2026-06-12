import { BrowserWindow } from 'electron';
import * as http from 'http';
import { IPC } from './ipc-channels';

const OLLAMA_URL = 'http://127.0.0.1:11434';

export type PullProgress = {
  model: string;
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent: number;
  done: boolean;
  error?: string;
};

const activePulls = new Map<string, http.ClientRequest>();

export function cancelPull(model: string): boolean {
  const req = activePulls.get(model);
  if (req) {
    req.destroy();
    activePulls.delete(model);
    return true;
  }
  return false;
}

export function pullModel(model: string, win: BrowserWindow | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: model, stream: true });
    const req = http.request(
      `${OLLAMA_URL}/api/pull`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        if (res.statusCode !== 200) {
          activePulls.delete(model);
          reject(new Error(`Pull failed: HTTP ${res.statusCode}`));
          return;
        }

        let buffer = '';
        let latestTotal = 0;
        let latestCompleted = 0;

        res.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.total) latestTotal = json.total;
              if (json.completed) latestCompleted = json.completed;
              const percent = latestTotal > 0
                ? Math.floor((latestCompleted / latestTotal) * 100)
                : 0;

              const progress: PullProgress = {
                model,
                status: json.status || 'working',
                digest: json.digest,
                total: latestTotal,
                completed: latestCompleted,
                percent,
                done: false,
                error: json.error
              };

              if (win && !win.isDestroyed()) {
                win.webContents.send(IPC.OLLAMA_PULL_PROGRESS, progress);
              }

              if (json.error) {
                activePulls.delete(model);
                reject(new Error(json.error));
                return;
              }
            } catch {
              // ignore malformed JSON lines
            }
          }
        });

        res.on('end', () => {
          activePulls.delete(model);
          const finalProgress: PullProgress = {
            model,
            status: 'success',
            percent: 100,
            done: true
          };
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC.OLLAMA_PULL_PROGRESS, finalProgress);
          }
          resolve();
        });

        res.on('error', err => {
          activePulls.delete(model);
          reject(err);
        });
      }
    );

    req.on('error', err => {
      activePulls.delete(model);
      // 'aborted' is expected when user cancels
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET' || req.destroyed) {
        resolve();
      } else {
        reject(err);
      }
    });

    activePulls.set(model, req);
    req.write(body);
    req.end();
  });
}

export async function isModelInstalled(model: string): Promise<boolean> {
  return new Promise(resolve => {
    http.get(`${OLLAMA_URL}/api/tags`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const models: Array<{ name: string }> = json.models || [];
          const baseName = model.split(':')[0];
          resolve(models.some(m => m.name === model || m.name.startsWith(baseName + ':')));
        } catch {
          resolve(false);
        }
      });
      res.on('error', () => resolve(false));
    }).on('error', () => resolve(false));
  });
}
