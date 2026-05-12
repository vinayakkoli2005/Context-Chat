export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
  image?: string;
}

export interface Conversation {
  id: string;
  context: { type: 'text' | 'image'; value: string };
  messages: Message[];
  model: string;
}

export interface Settings {
  ollamaUrl: string;
  selectedModel: string;
  launchAtStartup: boolean;
  provider: 'ollama' | 'openai' | 'anthropic';
  openaiApiKey: string;
  anthropicApiKey: string;
  hasCompletedSetup: boolean;
}

export interface OllamaModel {
  name: string;
  size: number;
}

export interface HardwareInfo {
  totalRamGb: number;
  recommendedTextModel: string;
  recommendedVisionModel: string;
}

export type QuickAction = 'explain' | 'summarize' | 'ask';

export interface HistoryEntry {
  id: string;
  startedAt: number;
  provider: string;
  model: string;
  context: { type: 'text' | 'image'; value: string };
  messages: Message[];
}

export interface Memory {
  id: string;
  content: string;
  type: 'fact' | 'preference' | 'project';
  source: 'auto' | 'manual';
  createdAt: number;
}

export interface RagFile {
  source: string;
  chunks: number;
}
