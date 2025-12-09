
export interface ModelEntry {
  name: string;
  url: string; // URL or Blob URL
}

// Initialize as empty object
let modelFiles: Record<string, unknown> = {};

try {
  // Safe check: access import.meta as any to avoid TS errors and check if glob exists
  // This prevents the "glob is not a function" error in non-Vite environments
  const meta = import.meta as any;
  
  if (typeof meta.glob === 'function') {
      // Use Vite's import.meta.glob feature to auto-scan for STL files
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

// Convert the file map to a list of entries
export const MODEL_LIBRARY: ModelEntry[] = Object.entries(modelFiles).map(([path, url]) => {
  // Extract filename from path (e.g., ./models/gear.stl -> gear)
  const name = path.split('/').pop()?.replace('.stl', '') || '未命名模型';
  
  return {
    name,
    url: url as string
  };
});
