import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
} from 'tldraw'
import { equationShapeProps, IEquationShape } from './EquationShape'

import 'mathlive'
import { useEffect, useRef } from 'react'

export class EquationShapeUtil extends BaseBoxShapeUtil<IEquationShape> {
	static override type = 'equation' as const
	static override props = equationShapeProps

	override canEdit() {
		return true
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
		const isEditing = this.editor.getEditingShapeId() === shape.id

		if (isEditing) {
			return (
				<HTMLContainer
					id={shape.id}
					style={{
						display: 'flex',
						alignItems: 'flex-start',
						justifyContent: 'flex-start',
						pointerEvents: 'all',
						width: '100%',
						// Allow the field to overflow the shape bounds visually while editing
						overflow: 'visible',
					}}
				>
					<MathLiveEditor shape={shape} editor={this.editor} />
				</HTMLContainer>
			)
		}

		const { latex, fontSize } = shape.props

		// KaTeX doesn't support \displaylines — convert to \begin{aligned}
		const normalizedLatex = latex
			.replace(
				/^\\displaylines\{([\s\S]*)\}$/,
				(_, body) => `\\begin{aligned}${body}\\end{aligned}`
			)

		let renderedHtml = ''
		try {
			renderedHtml = katex.renderToString(normalizedLatex, {
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
					color: 'var(--color-text)',
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
						justifyContent: 'center',
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

function MathLiveEditor({ shape, editor }: { shape: IEquationShape; editor: any }) {
	const mfRef = useRef<any>(null)

	useEffect(() => {
		if (!mfRef.current) return

		const mf = mfRef.current

		// Initialise with the shape's current LaTeX
		mf.value = shape.props.latex

		// Auto-focus after mount
		setTimeout(() => mf.focus(), 10)

		// ── Sync LaTeX + auto-resize height on every input ──
		const handleInput = (ev: Event) => {
			const latex = (ev.target as any).value
			// Update both latex and height derived from the rendered field size
			const naturalH = Math.max(60, mf.offsetHeight)
			editor.updateShape({
				id: shape.id,
				type: 'equation',
				props: { latex, h: naturalH },
			})
		}

		// ── Keyboard handling ──
		const handleKeyDown = (ev: KeyboardEvent) => {
			// Shift+Enter or Escape → exit editing
			if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.shiftKey)) {
				ev.preventDefault()
				ev.stopPropagation()
				editor.setEditingShape(null)
				return
			}
			// Plain Enter → insert a display line-break (\\) so the user can
			// write multi-line expressions without needing to know LaTeX environments
			if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
				ev.preventDefault()
				ev.stopPropagation()
				mf.executeCommand('addRowAfter')
			}
		}

		// ── Auto-resize: watch the field's rendered height and update shape ──
		const ro = new ResizeObserver(() => {
			const naturalH = Math.max(60, mf.offsetHeight)
			if (Math.abs(naturalH - shape.props.h) > 4) {
				editor.updateShape({
					id: shape.id,
					type: 'equation',
					props: { h: naturalH },
				})
			}
		})
		ro.observe(mf)

		mf.addEventListener('input', handleInput)
		mf.addEventListener('keydown', handleKeyDown)

		// ── Virtual keyboard: hide when editing stops (component unmounts) ──
		// focusout is unreliable with MathLive's shadow-DOM keyboard.
		// The cleanup below fires when tldraw exits edit mode and unmounts this component.
		return () => {
			mf.removeEventListener('input', handleInput)
			mf.removeEventListener('keydown', handleKeyDown)
			ro.disconnect()
			// Hide the virtual keyboard on unmount
			if (window.mathVirtualKeyboard) {
				window.mathVirtualKeyboard.hide()
			}
		}
	}, [editor, shape.id]) // Not tracking shape.props.latex to avoid cursor-jumping

	return (
		// @ts-expect-error math-field is a custom web component
		<math-field
			ref={mfRef}
			math-virtual-keyboard-policy="manual"
			style={{
				width: `${shape.props.w}px`,
				// Let height size naturally — ResizeObserver syncs back to shape
				minHeight: '60px',
				fontSize: `${shape.props.fontSize}px`,
				backgroundColor: 'var(--tl-color-panel)',
				color: 'var(--color-text)',
				border: '1.5px solid var(--color-primary)',
				borderRadius: '8px',
				outline: 'none',
				padding: '10px 14px',
				boxSizing: 'border-box',
				display: 'block',
			}}
		/>
	)
}
