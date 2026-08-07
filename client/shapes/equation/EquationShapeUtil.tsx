import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	useValue,
} from 'tldraw'
import { equationShapeProps, IEquationShape } from './EquationShape'
import { latexToMathjsLines } from '../../utils/latexToMathjs'
import { evaluateExpr } from '../../utils/mathCompile'

import { lazy, Suspense, useMemo } from 'react'

// MathLive (~700kB with its fonts) loads on the first equation EDIT - display
// is KaTeX and stays eager, since equations are the most common shape.
const MathLiveEditor = lazy(() => import('./MathLiveEditor'))

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
			const result = evaluateExpr(line, scope)
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
			const r = evaluateExpr(line, { ...scope })
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
					<Suspense fallback={null}>
						<MathLiveEditor shape={shape} editor={this.editor} />
					</Suspense>
				</HTMLContainer>
			)
		}

		return <EquationDisplay shape={shape} editor={this.editor} />
	}

	override getIndicatorPath(shape: IEquationShape): Path2D {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
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

	// boundScope is referentially fresh per store tick, so memo on a stable
	// serialization of it (scopes are tiny).
	const scopeKey = JSON.stringify(boundScope)

	// Equations are the most common shape on a tutoring board, and KaTeX
	// rendering + mathjs evaluation used to run in the render body on every
	// store tick (selection changes included). Memoize on the actual inputs.
	const mainHtml = useMemo(() => {
		// Build the display latex — if we have a result, show "original = value"
		const normalized = latex.replace(
			/^\\displaylines\{([\s\S]*)\}$/,
			(_, body) => `\\begin{aligned}${body}\\end{aligned}`
		)
		try {
			return katex.renderToString(normalized, {
				displayMode: true,
				throwOnError: false,
			})
		} catch {
			return `<div style="color:red">Error rendering LaTeX</div>`
		}
	}, [latex])

	// Substitution annotation: "a=3, b=5 → result"
	const subHtml = useMemo(() => {
		if (!hasScope) return ''
		const result = evaluateWithScope(latex, boundScope)
		const substitutions = Object.entries(boundScope)
			.map(([k, v]) => `${k} = ${+v.toFixed(4)}`)
			.join(',\\;')
		const subLatex =
			result !== null
				? `\\small\\color{gray}{${substitutions} \\Rightarrow ${+result.toFixed(6)}}`
				: `\\small\\color{gray}{${substitutions}}`
		try {
			return katex.renderToString(subLatex, { displayMode: false, throwOnError: false })
		} catch {
			return ''
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- scopeKey stands in for boundScope
	}, [latex, hasScope, scopeKey])

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

