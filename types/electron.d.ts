// 统一的Electron API类型定义文件

declare global {
  interface Window {
    electronAPI?: {
      // 模型相关API
      getModelsList: () => Promise<any>;
      getModelContent: (filePath: string) => Promise<ArrayBuffer>;
      
      // 项目保存相关API
      saveProject: (data: any) => Promise<any>;
      loadProject: (filePath: string) => Promise<any>;
      showSaveDialog: () => Promise<any>;
      saveFile: (filePath: string, data: string) => Promise<void>;
      
      // 获取和保存开始日期的API
      getStartDate: () => Promise<string | null>;
      saveStartDate: (startDate: string) => Promise<void>;
      
      // 监听检查未保存更改的消息
      onCheckUnsavedChanges: (callback: () => void) => (() => void);
      
      // 发送未保存更改的回复
      replyUnsavedChanges: (hasUnsavedChanges: boolean) => void;
      
      // 监听保存项目请求
      onRequestSaveBeforeQuit: (callback: () => void) => (() => void);
      
      // 发送项目已保存消息
      sendProjectSaved: () => void;
      
      // 发送取消关闭应用的消息
      cancelAppQuit: () => void;
      
      // 监听项目已保存消息
      onProjectSaved: (callback: () => void) => (() => void);
      
      // 监听显示关闭确认对话框的消息
      onShowCloseConfirmDialog: (callback: () => void) => (() => void);
      
      // 获取当前平台信息
      getPlatform: () => string;
    };
    
    modelsAPI?: {
      getModelsList: () => Promise<any>;
      getModelContent: (filePath: string) => Promise<ArrayBuffer>;
    };
    
    requireNode?: (module: string) => any;
  }
}

export {};