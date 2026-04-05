import { RecordProps, TLBaseShape, T } from 'tldraw'

export type IComplexPlaneShape = TLBaseShape<
	'complexplane',
	{
		w: number
		h: number
		expression: string  // complex expression in z, e.g. "z^2", "1/(z-1)"
		xMin: number
		xMax: number
		yMin: number
		yMax: number
	}
>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		complexplane: IComplexPlaneShape['props']
	}
}

export const complexPlaneShapeProps: RecordProps<IComplexPlaneShape> = {
	w: T.number,
	h: T.number,
	expression: T.string,
	xMin: T.number,
	xMax: T.number,
	yMin: T.number,
	yMax: T.number,
}
