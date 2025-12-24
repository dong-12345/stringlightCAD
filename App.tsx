
import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Scene } from './components/Scene';
import { ObjectList } from './components/ObjectList';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { ModelLibrary } from './components/ModelLibrary';
import { CADObject, ShapeType, DEFAULT_COLOR, WorkPlaneState } from './types';
import { getObjectHalfHeight } from './utils';

// 扩展Window接口以包含Electron自定义方法
declare global {
  interface Window {
    Electron?: {
      onCheckUnsaveChanges: (callback: () => void) => void;
      replyUnsaveChanges: (hasUnsavedChanges: boolean) => void;
    };
    electronAPI?: {
      onCheckUnsaveChanges: (callback: () => void) => void;
      replyUnsaveChanges: (hasUnsavedChanges: boolean) => void;
    };
  }
}

// Maximum history steps to keep memory usage in check
const MAX_HISTORY = 50;

const App: React.FC = () => {
  const [objects, setObjects] = useState<CADObject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  
  // Pending boolean operation state (waiting for second object)
  const [pendingOp, setPendingOp] = useState<{ type: 'UNION' | 'SUBTRACT', baseId: string } | null>(null);

  // Model Library Modal State
  const [showLibrary, setShowLibrary] = useState(false);

  // Floor Constraint Mode
  const [floorMode, setFloorMode] = useState(false);

  // Work Plane State
  const [workPlane, setWorkPlane] = useState<WorkPlaneState>({
    step: 'IDLE',
    planeData: null,
    sourceObjId: null,
    flipOrientation: false
  });

  // Panel Visibility State
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // Unsaved Changes State
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // History State
  const [history, setHistory] = useState<{objects: CADObject[], selectedIds: string[]}[]>([
    { objects: [], selectedIds: [] }
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  // --- Unsaved Changes Warning ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Update Title
    document.title = hasUnsavedChanges ? "StringLightCAD * (未保存)" : "StringLightCAD";

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Electron环境下监听主进程的检查未保存更改消息
  useEffect(() => {
    const handleCheckUnsavedChanges = () => {
      // 通过预加载脚本暴露的API回复主进程
      if (window.electronAPI && window.electronAPI.replyUnsaveChanges) {
        window.electronAPI.replyUnsaveChanges(hasUnsavedChanges);
      } else if (window.Electron && window.Electron.replyUnsaveChanges) {
        window.Electron.replyUnsaveChanges(hasUnsavedChanges);
      }
    };

    // 添加事件监听器
    if (window.electronAPI && window.electronAPI.onCheckUnsaveChanges) {
      window.electronAPI.onCheckUnsaveChanges(handleCheckUnsavedChanges);
    } else if (window.Electron && window.Electron.onCheckUnsaveChanges) {
      window.Electron.onCheckUnsaveChanges(handleCheckUnsavedChanges);
    }

    // 清理事件监听器
    return () => {
      if (window.electronAPI && window.electronAPI.onCheckUnsaveChanges) {
        window.electronAPI.onCheckUnsaveChanges(handleCheckUnsavedChanges);
      } else if (window.Electron && window.Electron.onCheckUnsaveChanges) {
        window.Electron.onCheckUnsaveChanges(handleCheckUnsavedChanges);
      }
    };
  }, [hasUnsavedChanges]);

  // --- History Management ---
  
  // Save a new state to history. 
  const pushHistory = (newObjects: CADObject[], newSelectedIds: string[]) => {
    const currentEntry = { objects: newObjects, selectedIds: newSelectedIds };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentEntry);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setHasUnsavedChanges(true); // Mark as dirty
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setPendingOp(null);
      setWorkPlane(prev => ({ ...prev, step: 'IDLE', planeData: null, sourceObjId: null }));
      const prevIndex = historyIndex - 1;
      const prevState = history[prevIndex];
      setObjects(prevState.objects);
      setSelectedIds(prevState.selectedIds);
      setHistoryIndex(prevIndex);
      // Undo technically reverts to a previous state, which might still be "unsaved" relative to disk,
      // but we keep it marked as unsaved to ensure user knows to save.
      setHasUnsavedChanges(true); 
    }
  };

  const handleCommit = () => {
    pushHistory(objects, selectedIds);
  };

  // --- Core Boolean Logic ---
  const executeBooleanOp = (op: 'UNION' | 'SUBTRACT', baseId: string, toolId: string) => {
    const obj1 = objects.find(o => o.id === baseId);
    const obj2 = objects.find(o => o.id === toolId);
    
    if (!obj1 || !obj2) return;
    if (obj1.locked) {
        alert(`对象 "${obj1.name}" 已锁定，无法修改。`);
        return;
    }

    // 检测两个对象是否有重叠
    if (!hasIntersection(obj1, obj2)) {
      setError("两个对象没有重叠，无法进行布尔运算。");
      return;
    }

    try {
      const geom1 = createGeometry(obj1);
      const geom2 = createGeometry(obj2);

      const brush1 = new Brush(geom1);
      brush1.position.set(...obj1.position);
      brush1.rotation.set(...obj1.rotation);
      brush1.scale.set(...obj1.scale);
      brush1.updateMatrixWorld();

      const brush2 = new Brush(geom2);
      brush2.position.set(...obj2.position);
      brush2.rotation.set(...obj2.rotation);
      brush2.scale.set(...obj2.scale);
      brush2.updateMatrixWorld();

      const evaluator = new Evaluator();
      evaluator.attributes = ['position', 'normal']; 
      evaluator.useGroups = false; 
      
      const csgOp = op === 'UNION' ? ADDITION : SUBTRACTION;
      const result = evaluator.evaluate(brush1, brush2, csgOp);

      let resultGeometry = result.geometry;
      resultGeometry = mergeVertices(resultGeometry, 1e-4);
      resultGeometry.computeVertexNormals();
      if (!resultGeometry.attributes.uv) {
        ensureAttributes(resultGeometry);
      }

      const json = resultGeometry.toJSON();
      const id = uuidv4();

      const newObj: CADObject = {
        id,
        name: `${obj1.name} ${op === 'UNION' ? '∪' : '-'} ${obj2.name}`,
        type: 'custom',
        position: [0, 0, 0], 
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: obj1.color,
        params: {},
        geometryData: json,
        locked: false
      };

      const nextObjects = [
        ...objects.filter(o => o.id !== obj1.id && o.id !== obj2.id),
        newObj
      ];
      const nextSelected = [id];

      setObjects(nextObjects);
      setSelectedIds(nextSelected);
      pushHistory(nextObjects, nextSelected);
      
      if (workPlane.step === 'ACTIVE') {
          setWorkPlane(prev => ({ ...prev, sourceObjId: id }));
      }

    } catch (e) {
      console.error("Boolean operation failed", e);
      alert("布尔运算失败，请检查对象形状。");
    }
  };

  // 检测两个对象是否相交的函数
  const hasIntersection = (obj1: CADObject, obj2: CADObject): boolean => {
    try {
      const geom1 = createGeometry(obj1);
      const geom2 = createGeometry(obj2);

      // 使用边界框进行快速预检测
      const tempMesh1 = new THREE.Mesh(geom1);
      tempMesh1.position.set(...obj1.position);
      tempMesh1.rotation.set(...obj1.rotation);
      tempMesh1.scale.set(...obj1.scale);
      tempMesh1.updateMatrixWorld();
      
      const tempMesh2 = new THREE.Mesh(geom2);
      tempMesh2.position.set(...obj2.position);
      tempMesh2.rotation.set(...obj2.rotation);
      tempMesh2.scale.set(...obj2.scale);
      tempMesh2.updateMatrixWorld();

      const bbox1 = new THREE.Box3().setFromObject(tempMesh1);
      const bbox2 = new THREE.Box3().setFromObject(tempMesh2);
      
      if (!bbox1.intersectsBox(bbox2)) {
        return false; // 边界框不相交，几何体肯定不相交
      }

      // 边界框相交，进行精确的交集检测
      const brush1 = new Brush(geom1);
      brush1.position.set(...obj1.position);
      brush1.rotation.set(...obj1.rotation);
      brush1.scale.set(...obj1.scale);

      const brush2 = new Brush(geom2);
      brush2.position.set(...obj2.position);
      brush2.rotation.set(...obj2.rotation);
      brush2.scale.set(...obj2.scale);

      const evaluator = new Evaluator();
      evaluator.attributes = ['position', 'normal'];
      evaluator.useGroups = false;

      // 计算交集
      const intersectionResult = evaluator.evaluate(brush1, brush2, ADDITION);
      
      // 检查交集结果是否有有效的几何数据
      const positionAttribute = intersectionResult.geometry.attributes.position;
      return positionAttribute && positionAttribute.count > 0;
    } catch (error) {
      // 如果检测失败，仍然执行布尔运算
      console.warn("交集检测失败，继续执行布尔运算", error);
      return true;
    }
  };

  // --- Work Plane Math & Logic ---

  const initWorkPlaneMode = () => {
    setPendingOp(null);
    setWorkPlane({
      step: 'PICKING_TARGET',
      planeData: null,
      sourceObjId: null,
      flipOrientation: false
    });
    setSelectedIds([]); 
  };

  const cancelWorkPlane = () => {
    setWorkPlane({ step: 'IDLE', planeData: null, sourceObjId: null, flipOrientation: false });
  };

  const alignObjectToPlane = (
    sourceId: string, 
    localPoint: THREE.Vector3, 
    localNormal: THREE.Vector3,
    targetPoint: THREE.Vector3,
    targetNormal: THREE.Vector3,
    flip: boolean
  ): CADObject[] => {
    const obj = objects.find(o => o.id === sourceId);
    if (!obj || obj.locked) return objects;

    // 1. Calculate Target Direction (World Space)
    const planeDir = targetNormal.clone().normalize();
    const targetDir = flip ? planeDir : planeDir.clone().negate();

    // 2. Get Current World Normal
    const currentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation));
    const currentWorldNormal = localNormal.clone().applyQuaternion(currentQuat).normalize();

    // 3. Calculate Rotation Delta
    const rotationDelta = new THREE.Quaternion().setFromUnitVectors(currentWorldNormal, targetDir);

    // 4. Apply Rotation
    const finalQuat = rotationDelta.multiply(currentQuat);

    // 5. Calculate Position
    const scale = new THREE.Vector3(...obj.scale);
    const scaledLocalPoint = localPoint.clone().multiply(scale);
    const rotatedOffset = scaledLocalPoint.clone().applyQuaternion(finalQuat);
    
    const newPos = targetPoint.clone().sub(rotatedOffset);
    const newRot = new THREE.Euler().setFromQuaternion(finalQuat);
    
    const updatedObj = {
      ...obj,
      position: [newPos.x, newPos.y, newPos.z] as [number, number, number],
      rotation: [newRot.x, newRot.y, newRot.z] as [number, number, number]
    };

    const nextObjects = objects.map(o => o.id === sourceId ? updatedObj : o);
    setObjects(nextObjects);
    setSelectedIds([sourceId]); 
    
    return nextObjects;
  };

  const calculateLocalData = (obj: CADObject, point: THREE.Vector3, normal: THREE.Vector3) => {
      const pos = new THREE.Vector3(...obj.position);
      const rot = new THREE.Euler(...obj.rotation);
      const scale = new THREE.Vector3(...obj.scale);
      const quat = new THREE.Quaternion().setFromEuler(rot);
      const invQuat = quat.clone().invert();
      
      const localPoint = point.clone().sub(pos).applyQuaternion(invQuat).divide(scale);
      const localNormal = normal.clone().applyQuaternion(invQuat).normalize();
      
      return {
          point: [localPoint.x, localPoint.y, localPoint.z] as [number, number, number],
          normal: [localNormal.x, localNormal.y, localNormal.z] as [number, number, number]
      };
  };

  const handleSceneClick = (id: string | null, point?: THREE.Vector3, normal?: THREE.Vector3) => {
    // 1. Work Plane: Pick Target
    if (workPlane.step === 'PICKING_TARGET') {
      if (id && point && normal) {
        setWorkPlane(prev => ({
          ...prev,
          step: 'PICKING_SOURCE',
          planeData: {
            position: [point.x, point.y, point.z],
            normal: [normal.x, normal.y, normal.z],
            targetObjId: id
          }
        }));
      }
      return;
    }

    // 2. Work Plane: Pick Source (First Alignment)
    if (workPlane.step === 'PICKING_SOURCE') {
      if (id && point && normal && workPlane.planeData) {
        if (id === workPlane.planeData.targetObjId) {
          alert("请选择另一个不同的物体作为基准物体");
          return;
        }
        
        const obj = objects.find(o => o.id === id);
        if (obj) {
            if (obj.locked) {
                alert("该物体已锁定，无法对齐");
                return;
            }
            const localData = calculateLocalData(obj, point, normal);
            const targetPoint = new THREE.Vector3(...workPlane.planeData.position);
            const targetNormal = new THREE.Vector3(...workPlane.planeData.normal);
            
            const nextObjects = alignObjectToPlane(
                id, 
                new THREE.Vector3(...localData.point), 
                new THREE.Vector3(...localData.normal), 
                targetPoint, 
                targetNormal, 
                false
            );

            setWorkPlane(prev => ({
              ...prev,
              step: 'ACTIVE',
              sourceObjId: id,
              sourceLocalData: localData,
              flipOrientation: false
            }));
            
            pushHistory(nextObjects, [id]);
        }
      }
      return;
    }

    // 3. Work Plane: Active Mode - Click to Align/Select
    if (workPlane.step === 'ACTIVE' && id && point && normal && workPlane.planeData) {
         if (id !== workPlane.planeData.targetObjId) {
             const obj = objects.find(o => o.id === id);
             if (obj) {
                 if (obj.locked) {
                     handleSelect(id, false, point, normal);
                     return;
                 }
                 const localData = calculateLocalData(obj, point, normal);
                 
                 const targetPoint = new THREE.Vector3(...workPlane.planeData.position);
                 const targetNormal = new THREE.Vector3(...workPlane.planeData.normal);
                 
                 // Align new object to original target point
                 const nextObjects = alignObjectToPlane(
                     id, 
                     new THREE.Vector3(...localData.point), 
                     new THREE.Vector3(...localData.normal), 
                     targetPoint, 
                     targetNormal, 
                     false
                 );
                 pushHistory(nextObjects, [id]);

                 setWorkPlane(prev => ({ 
                     ...prev, 
                     sourceObjId: id,
                     sourceLocalData: localData,
                     flipOrientation: false
                 }));

                 handleSelect(id, false, point, normal);
                 return;
             }
         }
    }

    handleSelect(id, false, point, normal); 
  };
  
  const toggleFlip = () => {
    if (workPlane.step === 'ACTIVE' && workPlane.sourceObjId && workPlane.planeData && workPlane.sourceLocalData) {
       const obj = objects.find(o => o.id === workPlane.sourceObjId);
       if (!obj || obj.locked) return;
       
       const newFlipState = !workPlane.flipOrientation;
       setWorkPlane(prev => ({ ...prev, flipOrientation: newFlipState }));

       const localPoint = new THREE.Vector3(...workPlane.sourceLocalData.point);
       const localNormal = new THREE.Vector3(...workPlane.sourceLocalData.normal);
       
       const currentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation));
       const scale = new THREE.Vector3(...obj.scale);
       const scaledLocalPoint = localPoint.clone().multiply(scale);
       
       const currentWorldAnchor = scaledLocalPoint.clone().applyQuaternion(currentQuat).add(new THREE.Vector3(...obj.position));
       
       const targetNormal = new THREE.Vector3(...workPlane.planeData.normal);
       
       const nextObjects = alignObjectToPlane(
           obj.id,
           localPoint,
           localNormal,
           currentWorldAnchor, 
           targetNormal,
           newFlipState
       );
       
       handleUpdateObject(obj.id, { 
          position: nextObjects.find(o => o.id === obj.id)!.position,
          rotation: nextObjects.find(o => o.id === obj.id)!.rotation
       });
       handleCommit();
    }
  };


  // --- Selection ---
  const handleSelect = (id: string | null, multi: boolean = false, point?: THREE.Vector3, normal?: THREE.Vector3) => {
    if (pendingOp) {
      if (id === null) {
        setPendingOp(null); 
        return;
      }
      if (id === pendingOp.baseId) return;
      executeBooleanOp(pendingOp.type, pendingOp.baseId, id);
      setPendingOp(null);
      return;
    }
    
    if (id === null) {
      if (!multi) setSelectedIds([]);
      if (workPlane.step === 'ACTIVE') {
          setWorkPlane(prev => ({ ...prev, sourceObjId: null }));
      }
      return;
    }

    if (multi) {
      setSelectedIds(prev => 
        prev.includes(id) 
          ? prev.filter(pid => pid !== id) 
          : [...prev, id]
      );
    } else {
      setSelectedIds([id]);
      
      if (workPlane.step === 'ACTIVE') {
          const obj = objects.find(o => o.id === id);
          if (obj) {
             let localData;
             if (point && normal) {
                 localData = calculateLocalData(obj, point, normal);
             } else {
                 localData = calculateLocalData(
                     obj, 
                     new THREE.Vector3(...obj.position), 
                     new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation))) 
                 );
                 if (workPlane.sourceObjId === id && workPlane.sourceLocalData) {
                     localData = workPlane.sourceLocalData;
                 }
             }
             setWorkPlane(prev => ({ ...prev, sourceObjId: id, sourceLocalData: localData }));
          }
      }
    }
  };

  // --- CRUD Operations ---
  const handleAddObject = (type: ShapeType) => {
    setPendingOp(null); 
    console.log("Adding object of type:", type);
    
    const id = uuidv4();
    let newObj: CADObject;

    // Default placement
    let position: [number, number, number] = [0, 25, 0];
    let rotation: [number, number, number] = [0, 0, 0];
    let isAligned = false;

    // If Work Plane is active, spawn object ON the plane
    if (workPlane.step === 'ACTIVE' && workPlane.planeData) {
        const pd = workPlane.planeData;
        position = [pd.position[0], pd.position[1], pd.position[2]];
        
        const normal = new THREE.Vector3(pd.normal[0], pd.normal[1], pd.normal[2]);
        const defaultUp = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, normal);
        const euler = new THREE.Euler().setFromQuaternion(quaternion);
        rotation = [euler.x, euler.y, euler.z];
        isAligned = true;
    }

    const baseProps = {
      id,
      type,
      position,
      rotation,
      scale: [1, 1, 1] as [number, number, number],
      color: DEFAULT_COLOR,
      params: {},
      locked: false
    };

    switch (type) {
      case 'cube':
        newObj = { ...baseProps, name: `方块 ${objects.length + 1}`, params: { width: 50, height: 50, depth: 50 } };
        break;
      case 'sphere':
        newObj = { ...baseProps, name: `球体 ${objects.length + 1}`, params: { radius: 25 } };
        break;
      case 'cylinder':
        newObj = { ...baseProps, name: `圆柱 ${objects.length + 1}`, params: { radius: 20, height: 60 } };
        break;
      case 'cone':
        newObj = { ...baseProps, name: `圆锥 ${objects.length + 1}`, params: { radius: 20, height: 60 } };
        break;
      case 'prism':
        newObj = { ...baseProps, name: `三棱柱 ${objects.length + 1}`, params: { radius: 30, height: 60 } };
        break;
      case 'hemisphere':
        newObj = { ...baseProps, name: `半球体 ${objects.length + 1}`, params: { radius: 25 } };
        break;
      case 'half_cylinder':
        newObj = { ...baseProps, name: `半圆柱 ${objects.length + 1}`, params: { radius: 20, height: 60 } };
        if (!isAligned) {
            newObj.rotation = [0, 0, Math.PI / 2];
        }
        break;
      case 'torus':
        newObj = { ...baseProps, name: `空心圆柱 ${objects.length + 1}`, params: { radius: 30, tube: 15, height: 40 }};
        if (!isAligned) {
            newObj.rotation = [0, 0, 0];
        }
        break;
      case 'text':
        newObj = { 
            ...baseProps, 
            name: `文本 ${objects.length + 1}`, 
            params: { text: "3D Text", radius: 20, height: 5 }
        };
        break;
      default:
        return;
    }

    // --- Floor Mode Adjustment on Creation ---
    if (floorMode) {
        // Use a simple heuristic for initial creation to ensure it doesn't spawn under floor
        const estimatedHalfHeight = getObjectHalfHeight(newObj);
        
        if (!isAligned) {
            newObj.position[1] = estimatedHalfHeight;
        } else {
             // For aligned objects, we just ensure the point isn't below ground, 
             // but usually the workplane dictates position. 
             // If workplane is below ground, floor mode should override? 
             // Let's stick to the Scene logic to correct it once rendered/moved.
             if (newObj.position[1] < estimatedHalfHeight) {
                newObj.position[1] = estimatedHalfHeight;
             }
        }
    }

    const nextObjects = [...objects, newObj];
    const nextSelected = [id];
    
    setObjects(nextObjects);
    setSelectedIds(nextSelected);
    pushHistory(nextObjects, nextSelected);

    if (isAligned) {
        setWorkPlane(prev => ({ 
            ...prev, 
            sourceObjId: id, 
            sourceLocalData: { point: [0,0,0], normal: [0,1,0] }
        }));
    }
  };

  const handleDeleteObject = () => {
    setPendingOp(null);
    if (selectedIds.length > 0) {
      // Cannot delete locked objects
      const lockedIds = objects.filter(o => selectedIds.includes(o.id) && o.locked).map(o => o.id);
      if (lockedIds.length > 0) {
          alert("部分选中对象已锁定，无法删除。");
          return;
      }

      const nextObjects = objects.filter((obj) => !selectedIds.includes(obj.id));
      const nextSelected: string[] = [];
      
      setObjects(nextObjects);
      setSelectedIds(nextSelected);
      pushHistory(nextObjects, nextSelected);
      
      if (workPlane.step === 'ACTIVE' && workPlane.sourceObjId && selectedIds.includes(workPlane.sourceObjId)) {
          setWorkPlane(prev => ({ ...prev, sourceObjId: null }));
      }
    }
  };

  const handleToggleLock = () => {
      if (selectedIds.length === 0) return;
      const nextObjects = objects.map(obj => {
          if (selectedIds.includes(obj.id)) {
              return { ...obj, locked: !obj.locked };
          }
          return obj;
      });
      setObjects(nextObjects);
      pushHistory(nextObjects, selectedIds);
  };

  const handleUpdateObject = (id: string, updates: Partial<CADObject>) => {
    setObjects((prev) =>
      prev.map((obj) => {
        if (obj.id !== id) return obj;

        // 1. Lock Check
        if (obj.locked && !updates.hasOwnProperty('locked')) {
            // Allow unlocking via updates if passed explicitly, otherwise block
            return obj; 
        }

        const newObj = { ...obj, ...updates };
        return newObj;
      })
    );
  };

  const ensureAttributes = (geometry: THREE.BufferGeometry) => {
    if (!geometry.attributes.position) return geometry;
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    if (!geometry.attributes.uv) {
      const count = geometry.attributes.position.count;
      const uvs = new Float32Array(count * 2);
      for (let i = 0; i < uvs.length; i++) {
        uvs[i] = 0;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  const createGeometry = (obj: CADObject) => {
    let geom: THREE.BufferGeometry;
    const { params } = obj;

    if (obj.type === 'cube') {
      geom = new THREE.BoxGeometry(params.width, params.height, params.depth);
    } else if (obj.type === 'sphere') {
      geom = new THREE.SphereGeometry(params.radius, 32, 32);
    } else if (obj.type === 'cylinder') {
      geom = new THREE.CylinderGeometry(params.radius, params.radius, params.height, 32);
    } else if (obj.type === 'cone') {
      geom = new THREE.ConeGeometry(params.radius, params.height, 32);
    } else if (obj.type === 'prism') {
      geom = new THREE.CylinderGeometry(params.radius, params.radius, params.height, 3);
    } else if (obj.type === 'hemisphere') {
      const points = [];
      points.push(new THREE.Vector2(0, 0));
      for (let i = 0; i <= 32; i++) {
        const phi = (i / 32) * (Math.PI / 2); // 0 to 90 degrees
        points.push(new THREE.Vector2(params.radius * Math.cos(phi), params.radius * Math.sin(phi)));
      }
      points.push(new THREE.Vector2(0, params.radius));
      points.push(new THREE.Vector2(0, 0));
      geom = new THREE.LatheGeometry(points, 32);
      geom.center();
    } else if (obj.type === 'half_cylinder') {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, params.radius, 0, Math.PI, false);
      shape.lineTo(params.radius, 0); 
      const extrudeSettings = { depth: params.height, bevelEnabled: false, curveSegments: 32 };
      geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geom.center(); 
      geom.rotateX(-Math.PI / 2); 
    } else if (obj.type === 'torus') {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, params.radius, 0, Math.PI * 2, false);

      const holePath = new THREE.Path();
      holePath.absarc(0, 0, params.tube, 0, Math.PI * 2, true);
      shape.holes.push(holePath);

      geom = new THREE.ExtrudeGeometry(shape, {
        depth: params.height,
        bevelEnabled: false,
        curveSegments: 32
      });
      geom.center();
      geom.rotateX(-Math.PI / 2);
    } else if (obj.type === 'custom' && obj.geometryData) {
      const loader = new THREE.BufferGeometryLoader();
      geom = loader.parse(obj.geometryData);
    } else if (obj.type === 'text') {
        geom = new THREE.BoxGeometry(params.radius || 20, params.radius || 20, params.height || 5);
    } else {
      geom = new THREE.BoxGeometry(1, 1, 1);
    }
    return ensureAttributes(geom);
  };

  const handleBooleanOperation = (op: 'UNION' | 'SUBTRACT') => {
    if (selectedIds.length === 2) {
      executeBooleanOp(op, selectedIds[0], selectedIds[1]);
      return;
    }
    if (selectedIds.length === 1) {
      setPendingOp({ type: op, baseId: selectedIds[0] });
    } else {
       alert("请先选择一个主对象");
    }
  };

  const triggerImport = () => {
    setPendingOp(null);
    fileInputRef.current?.click();
  };

  const triggerLoadProject = () => {
      setPendingOp(null);
      projectInputRef.current?.click();
  }

  const processImportedGeometry = (geometry: THREE.BufferGeometry, name: string) => {
        geometry = mergeVertices(geometry);
        geometry.center();
        ensureAttributes(geometry);
        
        const id = uuidv4();
        let pos: [number, number, number] = [0, 25, 0];
        let rot: [number, number, number] = [0, 0, 0];
        
        if (workPlane.step === 'ACTIVE' && workPlane.planeData) {
            const pd = workPlane.planeData;
            pos = [pd.position[0], pd.position[1], pd.position[2]];
            const normal = new THREE.Vector3(pd.normal[0], pd.normal[1], pd.normal[2]);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), normal);
            const e = new THREE.Euler().setFromQuaternion(q);
            rot = [e.x, e.y, e.z];
        }

        const newObj: CADObject = {
          id,
          name: name,
          type: 'custom',
          position: pos,
          rotation: rot,
          scale: [1, 1, 1],
          color: DEFAULT_COLOR,
          params: {},
          geometryData: geometry.toJSON(),
          locked: false
        };
        const nextObjects = [...objects, newObj];
        const nextSelected = [id];
        setObjects(nextObjects);
        setSelectedIds(nextSelected);
        pushHistory(nextObjects, nextSelected);
        
        if (workPlane.step === 'ACTIVE') {
            const localData = {
                point: [0,0,0] as [number, number, number],
                normal: [0,1,0] as [number, number, number]
            };
            setWorkPlane(prev => ({ ...prev, sourceObjId: id, sourceLocalData: localData }));
        }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;
      try {
        const loader = new STLLoader();
        const geometry = loader.parse(buffer);
        processImportedGeometry(geometry, file.name.replace('.stl', ''));
      } catch (err) {
        console.error("Failed to load STL", err);
        alert("导入STL失败");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          const text = event.target?.result as string;
          if (!text) return;
          try {
              const data = JSON.parse(text);
              if (data && Array.isArray(data.objects)) {
                  setObjects(data.objects);
                  setSelectedIds([]);
                  setHistory([{ objects: data.objects, selectedIds: [] }]);
                  setHistoryIndex(0);
                  setPendingOp(null);
                  setWorkPlane({ step: 'IDLE', planeData: null, sourceObjId: null, flipOrientation: false });
                  setFloorMode(false);
                  setHasUnsavedChanges(false); // Clean slate
              } else {
                  throw new Error("Invalid file format");
              }
          } catch (err) {
              console.error("Failed to load project", err);
              alert("读取项目文件失败：文件格式不正确");
          }
      };
      reader.readAsText(file);
      e.target.value = '';
  };

  const handleSaveProject = () => {
      try {
          setIsLoading(true);
          const projectData = {
              version: "1.0",
              timestamp: new Date().toISOString(),
              objects: objects
          };
      const json = JSON.stringify(projectData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `project_${new Date().toISOString().slice(0,10)}.sl3d`;
      link.click();
      setHasUnsavedChanges(false); // Saved
      } catch (err) {
          setError("保存项目时发生错误");
          console.error("Save project error", err);
      } finally {
          setIsLoading(false);
      }
  };

  const handleLibraryImport = async (url: string, name: string) => {
      setPendingOp(null);
      try {
          const response = await fetch(url);
          if (!response.ok) {
              throw new Error(`Failed to fetch ${url}`);
          }
          const buffer = await response.arrayBuffer();
          const loader = new STLLoader();
          const geometry = loader.parse(buffer);
          processImportedGeometry(geometry, name);
      } catch (err) {
          console.error("Library Load Error", err);
          setError(`无法加载模型 ${name}`);
          alert(`无法加载模型 ${name}。\n请确保文件 ${url} 存在于您的 public 文件夹中。`);
      }
  };

  const handleExportSTL = () => {
    const targets = selectedIds.length > 0 
      ? objects.filter(o => selectedIds.includes(o.id))
      : objects;
    if (targets.length === 0) {
      alert("场景为空，无法导出");
      return;
    }
    const exporter = new STLExporter();
    const exportGroup = new THREE.Group();
    
    if (targets.some(o => o.type === 'text')) {
        alert("提示：文本对象可能无法以高精度导出，因为它们是动态生成的。建议先进行其他操作。");
    }

    targets.forEach(obj => {
      const geom = createGeometry(obj);
      const mesh = new THREE.Mesh(geom);
      mesh.position.set(...obj.position);
      mesh.rotation.set(...obj.rotation);
      mesh.scale.set(...obj.scale);
      exportGroup.add(mesh);
    });
    const result = exporter.parse(exportGroup, { binary: true });
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = targets.length === 1 ? `${targets[0].name}.stl` : 'model.stl';
    link.click();
  };

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 添加一个effect来处理错误自动消失
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    if (error) {
      // 设置5秒后自动清除错误
      timeoutId = setTimeout(() => {
        setError(null);
      }, 5000);
    }
    
    // 清理函数，组件卸载或error变化时清除定时器
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [error]);
  
  const selectedObject = selectedIds.length === 1 
    ? objects.find((obj) => obj.id === selectedIds[0]) || null 
    : null;

  // 模拟初始化加载，实际项目中可以移除或替换为真实加载逻辑
  useEffect(() => {
    setIsLoading(false);
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-gray-100 text-gray-800 overflow-hidden font-sans">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".stl" 
        className="hidden" 
      />
      
      <input 
        type="file" 
        ref={projectInputRef} 
        onChange={handleProjectFileChange} 
        accept=".sl3d" 
        className="hidden" 
      />
      
      <ModelLibrary 
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={handleLibraryImport}
      />

      <div className="h-32 bg-white border-b border-gray-200 flex px-6 shadow-sm z-10 py-4">
        <div className="flex-shrink-0 text-2xl font-bold text-blue-600 mr-6 flex items-center gap-4 h-full">
          <i className="fa-solid fa-cube"></i> StringLightCAD
        </div>
        <Toolbar 
          onAdd={handleAddObject} 
          onDelete={handleDeleteObject} 
          onBooleanOp={handleBooleanOperation}
          onImport={triggerImport}
          onExport={handleExportSTL}
          onSaveProject={handleSaveProject}
          onLoadProject={triggerLoadProject}
          selectionCount={selectedIds.length} 
          onUndo={handleUndo}
          canUndo={historyIndex > 0}
          transformMode={transformMode}
          setTransformMode={setTransformMode}
          onInitWorkPlane={initWorkPlaneMode}
          workPlaneActive={workPlane.step !== 'IDLE'}
          onOpenLibrary={() => setShowLibrary(true)}
          floorMode={floorMode}
          onToggleFloorMode={() => setFloorMode(!floorMode)}
          onToggleLock={handleToggleLock}
        />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Object List */}
        <div className={`${leftPanelOpen ? 'w-72 border-r' : 'w-0 border-none'} bg-white border-gray-200 flex flex-col z-10 transition-all duration-300 ease-in-out relative overflow-hidden flex-shrink-0`}>
          <div className="flex-1 overflow-hidden flex flex-col w-72">
            <div className="p-4 bg-gray-50 border-b border-gray-200 font-semibold text-lg text-gray-600 flex items-center justify-center relative">
              <span>对象列表</span>
              <button 
                  onClick={() => setLeftPanelOpen(false)}
                  className="absolute right-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition-colors"
                  title="收起"
              >
                  <i className="fa-solid fa-chevron-left"></i>
              </button>
            </div>
            <ObjectList
              objects={objects}
              selectedIds={selectedIds}
              onSelect={(id, multi) => handleSelect(id, multi)}
            />
          </div>
        </div>

        <div className="flex-1 bg-gray-50 relative min-w-0">
          {/* Expand Buttons for Sidebars */}
          {!leftPanelOpen && (
              <button 
                  onClick={() => setLeftPanelOpen(true)}
                  className="absolute left-0 top-1/2 transform -translate-y-1/2 z-40 bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-600 p-3 rounded-r-xl shadow-md border border-l-0 border-gray-200 transition-colors"
                  title="展开对象列表"
              >
                  <i className="fa-solid fa-chevron-right"></i>
              </button>
          )}

          {!rightPanelOpen && (
              <button 
                  onClick={() => setRightPanelOpen(true)}
                  className="absolute right-0 top-1/2 transform -translate-y-1/2 z-40 bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-600 p-3 rounded-l-xl shadow-md border border-r-0 border-gray-200 transition-colors"
                  title="展开属性面板"
              >
                  <i className="fa-solid fa-chevron-left"></i>
              </button>
          )}

          {floorMode && (
             <div className="absolute top-4 right-4 bg-orange-100 text-orange-800 px-4 py-2 rounded-lg shadow-sm z-40 flex items-center text-sm font-bold border border-orange-200 pointer-events-none">
                 <i className="fa-solid fa-arrow-down-to-line mr-2"></i> 基准面模式已开启
             </div>
          )}

          {pendingOp && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-lg z-50 animate-pulse flex items-center gap-4 text-base">
              <span><i className="fa-solid fa-arrow-pointer"></i> 请选择第二个物体（{pendingOp.type === 'UNION' ? '合并' : '切割'}工具）</span>
              <button 
                onClick={() => setPendingOp(null)} 
                className="hover:text-gray-200 underline text-base ml-4 font-bold"
              >
                取消
              </button>
            </div>
          )}

          {workPlane.step !== 'IDLE' && (
             <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-xl shadow-lg z-50 flex items-center gap-4 text-base">
               <div>
                 <i className="fa-solid fa-ruler-combined mr-3"></i>
                 {workPlane.step === 'PICKING_TARGET' && "步骤1: 点击选择一个平面作为【基准工作平面】"}
                 {workPlane.step === 'PICKING_SOURCE' && "步骤2: 点击另一个物体的平面作为【对齐面】"}
                 {workPlane.step === 'ACTIVE' && "工作平面模式: 点击物体对齐，拖拽移动"}
               </div>
               
               {workPlane.step === 'ACTIVE' && workPlane.sourceObjId && selectedIds.includes(workPlane.sourceObjId) && (
                 <>
                   <button 
                     onClick={toggleFlip}
                     className="px-3 py-1 bg-purple-700 hover:bg-purple-800 rounded text-sm border border-purple-500"
                     title="翻转对齐方向 (Flip)"
                   >
                     <i className="fa-solid fa-arrows-up-down mr-2"></i> 翻转
                   </button>
                   <div className="h-6 w-px bg-purple-400"></div>
                 </>
               )}
               
               <button 
                 onClick={cancelWorkPlane}
                 className="hover:text-gray-200 font-bold text-base"
               >
                 {workPlane.step === 'ACTIVE' ? '退出模式' : '取消'}
               </button>
             </div>
          )}

          {error && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full shadow-lg z-50 flex items-center gap-4 text-base max-w-md w-full mx-4">
              <i className="fa-solid fa-triangle-exclamation mr-3"></i>
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="hover:text-gray-200 underline text-base ml-4 font-bold"
              >
                关闭
              </button>
            </div>
          )}

          <Scene 
            objects={objects}
            selectedIds={selectedIds}
            onObjectClick={handleSceneClick}
            onUpdate={handleUpdateObject}
            onCommit={handleCommit}
            transformMode={transformMode}
            workPlane={workPlane}
            floorMode={floorMode}
          />

          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-50">
              <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm mx-auto text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">正在加载3D场景...</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right Panel: Properties */}
        <div className={`${rightPanelOpen ? 'w-80 border-l' : 'w-0 border-none'} bg-white border-gray-200 flex flex-col z-10 transition-all duration-300 ease-in-out relative overflow-hidden flex-shrink-0`}>
          <div className="flex-1 overflow-hidden flex flex-col w-80">
            <div className="p-4 bg-gray-50 border-b border-gray-200 font-semibold text-lg text-gray-600 flex items-center justify-center relative">
              <button 
                  onClick={() => setRightPanelOpen(false)}
                  className="absolute left-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition-colors"
                  title="收起"
              >
                  <i className="fa-solid fa-chevron-right"></i>
              </button>
              <span>属性面板</span>
            </div>
            <PropertiesPanel 
              object={selectedObject} 
              selectionCount={selectedIds.length}
              onUpdate={(updates) => selectedObject && handleUpdateObject(selectedObject.id, updates)}
              onCommit={handleCommit}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
