module.exports = {
  appId: 'com.contextchat.desktop',
  productName: 'ContextChat',
  directories: { output: 'release' },
  files: ['out/**/*', 'resources/**/*', 'package.json'],
  asarUnpack: ['node_modules/@lancedb/**'],
  extraResources: [{ from: 'resources/tray-icon.png', to: 'tray-icon.png' }],
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
