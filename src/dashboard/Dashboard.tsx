import React, { useEffect, useState } from 'react';
import { Home } from './tabs/Home';
import { Setup } from './tabs/Setup';
import { Models } from './tabs/Models';
import { History } from '../history/History';
import { HowToUse } from './tabs/HowToUse';
import type { Settings } from '../shared/types';
import Memories from './tabs/Memories';
import KnowledgeBase from './tabs/KnowledgeBase';

type Tab = 'home' | 'setup' | 'models' | 'history' | 'howto' | 'memories' | 'kb';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'setup', label: 'Setup' },
  { id: 'models', label: 'Models' },
  { id: 'history', label: 'History' },
  { id: 'kb', label: 'Knowledge Base' },
  { id: 'howto', label: 'How to Use' },
  { id: 'memories', label: 'Memories' },
];

export const Dashboard: React.FC = () => {
  const [active, setActive] = useState<Tab>('home');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.cc.invoke(window.cc.channels.SETTINGS_GET)
      .then((s: Settings) => { if (!s.hasCompletedSetup) setActive('setup'); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="h-screen bg-gray-900 flex items-center justify-center text-white/50 text-sm">Loading…</div>;

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white text-sm select-none">
      {/* Tab bar */}
      <div className="flex border-b border-white/10 bg-gray-800 px-2 pt-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-xs rounded-t transition-colors ${
              active === t.id
                ? 'bg-gray-900 text-white border-t border-l border-r border-white/10'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {active === 'home' && <Home onNavigate={setActive} />}
        {active === 'setup' && <Setup onNavigate={setActive} />}
        {active === 'models' && <Models />}
        {active === 'history' && <History embedded />}
        {active === 'howto' && <HowToUse />}
        {active === 'kb' && <KnowledgeBase />}
        {active === 'memories' && <Memories />}
      </div>
    </div>
  );
};
