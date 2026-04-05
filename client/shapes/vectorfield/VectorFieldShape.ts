import { RecordProps, TLBaseShape, T } from 'tldraw'

export type IVectorFieldShape = TLBaseShape<
	'vectorfield',
	{
		w: number
		h: number
		expression: string  // "P(x,y), Q(x,y)" — e.g. "y, -x"
		xMin: number
		xMax: number
		yMin: number
		yMax: number
		density: number     // arrows per row (default 18)
	}
>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		vectorfield: IVectorFieldShape['props']
	}
}

export const vectorFieldShapeProps: RecordProps<IVectorFieldShape> = {
	w: T.number,
	h: T.number,
	expression: T.string,
	xMin: T.number,
	xMax: T.number,
	yMin: T.number,
	yMax: T.number,
	density: T.number,
}
