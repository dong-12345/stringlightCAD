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
import { CADObject, ShapeType, DEFAULT_COLOR, WorkPlaneState, TabState } from './types';
import { getObjectHalfHeight } from './utils';

// Maximum history steps to keep memory usage in check
const MAX_HISTORY = 50;

// 扩展Window接口以包含Electron自定义方法 - 现在已在 types/electron.d.ts 中统一定义

const App: React.FC = () => {
  // 初始化默认标签页
  const defaultTabId = uuidv4();
  const [tabs, setTabs] = useState<TabState[]>([{
    id: defaultTabId,
    name: '未命名项目',
    objects: [],
    selectedIds: [],
    transformMode: 'translate',
    pendingOp: null,
    workPlane: {
      step: 'IDLE',
      planeData: null,
      sourceObjId: null,
      flipOrientation: false
    },
    floorMode: false,
    hasUnsavedChanges: false,
    history: [{ objects: [], selectedIds: [] }],
    historyIndex: 0
  }]);
  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId);

  // 获取当前活动标签页
  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0];

  // 更新当前活动标签页的状态
  const updateActiveTab = (updates: Partial<TabState>) => {
    setTabs(prevTabs => 
      prevTabs.map(tab => 
        tab.id === activeTabId ? { ...tab, ...updates } : tab
      )
    );
  };

  // 创建新标签页
  const createNewTab = () => {
    const newTabId = uuidv4();
    const newTab: TabState = {
      id: newTabId,
      name: `未命名项目 ${tabs.length + 1}`,
      objects: [],
      selectedIds: [],
      transformMode: 'translate',
      pendingOp: null,
      workPlane: {
        step: 'IDLE',
        planeData: null,
        sourceObjId: null,
        flipOrientation: false
      },
      floorMode: false,
      hasUnsavedChanges: false,
      history: [{ objects: [], selectedIds: [] }],
      historyIndex: 0
    };
    
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  // 关闭标签页
  const closeTab = (tabId: string) => {
    const tabToClose = tabs.find(tab => tab.id === tabId);
    if (tabToClose && tabToClose.hasUnsavedChanges) {
      // 如果标签页有未保存的更改，设置状态以显示确认对话框
      setTabToClose(tabId);
      setShowTabCloseConfirmDialog(true);
    } else {
      // 没有未保存的更改，直接关闭
      performTabClose(tabId);
    }
  };

  // 实际执行关闭标签页的函数
  const performTabClose = (tabId: string) => {
    const newTabs = tabs.filter(tab => tab.id !== tabId);
    
    // 如果没有剩余标签页，创建一个新标签页
    if (newTabs.length === 0) {
      // 直接创建一个新标签页并设置，而不是先清空再创建
      const newTabId = uuidv4();
      const newTab: TabState = {
        id: newTabId,
        name: `未命名项目 1`,
        objects: [],
        selectedIds: [],
        transformMode: 'translate',
        pendingOp: null,
        workPlane: {
          step: 'IDLE',
          planeData: null,
          sourceObjId: null,
          flipOrientation: false
        },
        floorMode: false,
        hasUnsavedChanges: false,
        history: [{ objects: [], selectedIds: [] }],
        historyIndex: 0
      };
      
      setTabs([newTab]); // 直接设置包含新标签页的数组
      setActiveTabId(newTabId); // 并切换到新标签页
    } else {
      setTabs(newTabs);
      
      // 如果关闭的是当前激活的标签页，则切换到第一个可用的标签页
      if (activeTabId === tabId) {
        const nextActiveTab = newTabs.length > 0 ? newTabs[0].id : null;
        if (nextActiveTab) {
          setActiveTabId(nextActiveTab);
        }
      }
    }
  };

  // 保存项目后关闭标签页的回调函数
  const handleSaveAndCloseTab = (tabId: string) => {
    try {
      setIsLoading(true);
      const projectData = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        objects: activeTab.objects
      };
      const json = JSON.stringify(projectData, null, 2);
      
      // 如果在Electron环境中，使用Electron API保存文件
      if (window.electronAPI) {
        // 先显示保存对话框让用户选择保存路径
        window.electronAPI.showSaveDialog()
          .then(result => {
            if (!result.canceled) {
              // 用户选择了保存路径，执行保存
              return window.electronAPI.saveFile(result.filePath, json)
                .then(saveResult => {
                  // 成功保存后，更新标签页名称和状态
                  // 提取文件名（不含扩展名）
                  const fileName = result.filePath.split('\\').pop().split('/').pop().replace(/\.sl3d$/, '');
                  updateActiveTab({ 
                    name: fileName,
                    hasUnsavedChanges: false 
                  });
                  
                  // 保存成功后，关闭标签页
                  performTabClose(tabId);
                  setShowTabCloseConfirmDialog(false);
                  setTabToClose(null);
                });
            } else {
              // 用户取消了保存操作
              console.log("Save operation cancelled by user");
              setShowTabCloseConfirmDialog(false);
              setTabToClose(null);
            }
          })
          .catch((err) => {
            setError("保存项目时发生错误");
            console.error("Save project error", err);
            setShowTabCloseConfirmDialog(false);
            setTabToClose(null);
          });
      } else {
        // 浏览器环境的备用方案
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${activeTab.name}_${new Date().toISOString().slice(0,10)}.sl3d`;
        link.click();
        updateActiveTab({ hasUnsavedChanges: false }); // 保存后更新状态
        
        // 保存后关闭标签页
        performTabClose(tabId);
        setShowTabCloseConfirmDialog(false);
        setTabToClose(null);
      }
      
    } catch (err) {
      setError("保存项目时发生错误");
      console.error("Save project error", err);
      setShowTabCloseConfirmDialog(false);
      setTabToClose(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 重命名标签页
  const renameTab = (tabId: string, newName: string) => {
    if (!newName.trim()) return;
    setTabs(tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName } : tab
    ));
  };

  // 双击重命名功能
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  
  const handleRenameTab = (tabId: string) => {
    setRenamingTabId(tabId);
  };
  
  const finishRename = (newName: string, tabId: string) => {
    renameTab(tabId, newName);
    setRenamingTabId(null);
  };

  // 切换标签页
  const switchTab = (tabId: string) => {
    setActiveTabId(tabId);
  };

  // Model Library Modal State
  const [showLibrary, setShowLibrary] = useState(false);

  // Panel Visibility State
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);


  // --- History Management ---
  
  // Save a new state to history. 
  const pushHistory = (newObjects: CADObject[], newSelectedIds: string[]) => {
    const currentEntry = { objects: newObjects, selectedIds: newSelectedIds };
    const newHistory = activeTab.history.slice(0, activeTab.historyIndex + 1);
    newHistory.push(currentEntry);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    
    updateActiveTab({
      history: newHistory,
      historyIndex: newHistory.length - 1,
      hasUnsavedChanges: true // Mark as dirty
    });
  };

  const handleUndo = () => {
    if (activeTab.historyIndex > 0) {
      updateActiveTab({
        pendingOp: null,
        workPlane: { ...activeTab.workPlane, step: 'IDLE', planeData: null, sourceObjId: null }
      });
      
      const prevIndex = activeTab.historyIndex - 1;
      const prevState = activeTab.history[prevIndex];
      
      updateActiveTab({
        objects: prevState.objects,
        selectedIds: prevState.selectedIds,
        historyIndex: prevIndex
      });
    }
  };

  const handleRedo = () => {
    if (activeTab.historyIndex < activeTab.history.length - 1) {
      updateActiveTab({
        pendingOp: null,
        workPlane: { ...activeTab.workPlane, step: 'IDLE', planeData: null, sourceObjId: null }
      });
      
      const nextIndex = activeTab.historyIndex + 1;
      const nextState = activeTab.history[nextIndex];
      
      updateActiveTab({
        objects: nextState.objects,
        selectedIds: nextState.selectedIds,
        historyIndex: nextIndex
      });
    }
  };

  const handleCommit = () => {
    pushHistory(activeTab.objects, activeTab.selectedIds);
  };

  // --- Core Boolean Logic ---
  const executeBooleanOp = (op: 'UNION' | 'SUBTRACT', baseId: string, toolId: string) => {
    const obj1 = activeTab.objects.find(o => o.id === baseId);
    const obj2 = activeTab.objects.find(o => o.id === toolId);
    
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

      // 计算布尔运算结果的几何中心
      const tempMesh = new THREE.Mesh(resultGeometry);
      const boundingBox = new THREE.Box3().setFromObject(tempMesh);
      const center = new THREE.Vector3();
      boundingBox.getCenter(center);

      // 将几何体的中心移到原点（即相对于其父对象移动到中心的相反位置）
      resultGeometry = resultGeometry.clone();
      resultGeometry.translate(-center.x, -center.y, -center.z);

      const json = resultGeometry.toJSON();
      const id = uuidv4();

      const newObj: CADObject = {
        id,
        name: `${obj1.name} ${op === 'UNION' ? '∪' : '-'} ${obj2.name}`,
        type: 'custom',
        position: [center.x, center.y, center.z], // 使用几何中心作为新对象的位置
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: obj1.color,
        params: {},
        geometryData: json,
        locked: false
      };

      const nextObjects = [
        ...activeTab.objects.filter(o => o.id !== obj1.id && o.id !== obj2.id),
        newObj
      ];
      const nextSelected = [id];

      updateActiveTab({
        objects: nextObjects,
        selectedIds: nextSelected
      });
      pushHistory(nextObjects, nextSelected);
      
      if (activeTab.workPlane.step === 'ACTIVE') {
          updateActiveTab({
            workPlane: { ...activeTab.workPlane, sourceObjId: id }
          });
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
    updateActiveTab({
      pendingOp: null,
      workPlane: {
        step: 'PICKING_TARGET',
        planeData: null,
        sourceObjId: null,
        flipOrientation: false
      },
      selectedIds: []
    });
  };

  const cancelWorkPlane = () => {
    updateActiveTab({
      workPlane: { step: 'IDLE', planeData: null, sourceObjId: null, flipOrientation: false }
    });
  };

  const alignObjectToPlane = (
    sourceId: string, 
    localPoint: THREE.Vector3, 
    localNormal: THREE.Vector3,
    targetPoint: THREE.Vector3,
    targetNormal: THREE.Vector3,
    flip: boolean
  ): CADObject[] => {
    const obj = activeTab.objects.find(o => o.id === sourceId);
    if (!obj || obj.locked) return activeTab.objects;

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

    const nextObjects = activeTab.objects.map(o => o.id === sourceId ? updatedObj : o);
    updateActiveTab({
      objects: nextObjects,
      selectedIds: [sourceId]
    });
    
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
    if (activeTab.workPlane.step === 'PICKING_TARGET') {
      if (id && point && normal) {
        updateActiveTab({
          workPlane: {
            ...activeTab.workPlane,
            step: 'PICKING_SOURCE',
            planeData: {
              position: [point.x, point.y, point.z],
              normal: [normal.x, normal.y, normal.z],
              targetObjId: id
            }
          }
        });
      }
      return;
    }

    // 2. Work Plane: Pick Source (First Alignment)
    if (activeTab.workPlane.step === 'PICKING_SOURCE') {
      if (id && point && normal && activeTab.workPlane.planeData) {
        if (id === activeTab.workPlane.planeData.targetObjId) {
          alert("请选择另一个不同的物体作为基准物体");
          return;
        }
        
        const obj = activeTab.objects.find(o => o.id === id);
        if (obj) {
            if (obj.locked) {
                alert("该物体已锁定，无法对齐");
                return;
            }
            const localData = calculateLocalData(obj, point, normal);
            const targetPoint = new THREE.Vector3(...activeTab.workPlane.planeData.position);
            const targetNormal = new THREE.Vector3(...activeTab.workPlane.planeData.normal);
            
            const nextObjects = alignObjectToPlane(
                id, 
                new THREE.Vector3(...localData.point), 
                new THREE.Vector3(...localData.normal), 
                targetPoint, 
                targetNormal, 
                false
            );

            updateActiveTab({
              workPlane: {
                ...activeTab.workPlane,
                step: 'ACTIVE',
                sourceObjId: id,
                sourceLocalData: localData,
                flipOrientation: false
              }
            });
            
            pushHistory(nextObjects, [id]);
        }
      }
      return;
    }

    // 3. Work Plane: Active Mode - Click to Align/Select
    if (activeTab.workPlane.step === 'ACTIVE' && id && point && normal && activeTab.workPlane.planeData) {
         if (id !== activeTab.workPlane.planeData.targetObjId) {
             const obj = activeTab.objects.find(o => o.id === id);
             if (obj) {
                 if (obj.locked) {
                     handleSelect(id, false, point, normal);
                     return;
                 }
                 const localData = calculateLocalData(obj, point, normal);
                 
                 const targetPoint = new THREE.Vector3(...activeTab.workPlane.planeData.position);
                 const targetNormal = new THREE.Vector3(...activeTab.workPlane.planeData.normal);
                 
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

                 updateActiveTab({
                   workPlane: { 
                     ...activeTab.workPlane, 
                     sourceObjId: id,
                     sourceLocalData: localData,
                     flipOrientation: false
                   }
                 });

                 handleSelect(id, false, point, normal);
                 return;
             }
         }
    }

    handleSelect(id, false, point, normal); 
  };
  
  const toggleFlip = () => {
    if (activeTab.workPlane.step === 'ACTIVE' && activeTab.workPlane.sourceObjId && activeTab.workPlane.planeData && activeTab.workPlane.sourceLocalData) {
       const obj = activeTab.objects.find(o => o.id === activeTab.workPlane.sourceObjId);
       if (!obj || obj.locked) return;
       
       const newFlipState = !activeTab.workPlane.flipOrientation;
       updateActiveTab({
         workPlane: { ...activeTab.workPlane, flipOrientation: newFlipState }
       });

       const localPoint = new THREE.Vector3(...activeTab.workPlane.sourceLocalData.point);
       const localNormal = new THREE.Vector3(...activeTab.workPlane.sourceLocalData.normal);
       
       const currentQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...obj.rotation));
       const scale = new THREE.Vector3(...obj.scale);
       const scaledLocalPoint = localPoint.clone().multiply(scale);
       
       const currentWorldAnchor = scaledLocalPoint.clone().applyQuaternion(currentQuat).add(new THREE.Vector3(...obj.position));
       
       const targetNormal = new THREE.Vector3(...activeTab.workPlane.planeData.normal);
       
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
    if (activeTab.pendingOp) {
      if (id === null) {
        updateActiveTab({ pendingOp: null }); 
        return;
      }
      if (id === activeTab.pendingOp.baseId) return;
      executeBooleanOp(activeTab.pendingOp.type, activeTab.pendingOp.baseId, id);
      updateActiveTab({ pendingOp: null });
      return;
    }
    
    if (id === null) {
      if (!multi) updateActiveTab({ selectedIds: [] });
      if (activeTab.workPlane.step === 'ACTIVE') {
          updateActiveTab({
            workPlane: { ...activeTab.workPlane, sourceObjId: null }
          });
      }
      return;
    }

    if (multi) {
      updateActiveTab({
        selectedIds: activeTab.selectedIds.includes(id) 
            ? activeTab.selectedIds.filter(pid => pid !== id) 
            : [...activeTab.selectedIds, id]
      });
    } else {
      updateActiveTab({
        selectedIds: [id]
      });
      
      if (activeTab.workPlane.step === 'ACTIVE') {
          const obj = activeTab.objects.find(o => o.id === id);
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
                 if (activeTab.workPlane.sourceObjId === id && activeTab.workPlane.sourceLocalData) {
                     localData = activeTab.workPlane.sourceLocalData;
                 }
             }
             updateActiveTab({
               workPlane: { ...activeTab.workPlane, sourceObjId: id, sourceLocalData: localData }
             });
          }
      }
    }
  };

  // --- CRUD Operations ---
  const handleAddObject = (type: ShapeType) => {
    updateActiveTab({ pendingOp: null }); 
    console.log("Adding object of type:", type);
    
    const id = uuidv4();
    let newObj: CADObject;

    // Default placement
    let position: [number, number, number] = [0, 25, 0];
    let rotation: [number, number, number] = [0, 0, 0];
    let isAligned = false;

    // If Work Plane is active, spawn object ON the plane
    if (activeTab.workPlane.step === 'ACTIVE' && activeTab.workPlane.planeData) {
        const pd = activeTab.workPlane.planeData;
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
        newObj = { ...baseProps, name: `方块 ${activeTab.objects.length + 1}`, params: { width: 50, height: 50, depth: 50 } };
        break;
      case 'sphere':
        newObj = { ...baseProps, name: `球体 ${activeTab.objects.length + 1}`, params: { radius: 25 } };
        break;
      case 'cylinder':
        newObj = { ...baseProps, name: `圆柱 ${activeTab.objects.length + 1}`, params: { radius: 20, height: 60 } };
        break;
      case 'cone':
        newObj = { ...baseProps, name: `圆锥 ${activeTab.objects.length + 1}`, params: { radius: 20, height: 60 } };
        break;
      case 'prism':
        newObj = { ...baseProps, name: `三棱柱 ${activeTab.objects.length + 1}`, params: { radius: 30, height: 60 } };
        break;
      case 'hemisphere':
        newObj = { ...baseProps, name: `半球体 ${activeTab.objects.length + 1}`, params: { radius: 25 } };
        break;
      case 'half_cylinder':
        newObj = { ...baseProps, name: `半圆柱 ${activeTab.objects.length + 1}`, params: { radius: 20, height: 60 } };
        if (!isAligned) {
            newObj.rotation = [0, 0, Math.PI / 2];
        }
        break;
      case 'torus':
        newObj = { ...baseProps, name: `空心圆柱 ${activeTab.objects.length + 1}`, params: { radius: 30, tube: 15, height: 40 }};
        if (!isAligned) {
            newObj.rotation = [0, 0, 0];
        }
        break;
      case 'text':
        newObj = { 
            ...baseProps, 
            name: `文本 ${activeTab.objects.length + 1}`, 
            params: { text: "3D Text", radius: 20, height: 5 }
        };
        break;
      default:
        return;
    }

    // --- Floor Mode Adjustment on Creation ---
    if (activeTab.floorMode) {
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

    const nextObjects = [...activeTab.objects, newObj];
    const nextSelected = [id];
    
    updateActiveTab({
      objects: nextObjects,
      selectedIds: nextSelected
    });
    pushHistory(nextObjects, nextSelected);

    if (isAligned) {
        updateActiveTab({
          workPlane: { 
            ...activeTab.workPlane, 
            sourceObjId: id, 
            sourceLocalData: { point: [0,0,0], normal: [0,1,0] }
          }
        });
    }
  };

  const handleDeleteObject = () => {
    updateActiveTab({ pendingOp: null });
    if (activeTab.selectedIds.length > 0) {
      // Cannot delete locked objects
      const lockedIds = activeTab.objects.filter(o => activeTab.selectedIds.includes(o.id) && o.locked).map(o => o.id);
      if (lockedIds.length > 0) {
          alert("部分选中对象已锁定，无法删除。");
          return;
      }

      const nextObjects = activeTab.objects.filter((obj) => !activeTab.selectedIds.includes(obj.id));
      const nextSelected: string[] = [];
      
      updateActiveTab({
        objects: nextObjects,
        selectedIds: nextSelected
      });
      pushHistory(nextObjects, nextSelected);
      
      if (activeTab.workPlane.step === 'ACTIVE' && activeTab.workPlane.sourceObjId && activeTab.selectedIds.includes(activeTab.workPlane.sourceObjId)) {
          updateActiveTab({
            workPlane: { ...activeTab.workPlane, sourceObjId: null }
          });
      }
    }
  };

  const handleToggleLock = () => {
      if (activeTab.selectedIds.length === 0) return;
      const nextObjects = activeTab.objects.map(obj => {
          if (activeTab.selectedIds.includes(obj.id)) {
              return { ...obj, locked: !obj.locked };
          }
          return obj;
      });
      updateActiveTab({
        objects: nextObjects
      });
      pushHistory(nextObjects, activeTab.selectedIds);
  };

  const handleUpdateObject = (id: string, updates: Partial<CADObject>) => {
    updateActiveTab({
      objects: activeTab.objects.map((obj) => {
          if (obj.id !== id) return obj;

          // 1. Lock Check
          if (obj.locked && !updates.hasOwnProperty('locked')) {
              // Allow unlocking via updates if passed explicitly, otherwise block
              return obj; 
          }

          const newObj = { ...obj, ...updates };
          return newObj;
        })
    });
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
    if (activeTab.selectedIds.length === 2) {
      executeBooleanOp(op, activeTab.selectedIds[0], activeTab.selectedIds[1]);
      return;
    }
    if (activeTab.selectedIds.length === 1) {
      updateActiveTab({ pendingOp: { type: op, baseId: activeTab.selectedIds[0] } });
    } else {
       alert("请先选择一个主对象");
    }
  };

  const triggerImport = () => {
    updateActiveTab({ pendingOp: null });
    fileInputRef.current?.click();
  };

  const triggerLoadProject = () => {
      updateActiveTab({ pendingOp: null });
      projectInputRef.current?.click();
  }

  const processImportedGeometry = (geometry: THREE.BufferGeometry, name: string) => {
        geometry = mergeVertices(geometry);
        geometry.center();
        ensureAttributes(geometry);
        
        const id = uuidv4();
        let pos: [number, number, number] = [0, 25, 0];
        let rot: [number, number, number] = [0, 0, 0];
        
        if (activeTab.workPlane.step === 'ACTIVE' && activeTab.workPlane.planeData) {
            const pd = activeTab.workPlane.planeData;
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
        const nextObjects = [...activeTab.objects, newObj];
        const nextSelected = [id];
        updateActiveTab({
          objects: nextObjects,
          selectedIds: nextSelected
        });
        pushHistory(nextObjects, nextSelected);
        
        if (activeTab.workPlane.step === 'ACTIVE') {
            const localData = {
                point: [0,0,0] as [number, number, number],
                normal: [0,1,0] as [number, number, number]
            };
            updateActiveTab({
              workPlane: { ...activeTab.workPlane, sourceObjId: id, sourceLocalData: localData }
            });
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
      reader.onload = async (event) => {
          const text = event.target?.result as string;
          if (!text) return;
          try {
              const data = JSON.parse(text);
              
              // 创建新的标签页来加载项目
              const newTabId = uuidv4();
              const newTab: TabState = {
                id: newTabId,
                name: file.name.replace('.sl3d', ''),
                objects: data.objects || [],
                selectedIds: [],
                transformMode: 'translate',
                pendingOp: null,
                workPlane: {
                  step: 'IDLE',
                  planeData: null,
                  sourceObjId: null,
                  flipOrientation: false
                },
                floorMode: false,
                hasUnsavedChanges: false,
                history: [{ objects: data.objects || [], selectedIds: [] }],
                historyIndex: 0
              };
              
              setTabs([...tabs, newTab]);
              setActiveTabId(newTabId);
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
              objects: activeTab.objects
          };
          const json = JSON.stringify(projectData, null, 2);
          
          // 如果在Electron环境中，使用Electron API保存文件
          if (window.electronAPI) {
            // 先显示保存对话框让用户选择保存路径
            window.electronAPI.showSaveDialog()
              .then(result => {
                if (!result.canceled) {
                  // 用户选择了保存路径，执行保存
                  return window.electronAPI.saveFile(result.filePath, json)
                    .then(saveResult => {
                      // 成功保存后，更新标签页名称和状态
                      // 提取文件名（不含扩展名）
                      const fileName = result.filePath.split('\\').pop().split('/').pop().replace(/\.sl3d$/, '');
                      updateActiveTab({ 
                        name: fileName,
                        hasUnsavedChanges: false 
                      });
                    });
                } else {
                  // 用户取消了保存操作
                  console.log("Save operation cancelled by user");
                }
              })
              .catch((err) => {
                  setError("保存项目时发生错误");
                  console.error("Save project error", err);
              });
          } else {
            // 浏览器环境的备用方案
            const blob = new Blob([json], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${activeTab.name}_${new Date().toISOString().slice(0,10)}.sl3d`;
            link.click();
            updateActiveTab({ hasUnsavedChanges: false }); // 保存后更新状态
          }
          
      } catch (err) {
          setError("保存项目时发生错误");
          console.error("Save project error", err);
      } finally {
          setIsLoading(false);
      }
  };

  const handleLibraryImport = async (url: string, name: string) => {
      updateActiveTab({ pendingOp: null });
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
    const targets = activeTab.selectedIds.length > 0 
      ? activeTab.objects.filter(o => activeTab.selectedIds.includes(o.id))
      : activeTab.objects;
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
  
  // 添加未保存更改状态和确认对话框状态
  const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
  const [showTabCloseConfirmDialog, setShowTabCloseConfirmDialog] = useState(false);
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [isSavingBeforeQuit, setIsSavingBeforeQuit] = useState(false);
  
  // 添加对Electron关闭检查事件的监听
  useEffect(() => {
    if (window.electronAPI) {
      // 监听检查未保存更改的请求
      const unlistenCheckChanges = window.electronAPI.onCheckUnsavedChanges(() => {
        // 检查是否有任何标签页有未保存的更改
        const hasUnsaved = tabs.some(tab => tab.hasUnsavedChanges);
        window.electronAPI?.replyUnsavedChanges(hasUnsaved);
      });
      
      // 监听保存项目前的请求
      const unlistenSaveBeforeQuit = window.electronAPI.onRequestSaveBeforeQuit(() => {
        setIsSavingBeforeQuit(true);
        handleSaveProjectForQuit();
      });
      
      // 监听显示关闭确认对话框的请求
      const unlistenShowCloseConfirm = window.electronAPI.onShowCloseConfirmDialog(() => {
        setShowCloseConfirmDialog(true);
      });
      
      // 组件卸载时清理监听器
      return () => {
        if (unlistenCheckChanges) unlistenCheckChanges();
        if (unlistenSaveBeforeQuit) unlistenSaveBeforeQuit();
        if (unlistenShowCloseConfirm) unlistenShowCloseConfirm();
      };
    }
    
    // 如果不在Electron环境中，也要清理
    return () => {};
  }, [tabs]);
  
  // 处理保存项目并退出
  const handleSaveProjectForQuit = async () => {
    try {
      const projectData = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        objects: activeTab.objects
      };
      const json = JSON.stringify(projectData, null, 2);
      
      // 如果在Electron环境中，使用Electron API显示保存对话框
      if (window.electronAPI) {
        // 显示保存对话框，让用户选择保存路径
        const result = await window.electronAPI.showSaveDialog();
        
        // 如果用户取消了操作，不执行保存
        if (result.canceled) {
          setIsSavingBeforeQuit(false);
          return;
        }
        
        // 保存到用户选择的路径
        await window.electronAPI.saveFile(result.filePath, json);
        
        // 保存成功后，更新当前标签页的未保存状态，并通知主进程项目已保存
        updateActiveTab({ hasUnsavedChanges: false });
        window.electronAPI?.sendProjectSaved();
        setIsSavingBeforeQuit(false);
      } else {
        // 浏览器环境的备用方案
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${activeTab.name}_${new Date().toISOString().slice(0,10)}.sl3d`;
        link.click();
        updateActiveTab({ hasUnsavedChanges: false });
        setIsSavingBeforeQuit(false);
      }
    } catch (err) {
      setError("保存项目时发生错误");
      console.error("Save project error", err);
      setIsSavingBeforeQuit(false);
    }
  };

  
  const selectedObject = activeTab.selectedIds.length === 1 
    ? activeTab.objects.find((obj) => obj.id === activeTab.selectedIds[0]) || null 
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
      
      {/* Close Confirmation Dialog */}
      {isSavingBeforeQuit && (
        <div className="fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-300 rounded-2xl shadow-2xl transform transition-all duration-200 scale-100 w-full max-w-md p-8 relative">
            <div className="text-center">
              <div className="mx-auto bg-gradient-to-br from-blue-100 to-blue-200 w-16 h-16 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <i className="fas fa-spinner animate-spin text-blue-600 text-2xl"></i>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-3">正在保存项目...</h2>
              <p className="text-gray-600 mb-6 leading-relaxed">正在保存您的项目，请稍候...</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Confirm Close Dialog */}
      {showCloseConfirmDialog && !isSavingBeforeQuit && (
        <div className="fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-300 rounded-2xl shadow-2xl transform transition-all duration-200 scale-100 w-full max-w-md p-8 relative">
            <div className="text-center">
              <div className="mx-auto bg-gradient-to-br from-red-100 to-red-200 w-16 h-16 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <i className="fas fa-exclamation-triangle text-red-500 text-2xl"></i>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-3">确认退出</h2>
              <p className="text-gray-600 mb-2 leading-relaxed">您有未保存的更改，确定要退出吗？</p>
              <p className="text-gray-500 text-sm mb-6">如果直接退出，您的更改将会丢失。</p>
              
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    // 当用户点击"取消"时，隐藏对话框
                    setShowCloseConfirmDialog(false);
                    
                    // 通知主进程取消关闭操作，重置isQuitting标志
                    if (window.electronAPI) {
                      window.electronAPI.cancelAppQuit();
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium hover:from-gray-600 hover:to-gray-700 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-opacity-50 shadow-lg w-full"
                >
                  <i className="fas fa-times mr-2"></i>取消
                </button>
                <button
                  onClick={() => {
                    // 直接退出，不保存更改
                    if (window.electronAPI) {
                      window.electronAPI.sendProjectSaved(); // 通知主进程继续退出流程
                    } else {
                      window.close(); // 浏览器环境直接关闭
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-medium hover:from-red-600 hover:to-red-700 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-opacity-50 shadow-lg w-full"
                >
                  <i className="fas fa-sign-out-alt mr-2"></i>直接退出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Close Confirm Dialog */}
      {showTabCloseConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-30 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-300 rounded-2xl shadow-2xl transform transition-all duration-200 scale-100 w-full max-w-md p-8 relative">
            <div className="text-center">
              <div className="mx-auto bg-gradient-to-br from-yellow-100 to-yellow-200 w-16 h-16 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <i className="fas fa-exclamation-triangle text-yellow-500 text-2xl"></i>
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-3">确认关闭标签页</h2>
              <p className="text-gray-600 mb-2 leading-relaxed">此标签页有未保存的更改，确定要关闭吗？</p>
              <p className="text-gray-500 text-sm mb-6">如果关闭，您的更改将会丢失。</p>
              
              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowTabCloseConfirmDialog(false);
                    setTabToClose(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium hover:from-gray-600 hover:to-gray-700 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 focus:ring-opacity-50 shadow-lg w-full"
                >
                  <i className="fas fa-times mr-2"></i>取消
                </button>
                <button
                  onClick={() => {
                    // 保存当前标签页的更改然后关闭标签页
                    if (tabToClose) {
                      handleSaveAndCloseTab(tabToClose);
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-medium hover:from-blue-600 hover:to-blue-700 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-opacity-50 shadow-lg w-full"
                >
                  <i className="fas fa-save mr-2"></i>保存并关闭
                </button>
                <button
                  onClick={() => {
                    // 不保存直接关闭标签页
                    setShowTabCloseConfirmDialog(false);
                    if (tabToClose) {
                      performTabClose(tabToClose);
                    }
                    setTabToClose(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-medium hover:from-red-600 hover:to-red-700 transition-all duration-200 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-opacity-50 shadow-lg w-full"
                >
                  <i className="fas fa-times-circle mr-2"></i>不保存，直接关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          selectionCount={activeTab.selectedIds.length} 
          onUndo={handleUndo}
          canUndo={activeTab.historyIndex > 0}
          onRedo={handleRedo}
          canRedo={activeTab.historyIndex < activeTab.history.length - 1}
          transformMode={activeTab.transformMode}
          setTransformMode={(mode) => updateActiveTab({ transformMode: mode })}
          onInitWorkPlane={initWorkPlaneMode}
          workPlaneActive={activeTab.workPlane.step !== 'IDLE'}
          onOpenLibrary={() => setShowLibrary(true)}
          floorMode={activeTab.floorMode}
          onToggleFloorMode={() => updateActiveTab({ floorMode: !activeTab.floorMode })}
          onToggleLock={handleToggleLock}
        />
      </div>

      {/* 标签页头部 - 移至此处 */}
      <div className="flex bg-gray-200 border-b border-gray-300 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center px-4 py-2 cursor-pointer border-r border-gray-300 rounded-lg mr-1 mb-0.5 relative group ${
              activeTabId === tab.id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 hover:bg-gray-50'
            }`}
            onClick={() => switchTab(tab.id)}
            onDoubleClick={() => handleRenameTab(tab.id)}
          >
            {renamingTabId === tab.id ? (
              <input
                type="text"
                defaultValue={tab.name}
                autoFocus
                className="flex-1 bg-transparent outline-none"
                onBlur={(e) => finishRename(e.target.value, tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    finishRename((e.target as HTMLInputElement).value, tab.id);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate max-w-xs mr-2">{tab.name}</span>
            )}
            {tab.hasUnsavedChanges && renamingTabId !== tab.id && (
              <span className="ml-1 text-orange-500">*</span>
            )}
            {renamingTabId !== tab.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={createNewTab}
          className="px-3 py-2 text-gray-600 hover:bg-gray-50 border-r border-gray-300 rounded-t-lg mb-0.5"
          title="新建标签页"
        >
          <i className="fas fa-plus"></i>
        </button>
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
              objects={activeTab.objects}
              selectedIds={activeTab.selectedIds}
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

          {activeTab.floorMode && (
             <div className="absolute top-4 right-4 bg-orange-100 text-orange-800 px-4 py-2 rounded-lg shadow-sm z-40 flex items-center text-sm font-bold border border-orange-200 pointer-events-none">
                 <i className="fa-solid fa-arrow-down-to-line mr-2"></i> 基准面模式已开启
             </div>
          )}

          {activeTab.pendingOp && (
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-lg z-50 animate-pulse flex items-center gap-4 text-base">
              <span><i className="fa-solid fa-arrow-pointer"></i> 请选择第二个物体（{activeTab.pendingOp.type === 'UNION' ? '合并' : '切割'}工具）</span>
              <button 
                onClick={() => updateActiveTab({ pendingOp: null })} 
                className="hover:text-gray-200 underline text-base ml-4 font-bold"
              >
                取消
              </button>
            </div>
          )}

          {activeTab.workPlane.step !== 'IDLE' && (
             <div className="absolute top-6 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white px-6 py-3 rounded-xl shadow-lg z-50 flex items-center gap-4 text-base">
               <div>
                 <i className="fa-solid fa-ruler-combined mr-3"></i>
                 {activeTab.workPlane.step === 'PICKING_TARGET' && "步骤1: 点击选择一个平面作为【基准工作平面】"}
                 {activeTab.workPlane.step === 'PICKING_SOURCE' && "步骤2: 点击另一个物体的平面作为【对齐面】"}
                 {activeTab.workPlane.step === 'ACTIVE' && "工作平面模式: 点击物体对齐，拖拽移动"}
               </div>
               
               {activeTab.workPlane.step === 'ACTIVE' && activeTab.workPlane.sourceObjId && activeTab.selectedIds.includes(activeTab.workPlane.sourceObjId) && (
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
                 {activeTab.workPlane.step === 'ACTIVE' ? '退出模式' : '取消'}
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
            objects={activeTab.objects}
            selectedIds={activeTab.selectedIds}
            onObjectClick={handleSceneClick}
            onUpdate={handleUpdateObject}
            onCommit={handleCommit}
            transformMode={activeTab.transformMode}
            workPlane={activeTab.workPlane}
            floorMode={activeTab.floorMode}
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
              selectionCount={activeTab.selectedIds.length}
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