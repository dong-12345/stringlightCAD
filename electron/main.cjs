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

// 标志变量，用于判断是否是用户主动关闭应用
let isQuitting = false;

function handleCloseEvent(e) {
  // 如果已经在退出过程中，则不阻止关闭
  if (isQuitting) return;
  
  // 设置正在退出标志
  isQuitting = true;
  
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
      buttons: ['取消', '保存并退出', '直接退出'],
      title: '确认退出',
      message: '您有未保存的更改，确定要退出吗？',
      detail: '如果直接退出，您的更改将会丢失。',
      defaultId: 0,
      cancelId: 0
    }).then(({ response }) => {
      // response: 0=取消, 1=保存并退出, 2=直接退出
      if (response === 0) {
        // 用户取消，重置退出标志
        isQuitting = false;
        return;
      } else if (response === 1) {
        // 用户选择保存并退出，发送保存指令给渲染进程
        mainWindow.webContents.send('request-save-before-quit');
      } else if (response === 2) {
        // 用户选择直接退出，关闭应用
        forceCloseApp();
      }
    }).catch(err => {
      console.error('Dialog error:', err);
      // 出错时也允许退出
      forceCloseApp();
    });
  } else {
    // 没有未保存的更改，直接关闭
    forceCloseApp();
  }
});

// 添加IPC处理器，接收渲染进程的保存完成通知
ipcMain.on('project-saved', () => {
  // 项目已保存，但不应该自动关闭应用，只是移除退出标志
  // 之前是直接调用forceCloseApp()，现在改为仅重置退出标志
  isQuitting = false;
});

// 强制关闭应用
function forceCloseApp() {
  if (mainWindow) {
    // 移除close事件监听器以避免循环
    mainWindow.removeListener('close', handleCloseEvent);
    // 设置窗口关闭标志
    mainWindow.destroy();
  }
  // 退出应用
  app.quit();
}

app.whenReady().then(() => {
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('before-quit', (e) => {
  // 如果不是正在退出，设置标志
  if (!isQuitting) {
    isQuitting = true;
  } else {
    // 如果已经是退出状态，让应用继续退出
    return;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});