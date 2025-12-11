import React, { useState, useRef, Suspense, useMemo, useEffect } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { OrbitControls, Stage, Center, Html } from '@react-three/drei';
import * as THREE from 'three';
import { MODEL_LIBRARY, ModelEntry } from '../model_registry';

// Augment global JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any;
      meshStandardMaterial: any;
    }
  }
}

interface ModelLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (url: string, name: string) => void;
}

// 3D Preview Component
const ModelPreview: React.FC<{ url: string }> = ({ url }) => {
  // useLoader triggers Suspense
  const geometry = useLoader(STLLoader, url);
  
  // Clone to avoid modifying the cached geometry if used elsewhere
  const geom = useMemo(() => {
      const g = geometry.clone();
      g.center();
      g.computeVertexNormals();
      return g;
  }, [geometry]);

  return (
    <Center>
      <mesh geometry={geom}>
        <meshStandardMaterial color="#6366f1" roughness={0.5} />
      </mesh>
    </Center>
  );
};

const PreviewCanvas: React.FC<{ url: string | null }> = ({ url }) => {
    if (!url) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
                <i className="fa-solid fa-cube text-5xl mb-4"></i>
                <p className="text-lg">选择左侧模型以预览</p>
            </div>
        );
    }

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

export const ModelLibrary: React.FC<ModelLibraryProps> = ({ isOpen, onClose, onSelect }) => {
  const [localModels, setLocalModels] = useState<ModelEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ModelEntry | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const lastWheelTime = useRef(0);

  // Combine default library with loaded local files
  const allModels = useMemo(() => [...MODEL_LIBRARY, ...localModels], [localModels]);

  // Reset selection when closed
  useEffect(() => {
      if (!isOpen) setSelectedEntry(null);
  }, [isOpen]);

  // Auto-scroll to selected entry
  useEffect(() => {
      if (selectedEntry && listContainerRef.current) {
          const index = allModels.findIndex(m => m.url === selectedEntry.url);
          if (index !== -1) {
              const item = listContainerRef.current.children[index] as HTMLElement;
              // Ensure item exists before scrolling (checking children length vs index might be safer, but mapping is direct)
              if (item) {
                  item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
          }
      }
  }, [selectedEntry, allModels]);

  const handleListWheel = (e: React.WheelEvent) => {
    // Throttle scroll events to prevent rapid switching
    const now = Date.now();
    if (now - lastWheelTime.current < 60) return;
    lastWheelTime.current = now;

    if (allModels.length === 0) return;

    // Detect direction
    const delta = e.deltaY;
    if (Math.abs(delta) < 10) return; // Ignore very small scrolls

    const currentIndex = selectedEntry 
        ? allModels.findIndex(m => m.url === selectedEntry.url) 
        : -1;
    
    let nextIndex = currentIndex + (delta > 0 ? 1 : -1);

    // Clamp index
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= allModels.length) nextIndex = allModels.length - 1;

    if (nextIndex !== currentIndex) {
        setSelectedEntry(allModels[nextIndex]);
    }
  };

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedEntry) {
      onSelect(selectedEntry.url, selectedEntry.name);
      onClose();
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
        const files = Array.from(e.target.files) as File[];
        // Filter for STL files
        const stlFiles = files.filter(f => f.name.toLowerCase().endsWith('.stl'));
        
        if (stlFiles.length === 0) {
            alert("在所选文件夹中未找到 STL 文件。");
            return;
        }

        const newEntries: ModelEntry[] = stlFiles.map(f => ({
            name: f.name.replace('.stl', ''),
            url: URL.createObjectURL(f)
        }));

        setLocalModels(prev => [...prev, ...newEntries]);
    }
  };

  const triggerFolderSelect = () => {
      folderInputRef.current?.click();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm">
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

      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
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

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
            {/* Left: List */}
            <div className="w-1/3 border-r border-gray-200 flex flex-col bg-white">
                <div className="p-4 border-b border-gray-100">
                    <button 
                        onClick={triggerFolderSelect}
                        className="w-full py-3 px-4 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-3 text-base font-medium"
                    >
                        <i className="fa-solid fa-folder-open"></i> 打开模型文件夹...
                    </button>
                </div>
                
                <div 
                    ref={listContainerRef}
                    className="flex-1 overflow-y-auto p-3 space-y-2"
                    onWheel={handleListWheel}
                >
                    {allModels.length === 0 && (
                         <div className="flex flex-col items-center justify-center text-gray-400 mt-16 text-base px-6 text-center">
                            <i className="fa-regular fa-folder-open text-3xl mb-3 opacity-50"></i>
                            <p>列表为空</p>
                            <p className="text-sm mt-2 text-gray-400">请点击上方按钮加载本地文件夹，<br/>或确保您的构建环境支持自动扫描。</p>
                        </div>
                    )}
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

            {/* Right: Preview */}
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