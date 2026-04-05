import { RecordProps, TLBaseShape, T } from 'tldraw'

export type IGraph3dShape = TLBaseShape<
	'graph3d',
	{
		w: number
		h: number
		expression: string
		xMin: number
		xMax: number
		yMin: number
		yMax: number
		resolution: number
	}
>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		graph3d: IGraph3dShape['props']
	}
}

export const graph3dShapeProps: RecordProps<IGraph3dShape> = {
	w: T.number,
	h: T.number,
	expression: T.string,
	xMin: T.number,
	xMax: T.number,
	yMin: T.number,
	yMax: T.number,
	resolution: T.number,
}
