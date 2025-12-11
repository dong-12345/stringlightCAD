// 导入React核心库和Three.js相关模块
import React, { useState, useRef, Suspense, useMemo, useEffect } from 'react';
// 从@react-three/fiber导入Canvas和useLoader钩子
import { Canvas, useLoader } from '@react-three/fiber';
// 导入STL加载器
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
// 从@react-three/drei导入常用3D组件和辅助工具
import { OrbitControls, Stage, Center, Html } from '@react-three/drei';
// 导入Three.js核心库
import * as THREE from 'three';
// 导入模型注册表
import { MODEL_LIBRARY, ModelEntry } from '../model_registry';

// 扩展全局JSX命名空间
declare global {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any;
      meshStandardMaterial: any;
    }
  }
}

// 定义模型库组件的属性接口
interface ModelLibraryProps {
  isOpen: boolean; // 模型库是否打开
  onClose: () => void; // 关闭模型库的回调函数
  onSelect: (url: string, name: string) => void; // 选择模型的回调函数
}

// 3D预览组件：负责渲染单个STL模型的预览
const ModelPreview: React.FC<{ url: string }> = ({ url }) => {
  // useLoader触发Suspense，加载STL文件
  const geometry = useLoader(STLLoader, url);
  
  // 克隆几何体以避免修改缓存的几何体（如果在其他地方使用）
  const geom = useMemo(() => {
      const g = geometry.clone();
      g.center();
      g.computeVertexNormals();
      return g;
  }, [geometry]);

  // 渲染模型预览网格
  return (
    <Center>
      <mesh geometry={geom}>
        <meshStandardMaterial color="#6366f1" roughness={0.5} />
      </mesh>
    </Center>
  );
};

// 预览画布组件：负责渲染3D预览场景
const PreviewCanvas: React.FC<{ url: string | null }> = ({ url }) => {
    // 如果没有选择模型，显示提示信息
    if (!url) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
                <i className="fa-solid fa-cube text-5xl mb-4"></i>
                <p className="text-lg">选择左侧模型以预览</p>
            </div>
        );
    }

    // 渲染3D预览场景
    return (
        <div className="w-full h-full bg-gray-100 rounded-lg overflow-hidden border border-gray-200 relative">
             <Canvas shadows dpr={[1, 2]} camera={{ position: [50, 50, 50], fov: 50 }}>
                <Suspense fallback={<Html center><div className="text-gray-500 whitespace-nowrap text-lg">加载中...</div></Html>}>
                    <Stage environment="city" intensity={0.6}>
                        <ModelPreview url={url} />
                    </Stage>
                </Suspense>
                <OrbitControls autoRotate autoRotateSpeed={2} enableZoom={true} />
             </Canvas>
             <div className="absolute bottom-4 right-4 text-sm text-gray-500 bg-white/80 px-3 py-1 rounded">
                <i className="fa-solid fa-rotate"></i> 可拖拽旋转/滚轮缩放
             </div>
        </div>
    );
};

// ModelLibrary组件：模型库主界面
export const ModelLibrary: React.FC<ModelLibraryProps> = ({ isOpen, onClose, onSelect }) => {
  // 本地模型状态（用户选择的文件夹中的模型）
  const [localModels, setLocalModels] = useState<ModelEntry[]>([]);
  // 当前选中的模型条目
  const [selectedEntry, setSelectedEntry] = useState<ModelEntry | null>(null);
  // 文件夹输入引用
  const folderInputRef = useRef<HTMLInputElement>(null);
  // 列表容器引用
  const listContainerRef = useRef<HTMLDivElement>(null);
  // 上次滚轮时间引用（用于节流）
  const lastWheelTime = useRef(0);
  // 搜索关键词状态
  const [searchTerm, setSearchTerm] = useState('');

  // 合并默认库和加载的本地文件，并根据搜索词过滤
  const allModels = useMemo(() => {
    const models = [...MODEL_LIBRARY, ...localModels];
    if (!searchTerm) return models;
    return models.filter(model => 
      model.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [localModels, searchTerm]);

  // 关闭时重置选择
  useEffect(() => {
      if (!isOpen) setSelectedEntry(null);
  }, [isOpen]);

  // 自动滚动到选中条目
  useEffect(() => {
      if (selectedEntry && listContainerRef.current) {
          const index = allModels.findIndex(m => m.url === selectedEntry.url);
          if (index !== -1) {
              const item = listContainerRef.current.children[index] as HTMLElement;
              // 确保项目存在再滚动（检查子元素长度与索引可能更安全，但映射是直接的）
              if (item) {
                  item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
          }
      }
  }, [selectedEntry, allModels]);

  // 处理列表滚轮事件
  const handleListWheel = (e: React.WheelEvent) => {
    // 节流滚轮事件以防止快速切换
    const now = Date.now();
    if (now - lastWheelTime.current < 60) return;
    lastWheelTime.current = now;

    if (allModels.length === 0) return;

    // 检测方向
    const delta = e.deltaY;
    if (Math.abs(delta) < 10) return; // 忽略非常小的滚动

    const currentIndex = selectedEntry 
        ? allModels.findIndex(m => m.url === selectedEntry.url) 
        : -1;
    
    let nextIndex = currentIndex + (delta > 0 ? 1 : -1);

    // 限制索引范围
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= allModels.length) nextIndex = allModels.length - 1;

    if (nextIndex !== currentIndex) {
        setSelectedEntry(allModels[nextIndex]);
    }
  };

  // 如果模型库未打开，不渲染任何内容
  if (!isOpen) return null;

  // 处理确认选择
  const handleConfirm = () => {
    if (selectedEntry) {
      onSelect(selectedEntry.url, selectedEntry.name);
      onClose();
    }
  };

  // 处理文件夹选择
  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
        const files = Array.from(e.target.files) as File[];
        // 筛选STL文件
        const stlFiles = files.filter(f => f.name.toLowerCase().endsWith('.stl'));
        
        if (stlFiles.length === 0) {
            alert("在所选文件夹中未找到 STL 文件。");
            return;
        }

        // 创建新条目
        const newEntries: ModelEntry[] = stlFiles.map(f => ({
            name: f.name.replace('.stl', ''),
            url: URL.createObjectURL(f)
        }));

        setLocalModels(prev => [...prev, ...newEntries]);
    }
  };

  // 触发文件夹选择
  const triggerFolderSelect = () => {
      folderInputRef.current?.click();
  };

  // 渲染模型库界面
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
      {/* 隐藏的文件输入元素，用于选择文件夹 */}
      <input 
        type="file" 
        ref={folderInputRef} 
        className="hidden" 
        onChange={handleFolderSelect} 
        // @ts-ignore
        webkitdirectory="" 
        directory="" 
        multiple 
      />

      {/* 模型库主窗口 */}
      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col overflow-hidden">
        {/* 头部区域 */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                <i className="fa-solid fa-cubes text-blue-600"></i>
                模型库
            </h2>
            <p className="text-base text-gray-500 mt-1">选择内置模型或加载本地文件夹</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200">
            <i className="fa-solid fa-xmark text-2xl"></i>
          </button>
        </div>

        {/* 主体区域 */}
        <div className="flex-1 flex overflow-hidden">
            {/* 左侧：模型列表 */}
            <div className="w-1/3 border-r border-gray-200 flex flex-col bg-white">
                <div className="p-4 border-b border-gray-100 space-y-3">
                    <button 
                        onClick={triggerFolderSelect}
                        className="w-full py-3 px-4 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-3 text-base font-medium"
                    >
                        <i className="fa-solid fa-folder-open"></i> 打开模型文件夹...
                    </button>
                    
                    {/* 搜索框 */}
                    <div className="relative">
                      <i className="fa-solid fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                      <input
                        type="text"
                        placeholder="搜索模型..."
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                </div>
                
                <div 
                    ref={listContainerRef}
                    className="flex-1 overflow-y-auto p-3 space-y-2"
                    onWheel={handleListWheel}
                >
                    {/* 如果没有模型，显示提示信息 */}
                    {allModels.length === 0 && (
                         <div className="flex flex-col items-center justify-center text-gray-400 mt-16 text-base px-6 text-center">
                            <i className="fa-regular fa-folder-open text-3xl mb-3 opacity-50"></i>
                            <p>{searchTerm ? '未找到匹配的模型' : '列表为空'}</p>
                            <p className="text-sm mt-2 text-gray-400">请点击上方按钮加载本地文件夹，<br/>或确保您的构建环境支持自动扫描。</p>
                        </div>
                    )}
                    {/* 渲染所有模型条目 */}
                    {allModels.map((entry, index) => (
                        <div 
                            key={index}
                            onClick={() => setSelectedEntry(entry)}
                            className={`
                                px-4 py-3 rounded-xl cursor-pointer flex items-center gap-3 transition-all select-none
                                ${selectedEntry?.url === entry.url 
                                    ? 'bg-blue-600 text-white shadow-md transform scale-[1.01]' 
                                    : 'hover:bg-gray-100 text-gray-700'}
                            `}
                        >
                            <i className={`fa-solid text-lg ${selectedEntry?.url === entry.url ? 'fa-cube text-white' : 'fa-cube text-gray-400'}`}></i>
                            <span className="truncate font-medium text-base">{entry.name}</span>
                        </div>
                    ))}
                </div>
                
                <div className="p-3 bg-gray-50 text-sm text-gray-400 text-center border-t border-gray-200">
                    共 {allModels.length} 个模型 | 鼠标滚轮可快速切换
                </div>
            </div>

            {/* 右侧：预览区域 */}
            <div className="w-2/3 p-6 bg-gray-50 flex flex-col">
                <div className="flex-1 mb-5 shadow-inner rounded-xl">
                    <PreviewCanvas url={selectedEntry?.url || null} />
                </div>
                
                <div className="flex justify-between items-center">
                    <div className="text-base text-gray-500">
                        {selectedEntry ? (
                            <span>已选: <span className="font-bold text-gray-800">{selectedEntry.name}</span></span>
                        ) : (
                            <span>未选择模型</span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button 
                            onClick={onClose}
                            className="px-6 py-2 text-base text-gray-600 hover:bg-gray-200 rounded-xl transition-colors font-medium"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleConfirm}
                            disabled={!selectedEntry}
                            className={`
                                px-6 py-2 text-base text-white rounded-xl transition-all shadow-sm flex items-center gap-2 font-bold
                                ${selectedEntry 
                                    ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-md' 
                                    : 'bg-gray-300 cursor-not-allowed'}
                            `}
                        >
                            <i className="fa-solid fa-file-import"></i> 导入到场景
                        </button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};