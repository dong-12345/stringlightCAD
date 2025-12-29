// 导出模型条目接口定义
export interface ModelEntry {
  name: string; // 模型名称
  url: string; // 模型URL或Blob URL
}

// 初始化为空对象
let modelFiles: Record<string, unknown> = {};

try {
  // 安全检查：以any方式访问import.meta以避免TS错误并检查glob是否存在
  // 这可以防止在非Vite环境中出现"glob is not a function"错误
  const meta = import.meta as any;
  
  // 检查import.meta.glob是否为函数
  if (typeof meta.glob === 'function') {
      // 使用Vite的import.meta.glob功能自动扫描STL文件（开发环境）
      modelFiles = meta.glob('./models/*.stl', { 
        eager: true, 
        query: '?url', 
        import: 'default' 
      });
  } else {
      console.warn("Model Registry: import.meta.glob is not supported in this environment. Auto-scan disabled.");
  }
} catch (e) {
  console.warn("Model Registry: Error accessing import.meta.glob", e);
}

// 将文件映射转换为条目列表
let devModelLibrary: ModelEntry[] = Object.entries(modelFiles).map(([path, url]) => {
  // 从路径中提取文件名（例如，./models/gear.stl -> gear）
  const name = path.split('/').pop()?.replace('.stl', '') || '未命名模型';
  
  return {
    name,
    url: url as string
  };
});

// 初始化生产环境模型库
let prodModelLibrary: ModelEntry[] = [];

// 检查是否在Electron环境中并尝试获取模型列表
if (typeof window !== 'undefined' && window.electronAPI) {
  // 在Electron环境中，尝试从资源目录加载模型
  // 此处暂时初始化为空，实际数据将在组件中获取
}

// 合并开发环境模型和Electron生产环境模型
export const MODEL_LIBRARY: ModelEntry[] = [...devModelLibrary, ...prodModelLibrary];

// 异步获取Electron环境中的模型列表
export const loadElectronModels = async (): Promise<ModelEntry[]> => {
  if (typeof window !== 'undefined' && window.modelsAPI) {
    try {
      const modelsList = await window.modelsAPI.getModelsList();
      return modelsList;
    } catch (error) {
      console.error("Error loading electron models:", error);
    }
  }
  return [];
};

// 创建一个用于生产环境中加载模型内容的函数
export const loadModelContent = async (filePath: string): Promise<string> => {
  if (typeof window !== 'undefined' && (window as any).modelsAPI && (window as any).modelsAPI.getModelContent) {
    try {
      const fileBuffer = await (window as any).modelsAPI.getModelContent(filePath);
      // 将ArrayBuffer转换为Blob URL
      const blob = new Blob([fileBuffer], { type: 'model/stl' });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error("Error loading model content:", error);
      throw error;
    }
  }
  throw new Error("Electron API not available");
};