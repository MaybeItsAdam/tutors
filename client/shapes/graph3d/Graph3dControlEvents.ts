export const GRAPH3D_CONTROL_EVENT = 'tutors:graph3d-control'
export const GRAPH3D_ORIENTATION_EVENT = 'tutors:graph3d-orientation'

export type Graph3dControlAction =
	| 'reset'
	| 'top'
	| 'front'
	| 'right'
	| 'left'
	| 'zoom-in'
	| 'zoom-out'
	| 'orbit-delta'

export interface Graph3dControlEventDetail {
	shapeId: string
	action: Graph3dControlAction
	dx?: number
	dy?: number
}

export interface Graph3dOrientationEventDetail {
	shapeId: string
	axes: {
		x: { x: number; y: number; z: number }
		y: { x: number; y: number; z: number }
		z: { x: number; y: number; z: number }
	}
}

export function dispatchGraph3dControl(detail: Graph3dControlEventDetail) {
	window.dispatchEvent(new CustomEvent<Graph3dControlEventDetail>(GRAPH3D_CONTROL_EVENT, { detail }))
}

export function dispatchGraph3dOrientation(detail: Graph3dOrientationEventDetail) {
	window.dispatchEvent(new CustomEvent<Graph3dOrientationEventDetail>(GRAPH3D_ORIENTATION_EVENT, { detail }))
}
