// 导入React核心库和Three.js相关模块
import React, { useRef, useMemo, useEffect, useState, Suspense } from 'react';
// 从@react-three/fiber导入Canvas和useThree钩子，用于创建Three.js场景
import { Canvas, useThree } from '@react-three/fiber';
// 从@react-three/drei导入常用3D组件和辅助工具
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewcube, Text3D, Center } from '@react-three/drei';
// 导入Three.js核心库
import * as THREE from 'three';
// 导入自定义类型定义
import { CADObject, WorkPlaneState } from '../types';

// 修复TypeScript中缺少JSX IntrinsicElements的问题
// 我们扩展全局JSX命名空间以包含Three.js元素
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      directionalLight: any;
      gridHelper: any;
      axesHelper: any;
      arrowHelper: any;
      group: any;
      mesh: any;
      boxGeometry: any;
      sphereGeometry: any;
      cylinderGeometry: any;
      coneGeometry: any;
      planeGeometry: any;
      primitive: any;
      meshStandardMaterial: any;
      meshBasicMaterial: any;
      lineLoop: any;
      bufferGeometry: any;
      bufferAttribute: any;
      lineBasicMaterial: any;
      lineSegments: any;
      edgesGeometry: any;
    }
  }
}

// 定义Scene组件的属性接口
interface SceneProps {
  objects: CADObject[]; // 场景中的所有CAD对象
  selectedIds: string[]; // 当前选中的对象ID数组
  onObjectClick: (id: string | null, point?: THREE.Vector3, normal?: THREE.Vector3) => void; // 对象点击回调
  onUpdate: (id: string, updates: Partial<CADObject>) => void; // 对象更新回调
  onCommit: () => void; // 提交更改回调
  transformMode: 'translate' | 'rotate' | 'scale'; // 变换模式
  workPlane: WorkPlaneState; // 工作平面状态
  floorMode: boolean; // 基准面模式
}

// 定义工作区边界范围
const SCENE_EXTENT = 500; // 从中心向外延伸500单位（总大小1000x1000x1000）

// MeshComponent组件：负责渲染单个CAD对象
const MeshComponent: React.FC<{
  obj: CADObject; // 要渲染的CAD对象
  isSelected: boolean; // 是否被选中
  onSelect: (id: string | null, point?: THREE.Vector3, normal?: THREE.Vector3) => void; // 选择回调
}> = ({ obj, isSelected, onSelect }) => {
  // 创建网格引用，用于访问Three.js对象
  const meshRef = useRef<THREE.Mesh>(null);

  // 使用useMemo缓存几何体，只有当对象类型或参数改变时才重新创建
  const geometry = useMemo(() => {
    const { params, type } = obj;
    // 根据对象类型创建对应的几何体
    if (type === 'cube') {
      return <boxGeometry args={[params.width, params.height, params.depth]} />;
    } else if (type === 'sphere') {
      return <sphereGeometry args={[params.radius, 32, 32]} />;
    } else if (type === 'cylinder') {
      return <cylinderGeometry args={[params.radius, params.radius, params.height, 32]} />;
    } else if (type === 'cone') {
      return <coneGeometry args={[params.radius, params.height, 32]} />;
    } else if (type === 'prism') {
      return <cylinderGeometry args={[params.radius, params.radius, params.height, 3]} />;
    } else if (type === 'hemisphere') {
      // 创建半球几何体
      const points = [];
      points.push(new THREE.Vector2(0, 0));
      for (let i = 0; i <= 32; i++) {
        const phi = (i / 32) * (Math.PI / 2);
        points.push(new THREE.Vector2(params.radius * Math.cos(phi), params.radius * Math.sin(phi)));
      }
      points.push(new THREE.Vector2(0, params.radius));
      points.push(new THREE.Vector2(0, 0));

      const geom = new THREE.LatheGeometry(points, 32);
      geom.center();
      return <primitive object={geom} attach="geometry" />;
    } else if (type === 'half_cylinder') {
      // 创建半圆柱几何体
      const shape = new THREE.Shape();
      shape.absarc(0, 0, params.radius, 0, Math.PI, false);
      shape.lineTo(params.radius, 0);

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: params.height,
        bevelEnabled: false,
        curveSegments: 32
      });
      geom.center(); 
      geom.rotateX(-Math.PI / 2); 
      return <primitive object={geom} attach="geometry" />;
    } else if (type === 'torus') {
      // 创建空心圆柱（拉伸带孔的形状）
      const shape = new THREE.Shape();
      shape.absarc(0, 0, params.radius, 0, Math.PI * 2, false);

      const holePath = new THREE.Path();
      holePath.absarc(0, 0, params.tube, 0, Math.PI * 2, true);
      shape.holes.push(holePath);

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: params.height,
        bevelEnabled: false,
        curveSegments: 32
      });
      geom.center();
      // 拉伸沿Z轴，旋转使其直立（沿Y轴）
      geom.rotateX(-Math.PI / 2);
      
      return <primitive object={geom} attach="geometry" />;
    } else if (type === 'custom' && obj.geometryData) {
      // 处理自定义几何体（如布尔运算结果）
      const loader = new THREE.BufferGeometryLoader();
      const geom = loader.parse(obj.geometryData);
      return <primitive object={geom} attach="geometry" />;
    }
    return null;
  }, [obj.type, obj.params, obj.geometryData]);

  // 处理对象点击事件
  const handleClick = (e: any) => {
    e.stopPropagation();
    const face = e.face;
    let normal = new THREE.Vector3(0, 1, 0);
    // 对于Text3D，meshRef可能指向内部网格（如果被包装）或组
    // 但是，事件冒泡通常会给我们提供对象
    if (face && e.object) {
        // 将法向量转换为世界空间
        normal = face.normal.clone().applyQuaternion(e.object.quaternion).normalize();
    }
    onSelect(obj.id, e.point, normal);
  };

  // 特殊处理文本对象，它渲染为不同类型的组件
  if (obj.type === 'text') {
      return (
          <group
            position={obj.position}
            rotation={obj.rotation}
            scale={obj.scale}
            userData={{ id: obj.id }}
            onClick={handleClick}
          >
              <Suspense fallback={
                  // 悬停加载状态：显示线框立方体
                  <mesh>
                      <boxGeometry args={[obj.params.radius || 20, obj.params.radius || 20, obj.params.height || 5]} />
                      <meshBasicMaterial color="red" wireframe />
                  </mesh>
              }>
                  <Center top>
                      <Text3D
                        // 使用可靠的CDN和特定版本确保字体加载
                        font="https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json"
                        size={obj.params.radius || 20}
                        height={obj.params.height || 5}
                        curveSegments={6}
                        bevelEnabled
                        bevelThickness={1}
                        bevelSize={0.5}
                        bevelOffset={0}
                        bevelSegments={3}
                      >
                        {obj.params.text || 'TEXT'}
                        <meshStandardMaterial
                            color={obj.color}
                            emissive={isSelected ? "#3b82f6" : "#000000"}
                            roughness={0.4} 
                            metalness={0.3}
                        />
                      </Text3D>
                  </Center>
              </Suspense>
          </group>
      )
  }

  // 渲染普通3D对象网格
  return (
    <mesh
      ref={meshRef}
      position={obj.position}
      rotation={obj.rotation}
      scale={obj.scale}
      userData={{ id: obj.id }}
      onClick={handleClick}
    >
      {geometry}
      <meshStandardMaterial
        color={obj.color}
        emissive={isSelected ? "#3b82f6" : "#000000"}
        roughness={0.4} 
        metalness={0.3} // 稍微增加金属感以获得更好的环境反射效果
        polygonOffset={true}
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        side={THREE.DoubleSide} 
      />
    </mesh>
  );
};

// 可重用函数：禁用射线投射（防止对象阻挡点击事件）
const ignoreRaycast = () => null;

// WorkPlaneHelper组件：可视化工作平面
const WorkPlaneHelper: React.FC<{ data: WorkPlaneState['planeData'] }> = ({ data }) => {
    // 如果没有平面数据，则不渲染任何内容
    if (!data) return null;
    
    // 创建位置和法向量向量
    const pos = new THREE.Vector3(...data.position);
    const normal = new THREE.Vector3(data.normal[0], data.normal[1], data.normal[2]);

    // 创建虚拟对象用于定向
    const dummy = new THREE.Object3D();
    dummy.position.copy(pos);
    
    // 防止当朝向平行于默认向上方向(0, 1, 0)时出现奇点
    // 如果法向量实际上垂直，将向上向量更改为Z以允许正确的方向
    if (Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))) > 0.99) {
        dummy.up.set(0, 0, 1);
    }

    // 设置对象朝向
    dummy.lookAt(pos.clone().add(normal));
    
    // 显式设置raycast为null以防止阻塞点击
    return (
        <group position={pos} quaternion={dummy.quaternion}>
             <gridHelper 
                args={[200, 20, 0x3b82f6, 0x3b82f6]} 
                rotation={[Math.PI / 2, 0, 0]} 
                raycast={ignoreRaycast} 
             />
             <mesh rotation={[0, 0, 0]} raycast={ignoreRaycast}> 
                 <planeGeometry args={[200, 200]} />
                 <meshBasicMaterial color="#3b82f6" opacity={0.1} transparent side={THREE.DoubleSide} depthWrite={false} />
             </mesh>
             <arrowHelper 
                args={[new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,0), 30, 0x1d4ed8]} 
                raycast={ignoreRaycast} 
             />
        </group>
    )
}

// PlaneConstrainedControls组件：特殊控制器，将移动锁定到平面
const PlaneConstrainedControls: React.FC<{
  object: CADObject,
  planeNormal: [number, number, number],
  onUpdate: (id: string, updates: Partial<CADObject>) => void,
  onCommit: () => void,
  floorMode: boolean
}> = ({ object, planeNormal, onUpdate, onCommit, floorMode }) => {
  // 创建代理引用和拖拽状态
  const proxyRef = useRef<THREE.Mesh>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 当真实对象发生变化时更新代理位置（例如从属性面板）
  // 仅在未拖拽时同步，这可以防止React状态更新和活动的TransformControls拖拽之间的"跳跃"或冲突
  useEffect(() => {
    if (proxyRef.current && !isDragging) {
      proxyRef.current.position.set(...object.position);
      proxyRef.current.updateMatrixWorld();
    }
  }, [object.position, isDragging]);

  // 设置代理旋转以与平面法向量对齐
  useEffect(() => {
    if (proxyRef.current) {
      const normal = new THREE.Vector3(...planeNormal);
      const zAxis = new THREE.Vector3(0, 0, 1);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(zAxis, normal);
      proxyRef.current.quaternion.copy(quaternion);
      proxyRef.current.updateMatrixWorld();
    }
  }, [planeNormal]);

  return (
    <>
      <mesh ref={proxyRef} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <TransformControls
        object={proxyRef.current}
        mode="translate"
        space="local"
        showZ={false} // 锁定到平面（X/Y局部轴在平面上）
        size={2.5}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => {
           setIsDragging(false);
           onCommit();
        }}
        onObjectChange={(e: any) => {
           if (e.target.object) {
             const obj = e.target.object;
             obj.updateMatrixWorld(); // 确保世界矩阵是最新的

             const box = new THREE.Box3().setFromObject(obj);

             // 使用精确的包围盒强制执行地板约束
             if (floorMode) {
                 const minY = box.min.y;
                 if (minY < -0.001) {
                     obj.position.y -= minY; 
                     obj.updateMatrixWorld();
                     box.setFromObject(obj); // 移动后更新包围盒
                 }
             }
             
             // 强制执行边界约束（XYZ）
             let shiftX = 0;
             let shiftY = 0;
             let shiftZ = 0;
             
             if (box.min.x < -SCENE_EXTENT) shiftX = -SCENE_EXTENT - box.min.x;
             if (box.max.x > SCENE_EXTENT) shiftX = SCENE_EXTENT - box.max.x;
             
             if (box.min.y < -SCENE_EXTENT) shiftY = -SCENE_EXTENT - box.min.y;
             if (box.max.y > SCENE_EXTENT) shiftY = SCENE_EXTENT - box.max.y;
             
             if (box.min.z < -SCENE_EXTENT) shiftZ = -SCENE_EXTENT - box.min.z;
             if (box.max.z > SCENE_EXTENT) shiftZ = SCENE_EXTENT - box.max.z;

             if (shiftX !== 0 || shiftY !== 0 || shiftZ !== 0) {
                 obj.position.x += shiftX;
                 obj.position.y += shiftY;
                 obj.position.z += shiftZ;
                 obj.updateMatrixWorld();
             }

             const p = obj.position;
             // 同步真实对象位置到代理位置
             onUpdate(object.id, { position: [p.x, p.y, p.z] });
           }
        }}
      />
    </>
  );
};

// BoundaryHelper组件：可视化场景边界
const BoundaryHelper = () => {
    // 使用useMemo缓存盒子几何体
    const boxGeo = useMemo(() => new THREE.BoxGeometry(SCENE_EXTENT * 2, SCENE_EXTENT * 2, SCENE_EXTENT * 2), []);
    
    return (
        <group>
             <lineSegments>
                <edgesGeometry args={[boxGeo]} />
                <lineBasicMaterial color="#ef4444" opacity={0.3} transparent />
             </lineSegments>
        </group>
    )
}

// SceneContent组件：场景主要内容
const SceneContent: React.FC<SceneProps> = ({ objects, selectedIds, onObjectClick, onUpdate, onCommit, transformMode, workPlane, floorMode }) => {
  // 获取场景对象
  const { scene } = useThree();
  // 判断工作平面是否处于激活状态
  const isWorkPlaneActive = workPlane.step === 'ACTIVE' && workPlane.planeData && workPlane.sourceObjId;

  // 识别工作平面的活动对象
  const activeObj = isWorkPlaneActive ? objects.find(o => o.id === workPlane.sourceObjId) : null;
  const isSelectedObjActive = activeObj && selectedIds.includes(activeObj.id);

  return (
    <>
      {/* 高质量光照设置 - 使用简单的环境光和方向光替代HDR贴图 */}
      <ambientLight intensity={0.5} /> 
      <directionalLight 
        position={[80, 100, 80]} 
        intensity={1.2} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      />
      {/* 移除Environment组件，因为它会导致网络错误 */}
      
      {/* 如果没有工作平面数据，则显示网格和边界 */}
      {!workPlane.planeData && (
          <>
            <gridHelper args={[SCENE_EXTENT * 2, 100, 0xcccccc, 0xe5e5e5]} position={[0, 0, 0]} />
            <BoundaryHelper />
          </>
      )}
      <axesHelper args={[50]} />

      {/* 用于选择地面作为工作平面目标的交互地面平面 */}
      {workPlane.step === 'PICKING_TARGET' && (
        <mesh 
           rotation={[-Math.PI / 2, 0, 0]} 
           position={[0, -0.01, 0]}
           onClick={(e) => {
             e.stopPropagation();
             onObjectClick('GROUND_PLANE', e.point, new THREE.Vector3(0, 1, 0));
           }}
        >
             <planeGeometry args={[2000, 2000]} />
             <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* 渲染工作平面辅助 */}
      <WorkPlaneHelper data={workPlane.planeData} />

      {/* 渲染所有对象 */}
      {objects.map((obj) => (
        <React.Fragment key={obj.id}>
          <MeshComponent
            obj={obj}
            isSelected={selectedIds.includes(obj.id)}
            onSelect={onObjectClick}
          />
          
          {/* 正常控制：仅在选中、单选、不在活动工作平面模式下且未锁定时显示 */}
          {selectedIds.includes(obj.id) && selectedIds.length === 1 && (!isWorkPlaneActive || obj.id !== workPlane.sourceObjId) && !obj.locked && (
            <TransformControls
              object={scene.children.find(c => c.userData && c.userData.id === obj.id)}
              position={obj.position}
              rotation={obj.rotation}
              mode={transformMode}
              space="world" // 默认使用世界坐标系便于使用
              size={2.5}
              onObjectChange={(e: any) => {
                if (e?.target?.object) {
                  const o = e.target.object;
                  
                  o.updateMatrixWorld();
                  const box = new THREE.Box3().setFromObject(o);
                  
                  // --- 精确的地板约束 ---
                  if (floorMode) {
                       const minY = box.min.y;
                       
                       // 如果最低点低于0，抬起对象
                       // 使用小的epsilon避免浮点抖动
                       if (minY < -0.001) {
                           o.position.y -= minY; // 按穿透深度偏移位置
                           o.updateMatrixWorld();
                           box.setFromObject(o); // 重新计算包围盒用于边界检查
                       }
                  }

                  // --- 边界约束 ---
                  // 夹住对象使其包围盒保持在 +/- SCENE_EXTENT 内
                  let shiftX = 0;
                  let shiftY = 0;
                  let shiftZ = 0;
                  
                  if (box.min.x < -SCENE_EXTENT) shiftX = -SCENE_EXTENT - box.min.x;
                  else if (box.max.x > SCENE_EXTENT) shiftX = SCENE_EXTENT - box.max.x;
                  
                  if (box.min.y < -SCENE_EXTENT) shiftY = -SCENE_EXTENT - box.min.y;
                  else if (box.max.y > SCENE_EXTENT) shiftY = SCENE_EXTENT - box.max.y;

                  if (box.min.z < -SCENE_EXTENT) shiftZ = -SCENE_EXTENT - box.min.z;
                  else if (box.max.z > SCENE_EXTENT) shiftZ = SCENE_EXTENT - box.max.z;

                  if (shiftX !== 0 || shiftY !== 0 || shiftZ !== 0) {
                      o.position.x += shiftX;
                      o.position.y += shiftY;
                      o.position.z += shiftZ;
                      o.updateMatrixWorld();
                  }

                  onUpdate(obj.id, {
                    position: [o.position.x, o.position.y, o.position.z],
                    rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
                    scale: [o.scale.x, o.scale.y, o.scale.z]
                  });
                }
              }}
              onMouseUp={onCommit}
            />
          )}
        </React.Fragment>
      ))}

      {/* 平面约束控制：为活动对象显示，隐藏如果锁定 */}
      {isWorkPlaneActive && isSelectedObjActive && activeObj && !activeObj.locked && workPlane.planeData && (
        <PlaneConstrainedControls 
          object={activeObj} 
          planeNormal={workPlane.planeData.normal}
          onUpdate={onUpdate}
          onCommit={onCommit}
          floorMode={floorMode}
        />
      )}

      {/* 默认轨道控制 */}
      <OrbitControls makeDefault />
      
      {/* 视角立方体辅助 */}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewcube 
          faces={['右', '左', '上', '下', '前', '后']}
          // 样式：蓝色主题
          color="#ffffff"
          strokeColor="#3b82f6" // Blue-500
          textColor="#1d4ed8"   // Blue-700
          hoverColor="#bfdbfe"  // Blue-200
          opacity={1}
          font="800 48px 'Inter', 'Microsoft YaHei', sans-serif" 
        />
      </GizmoHelper>
    </>
  );
};

// Scene组件：导出的场景组件
export const Scene: React.FC<SceneProps> = (props) => {
  return (
    // Canvas组件：Three.js渲染画布
    <Canvas
      shadows
      dpr={[1, 2]} // 支持高DPI渲染
      camera={{ position: [150, 150, 150], fov: 50, far: 5000 }}
      className="w-full h-full bg-white"
      onPointerMissed={() => {
          // 仅当点击背景（未命中所有对象）时触发取消选择
          props.onObjectClick(null);
      }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
};