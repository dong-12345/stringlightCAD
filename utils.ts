import { CADObject } from './types';

// Helper: Calculate Approximate Vertical Offset for initial placement
// Returns the distance from center to bottom (Y-axis) for clamping
export const getObjectHalfHeight = (obj: CADObject): number => {
    const { type, params, scale } = obj;
    // Note: This is an estimation for initial placement.
    // Real-time constraints are handled by Scene's Box3 logic.
    let baseHeight = 0;

    switch (type) {
        case 'cube':
            baseHeight = (params.height || 0) / 2;
            break;
        case 'sphere':
        case 'hemisphere': // Hemisphere pivot is usually at bottom or center depending on generation, our code centers it.
            baseHeight = params.radius || 0;
            break;
        case 'cylinder':
        case 'cone':
        case 'prism':
        case 'half_cylinder':
        case 'torus': // Our custom torus is extruded cylinder-like
            baseHeight = (params.height || 0) / 2;
            break;
        case 'text':
            baseHeight = (params.radius || 20) / 2; // Rough approximation
            break;
        case 'custom':
            // Custom objects are hard to guess without geometry, default to 0
            // The Scene logic will fix it on first interaction
            baseHeight = 0; 
            break;
    }
    return baseHeight * scale[1];
};