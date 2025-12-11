

import React, { useState, useEffect, useRef } from 'react';
// 导入CAD对象类型定义
import { CADObject } from '../types';

// 定义属性面板组件的属性接口
interface PropertiesPanelProps {
  object: CADObject | null; // 当前选中的对象，如果没有选中则为null
  selectionCount: number; // 当前选中的对象数量
  onUpdate: (updates: Partial<CADObject>) => void; // 更新对象属性的回调函数
  onCommit: () => void; // 提交更改的回调函数
}

// 数字输入组件包装器：处理本地编辑状态，允许空字符串
const NumericInput = ({ 
  value, 
  onChange, 
  onCommit, 
  className, 
  disabled,
  ...props 
}: React.InputHTMLAttributes<HTMLInputElement> & { 
  value: string | number, 
  onChange: (val: string) => void, 
  onCommit: () => void 
}) => {
  // 本地值状态和编辑状态
  const [localVal, setLocalVal] = useState(value.toString());
  const [isEditing, setIsEditing] = useState(false);

  // 当属性值变化时更新本地值（但仅在未编辑时）
  useEffect(() => {
    if (!isEditing) {
      setLocalVal(value.toString());
    } else {
       // 如果正在编辑，仅在外部更改显著时同步（例如通过gizmo拖拽）
       const parsedLocal = parseFloat(localVal);
       const parsedProp = parseFloat(value.toString());
       // 如果localVal为空/无效，我们假设用户正在输入，所以除非prop发生显著变化，否则不覆盖
       if (!isNaN(parsedLocal) && !isNaN(parsedProp) && Math.abs(parsedLocal - parsedProp) > 0.0001) {
           setLocalVal(value.toString());
       }
    }
  }, [value, isEditing]);

  // 处理输入变化
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalVal(val);
    onChange(val);
  };

  // 处理失去焦点事件
  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsEditing(false);
      // 如果输入无效则重置为属性值
      if (localVal === '' || localVal === '-' || isNaN(parseFloat(localVal))) {
          setLocalVal(value.toString());
      }
      onCommit();
  };

  // 处理键盘按下事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.currentTarget.blur();
      }
      props.onKeyDown?.(e);
  };

  // 渲染输入框
  return (
      <input 
        {...props}
        value={localVal}
        onChange={handleChange}
        onFocus={(e) => { setIsEditing(true); props.onFocus?.(e); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`${className} ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
        disabled={disabled}
      />
  )
}

// PropertiesPanel组件：显示和编辑选中对象的属性
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ object, selectionCount, onUpdate, onCommit }) => {
  // 状态：是否锁定等比例缩放，默认为true（锁定）
  const [lockScale, setLockScale] = useState(true);
  // 缩放快照引用，用于等比例缩放计算
  const scaleSnapshot = useRef<[number, number, number] | null>(null);

  // 如果选中多个对象，显示多选提示
  if (selectionCount > 1) {
    return (
      <div className="p-6 text-center text-gray-500 text-base mt-20">
        <i className="fa-solid fa-layer-group text-4xl mb-4"></i>
        <p>已选择 {selectionCount} 个对象</p>
        <p className="text-sm mt-4 text-gray-400">使用工具栏进行布尔运算、删除或导出。</p>
      </div>
    );
  }

  // 如果没有选中对象，显示提示信息
  if (!object) {
    return (
      <div className="p-6 text-center text-gray-400 text-base mt-20">
        <p>选择一个对象以查看属性。</p>
      </div>
    );
  }

  // 检查对象是否被锁定
  const isLocked = object.locked || false;

  // 处理通用属性变化
  const handleChange = (key: string, value: any) => {
    onUpdate({ [key]: value });
  };

  // 处理参数属性变化
  const handleParamChange = (paramKey: string, val: string) => {
    // 文本的特殊处理：允许空字符串
    if (paramKey === 'text') {
        onUpdate({
            params: {
                ...object.params,
                [paramKey]: val
            }
        });
        return;
    }

    // 对于数字，防止在空或单负号时更新，以允许输入
    if (val === '' || val === '-') return;
    
    onUpdate({
      params: {
        ...object.params,
        [paramKey]: Number(val),
      },
    });
  };

  // 处理位置变化
  const handlePosChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newPos = [...object.position] as [number, number, number];
    newPos[idx] = Number(val);
    onUpdate({ position: newPos });
  };

  // 处理旋转变化（角度转弧度）
  const handleRotChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newRot = [...object.rotation] as [number, number, number];
    // 将角度转换为弧度存储
    newRot[idx] = Number(val) * (Math.PI / 180);
    onUpdate({ rotation: newRot });
  };

  // 处理缩放获取焦点事件
  const handleScaleFocus = () => {
      if (object) {
          scaleSnapshot.current = [...object.scale];
      }
  };

  // 处理缩放变化
  const handleScaleChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newVal = parseFloat(val);
    if (isNaN(newVal)) return;

    if (lockScale) {
        // 如果有快照则使用，否则回退
        const baseScale = scaleSnapshot.current || object.scale;
        const currentVal = baseScale[idx];
        const newScale = [...baseScale] as [number, number, number];

        // 避免除以零或异常值
        if (Math.abs(currentVal) > 1e-6) {
            const ratio = newVal / currentVal;
            newScale[0] = baseScale[0] * ratio;
            newScale[1] = baseScale[1] * ratio;
            newScale[2] = baseScale[2] * ratio;
        } else {
            // 如果当前值为0，直接更新该轴，不进行比率计算
            newScale[idx] = newVal;
        }
        onUpdate({ scale: newScale });
    } else {
        const newScale = [...object.scale] as [number, number, number];
        newScale[idx] = newVal;
        onUpdate({ scale: newScale });
    }
  };
  
  // 处理键盘按下事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
        onCommit();
        (e.target as HTMLInputElement).blur();
    }
  };

  // 输入框样式：使用bg-gray-50替换默认背景，缩小字体和内边距
  const inputClass = "w-full text-base p-2 border border-gray-300 rounded bg-gray-50 text-gray-800 focus:border-blue-500 focus:outline-none focus:bg-white transition-colors";

  // 渲染属性面板
  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* 对象名称编辑 */}
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">名称</label>
        <div className="flex gap-2">
            <input
            type="text"
            value={object.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={onCommit}
            onKeyDown={handleKeyDown}
            className={inputClass}
            />
            {/* 锁定切换按钮 */}
             <button 
                onClick={() => handleChange('locked', !isLocked)}
                className={`w-10 flex-shrink-0 flex items-center justify-center rounded border ${isLocked ? 'bg-red-50 border-red-200 text-red-500' : 'bg-gray-50 border-gray-300 text-gray-400'}`}
                title={isLocked ? "点击解锁" : "点击锁定"}
             >
                 <i className={`fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'}`}></i>
             </button>
        </div>
        {isLocked && <div className="text-xs text-red-400 mt-1">此对象已锁定</div>}
      </div>

      {/* 对象颜色编辑 */}
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">颜色</label>
        <div className="flex gap-3 items-center">
           <input
            type="color"
            value={object.color}
            onChange={(e) => { handleChange('color', e.target.value); onCommit(); }} 
            className="h-10 w-16 p-0 border border-gray-300 rounded cursor-pointer bg-gray-50"
          />
          <input 
             type="text"
             value={object.color}
             onChange={(e) => handleChange('color', e.target.value)}
             onBlur={onCommit}
             onKeyDown={handleKeyDown}
             className={inputClass}
          />
        </div>
      </div>

      {/* 对象位置编辑 (X, Y, Z) */}
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">位置 (X, Y, Z)</label>
        <div className="grid grid-cols-3 gap-3">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <div key={axis}>
              <NumericInput
                type="number"
                value={object.position[i]}
                onChange={(val) => handlePosChange(i, val)}
                onCommit={onCommit}
                className={inputClass}
                step="1"
                disabled={isLocked}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 对象旋转编辑 (角度°) */}
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">旋转 (角度 °)</label>
        <div className="grid grid-cols-3 gap-3">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <div key={axis}>
              <NumericInput
                type="number"
                // 将弧度转换为角度显示
                value={(object.rotation[i] * (180 / Math.PI)).toFixed(1)}
                onChange={(val) => handleRotChange(i, val)}
                onCommit={onCommit}
                className={inputClass}
                step="15"
                disabled={isLocked}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 对象缩放编辑 */}
      <div className="mb-6">
        <div className="flex flex-col mb-3">
            <div className="flex justify-between items-center">
               <label className="block text-sm font-bold text-gray-500 uppercase">缩放 (Scale)</label>
            </div>
            <div className="flex items-center mt-2">
                <input 
                    id="scale-lock-checkbox"
                    type="checkbox" 
                    checked={lockScale} 
                    onChange={(e) => setLockScale(e.target.checked)}
                    className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                />
                <label htmlFor="scale-lock-checkbox" className="ml-2 text-base text-gray-600 cursor-pointer select-none">
                    等比例缩放
                </label>
            </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <div key={axis}>
              <NumericInput
                type="number"
                value={object.scale[i]}
                onChange={(val) => handleScaleChange(i, val)}
                onCommit={onCommit}
                onFocus={handleScaleFocus}
                className={inputClass}
                step="0.1"
                disabled={isLocked}
              />
            </div>
          ))}
        </div>
      </div>
      
      {/* 几何参数编辑 */}
      {object.type !== 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-500 uppercase mb-3 border-b border-gray-200 pb-1">几何参数</label>
          
          <div className="space-y-4">
            {/* 文本内容编辑 */}
            {object.type === 'text' && (
               <div>
                  <label className="text-base text-gray-600 block mb-1">文本内容</label>
                  <input
                    type="text"
                    value={object.params.text || ''}
                    onChange={(e) => handleParamChange('text', e.target.value)}
                    onBlur={onCommit}
                    onKeyDown={handleKeyDown}
                    className={inputClass}
                  />
               </div>
            )}

            {/* 宽度参数编辑 */}
            {(object.params.width !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">宽度 (Width)</label>
                <NumericInput
                  type="number"
                  value={object.params.width}
                  onChange={(val) => handleParamChange('width', val)}
                  onCommit={onCommit}
                  className={inputClass}
                  disabled={isLocked}
                />
              </div>
            )}
            
            {/* 高度/厚度参数编辑 */}
            {(object.params.height !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">
                    {object.type === 'text' ? '厚度/挤出 (Depth)' : '高度 (Height)'}
                </label>
                <NumericInput
                  type="number"
                  value={object.params.height}
                  onChange={(val) => handleParamChange('height', val)}
                  onCommit={onCommit}
                  className={inputClass}
                  disabled={isLocked}
                />
              </div>
            )}
            
            {/* 深度参数编辑 */}
            {(object.params.depth !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">深度 (Depth)</label>
                <NumericInput
                  type="number"
                  value={object.params.depth}
                  onChange={(val) => handleParamChange('depth', val)}
                  onCommit={onCommit}
                  className={inputClass}
                  disabled={isLocked}
                />
              </div>
            )}
            
            {/* 半径参数编辑 */}
            {(object.params.radius !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">
                    {object.type === 'text' ? '字号 (Size)' : '半径 (Radius)'}
                </label>
                <NumericInput
                  type="number"
                  value={object.params.radius}
                  onChange={(val) => handleParamChange('radius', val)}
                  onCommit={onCommit}
                  className={inputClass}
                  disabled={isLocked}
                />
              </div>
            )}
            
            {/* 管径参数编辑 */}
            {(object.params.tube !== undefined) && (
               <div>
                <label className="text-base text-gray-600 block mb-1">
                  {object.type === 'torus' ? '内径 (Inner Radius)' : '管径 (Tube)'}
                </label>
                <NumericInput
                  type="number"
                  value={object.params.tube}
                  onChange={(val) => handleParamChange('tube', val)}
                  onCommit={onCommit}
                  className={inputClass}
                  disabled={isLocked}
                />
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 自定义对象提示 */}
      {object.type === 'custom' && (
        <div className="mb-6 p-3 bg-blue-50 text-blue-800 text-base rounded border border-blue-100 flex items-start gap-2">
           <i className="fa-solid fa-info-circle mt-1"></i> 
           <span>此对象由布尔运算或导入生成，无法调整基础几何参数，但可调整上方变换属性。</span>
        </div>
      )}
    </div>
  );
};