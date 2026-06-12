import Store from 'electron-store';
import type { Settings } from '../src/shared/types';

const DEFAULTS: Settings = {
  ollamaUrl: 'http://localhost:11434',
  selectedModel: '',
  launchAtStartup: true,
  provider: 'ollama',
  openaiApiKey: '',
  anthropicApiKey: '',
  hasCompletedSetup: false,
  welcomeDecision: 'pending',
  activeSkillId: null,
  enableAirLlmFallback: false,
  useTurbovec: false,
};

let _store: Store<Settings> | null = null;
const store = (): Store<Settings> => {
  if (!_store) _store = new Store<Settings>({ defaults: DEFAULTS });
  return _store;
};

export const getSettings = (): Settings => ({
  ollamaUrl: store().get('ollamaUrl'),
  selectedModel: store().get('selectedModel'),
  launchAtStartup: store().get('launchAtStartup'),
  provider: store().get('provider'),
  openaiApiKey: store().get('openaiApiKey'),
  anthropicApiKey: store().get('anthropicApiKey'),
  hasCompletedSetup: store().get('hasCompletedSetup'),
  welcomeDecision: store().get('welcomeDecision'),
  activeSkillId: store().get('activeSkillId'),
  enableAirLlmFallback: store().get('enableAirLlmFallback'),
  useTurbovec: store().get('useTurbovec'),
});

export const setSettings = (patch: Partial<Settings>): Settings => {
  for (const [k, v] of Object.entries(patch)) {
    store().set(k as keyof Settings, v as Settings[keyof Settings]);
  }
  return getSettings();
};
