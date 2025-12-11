const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#f9fafb', // 设置背景色以减少白屏现象
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 启用WebGL支持
      webgl: true,
      // 启用硬件加速
      hardwareAcceleration: true
      // 移除不安全的webSecurity: false配置
    }
  });

  // 在开发模式下加载Vite开发服务器，在生产模式下加载构建后的文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  // 仅在开发模式下打开开发者工具以便调试
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 监听关闭事件，检查是否有未保存的更改
  mainWindow.on('close', handleCloseEvent);

  return mainWindow;
}

function handleCloseEvent(e) {
  // 阻止默认关闭行为
  e.preventDefault();
  
  // 发送消息到渲染进程询问是否有未保存的更改
  mainWindow.webContents.send('check-unsave-changes');
}

// 处理来自渲染进程的回复
ipcMain.on('unsave-changes-reply', (event, hasUnsavedChanges) => {
  if (!mainWindow) return;
  
  if (hasUnsavedChanges) {
    // 显示确认对话框
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['取消', '确定'],
      title: '确认退出',
      message: '您有未保存的更改，确定要退出吗？',
      detail: '如果退出，您的更改将会丢失。',
      defaultId: 0,
      cancelId: 0
    }).then(({ response }) => {
      // 如果用户选择确定，则真正关闭应用
      if (response === 1) {
        // 移除close事件监听器以避免循环
        mainWindow.removeListener('close', handleCloseEvent);
        mainWindow.destroy();
        app.quit();
      }
    });
  } else {
    // 没有未保存的更改，直接关闭
    // 移除close事件监听器以避免循环
    mainWindow.removeListener('close', handleCloseEvent);
    mainWindow.destroy();
    app.quit();
  }
});

app.whenReady().then(() => {
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('before-quit', (e) => {
  // 移除所有监听器确保应用可以正常退出
  if (mainWindow) {
    mainWindow.removeListener('close', handleCloseEvent);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});