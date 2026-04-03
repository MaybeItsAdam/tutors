import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
} from 'tldraw'
import { equationShapeProps, IEquationShape } from './EquationShape'

export class EquationShapeUtil extends BaseBoxShapeUtil<IEquationShape> {
	static override type = 'equation' as const
	static override props = equationShapeProps

	override canEdit() {
		return false // Use agent to edit for now, or could implement an input overlay
	}

	override getDefaultProps(): IEquationShape['props'] {
		return {
			w: 300,
			h: 100,
			latex: 'E = mc^2',
			fontSize: 24,
			color: 'text',
		}
	}

	override component(shape: IEquationShape) {
		const { latex, fontSize, color } = shape.props

		let renderedHtml = ''
		try {
			renderedHtml = katex.renderToString(latex, {
				displayMode: true,
				throwOnError: false,
			})
		} catch (e) {
			renderedHtml = `<div style="color: red;">Error rendering LaTeX</div>`
		}

		return (
			<HTMLContainer
				id={shape.id}
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontSize: `${fontSize}px`,
					color: 'var(--color-text)', // Use tldraw's theme text color
					pointerEvents: 'all',
					width: '100%',
					height: '100%',
					overflow: 'visible',
				}}
			>
				<div 
					className="katex-container" 
					dangerouslySetInnerHTML={{ __html: renderedHtml }} 
					style={{ 
						width: '100%', 
						height: '100%', 
						display: 'flex', 
						alignItems: 'center', 
						justifyContent: 'center' 
					}}
				/>
			</HTMLContainer>
		)
	}

	override indicator(shape: IEquationShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}

	override onResize = (shape: IEquationShape, info: any) => {
		return {
			props: {
				w: Math.max(10, info.bounds.w),
				h: Math.max(10, info.bounds.h),
			},
		}
	}
}
