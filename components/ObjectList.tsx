
import React from 'react';
// 导入CAD对象类型定义
import { CADObject } from '../types';

// 定义对象列表组件的属性接口
interface ObjectListProps {
  objects: CADObject[]; // 场景中的所有对象
  selectedIds: string[]; // 当前选中的对象ID数组
  onSelect: (id: string, multi: boolean) => void; // 选择对象的回调函数
}

// ObjectList组件：显示场景中所有对象的列表
export const ObjectList: React.FC<ObjectListProps> = ({ objects, selectedIds, onSelect }) => {
  // 对象类型映射表，将英文类型名转换为中文显示
  const typeMap: Record<string, string> = {
    cube: '方块',
    sphere: '球体',
    cylinder: '圆柱',
    cone: '圆锥',
    prism: '三棱柱',
    hemisphere: '半球体',
    half_cylinder: '半圆柱',
    torus: '空心圆柱',
    custom: '复合/导入'
  };

  // 如果场景中没有对象，显示提示信息
  if (objects.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-base mt-20">
        <i className="fa-solid fa-box-open text-4xl mb-4"></i>
        <p>场景中没有对象。</p>
        <p>请从工具栏添加。</p>
      </div>
    );
  }

  // 渲染对象列表
  return (
    <ul className="flex-1 overflow-y-auto">
      {objects.map((obj) => (
        <li
          key={obj.id}
          className={`px-4 py-3 text-base cursor-pointer border-l-4 transition-colors flex items-center justify-between ${
            selectedIds.includes(obj.id)
              ? 'bg-blue-50 border-blue-500 text-blue-900 font-medium'
              : 'border-transparent hover:bg-gray-50 text-gray-700'
          }`}
          onClick={(e) => onSelect(obj.id, e.ctrlKey || e.metaKey)}
        >
          <span className="flex items-center gap-3">
             <span 
               className="w-4 h-4 rounded-full border border-gray-300 shadow-sm"
               style={{ backgroundColor: obj.color }}
             ></span>
             <span className="truncate max-w-[140px]" title={obj.name}>{obj.name}</span>
          </span>
          <span className="text-xs text-gray-400 uppercase">{typeMap[obj.type] || '未知'}</span>
        </li>
      ))}
    </ul>
  );
};