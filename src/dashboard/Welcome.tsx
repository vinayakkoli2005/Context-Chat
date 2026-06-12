import React, { useEffect, useState } from 'react';

type AutoSetupProgress = {
  step: 'install_ollama' | 'start_ollama' | 'pull_embed' | 'pull_chat' | 'done' | 'error';
  percent: number;
  message?: string;
};

type WelcomeState = {
  decision: 'pending' | 'accepted' | 'declined';
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  hasCompletedSetup: boolean;
};

type Hardware = {
  totalRamGb: number;
  recommendedTextModel: string;
};

const STEP_LABELS: Record<AutoSetupProgress['step'], string> = {
  install_ollama: 'Installing Ollama',
  start_ollama: 'Starting Ollama',
  pull_embed: 'Downloading embedding model',
  pull_chat: 'Downloading chat model',
  done: 'Setup complete',
  error: 'Setup failed'
};

const Welcome: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [hw, setHw] = useState<Hardware | null>(null);
  const [phase, setPhase] = useState<'intro' | 'running' | 'done' | 'error'>('intro');
  const [progress, setProgress] = useState<AutoSetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.cc.invoke(window.cc.channels.HARDWARE_INFO)
      .then((h: Hardware) => setHw(h))
      .catch(() => setHw({ totalRamGb: 0, recommendedTextModel: 'llama3.2' }));
  }, []);

  useEffect(() => {
    const off = window.cc.on(window.cc.channels.WELCOME_AUTO_SETUP_PROGRESS, (p: AutoSetupProgress) => {
      setProgress(p);
      if (p.step === 'error') {
        setPhase('error');
        setError(p.message || 'Unknown error');
      } else if (p.step === 'done') {
        setPhase('done');
        setTimeout(onDone, 1500);
      }
    });
    return off;
  }, [onDone]);

  const handleYes = async () => {
    setPhase('running');
    setError(null);
    try {
      await window.cc.invoke(window.cc.channels.WELCOME_AUTO_SETUP, {
        embedModel: 'nomic-embed-text',
        chatModel: hw?.recommendedTextModel || 'llama3.2'
      });
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleNo = async () => {
    await window.cc.invoke(window.cc.channels.WELCOME_SET_DECISION, 'declined');
    onDone();
  };

  if (phase === 'intro') {
    return (
      <div className="h-full bg-gray-900 text-white flex items-center justify-center p-8">
        <div className="max-w-lg w-full">
          <div className="mb-6 text-center">
            <div className="text-3xl mb-2">Welcome to ContextChat</div>
            <p className="text-sm text-white/60">
              A local-first AI assistant. Everything runs on your machine — no cloud, no subscriptions, nothing leaves your device.
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg border border-white/10 p-5 mb-6">
            <h3 className="font-medium mb-3">What we&apos;ll install automatically</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li className="flex justify-between">
                <span>• <span className="font-medium text-white">Ollama</span> — the local AI engine</span>
                <span className="text-white/40 text-xs">~250MB</span>
              </li>
              <li className="flex justify-between">
                <span>• <span className="font-medium text-white">nomic-embed-text</span> — for knowledge base + memory</span>
                <span className="text-white/40 text-xs">~270MB</span>
              </li>
              <li className="flex justify-between">
                <span>• <span className="font-medium text-white">{hw?.recommendedTextModel || 'llama3.2'}</span> — chat model recommended for your hardware</span>
                <span className="text-white/40 text-xs">~2GB</span>
              </li>
            </ul>
            <div className="mt-4 text-xs text-white/40">
              Total ~6GB. No terminal needed — we handle the install silently. You can change models later.
              {hw && hw.totalRamGb > 0 && <> Detected {hw.totalRamGb} GB RAM.</>}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleYes}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded font-medium"
            >
              Yes, install everything
            </button>
            <button
              onClick={handleNo}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Decide later
            </button>
          </div>

          <p className="text-xs text-white/40 mt-4 text-center">
            You can always install or change these later from the &quot;Local AI&quot; tab.
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'running' || phase === 'done') {
    const stepIndex = progress
      ? ['install_ollama', 'start_ollama', 'pull_embed', 'pull_chat', 'done'].indexOf(progress.step)
      : 0;
    const totalSteps = 4;
    const overallPercent = Math.min(100, Math.floor(((stepIndex) / totalSteps) * 100 + (progress?.percent || 0) / totalSteps));

    return (
      <div className="h-full bg-gray-900 text-white flex items-center justify-center p-8">
        <div className="max-w-lg w-full">
          <div className="mb-6 text-center">
            <div className="text-2xl mb-2">Setting up</div>
            <p className="text-sm text-white/60">
              This takes about 5 minutes depending on your internet speed. Feel free to do something else — we&apos;ll be ready when you come back.
            </p>
          </div>

          <div className="bg-gray-800 rounded-lg border border-white/10 p-5 mb-4">
            <div className="text-sm font-medium mb-2">
              {progress ? STEP_LABELS[progress.step] : 'Starting…'}
            </div>
            {progress?.message && (
              <div className="text-xs text-white/50 mb-3">{progress.message}</div>
            )}
            <div className="h-2 bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${overallPercent}%` }}
              />
            </div>
            <div className="text-xs text-white/40 mt-2 text-right">{overallPercent}%</div>
          </div>

          {phase === 'done' && (
            <div className="text-center text-green-300 text-sm">
              ✓ All set — opening ContextChat…
            </div>
          )}
        </div>
      </div>
    );
  }

  // error phase
  return (
    <div className="h-full bg-gray-900 text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="mb-6 text-center">
          <div className="text-2xl mb-2">Setup hit a snag</div>
          <p className="text-sm text-white/60 mb-2">Don&apos;t worry — you can still use ContextChat with cloud providers, or retry the install later.</p>
        </div>

        <div className="bg-red-900/20 border border-red-500/30 rounded p-4 mb-4 text-sm text-red-200">
          {error}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleYes}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded font-medium"
          >
            Try again
          </button>
          <button
            onClick={handleNo}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
