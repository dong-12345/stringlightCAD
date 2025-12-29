const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

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

// 处理获取模型列表的IPC事件
ipcMain.handle('get-models-list', async () => {
  try {
    // 根据环境确定模型目录路径
    let modelsDirPath;
    // 使用app.isPackaged来判断是否在生产环境中（打包后的应用）
    if (app.isPackaged) {
      // 生产环境：使用资源目录
      modelsDirPath = path.join(process.resourcesPath, 'models');
    } else {
      // 开发环境：使用项目根目录下的models文件夹
      modelsDirPath = path.join(__dirname, '../models');
    }

    console.log(`Attempting to read models from: ${modelsDirPath}`); // 添加日志用于调试
    console.log(`App is packaged: ${app.isPackaged}`); // 添加日志查看是否打包
    
    // 检查目录是否存在
    try {
      await fs.access(modelsDirPath);
    } catch (error) {
      console.warn(`Models directory does not exist: ${modelsDirPath}`);
      return [];
    }

    // 读取目录内容
    const files = await fs.readdir(modelsDirPath);
    
    console.log(`Found ${files.length} files in models directory`); // 添加日志
    
    // 过滤出STL文件
    const stlFiles = files.filter(file => path.extname(file).toLowerCase() === '.stl');
    
    console.log(`Found ${stlFiles.length} STL files`); // 添加日志
    
    // 返回模型条目列表
    return stlFiles.map(file => {
      const name = path.basename(file, '.stl'); // 移除扩展名作为模型名称
      // 根据环境决定URL格式
      if (app.isPackaged) {
        // 生产环境：返回相对路径，后续通过IPC读取文件内容
        return {
          name,
          url: path.join(modelsDirPath, file) // 返回完整路径
        };
      } else {
        // 开发环境：使用Vite处理的URL
        return {
          name,
          url: `/models/${file}`
        };
      }
    });
  } catch (error) {
    console.error('Error reading models directory:', error);
    return [];
  }
});

// 处理获取模型内容的IPC事件
ipcMain.handle('get-model-content', async (event, filePath) => {
  try {
    // 确保路径安全，防止路径遍历攻击
    const basePath = process.env.NODE_ENV === 'production' 
      ? path.join(process.resourcesPath, 'models')
      : path.join(__dirname, '../models');
    
    const resolvedPath = path.resolve(filePath);
    const baseResolvedPath = path.resolve(basePath);
    
    // 确保请求的路径在models目录下
    if (!resolvedPath.startsWith(baseResolvedPath)) {
      throw new Error('Invalid file path');
    }
    
    // 读取文件内容
    const fileContent = await fs.readFile(resolvedPath);
    
    // 转换为ArrayBuffer，以便在前端使用
    return fileContent.buffer.slice(fileContent.byteOffset, fileContent.byteOffset + fileContent.byteLength);
  } catch (error) {
    console.error('Error reading model file:', error);
    throw error;
  }
});

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