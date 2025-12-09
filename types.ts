

export type ShapeType = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'prism' | 'hemisphere' | 'half_cylinder' | 'torus' | 'custom' | 'text';

export interface CADObject {
  id: string;
  name: string;
  type: ShapeType;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  params: {
    width?: number;   // for cube
    height?: number;  // for cube, cylinder, cone, prism, half_cylinder, text (depth)
    depth?: number;   // for cube
    radius?: number;  // for sphere, cylinder, cone, prism, hemisphere, half_cylinder, torus, text (size)
    tube?: number;    // for torus
    text?: string;    // for text
  };
  geometryData?: any; // To store THREE.BufferGeometry JSON for boolean results
}

export interface WorkPlaneState {
  step: 'IDLE' | 'PICKING_TARGET' | 'PICKING_SOURCE' | 'ACTIVE';
  planeData: {
    position: [number, number, number]; // Point on the plane
    normal: [number, number, number];   // Plane normal vector
    targetObjId: string;
  } | null;
  sourceObjId: string | null; // The object being aligned/moved
  sourceLocalData?: {
    point: [number, number, number];  // Clicked point in object's local space
    normal: [number, number, number]; // Clicked face normal in object's local space
  };
  flipOrientation: boolean;
}

export const DEFAULT_COLOR = "#A78BFA";
export const SELECTED_COLOR = "#FFD700";