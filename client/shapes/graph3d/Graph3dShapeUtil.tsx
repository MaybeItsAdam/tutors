import { lazy, Suspense } from 'react'
import { BaseBoxShapeUtil, HTMLContainer } from 'tldraw'
import { graph3dShapeProps, IGraph3dShape } from './Graph3dShape'

// Everything that touches three.js lives in Graph3dRenderer, loaded lazily on
// the first 3D shape's mount - three is ~700kB that most sessions never need.
// The class itself must stay synchronous: tldraw resolves shape utils eagerly.
const Graph3dRenderer = lazy(() => import('./Graph3dRenderer'))

export class Graph3dShapeUtil extends BaseBoxShapeUtil<IGraph3dShape> {
	static override type = 'graph3d' as const
	static override props = graph3dShapeProps

	override canEdit() { return true }

	override getDefaultProps(): IGraph3dShape['props'] {
		return {
			w: 420,
			h: 320,
			expression: 'sin(sqrt(x^2 + y^2))',
			xMin: -6,
			xMax: 6,
			yMin: -6,
			yMax: 6,
			resolution: 48,
		}
	}

	override component(shape: IGraph3dShape) {
		const isEditing = this.editor.getEditingShapeId() === shape.id
		return (
			<HTMLContainer
				id={shape.id}
				style={{ width: '100%', height: '100%', pointerEvents: 'all', userSelect: 'none' }}
			>
				<Suspense
					fallback={
						<div
							style={{
								width: '100%',
								height: '100%',
								borderRadius: 8,
								background: 'rgba(15,17,23,0.87)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								color: '#64748b',
								fontSize: 12,
							}}
						>
							Loading 3D…
						</div>
					}
				>
					<Graph3dRenderer shape={shape} isEditing={isEditing} />
				</Suspense>
			</HTMLContainer>
		)
	}

	override indicator(shape: IGraph3dShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={6} />
	}

	override onResize = (shape: IGraph3dShape, info: any) => {
		const rawW = info?.bounds?.w ?? (info?.initialBounds?.w != null && info?.scaleX != null
			? info.initialBounds.w * info.scaleX : shape.props.w)
		const rawH = info?.bounds?.h ?? (info?.initialBounds?.h != null && info?.scaleY != null
			? info.initialBounds.h * info.scaleY : shape.props.h)
		return {
			props: {
				w: Math.max(160, Math.abs(rawW)),
				h: Math.max(120, Math.abs(rawH)),
			},
		}
	}
}
