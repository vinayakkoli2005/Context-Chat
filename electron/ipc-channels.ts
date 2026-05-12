export const IPC = {
  // panel ↔ main
  PANEL_READY: 'panel:ready',
  PANEL_CLOSE: 'panel:close',
  CHAT_SEND: 'chat:send',
  CHAT_TOKEN: 'chat:token',
  CHAT_DONE: 'chat:done',
  CHAT_ERROR: 'chat:error',
  ABORT_CHAT: 'chat:abort',

  // icon ↔ main
  ICON_CLICK: 'icon:click',

  // settings / dashboard ↔ main
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  MODELS_LIST: 'models:list',
  HARDWARE_INFO: 'hardware:info',

  // toast ↔ main
  TOAST_ACCEPT: 'toast:accept',
  TOAST_DISMISS: 'toast:dismiss',

  // main → panel push
  CONTEXT_TEXT: 'context:text',
  CONTEXT_IMAGE: 'context:image',

  // history ↔ main
  HISTORY_GET: 'history:get',
  HISTORY_DELETE: 'history:delete',
  HISTORY_EXPORT: 'history:export',

  // dashboard ↔ main (new)
  OLLAMA_STATUS: 'ollama:status',
  OLLAMA_PULL: 'ollama:pull',
  OLLAMA_PULL_PROGRESS: 'ollama:pull:progress',
  OPENAI_STATUS: 'openai:status',
  ANTHROPIC_STATUS: 'anthropic:status',
  SETUP_COMPLETE: 'setup:complete',

  // screenshot button
  SCREENSHOT_BTN_CLICK: 'screenshotbtn:click',
  SCREENSHOT_BTN_DRAG: 'screenshotbtn:drag',

  // voice / whisper
  WHISPER_READY: 'whisper:ready',
  WHISPER_TRANSCRIBE: 'whisper:transcribe',
  WHISPER_DOWNLOAD_PROGRESS: 'whisper:download:progress',
  VOICE_CLOSE: 'voice:close',
  VOICE_SEND: 'voice:send',

  // memory ↔ main
  MEMORY_LIST:   'memory:list',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_ADD:    'memory:add',
  MEMORY_COUNT:  'memory:count',
  MEMORY_EXTRACT_FROM_HISTORY: 'memory:extract-from-history',
} as const;
