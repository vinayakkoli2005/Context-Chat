module.exports = {
  appId: 'com.contextchat.desktop',
  productName: 'ContextChat',
  directories: { output: 'release' },
  files: ['out/**/*', 'resources/**/*', 'package.json'],
  asarUnpack: ['node_modules/@lancedb/**'],
  extraResources: [
    { from: 'resources/tray-icon.png', to: 'tray-icon.png' },
    // Python sidecar scripts for AirLLM (large-model fallback inference)
    // and TurboVec (compressed vector index). Both are activated only when
    // the user enables the corresponding setting AND a working Python
    // environment with the required package is detected on the system.
    { from: 'resources/airllm-runner.py', to: 'airllm-runner.py' },
    { from: 'resources/turbovec-runner.py', to: 'turbovec-runner.py' }
  ],
  win: {
    target: ['nsis'],
    icon: 'resources/app-icon.png'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true
  }
};
