

import React, { useRef, useMemo, useEffect, useState, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Edges, Environment, Text3D, Center } from '@react-three/drei';
import * as THREE from 'three';
import { CADObject, WorkPlaneState } from '../types';

// Augment the global JSX namespace to fix intrinsic element type errors and allow standard HTML tags
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}

interface SceneProps {
  objects: CADObject[];
  selectedIds: string[];
  onObjectClick: (id: string | null, point?: THREE.Vector3, normal?: THREE.Vector3) => void;
  onUpdate: (id: string, updates: Partial<CADObject>) => void;
  onCommit: () => void;
  transformMode: 'translate' | 'rotate' | 'scale';
  workPlane: WorkPlaneState;
}

const MeshComponent: React.FC<{
  obj: CADObject;
  isSelected: boolean;
  onSelect: (id: string | null, point?: THREE.Vector3, normal?: THREE.Vector3) => void;
}> = ({ obj, isSelected, onSelect }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const { params, type } = obj;
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
      // Hollow Cylinder (Extrude with hole)
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
      // Extrude is along Z, rotate to stand upright (along Y)
      geom.rotateX(-Math.PI / 2);
      
      return <primitive object={geom} attach="geometry" />;
    } else if (type === 'custom' && obj.geometryData) {
      const loader = new THREE.BufferGeometryLoader();
      const geom = loader.parse(obj.geometryData);
      return <primitive object={geom} attach="geometry" />;
    }
    return null;
  }, [obj.type, obj.params, obj.geometryData]);

  const handleClick = (e: any) => {
    e.stopPropagation();
    const face = e.face;
    let normal = new THREE.Vector3(0, 1, 0);
    // For Text3D, meshRef might point to the inner mesh if wrapped, or the group.
    // However, event bubbling usually gives us the object.
    if (face && e.object) {
        // Transform normal to world space
        normal = face.normal.clone().applyQuaternion(e.object.quaternion).normalize();
    }
    onSelect(obj.id, e.point, normal);
  };

  // Special handling for Text which renders as a separate component type
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
                  <mesh>
                      <boxGeometry args={[obj.params.radius || 20, obj.params.radius || 20, obj.params.height || 5]} />
                      <meshBasicMaterial color="red" wireframe />
                  </mesh>
              }>
                  <Center top>
                      <Text3D
                        // Use reliable CDN with specific version to ensure font loads
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
                            roughness={0.4} 
                            metalness={0.3}
                        />
                      </Text3D>
                  </Center>
              </Suspense>
               {isSelected && (
                <Edges
                  linewidth={2}
                  scale={1.1} // Slightly larger for text
                  threshold={15}
                  color="#FFD700"
                />
              )}
          </group>
      )
  }

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
        roughness={0.4} 
        metalness={0.3} // Increased slightly for better environment reflections
        polygonOffset={true}
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        side={THREE.DoubleSide} 
      />
      {isSelected && (
        <Edges
          linewidth={2}
          scale={1.05} 
          threshold={15}
          color="#FFD700"
        />
      )}
    </mesh>
  );
};

// Reusable function to disable raycasting
const ignoreRaycast = () => null;

const WorkPlaneHelper: React.FC<{ data: WorkPlaneState['planeData'] }> = ({ data }) => {
    if (!data) return null;
    
    const pos = new THREE.Vector3(...data.position);
    const normal = new THREE.Vector3(data.normal[0], data.normal[1], data.normal[2]);

    const dummy = new THREE.Object3D();
    dummy.position.copy(pos);
    
    // Prevent singularity when looking at a vector parallel to the default up (0, 1, 0)
    // If normal is effectively vertical, change the up vector to Z to allow proper orientation.
    if (Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))) > 0.99) {
        dummy.up.set(0, 0, 1);
    }

    dummy.lookAt(pos.clone().add(normal));
    
    // Explicitly set raycast to null to prevent blocking clicks
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

// Special controls that lock movement to the plane
const PlaneConstrainedControls: React.FC<{
  object: CADObject,
  planeNormal: [number, number, number],
  onUpdate: (id: string, updates: Partial<CADObject>) => void,
  onCommit: () => void
}> = ({ object, planeNormal, onUpdate, onCommit }) => {
  const proxyRef = useRef<THREE.Mesh>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Update proxy position when real object changes (e.g. from properties panel)
  // Only sync if NOT dragging. This prevents the "jump" or fight between 
  // React state updates and the active TransformControls drag.
  useEffect(() => {
    if (proxyRef.current && !isDragging) {
      proxyRef.current.position.set(...object.position);
      proxyRef.current.updateMatrixWorld();
    }
  }, [object.position, isDragging]);

  // Set proxy rotation to align with plane normal
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
        showZ={false} // Lock to plane (X/Y local axes are on the plane)
        size={2.5}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => {
           setIsDragging(false);
           onCommit();
        }}
        onObjectChange={(e: any) => {
           if (e.target.object) {
             const p = e.target.object.position;
             // Sync real object position to proxy position
             onUpdate(object.id, { position: [p.x, p.y, p.z] });
           }
        }}
      />
    </>
  );
};


const SceneContent: React.FC<SceneProps> = ({ objects, selectedIds, onObjectClick, onUpdate, onCommit, transformMode, workPlane }) => {
  const { scene } = useThree();
  const isWorkPlaneActive = workPlane.step === 'ACTIVE' && workPlane.planeData && workPlane.sourceObjId;

  // Identify the active object for work plane
  const activeObj = isWorkPlaneActive ? objects.find(o => o.id === workPlane.sourceObjId) : null;
  const isSelectedObjActive = activeObj && selectedIds.includes(activeObj.id);

  return (
    <>
      {/* High Quality Lighting Setup */}
      <Environment preset="city" />
      <ambientLight intensity={0.4} /> 
      <directionalLight 
        position={[80, 100, 80]} 
        intensity={1.2} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      />
      
      {!workPlane.planeData && <gridHelper args={[500, 50, 0xcccccc, 0xe5e5e5]} position={[0, 0, 0]} />}
      <axesHelper args={[50]} />

      {/* Interactive Ground Plane for picking ground as workplane target */}
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

      <WorkPlaneHelper data={workPlane.planeData} />

      {objects.map((obj) => (
        <React.Fragment key={obj.id}>
          <MeshComponent
            obj={obj}
            isSelected={selectedIds.includes(obj.id)}
            onSelect={onObjectClick}
          />
          
          {/* Normal Controls */}
          {selectedIds.includes(obj.id) && selectedIds.length === 1 && (!isWorkPlaneActive || obj.id !== workPlane.sourceObjId) && (
            <TransformControls
              object={scene.children.find(c => c.userData && c.userData.id === obj.id)}
              position={obj.position}
              rotation={obj.rotation}
              mode={transformMode}
              space="world" // Default to world for ease of use
              size={2.5}
              onObjectChange={(e: any) => {
                if (e?.target?.object) {
                  const o = e.target.object;
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

      {/* Plane Constrained Controls for the active object */}
      {isWorkPlaneActive && isSelectedObjActive && activeObj && workPlane.planeData && (
        <PlaneConstrainedControls 
          object={activeObj} 
          planeNormal={workPlane.planeData.normal}
          onUpdate={onUpdate}
          onCommit={onCommit}
        />
      )}

      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={['#9d4b4b', '#2f7f4f', '#3b5b9d']} labelColor="white" />
      </GizmoHelper>
    </>
  );
};

export const Scene: React.FC<SceneProps> = (props) => {
  return (
    <Canvas
      shadows
      dpr={[1, 2]} // Support High DPI Rendering
      camera={{ position: [150, 150, 150], fov: 50 }}
      className="w-full h-full bg-white"
      onPointerMissed={() => {
          // Trigger deselect only if click hits background (misses all objects)
          props.onObjectClick(null);
      }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
};