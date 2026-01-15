const { contextBridge, ipcRenderer } = require('electron');

// 安全地暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 模型相关API
  getModelsList: () => ipcRenderer.invoke('get-models-list'),
  getModelContent: (filePath) => ipcRenderer.invoke('get-model-content', filePath),
  
  // 项目保存相关API
  saveProject: (data) => ipcRenderer.invoke('save-project', data),
  loadProject: (filePath) => ipcRenderer.invoke('load-project', filePath),
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
  saveFile: (filePath, data) => ipcRenderer.invoke('save-file', filePath, data),
  
  // 获取和保存开始日期的API
  getStartDate: () => ipcRenderer.invoke('get-start-date'),
  saveStartDate: (startDate) => ipcRenderer.invoke('save-start-date', startDate),
  
  // 监听检查未保存更改的消息
  onCheckUnsavedChanges: (callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on('check-unsave-changes', listener);
    return () => ipcRenderer.removeListener('check-unsave-changes', listener);
  },
  
  // 发送未保存更改的回复
  replyUnsavedChanges: (hasUnsavedChanges) => {
    ipcRenderer.send('unsave-changes-reply', hasUnsavedChanges);
  },
  
  // 监听请求保存项目的消息
  onRequestSaveBeforeQuit: (callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on('request-save-before-quit', listener);
    return () => ipcRenderer.removeListener('request-save-before-quit', listener);
  },
  
  // 发送项目已保存消息
  sendProjectSaved: () => {
    ipcRenderer.send('project-saved');
  },
  
  // 发送取消关闭应用的消息
  cancelAppQuit: () => {
    ipcRenderer.send('cancel-app-quit');
  },
  
  // 监听项目已保存消息
  onProjectSaved: (callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on('project-saved', listener);
    return () => ipcRenderer.removeListener('project-saved', listener);
  },
  
  // 监听显示关闭确认对话框的消息
  onShowCloseConfirmDialog: (callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on('show-close-confirm-dialog', listener);
    return () => ipcRenderer.removeListener('show-close-confirm-dialog', listener);
  },
  
  // 获取当前平台信息
  getPlatform: () => process.platform
});

// 暴露一个用于获取当前项目路径下的模型的新API
contextBridge.exposeInMainWorld('modelsAPI', {
  getModelsList: () => ipcRenderer.invoke('get-models-list'),
  getModelContent: (filePath) => ipcRenderer.invoke('get-model-content', filePath)
});