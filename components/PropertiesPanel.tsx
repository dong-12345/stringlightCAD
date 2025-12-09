
import React, { useState, useEffect, useRef } from 'react';
import { CADObject } from '../types';

interface PropertiesPanelProps {
  object: CADObject | null;
  selectionCount: number;
  onUpdate: (updates: Partial<CADObject>) => void;
  onCommit: () => void;
}

// Wrapper to handle local editing state, allowing empty strings
const NumericInput = ({ 
  value, 
  onChange, 
  onCommit, 
  className, 
  ...props 
}: React.InputHTMLAttributes<HTMLInputElement> & { 
  value: string | number, 
  onChange: (val: string) => void, 
  onCommit: () => void 
}) => {
  const [localVal, setLocalVal] = useState(value.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setLocalVal(value.toString());
    } else {
       // If editing, only sync if external change is significant (e.g. gizmo drag)
       const parsedLocal = parseFloat(localVal);
       const parsedProp = parseFloat(value.toString());
       // If localVal is empty/invalid, we assume user is typing, so don't overwrite unless prop changed significantly
       if (!isNaN(parsedLocal) && !isNaN(parsedProp) && Math.abs(parsedLocal - parsedProp) > 0.0001) {
           setLocalVal(value.toString());
       }
    }
  }, [value, isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalVal(val);
    onChange(val);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsEditing(false);
      // Reset to prop value if invalid on blur
      if (localVal === '' || localVal === '-' || isNaN(parseFloat(localVal))) {
          setLocalVal(value.toString());
      }
      onCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.currentTarget.blur();
      }
      props.onKeyDown?.(e);
  };

  return (
      <input 
        {...props}
        value={localVal}
        onChange={handleChange}
        onFocus={(e) => { setIsEditing(true); props.onFocus?.(e); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={className}
      />
  )
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ object, selectionCount, onUpdate, onCommit }) => {
  // 状态：是否锁定等比例缩放，默认为 true (锁定)
  const [lockScale, setLockScale] = useState(true);
  const scaleSnapshot = useRef<[number, number, number] | null>(null);

  if (selectionCount > 1) {
    return (
      <div className="p-6 text-center text-gray-500 text-base mt-20">
        <i className="fa-solid fa-layer-group text-4xl mb-4"></i>
        <p>已选择 {selectionCount} 个对象</p>
        <p className="text-sm mt-4 text-gray-400">使用工具栏进行布尔运算、删除或导出。</p>
      </div>
    );
  }

  if (!object) {
    return (
      <div className="p-6 text-center text-gray-400 text-base mt-20">
        <p>选择一个对象以查看属性。</p>
      </div>
    );
  }

  const handleChange = (key: string, value: any) => {
    onUpdate({ [key]: value });
  };

  const handleParamChange = (paramKey: string, val: string) => {
    // Special handling for text: allow empty string
    if (paramKey === 'text') {
        onUpdate({
            params: {
                ...object.params,
                [paramKey]: val
            }
        });
        return;
    }

    // For numbers, prevent update on empty or single negative sign to allow typing
    if (val === '' || val === '-') return;
    
    onUpdate({
      params: {
        ...object.params,
        [paramKey]: Number(val),
      },
    });
  };

  const handlePosChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newPos = [...object.position] as [number, number, number];
    newPos[idx] = Number(val);
    onUpdate({ position: newPos });
  };

  const handleRotChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newRot = [...object.rotation] as [number, number, number];
    // Convert degrees to radians for storage
    newRot[idx] = Number(val) * (Math.PI / 180);
    onUpdate({ rotation: newRot });
  };

  const handleScaleFocus = () => {
      if (object) {
          scaleSnapshot.current = [...object.scale];
      }
  };

  const handleScaleChange = (idx: number, val: string) => {
    if (val === '' || val === '-') return;
    const newVal = parseFloat(val);
    if (isNaN(newVal)) return;

    if (lockScale) {
        // Use snapshot if available to avoid "0" glitch, else fallback
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
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
        onCommit();
        (e.target as HTMLInputElement).blur();
    }
  };

  // 输入框样式：使用 bg-gray-50 替换默认背景，缩小字体和内边距
  const inputClass = "w-full text-base p-2 border border-gray-300 rounded bg-gray-50 text-gray-800 focus:border-blue-500 focus:outline-none focus:bg-white transition-colors";

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">名称</label>
        <input
          type="text"
          value={object.name}
          onChange={(e) => handleChange('name', e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          className={inputClass}
        />
      </div>

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
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-500 uppercase mb-2">旋转 (角度 °)</label>
        <div className="grid grid-cols-3 gap-3">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <div key={axis}>
              <NumericInput
                type="number"
                // Convert radians to degrees for display
                value={(object.rotation[i] * (180 / Math.PI)).toFixed(1)}
                onChange={(val) => handleRotChange(i, val)}
                onCommit={onCommit}
                className={inputClass}
                step="15"
              />
            </div>
          ))}
        </div>
      </div>

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
              />
            </div>
          ))}
        </div>
      </div>
      
      {/* 几何参数 */}
      {object.type !== 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-500 uppercase mb-3 border-b border-gray-200 pb-1">几何参数</label>
          
          <div className="space-y-4">
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

            {(object.params.width !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">宽度 (Width)</label>
                <NumericInput
                  type="number"
                  value={object.params.width}
                  onChange={(val) => handleParamChange('width', val)}
                  onCommit={onCommit}
                  className={inputClass}
                />
              </div>
            )}
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
                />
              </div>
            )}
            {(object.params.depth !== undefined) && (
              <div>
                <label className="text-base text-gray-600 block mb-1">深度 (Depth)</label>
                <NumericInput
                  type="number"
                  value={object.params.depth}
                  onChange={(val) => handleParamChange('depth', val)}
                  onCommit={onCommit}
                  className={inputClass}
                />
              </div>
            )}
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
                />
              </div>
            )}
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
                />
              </div>
            )}
          </div>
        </div>
      )}
      
      {object.type === 'custom' && (
        <div className="mb-6 p-3 bg-blue-50 text-blue-800 text-base rounded border border-blue-100 flex items-start gap-2">
           <i className="fa-solid fa-info-circle mt-1"></i> 
           <span>此对象由布尔运算或导入生成，无法调整基础几何参数，但可调整上方变换属性。</span>
        </div>
      )}
    </div>
  );
};
