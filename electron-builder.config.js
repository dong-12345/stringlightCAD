/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.stringlight.cad',
  productName: 'Stringlight CAD',
  directories: {
    output: 'dist-electron'
  },
  files: [
    'dist/**/*',
    'electron-main.js',
    'preload.js',
    'stringlight.ico'
  ],
  win: {
    icon: 'stringlight.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      },
      {
        target: 'portable',
        arch: ['x64']
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
};

module.exports = config;