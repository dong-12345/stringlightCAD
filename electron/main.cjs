const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsNative = require('fs'); // 添加同步fs模块用于创建目录

// 设置过期日期 - 修改这个日期来控制应用的有效期
const EXPIRATION_DATE = new Date('2026-3-15'); // 修改这个日期以设定到期时间

let mainWindow;

function createWindow() {
  // 检查是否已过期
  const currentDate = new Date();
  if (currentDate > EXPIRATION_DATE) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '应用已过期',
      message: `此软件版本已于 ${EXPIRATION_DATE.toLocaleDateString()} 到期，请联系供应商获取新版。`,
      buttons: ['确定']
    });
    app.quit();
    return;
  }

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

// 处理获取开始日期的IPC事件
ipcMain.handle('get-start-date', async () => {
  try {
    // 获取userData路径
    const userDataPath = app.getPath('userData');
    const startDateFilePath = path.join(userDataPath, 'start_date.txt');
    
    // 检查文件是否存在
    if (fsNative.existsSync(startDateFilePath)) {
      // 读取文件内容
      const startDate = await fs.readFile(startDateFilePath, 'utf8');
      return startDate.trim(); // 返回日期字符串
    } else {
      return null; // 文件不存在则返回null
    }
  } catch (error) {
    console.error('Error reading start date:', error);
    return null;
  }
});

// 处理保存开始日期的IPC事件
ipcMain.handle('save-start-date', async (event, startDate) => {
  try {
    // 获取userData路径
    const userDataPath = app.getPath('userData');
    const startDateFilePath = path.join(userDataPath, 'start_date.txt');
    
    // 确保userData目录存在
    if (!fsNative.existsSync(userDataPath)) {
      fsNative.mkdirSync(userDataPath, { recursive: true });
    }
    
    // 写入开始日期到文件
    await fs.writeFile(startDateFilePath, startDate, 'utf8');
    console.log(`Start date saved to: ${startDateFilePath}`);
  } catch (error) {
    console.error('Error saving start date:', error);
    throw error;
  }
});

// 处理获取模型列表的IPC事件
ipcMain.handle('get-models-list', async () => {
  try {
    // 根据环境确定模型目录路径
    let modelsDirPaths = [];
    
    // 使用app.isPackaged来判断是否在生产环境中（打包后的应用）
    if (app.isPackaged) {
      // 生产环境：使用资源目录
      modelsDirPaths.push(path.join(process.resourcesPath, 'models'));
    } else {
      // 开发环境：添加多个可能的models目录路径
      modelsDirPaths.push(path.join(__dirname, '../models')); // 项目根目录下的models
      
      // 尝试获取当前工作目录下的models文件夹
      const currentWorkingDirModels = path.join(process.cwd(), 'models');
      if (!modelsDirPaths.includes(currentWorkingDirModels)) {
        modelsDirPaths.push(currentWorkingDirModels);
      }
    }

    let allStlFiles = [];

    // 遍历所有可能的模型目录
    for (const modelsDirPath of modelsDirPaths) {
      console.log(`Attempting to read models from: ${modelsDirPath}`); // 添加日志用于调试
      
      // 检查目录是否存在
      try {
        await fs.access(modelsDirPath);
      } catch (error) {
        console.warn(`Models directory does not exist: ${modelsDirPath}`);
        continue; // 跳过不存在的目录
      }

      // 读取目录内容
      const files = await fs.readdir(modelsDirPath);
      
      console.log(`Found ${files.length} files in models directory: ${modelsDirPath}`); // 添加日志
      
      // 过滤出STL文件
      const stlFiles = files.filter(file => path.extname(file).toLowerCase() === '.stl');
      
      console.log(`Found ${stlFiles.length} STL files in: ${modelsDirPath}`); // 添加日志
      
      // 添加到总列表
      allStlFiles = allStlFiles.concat(stlFiles.map(file => {
        const name = path.basename(file, '.stl'); // 移除扩展名作为模型名称
        // 根据环境决定URL格式
        if (app.isPackaged) {
          // 生产环境：返回相对路径，后续通过IPC读取文件内容
          return {
            name,
            url: path.join(modelsDirPath, file) // 返回完整路径
          };
        } else {
          // 开发环境：使用相对于项目根目录的路径
          return {
            name,
            url: path.join(modelsDirPath, file)
          };
        }
      }));
    }

    // 去重：如果有重复的模型名称，保留第一个
    const uniqueModels = [];
    const seenNames = new Set();
    for (const model of allStlFiles) {
      if (!seenNames.has(model.name)) {
        seenNames.add(model.name);
        uniqueModels.push(model);
      }
    }

    return uniqueModels;
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
    
    // 检查请求的文件是否在允许的目录中（包括当前工作目录下的models）
    const currentWorkingDirModels = path.join(process.cwd(), 'models');
    const resolvedPath = path.resolve(filePath);
    const baseResolvedPath = path.resolve(basePath);
    const currentWorkingDirResolvedPath = path.resolve(currentWorkingDirModels);
    
    // 确保请求的路径在允许的models目录下
    if (!resolvedPath.startsWith(baseResolvedPath) && !resolvedPath.startsWith(currentWorkingDirResolvedPath)) {
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

// 处理保存文件的IPC事件
ipcMain.handle('save-file', async (event, filePath, data) => {
  try {
    // 确保文件路径安全，防止路径遍历攻击
    const resolvedPath = path.resolve(filePath);
    const userDir = app.getPath('documents');
    const baseResolvedPath = path.resolve(userDir);
    
    // 确保保存路径在用户的文档目录内
    if (!resolvedPath.startsWith(baseResolvedPath) && !resolvedPath.includes('.sl3d')) {
      // 对于项目文件，只允许特定的扩展名和基本路径
      const fileName = path.basename(resolvedPath);
      if (!fileName.endsWith('.sl3d')) {
        throw new Error('Invalid file extension');
      }
    }
    
    // 确保目录存在
    const dir = path.dirname(resolvedPath);
    if (!fsNative.existsSync(dir)) {
      fsNative.mkdirSync(dir, { recursive: true });
    }
    
    // 写入文件内容
    await fs.writeFile(resolvedPath, data);
    console.log(`File saved successfully: ${resolvedPath}`);
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    throw error;
  }
});

// 显示保存对话框的IPC事件
ipcMain.handle('show-save-dialog', async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存项目',
      filters: [
        { name: 'SL3D Files', extensions: ['sl3d'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: `项目_${new Date().toISOString().slice(0, 10)}.sl3d`
    });

    if (result.canceled) {
      return { canceled: true };
    }

    return { 
      filePath: result.filePath,
      canceled: false 
    };
  } catch (error) {
    console.error('Error showing save dialog:', error);
    throw error;
  }
});

// 显示保存对话框并使用指定名称作为默认文件名的IPC事件
ipcMain.handle('show-save-dialog-with-name', async (event, name) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存项目',
      filters: [
        { name: 'SL3D Files', extensions: ['sl3d'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: `${name}.sl3d`
    });

    if (result.canceled) {
      return { canceled: true };
    }

    return { 
      filePath: result.filePath,
      canceled: false 
    };
  } catch (error) {
    console.error('Error showing save dialog with name:', error);
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
    // 对于有未保存更改的情况，现在我们将在渲染进程中显示自定义对话框
    // 所以我们只需向渲染进程发送显示对话框的消息
    mainWindow.webContents.send('show-close-confirm-dialog');
  } else {
    // 没有未保存的更改，直接关闭
    forceCloseApp();
  }
});

// 添加IPC处理器，接收渲染进程的保存完成通知
ipcMain.on('project-saved', () => {
  // 项目已保存，关闭应用
  forceCloseApp();
});

// 添加IPC处理器，接收渲染进程的取消关闭请求
ipcMain.on('cancel-app-quit', () => {
  // 用户取消了关闭操作，重置退出标志
  isQuitting = false;
});

// 监听渲染进程请求保存的通知
ipcMain.on('request-save-before-quit', () => {
  // 向渲染进程发送保存指令
  mainWindow.webContents.send('request-save-before-quit');
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