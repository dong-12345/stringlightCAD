// TestScene.tsx - 简化版场景组件用于测试
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';

// 简单的立方体组件
const SimpleCube: React.FC = () => {
  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[50, 50, 50]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  );
};

// 测试场景组件
export const TestScene: React.FC = () => {
  return (
    <Canvas
      shadows
      camera={{ position: [150, 150, 150], fov: 50 }}
      className="w-full h-full"
    >
      {/* 灯光 */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[100, 100, 50]}
        intensity={1}
        castShadow
      />
      
      {/* 简单立方体 */}
      <SimpleCube />
      
      {/* 网格 */}
      <Grid 
        position={[0, -25, 0]} 
        args={[100, 100]} 
        cellSize={10} 
        cellThickness={1} 
        cellColor="#6f6f6f" 
        sectionSize={50} 
        sectionThickness={2} 
        sectionColor="#9d4b4b" 
        fadeDistance={200} 
        fadeStrength={1} 
      />
      
      {/* 控制器 */}
      <OrbitControls makeDefault />
    </Canvas>
  );
};