
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
      // 使用Vite的import.meta.glob功能自动扫描STL文件
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
export const MODEL_LIBRARY: ModelEntry[] = Object.entries(modelFiles).map(([path, url]) => {
  // 从路径中提取文件名（例如，./models/gear.stl -> gear）
  const name = path.split('/').pop()?.replace('.stl', '') || '未命名模型';
  
  return {
    name,
    url: url as string
  };
});