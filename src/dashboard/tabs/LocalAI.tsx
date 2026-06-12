import React, { useEffect, useState, useCallback } from 'react';
import type { Settings } from '../../shared/types';

type OllamaStatus = { running: boolean; spawnedByApp: boolean; installed: boolean };
type InstallProgress =
  | { phase: 'idle' }
  | { phase: 'downloading'; percent: number; bytes: number; total: number }
  | { phase: 'installing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };
type PullProgress = {
  model: string;
  status: string;
  percent: number;
  done: boolean;
  error?: string;
};

const REQUIRED_MODELS = [
  { id: 'nomic-embed-text', label: 'Embedding model (nomic-embed-text)', size: '~270MB' },
  { id: 'llama3.2', label: 'Chat model (llama3.2)', size: '~2GB' },
];

const LocalAI: React.FC = () => {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress>({ phase: 'idle' });
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setLocalSettings] = useState<Settings | null>(null);

  useEffect(() => {
    window.cc.invoke(window.cc.channels.SETTINGS_GET).then((s: Settings) => setLocalSettings(s));
  }, []);

  const toggleSetting = async (key: 'enableAirLlmFallback' | 'useTurbovec') => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setLocalSettings(next);
    await window.cc.invoke(window.cc.channels.SETTINGS_SET, { [key]: next[key] });
  };

  const refreshStatus = useCallback(async () => {
    try {
      const s: OllamaStatus = await window.cc.invoke(window.cc.channels.OLLAMA_STATUS);
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    const off1 = window.cc.on(window.cc.channels.OLLAMA_INSTALL_PROGRESS, (p: InstallProgress) => {
      setInstallProgress(p);
    });
    const off2 = window.cc.on(window.cc.channels.OLLAMA_PULL_PROGRESS, (p: PullProgress) => {
      setPullProgress(prev => ({ ...prev, [p.model]: p }));
    });
    const off3 = window.cc.on(window.cc.channels.OLLAMA_LOGS, (line: string) => {
      setLogs(prev => [...prev.slice(-200), line]);
    });
    return () => { off1(); off2(); off3(); };
  }, []);

  const handleInstall = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.cc.invoke(window.cc.channels.OLLAMA_INSTALL);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.cc.invoke(window.cc.channels.OLLAMA_START);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setError(null);
    try {
      await window.cc.invoke(window.cc.channels.OLLAMA_STOP);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePull = async (model: string) => {
    setError(null);
    try {
      await window.cc.invoke(window.cc.channels.OLLAMA_PULL, model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancelPull = async (model: string) => {
    await window.cc.invoke(window.cc.channels.MODEL_PULL_CANCEL, model);
  };

  const handleViewLogs = async () => {
    setShowLogs(true);
    const initial: string[] = await window.cc.invoke(window.cc.channels.OLLAMA_LOGS);
    setLogs(initial);
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h2 className="text-lg font-semibold mb-4">Local AI</h2>

      {/* Status banner */}
      <div className="mb-6 p-4 rounded bg-gray-800 border border-white/10">
        <div className="flex items-center gap-3 mb-2">
          <span className={`w-3 h-3 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-medium">
            {status?.running ? 'Ollama is running' : 'Ollama is not running'}
          </span>
          {status?.spawnedByApp && (
            <span className="text-xs text-white/40">(managed by ContextChat)</span>
          )}
        </div>
        <p className="text-xs text-white/50">
          {status?.installed
            ? 'Ollama is installed on your system.'
            : 'Ollama is not installed. Click below to install automatically — no terminal needed.'}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-900/30 border border-red-500/30 text-red-200 text-xs">
          {error}
        </div>
      )}

      {/* Install Ollama */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">1. Install Ollama</h3>
        {!status?.installed ? (
          <>
            <button
              onClick={handleInstall}
              disabled={busy || installProgress.phase === 'downloading' || installProgress.phase === 'installing'}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm"
            >
              {installProgress.phase === 'downloading' ? 'Downloading…' :
               installProgress.phase === 'installing' ? 'Installing…' :
               'Install Ollama'}
            </button>
            {installProgress.phase === 'downloading' && (
              <div className="mt-3">
                <div className="h-2 bg-gray-700 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${installProgress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-white/40 mt-1">
                  {installProgress.percent}% — {(installProgress.bytes / 1024 / 1024).toFixed(1)}MB
                </p>
              </div>
            )}
            {installProgress.phase === 'error' && (
              <p className="text-xs text-red-300 mt-2">Install failed: {installProgress.message}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-green-300">✓ Ollama installed</p>
        )}
      </section>

      {/* Start / Stop Ollama */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">2. Run Ollama</h3>
        {status?.running ? (
          status.spawnedByApp ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
            >
              Stop Ollama (managed)
            </button>
          ) : (
            <p className="text-xs text-white/50">Ollama is already running from another source — leaving it alone.</p>
          )
        ) : (
          <button
            onClick={handleStart}
            disabled={!status?.installed || busy}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm"
          >
            Start Ollama
          </button>
        )}
      </section>

      {/* Pull models */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">3. Download required models</h3>
        <div className="space-y-3">
          {REQUIRED_MODELS.map(m => {
            const p = pullProgress[m.id];
            return (
              <div key={m.id} className="p-3 bg-gray-800 rounded border border-white/10">
                <div className="flex justify-between items-center mb-1">
                  <div>
                    <div className="text-sm">{m.label}</div>
                    <div className="text-xs text-white/40">{m.size}</div>
                  </div>
                  {!p || p.done ? (
                    <button
                      onClick={() => handlePull(m.id)}
                      disabled={!status?.running}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
                    >
                      {p?.done ? 'Re-pull' : 'Pull'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCancelPull(m.id)}
                      className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {p && !p.done && (
                  <>
                    <div className="h-1.5 bg-gray-700 rounded overflow-hidden mt-2">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${p.percent}%` }} />
                    </div>
                    <div className="text-xs text-white/40 mt-1">{p.status} — {p.percent}%</div>
                  </>
                )}
                {p?.error && <div className="text-xs text-red-300 mt-1">{p.error}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Pro Mode toggles */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">Pro Mode</h3>
        <p className="text-xs text-white/40 mb-3">
          Advanced features. Both require a working Python install on your system.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 bg-gray-800 rounded border border-white/10 cursor-pointer hover:bg-gray-750">
            <input
              type="checkbox"
              checked={settings?.enableAirLlmFallback ?? false}
              onChange={() => toggleSetting('enableAirLlmFallback')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">AirLLM fallback for large models</div>
              <div className="text-xs text-white/50 mt-1">
                When the chosen model exceeds available VRAM, route inference through
                AirLLM&apos;s layer-by-layer runner instead of crashing. Enables 70B
                models on as little as 4GB VRAM. Slower than Ollama for models that
                fit normally — only used when needed.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 bg-gray-800 rounded border border-white/10 cursor-pointer hover:bg-gray-750">
            <input
              type="checkbox"
              checked={settings?.useTurbovec ?? false}
              onChange={() => toggleSetting('useTurbovec')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">TurboVec compressed vector index</div>
              <div className="text-xs text-white/50 mt-1">
                Store RAG vectors 16× smaller using TurboQuant compression. Lets
                100,000+ chunks fit under 1GB RAM. Falls back to LanceDB if the
                Python sidecar isn&apos;t installed — your data is never lost.
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Logs viewer */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold mb-2">System logs</h3>
        {!showLogs ? (
          <button
            onClick={handleViewLogs}
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          >
            View Ollama logs
          </button>
        ) : (
          <div className="h-48 bg-black/50 rounded p-2 overflow-y-auto font-mono text-[10px] text-white/60">
            {logs.length === 0 ? <div className="text-white/30">No logs yet</div> :
              logs.map((l, i) => <div key={i}>{l}</div>)
            }
          </div>
        )}
      </section>
    </div>
  );
};

export default LocalAI;
