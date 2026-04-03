import { RecordProps, TLBaseShape, T } from 'tldraw'

export type IEquationShape = TLBaseShape<
	'equation',
	{
		w: number
		h: number
		latex: string
		fontSize: number
		color: string
	}
>

// tldraw requires module augmentation to add custom shapes to its type registry
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		equation: IEquationShape['props']
	}
}

export const equationShapeProps: RecordProps<IEquationShape> = {
	w: T.number,
	h: T.number,
	latex: T.string,
	fontSize: T.number,
	color: T.string,
}
