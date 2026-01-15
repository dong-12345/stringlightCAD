// 定义形状类型联合类型，包括各种基本几何体和自定义类型
export type ShapeType = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'prism' | 'hemisphere' | 'half_cylinder' | 'torus' | 'custom' | 'text';

// 定义CAD对象接口
export interface CADObject {
  id: string; // 对象唯一标识符
  name: string; // 对象名称
  type: ShapeType; // 对象类型
  position: [number, number, number]; // 对象位置[x, y, z]
  rotation: [number, number, number]; // 对象旋转[rx, ry, rz]（弧度）
  scale: [number, number, number]; // 对象缩放[sx, sy, sz]
  color: string; // 对象颜色（十六进制字符串）
  locked?: boolean; // 对象是否被锁定（可选属性）
  params: { // 对象参数，根据不同类型有不同的参数
    width?: number;   // 立方体的宽度
    height?: number;  // 立方体的高度、圆柱体、圆锥体、三棱柱、半圆柱、文本的厚度/深度
    depth?: number;   // 立方体的深度
    radius?: number;  // 球体、圆柱体、圆锥体、三棱柱、半球体、半圆柱、空心圆柱、文本的半径/大小
    tube?: number;    // 空心圆柱的内径
    text?: string;    // 文本内容
  };
  geometryData?: any; // 存储布尔运算结果的THREE.BufferGeometry JSON数据
}

// 定义工作平面状态接口
export interface WorkPlaneState {
  step: 'IDLE' | 'PICKING_TARGET' | 'PICKING_SOURCE' | 'ACTIVE'; // 工作平面步骤状态
  planeData: { // 平面数据
    position: [number, number, number]; // 平面上的点
    normal: [number, number, number];   // 平面法向量
    targetObjId: string; // 目标对象ID
  } | null;
  sourceObjId: string | null; // 源对象ID（正在对齐/移动的对象）
  sourceLocalData?: { // 源对象局部数据
    point: [number, number, number];  // 对象局部空间中的点击点
    normal: [number, number, number]; // 对象局部空间中的点击面法向量
  };
  flipOrientation: boolean; // 是否翻转方向
}
// 定义标签页状态接口
export interface TabState {
  id: string; // 标签页唯一标识符
  name: string; // 标签页名称
  objects: CADObject[]; // 该标签页中的对象数组
  selectedIds: string[]; // 该标签页中的选中对象ID
  transformMode: 'translate' | 'rotate' | 'scale'; // 该标签页中的变换模式
  pendingOp: { type: 'UNION' | 'SUBTRACT', baseId: string } | null; // 待处理的布尔运算
  workPlane: WorkPlaneState; // 工作平面状态
  floorMode: boolean; // 基准面模式
  hasUnsavedChanges: boolean; // 是否有未保存的更改
  history: {objects: CADObject[], selectedIds: string[]}[]; // 操作历史
  historyIndex: number; // 当前历史索引
}

// 默认颜色常量
export const DEFAULT_COLOR = "#A78BFA";
// 选中颜色常量
export const SELECTED_COLOR = "#FFD700";