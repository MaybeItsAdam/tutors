import { T } from 'tldraw'
import { RecordProps, TLBaseShape } from 'tldraw'

export type IGraphShape = TLBaseShape<
	'graph',
	{
		w: number
		h: number
		functionStr: string
		xMin: number
		xMax: number
		yMin: number
		yMax: number
		color: string
		strokeWidth: number
		sliders?: {
			name: string
			value: number
			min: number
			max: number
			step: number
		}[]
	}
>

// tldraw module augmentation
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		graph: IGraphShape['props']
	}
}

export const graphShapeProps: RecordProps<IGraphShape> = {
	w: T.number,
	h: T.number,
	functionStr: T.string,
	xMin: T.number,
	xMax: T.number,
	yMin: T.number,
	yMax: T.number,
	color: T.string,
	strokeWidth: T.number,
	sliders: T.arrayOf(
		T.object({
			name: T.string,
			value: T.number,
			min: T.number,
			max: T.number,
			step: T.number,
		})
	).optional(),
}
