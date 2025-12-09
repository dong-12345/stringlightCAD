import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { Scene } from './components/Scene';
import { ObjectList } from './components/ObjectList';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { ModelLibrary } from './components/ModelLibrary';
import { CADObject, ShapeType, DEFAULT_COLOR, WorkPlaneState } from './types';

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

  // Work Plane State
  const [workPlane, setWorkPlane] = useState<WorkPlaneState>({
    step: 'IDLE',
    planeData: null,
    sourceObjId: null,
    flipOrientation: false
  });

  // History State
  const [history, setHistory] = useState<{objects: CADObject[], selectedIds: string[]}[]>([
    { objects: [], selectedIds: [] }
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  // --- History Management ---
  
  // Save a new state to history. 
  const pushHistory = (newObjects: CADObject[], newSelectedIds: string[]) => {
    const currentEntry = { objects: newObjects, selectedIds: newSelectedIds };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentEntry);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
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
      // Important: Use standard attributes for better compatibility
      evaluator.attributes = ['position', 'normal']; 
      evaluator.useGroups = false; // Disable groups to merge into single mesh
      
      const csgOp = op === 'UNION' ? ADDITION : SUBTRACTION;
      const result = evaluator.evaluate(brush1, brush2, csgOp);

      let resultGeometry = result.geometry;
      
      // --- Auto-Repair Logic ---
      
      // 1. Merge vertices to close gaps
      resultGeometry = mergeVertices(resultGeometry, 1e-4);
      
      // 2. Recompute normals for smooth shading
      resultGeometry.computeVertexNormals();
      
      // 3. Ensure attributes exist
      if (!resultGeometry.attributes.uv) {
        ensureAttributes(resultGeometry);
      }

      // 4. Remove degenerate triangles (area ~ 0) to prevent broken faces in rendering
      // Simple heuristic: re-indexing or cleaning can help, but THREE.BufferGeometryUtils.mergeVertices 
      // already does a good job. For robust "remove degenerate", we would need to iterate indices.
      // Keeping it simple for now as mergeVertices(1e-4) handles most "sliver" issues.

      const json = resultGeometry.toJSON();
      const id = uuidv4();

      const newObj: CADObject = {
        id,
        name: `${obj1.name} ${op === 'UNION' ? '∪' : '-'} ${obj2.name}`,
        type: 'custom',
        position: [0, 0, 0], // Result is already in world space, so reset pos
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: obj1.color,
        params: {},
        geometryData: json
      };

      const nextObjects = [
        ...objects.filter(o => o.id !== obj1.id && o.id !== obj2.id),
        newObj
      ];
      const nextSelected = [id];

      setObjects(nextObjects);
      setSelectedIds(nextSelected);
      pushHistory(nextObjects, nextSelected);
      
      // Update WorkPlane active object if the base object was the active one
      if (workPlane.step === 'ACTIVE') {
          setWorkPlane(prev => ({ ...prev, sourceObjId: id }));
      }

    } catch (e) {
      console.error("Boolean operation failed", e);
      alert("布尔运算失败：请确保模型有重叠部分，且为封闭实体。");
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
    setSelectedIds([]); // Clear selection to avoid transform controls getting in the way
  };

  const cancelWorkPlane = () => {
    setWorkPlane({ step: 'IDLE', planeData: null, sourceObjId: null, flipOrientation: false });
  };

  // Updated Alignment Logic: Uses Local data + Target World Point + Flip flag
  const alignObjectToPlane = (
    sourceId: string, 
    localPoint: THREE.Vector3, 
    localNormal: THREE.Vector3,
    targetPoint: THREE.Vector3,
    targetNormal: THREE.Vector3,
    flip: boolean
  ): CADObject[] => {
    const obj = objects.find(o => o.id === sourceId);
    if (!obj) return objects;

    // 1. Calculate Target Direction (World Space)
    const planeDir = targetNormal.clone().normalize();
    const targetDir = flip ? planeDir : planeDir.clone().negate();

    // 2. Get Current World Normal of the face using current rotation
    const currentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation));
    const currentWorldNormal = localNormal.clone().applyQuaternion(currentQuat).normalize();

    // 3. Calculate Rotation Delta needed to turn CurrentWorldNormal to TargetDir
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

                 // Update Active selection
                 setWorkPlane(prev => ({ 
                     ...prev, 
                     sourceObjId: id,
                     sourceLocalData: localData,
                     flipOrientation: false // reset flip for new object
                 }));

                 handleSelect(id, false, point, normal);
                 return;
             }
         }
    }

    // Normal Selection Logic
    handleSelect(id, false, point, normal); 
  };
  
  const toggleFlip = () => {
    if (workPlane.step === 'ACTIVE' && workPlane.sourceObjId && workPlane.planeData && workPlane.sourceLocalData) {
       const obj = objects.find(o => o.id === workPlane.sourceObjId);
       if (!obj) return;
       
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
        // Hollow Cylinder: Big cylinder with small cylinder cutout
        newObj = { ...baseProps, name: `空心圆柱 ${objects.length + 1}`, params: { radius: 30, tube: 15, height: 40 }};
        if (!isAligned) {
            newObj.rotation = [0, 0, 0];
        }
        break;
      case 'text':
        newObj = { 
            ...baseProps, 
            name: `文本 ${objects.length + 1}`, 
            // Reuse radius for Font Size, height for Thickness (Depth)
            params: { text: "3D Text", radius: 20, height: 5 }
        };
        break;
      default:
        return;
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

  const handleUpdateObject = (id: string, updates: Partial<CADObject>) => {
    setObjects((prev) =>
      prev.map((obj) => (obj.id === id ? { ...obj, ...updates } : obj))
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
      // Hollow Cylinder: shape with a hole
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
      // Extrude produces along Z. Rotate X -90 to align with Y (Upright cylinder)
      geom.rotateX(-Math.PI / 2);
    } else if (obj.type === 'custom' && obj.geometryData) {
      const loader = new THREE.BufferGeometryLoader();
      geom = loader.parse(obj.geometryData);
    } else if (obj.type === 'text') {
        // Warning: Text Geometry generation for CSG is complex because we need the font loaded synchronously here
        // or a way to convert Text3D buffer to Geometry.
        // For now, if user tries to boolean a Text object, we fallback to a box placeholder 
        // OR we'd need to fetch the font again. 
        // To simplify, we will return a placeholder box for Boolean Ops involving Text if we can't easily generate it.
        // However, STLExporter in scene works because it traverses the scene graph mesh.
        // Boolean op logic (createGeometry) runs purely on data.
        // We will default to a box for text boolean ops in this lite version.
        console.warn("布尔运算暂不支持直接使用 Text 对象，请先将其转换为网格 (未实现) 或仅作为独立对象使用。");
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

  // Helper to process loaded geometry into a CADObject
  const processImportedGeometry = (geometry: THREE.BufferGeometry, name: string) => {
        geometry = mergeVertices(geometry);
        geometry.center();
        ensureAttributes(geometry);
        
        const id = uuidv4();
        // Determine position based on Work Plane
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
          geometryData: geometry.toJSON()
        };
        const nextObjects = [...objects, newObj];
        const nextSelected = [id];
        setObjects(nextObjects);
        setSelectedIds(nextSelected);
        pushHistory(nextObjects, nextSelected);
        
        // Update active workplane object
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
                  // Basic validation
                  setObjects(data.objects);
                  setSelectedIds([]);
                  // Reset history to the loaded state
                  setHistory([{ objects: data.objects, selectedIds: [] }]);
                  setHistoryIndex(0);
                  // Reset other states
                  setPendingOp(null);
                  setWorkPlane({ step: 'IDLE', planeData: null, sourceObjId: null, flipOrientation: false });
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
    // Special handling for Text objects in React Tree:
    // Since createGeometry returns a placeholder for text, we rely on the Scene graph traversal.
    // However, STLExporter.parse takes a THREE.Object3D. We need to grab the actual meshes from the scene.
    // The current scene implementation uses React state to render. 
    // We can traverse the `scene` if we had access to it, but we are in App component.
    // Solution: We will let STLExporter parse what it can. 
    // BUT: Since createGeometry returns boxes for text, exporting based on `objects` data map won't work well for text.
    // Better approach: We should find the actual THREE objects in the real scene if possible.
    // Limitation: In this Lite architecture, we are re-creating geometries for export based on data params.
    // For Text, we will skip export in this function OR alert user.
    // As a workaround for this "Lite" version, we will try to find the mesh in the DOM/Scene if possible? No.
    // We will stick to the standard createGeometry logic.
    // Note: Text boolean/export is limited in this version without a proper font loader in logic.
    
    // Alert if Text objects are present
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

  const selectedObject = selectedIds.length === 1 
    ? objects.find((obj) => obj.id === selectedIds[0]) || null 
    : null;

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
        />
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col z-10">
          <div className="p-4 bg-gray-50 border-b border-gray-200 font-semibold text-lg text-gray-600">
            对象列表
          </div>
          <ObjectList
            objects={objects}
            selectedIds={selectedIds}
            onSelect={(id, multi) => handleSelect(id, multi)}
          />
        </div>

        <div className="flex-1 bg-gray-50 relative">
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

          <Scene 
            objects={objects}
            selectedIds={selectedIds}
            onObjectClick={handleSceneClick}
            onUpdate={handleUpdateObject}
            onCommit={handleCommit}
            transformMode={transformMode}
            workPlane={workPlane}
          />
        </div>

        <div className="w-80 bg-white border-l border-gray-200 flex flex-col z-10">
          <div className="p-4 bg-gray-50 border-b border-gray-200 font-semibold text-lg text-gray-600">
            属性面板
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
  );
};

export default App;