

import React from 'react';
import { ShapeType } from '../types';

interface ToolbarProps {
  onAdd: (type: ShapeType) => void;
  onDelete: () => void;
  onBooleanOp: (op: 'UNION' | 'SUBTRACT') => void;
  onImport: () => void;
  onExport: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  selectionCount: number;
  onUndo: () => void;
  canUndo: boolean;
  transformMode: 'translate' | 'rotate' | 'scale';
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  onInitWorkPlane: () => void;
  workPlaneActive: boolean;
  onOpenLibrary: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ 
  onAdd, onDelete, onBooleanOp, onImport, onExport, 
  onSaveProject, onLoadProject,
  selectionCount, onUndo, canUndo,
  transformMode, setTransformMode,
  onInitWorkPlane, workPlaneActive,
  onOpenLibrary
}) => {
  // Common Button Styles - Scaled down (approx 0.8x)
  const btnClass = "px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2 text-base border border-transparent whitespace-nowrap font-medium text-gray-700";
  const iconBtnClass = "p-2 rounded-lg hover:bg-gray-100 transition-colors text-lg border border-transparent";
  const disabledClass = "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-gray-400 grayscale";

  const booleanEnabled = selectionCount >= 1;
  const deleteEnabled = selectionCount > 0;

  return (
    <div className="flex flex-col gap-2 w-full justify-center">
      
      {/* Row 1: System, Transform, Workflow */}
      <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
         {/* 撤回 */}
         <button 
          className={`${btnClass} ${!canUndo ? disabledClass : ''}`}
          onClick={onUndo}
          disabled={!canUndo}
          title="撤回到上一步"
        >
          <i className="fa-solid fa-rotate-left text-gray-500"></i> 撤回
        </button>

        <div className="w-px h-6 bg-gray-300"></div>
        
        {/* 变换工具 */}
        <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg border border-gray-200">
          <button 
            className={`${iconBtnClass} ${transformMode === 'translate' ? 'bg-blue-100 text-blue-600 border-blue-200' : 'text-blue-400'}`} 
            onClick={() => setTransformMode('translate')} 
            title="移动 (Translate)"
          >
            <i className="fa-solid fa-arrows-up-down-left-right"></i>
          </button>
          <button 
            className={`${iconBtnClass} ${transformMode === 'rotate' ? 'bg-blue-100 text-blue-600 border-blue-200' : 'text-blue-400'}`} 
            onClick={() => setTransformMode('rotate')} 
            title="旋转 (Rotate)"
          >
            <i className="fa-solid fa-rotate"></i>
          </button>
          <button 
            className={`${iconBtnClass} ${transformMode === 'scale' ? 'bg-blue-100 text-blue-600 border-blue-200' : 'text-blue-400'}`} 
            onClick={() => setTransformMode('scale')} 
            title="缩放 (Scale)"
          >
            <i className="fa-solid fa-expand"></i>
          </button>
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        {/* 工作平面 */}
        <button 
          className={`${btnClass} ${workPlaneActive ? 'bg-purple-100 text-purple-700 border-purple-200' : ''}`} 
          onClick={onInitWorkPlane}
          title="设定工作平面与对齐"
        >
          <i className="fa-solid fa-ruler-combined text-purple-600"></i> 工作平面
        </button>

        <div className="flex-1"></div>

        {/* 文件操作 */}
        <div className="flex items-center gap-2">
            <button className={btnClass} onClick={onLoadProject} title="打开 .sl3d 项目文件">
                <i className="fa-regular fa-folder-open text-orange-600"></i> 打开
            </button>
            <button className={btnClass} onClick={onSaveProject} title="保存当前进度为 .sl3d 文件">
                <i className="fa-regular fa-floppy-disk text-blue-600"></i> 保存
            </button>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <button className={btnClass} onClick={onOpenLibrary} title="打开模型库">
                <i className="fa-solid fa-cubes text-indigo-500"></i> 库
            </button>
            <button className={btnClass} onClick={onImport} title="导入本地STL文件">
                <i className="fa-solid fa-upload text-gray-600"></i> 导入STL
            </button>
            <button className={btnClass} onClick={onExport} title="导出当前场景或选中项">
                <i className="fa-solid fa-download text-gray-600"></i> 导出STL
            </button>
        </div>
      </div>

      {/* Row 2: Creation & Modeling */}
      <div className="flex items-center gap-3">
        {/* 基础形状组 */}
        <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs font-semibold uppercase mr-2 tracking-wider">创建:</span>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('cube')} title="方块">
            <i className="fa-solid fa-square"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('sphere')} title="球体">
            <i className="fa-solid fa-circle"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('cylinder')} title="圆柱">
            <i className="fa-solid fa-database"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('cone')} title="圆锥">
            <i className="fa-solid fa-play fa-rotate-270" style={{ transform: 'rotate(-90deg)' }}></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('prism')} title="三棱柱">
            <i className="fa-solid fa-caret-up"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('hemisphere')} title="半球体">
            <i className="fa-solid fa-circle-half-stroke" style={{ transform: 'rotate(-90deg)' }}></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('half_cylinder')} title="半圆柱">
            <i className="fa-solid fa-warehouse"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('torus')} title="圆环">
            <i className="fa-solid fa-circle-dot"></i>
            </button>
            <button className={`${iconBtnClass} text-blue-500`} onClick={() => onAdd('text')} title="3D文本">
            <i className="fa-solid fa-font"></i>
            </button>
        </div>
        
        <div className="w-px h-6 bg-gray-300 mx-2"></div>

        {/* 布尔操作 */}
        <div className="flex items-center gap-2">
             <span className="text-gray-400 text-xs font-semibold uppercase mr-2 tracking-wider">编辑:</span>
             <button 
                className={`${btnClass} ${!booleanEnabled ? disabledClass : ''} text-purple-700`}
                onClick={() => onBooleanOp('UNION')}
                disabled={!booleanEnabled}
                title="合并"
            >
                <i className="fa-solid fa-link"></i> 合并
            </button>

            <button 
                className={`${btnClass} ${!booleanEnabled ? disabledClass : ''} text-orange-600`}
                onClick={() => onBooleanOp('SUBTRACT')}
                disabled={!booleanEnabled}
                title="切割"
            >
                <i className="fa-solid fa-scissors"></i> 切割
            </button>
        </div>

        <div className="flex-1"></div>

        <button 
            className={`${btnClass} ${!deleteEnabled ? disabledClass : 'text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-100'}`}
            onClick={onDelete}
            disabled={!deleteEnabled}
        >
            <i className="fa-solid fa-trash"></i> 删除
        </button>
      </div>
    </div>
  );
};