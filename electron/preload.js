// Electron应用的安全预加载脚本
// 在渲染进程和主进程之间建立安全通信桥梁

const { contextBridge, ipcRenderer } = require('electron');

// 在此处暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 示例API（可根据需要扩展）
  // sendMessage: (message) => ipcRenderer.send('message', message),
  // onMessage: (callback) => ipcRenderer.on('reply', (_event, value) => callback(value)),
  
  // 监听主进程发送的检查未保存更改的消息
  onCheckUnsaveChanges: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('check-unsave-changes', subscription);
    return () => ipcRenderer.removeListener('check-unsave-changes', subscription);
  },
  
  // 监听主进程发送的保存请求消息
  onRequestSaveBeforeQuit: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('request-save-before-quit', subscription);
    return () => ipcRenderer.removeListener('request-save-before-quit', subscription);
  },
  
  // 回复主进程是否有未保存的更改
  replyUnsaveChanges: (hasUnsavedChanges) => ipcRenderer.send('unsave-changes-reply', hasUnsavedChanges),
  
  // 通知主进程项目已保存
  notifyProjectSaved: () => ipcRenderer.send('project-saved')
});