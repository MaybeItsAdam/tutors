import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	Rectangle2d,
	useEditor,
	useValue,
} from 'tldraw'
import { equationShapeProps, IEquationShape } from './EquationShape'
import { latexToMathjs, latexToMathjsLines } from '../../utils/latexToMathjs'
import { evaluate } from 'mathjs'

import 'mathlive'
import { useEffect, useRef } from 'react'

// ── Variable extraction from a latex equation ─────────────────────────────────
/**
 * Attempt to evaluate a LaTeX equation as a mathjs expression,
 * collecting any variable assignments into `scope`.
 * Returns the scope (mutated in place).
 */
function extractScope(latex: string, scope: Record<string, number>) {
	const lines = latexToMathjsLines(latex)
	for (const line of lines) {
		try {
			const result = evaluate(line, scope)
			// If the expression is an assignment (a = 3.14), mathjs already
			// wrote it to scope. Also handle bare numbers (the whole equation evaluates).
			if (typeof result === 'number' && isFinite(result)) {
				// Try to extract the variable name from the original latex line
				// pattern: "var = expr" or "expr" (bare)
				const match = line.match(/^\s*([a-zA-Z])\s*=/)
				if (match) {
					scope[match[1]] = result
				}
			}
		} catch {
			// ignore parse / eval errors
		}
	}
	return scope
}

/**
 * Given a scope and a latex equation, try to evaluate it numerically.
 * Returns the numeric result or null.
 */
function evaluateWithScope(latex: string, scope: Record<string, number>): number | null {
	const lines = latexToMathjsLines(latex)
	let last: number | null = null
	for (const line of lines) {
		try {
			const r = evaluate(line, { ...scope })
			if (typeof r === 'number' && isFinite(r)) last = r
		} catch {
			// ignore
		}
	}
	return last
}

// ── Shape util ────────────────────────────────────────────────────────────────
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
						overflow: 'visible',
					}}
				>
					<MathLiveEditor shape={shape} editor={this.editor} />
				</HTMLContainer>
			)
		}

		return <EquationDisplay shape={shape} editor={this.editor} />
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

// ── Display component (handles variable binding) ──────────────────────────────
function EquationDisplay({ shape, editor }: { shape: IEquationShape; editor: any }) {
	// Subscribe to all incoming arrow bindings so we react to changes in
	// connected source equations.
	const boundScope = useValue('eq-bound-scope', () => {
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		const scope: Record<string, number> = {}

		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			// Find the start binding on the same arrow
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const srcShape = editor.getShape(startB.toId)
				if (!srcShape || srcShape.type !== 'equation') continue
				const src = srcShape as IEquationShape
				extractScope(src.props.latex?.trim() ?? '', scope)
			}
		}
		return scope
	}, [editor, shape.id])

	const { latex, fontSize } = shape.props
	const hasScope = Object.keys(boundScope).length > 0

	// Evaluate this equation with the bound scope (if any)
	const result = hasScope ? evaluateWithScope(latex, boundScope) : null

	// Build the display latex — if we have a result, show "original = value"
	const normalizeForDisplay = (raw: string) =>
		raw.replace(
			/^\\displaylines\{([\s\S]*)\}$/,
			(_, body) => `\\begin{aligned}${body}\\end{aligned}`
		)

	let mainHtml = ''
	try {
		mainHtml = katex.renderToString(normalizeForDisplay(latex), {
			displayMode: true,
			throwOnError: false,
		})
	} catch {
		mainHtml = `<div style="color:red">Error rendering LaTeX</div>`
	}

	// Substitution annotation: "a=3, b=5 → result"
	let subHtml = ''
	if (hasScope) {
		const substitutions = Object.entries(boundScope)
			.map(([k, v]) => `${k} = ${+v.toFixed(4)}`)
			.join(',\\;')
		const subLatex =
			result !== null
				? `\\small\\color{gray}{${substitutions} \\Rightarrow ${+result.toFixed(6)}}`
				: `\\small\\color{gray}{${substitutions}}`
		try {
			subHtml = katex.renderToString(subLatex, { displayMode: false, throwOnError: false })
		} catch {
			subHtml = ''
		}
	}

	return (
		<HTMLContainer
			id={shape.id}
			style={{
				display: 'flex',
				flexDirection: 'column',
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
				dangerouslySetInnerHTML={{ __html: mainHtml }}
				style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
			/>
			{subHtml && (
				<div
					dangerouslySetInnerHTML={{ __html: subHtml }}
					style={{
						marginTop: 4,
						fontSize: '0.6em',
						opacity: 0.75,
						textAlign: 'center',
					}}
				/>
			)}
		</HTMLContainer>
	)
}

// ── MathLive editor ────────────────────────────────────────────────────────────
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
			const naturalH = Math.max(60, mf.offsetHeight)
			editor.updateShape({
				id: shape.id,
				type: 'equation',
				props: { latex, h: naturalH },
			})
		}

		// ── Keyboard handling ──
		const handleKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.shiftKey)) {
				ev.preventDefault()
				ev.stopPropagation()
				editor.setEditingShape(null)
				return
			}
			if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
				ev.preventDefault()
				ev.stopPropagation()
				mf.executeCommand('addRowAfter')
			}
		}

		// ── Auto-resize: watch the field's rendered height ──
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

		return () => {
			mf.removeEventListener('input', handleInput)
			mf.removeEventListener('keydown', handleKeyDown)
			ro.disconnect()
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
