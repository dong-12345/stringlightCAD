// Electron应用的安全预加载脚本
// 在渲染进程和主进程之间建立安全通信桥梁

const { contextBridge, ipcRenderer } = require('electron');

// 在此处暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 示例API（可根据需要扩展）
  // sendMessage: (message) => ipcRenderer.send('message', message),
  // onMessage: (callback) => ipcRenderer.on('reply', (_event, value) => callback(value))
});