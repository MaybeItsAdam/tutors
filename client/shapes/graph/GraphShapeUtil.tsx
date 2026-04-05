import { evaluate } from 'mathjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, useEditor, useValue } from 'tldraw'
import { IEquationShape } from '../equation/EquationShape'
import { graphShapeProps, IGraphShape } from './GraphShape'
import { latexToMathjsLines } from '../../utils/latexToMathjs'
import {
	matrixFromLatex,
	apply2,
	eigen2,
	eigenvec2,
	det2,
	trace2,
} from '../../utils/matrixFromLatex'

const SAMPLES = 400
const INTERSECTION_EPSILON = 1e-3
const INTERSECTION_THRESHOLD_DIVISOR = 2
const INTERSECTION_DUPLICATE_X_FACTOR = 2.5
const INTERSECTION_DUPLICATE_Y_FACTOR = 4
const INTERSECTION_OUTER_COLOR = '#f8fafc'
const INTERSECTION_CENTER_COLOR = '#0f1117'

// Colour palette for multi-function graphs
const CURVE_COLORS = ['#60a5fa', '#34d399', '#f97316', '#f472b6', '#a78bfa', '#facc15']

type GraphSlider = NonNullable<IGraphShape['props']['sliders']>[number]

function isConstantName(name: string) {
	// Constants are single-letter symbols except x/X (reserved as the graph's independent variable).
	return /^[a-wyzA-WYZ]$/.test(name)
}

function collectConstantsFromExpression(expr: string): string[] {
	const tokens = expr.match(/[A-Za-z]+/g) ?? []
	const constants = new Set<string>()
	for (const token of tokens) {
		if (token.length !== 1) continue
		if (!isConstantName(token)) continue
		constants.add(token)
	}
	return Array.from(constants).sort()
}

function mergeSliders(expressions: string[], existing: GraphSlider[]): GraphSlider[] {
	const names = new Set<string>()
	for (const expr of expressions) {
		for (const name of collectConstantsFromExpression(expr)) {
			names.add(name)
		}
	}

	return Array.from(names)
		.sort()
		.map((name) => {
			const prior = existing.find((slider) => slider.name === name)
			return (
				prior ?? {
					name,
					value: 1,
					min: -10,
					max: 10,
					step: 0.1,
				}
			)
		})
}

function expressionScope(sliders: GraphSlider[]) {
	const scope: Record<string, number> = {}
	for (const slider of sliders) {
		scope[slider.name] = slider.value
	}
	return scope
}

function createExpressionEvaluator(sliders: GraphSlider[]) {
	const scope = expressionScope(sliders)
	return (expr: string, x: number) => {
		scope.x = x
		return evaluate(expr, scope)
	}
}

function findIntersections(
	functionsToPlot: { expr: string; color: string; label: string }[],
	sliders: GraphSlider[],
	xMin: number,
	xMax: number
) {
	const intersections: { x: number; y: number; colorA: string; colorB: string; score: number }[] = []
	const steps = SAMPLES
	const dx = (xMax - xMin) / steps
	// Keep root and de-dup tolerances proportional to sample spacing to reduce flicker
	// while still catching near-tangent intersections.
	const threshold = Math.max(INTERSECTION_EPSILON, dx / INTERSECTION_THRESHOLD_DIVISOR)
	const evaluateExpression = createExpressionEvaluator(sliders)

	const rootBetween = (diffA: number, diffB: number, xa: number, xb: number) => {
		if (Math.abs(diffA) < 1e-8) return xa
		if (Math.abs(diffB) < 1e-8) return xb
		const denom = diffB - diffA
		if (Math.abs(denom) < 1e-12) return (xa + xb) / 2
		return xa - (diffA * (xb - xa)) / denom
	}

	const diffAt = (exprA: string, exprB: string, x: number) =>
		evaluateExpression(exprA, x) - evaluateExpression(exprB, x)

	const refineRoot = (exprA: string, exprB: string, xa: number, xb: number, guess: number, dA: number, dB: number) => {
		let x = Math.min(xb, Math.max(xa, guess))
		let bestX = x
		let bestScore = Number.POSITIVE_INFINITY
		const h = Math.max(1e-6, dx * 0.1)

		for (let iter = 0; iter < 8; iter++) {
			let d: number
			try {
				d = diffAt(exprA, exprB, x)
			} catch {
				break
			}
			const absD = Math.abs(d)
			if (absD < bestScore) {
				bestScore = absD
				bestX = x
			}
			if (absD < 1e-10) return { x, score: absD }
			let dLeft: number
			let dRight: number
			try {
				dLeft = diffAt(exprA, exprB, x - h)
				dRight = diffAt(exprA, exprB, x + h)
			} catch {
				break
			}
			const derivative = (dRight - dLeft) / (2 * h)
			if (!isFinite(derivative) || Math.abs(derivative) < 1e-12) break
			const nextX = x - d / derivative
			x = Math.min(xb, Math.max(xa, nextX))
		}

		if (dA * dB <= 0) {
			let lo = xa
			let hi = xb
			let dLo = dA
			let dHi = dB
			for (let iter = 0; iter < 14; iter++) {
				const mid = lo + (hi - lo) * 0.5
				let dMid: number
				try {
					dMid = diffAt(exprA, exprB, mid)
				} catch {
					break
				}
				const absMid = Math.abs(dMid)
				if (absMid < bestScore) {
					bestScore = absMid
					bestX = mid
				}
				if (absMid < 1e-10) return { x: mid, score: absMid }
				if (dLo * dMid <= 0) {
					hi = mid
					dHi = dMid
				} else {
					lo = mid
					dLo = dMid
				}
			}
		}

		return { x: bestX, score: bestScore }
	}

	for (let i = 0; i < functionsToPlot.length; i++) {
		for (let j = i + 1; j < functionsToPlot.length; j++) {
			const a = functionsToPlot[i]
			const b = functionsToPlot[j]

			for (let k = 0; k < steps; k++) {
				const x0 = xMin + k * dx
				const x1 = x0 + dx
				let d0: number
				let d1: number
				try {
					d0 = evaluateExpression(a.expr, x0) - evaluateExpression(b.expr, x0)
					d1 = evaluateExpression(a.expr, x1) - evaluateExpression(b.expr, x1)
					if (!isFinite(d0) || !isFinite(d1)) continue
				} catch {
					continue
				}

				if (Math.abs(d0) > threshold && Math.abs(d1) > threshold && d0 * d1 > 0) continue

				const xInitial = rootBetween(d0, d1, x0, x1)
				const { x: xRoot, score } = refineRoot(a.expr, b.expr, x0, x1, xInitial, d0, d1)
				let yRoot: number
				try {
					yRoot = evaluateExpression(a.expr, xRoot)
					if (!isFinite(yRoot)) continue
				} catch {
					continue
				}

				const duplicateIndex = intersections.findIndex(
					(point) =>
						Math.abs(point.x - xRoot) < dx * INTERSECTION_DUPLICATE_X_FACTOR &&
						Math.abs(point.y - yRoot) < threshold * INTERSECTION_DUPLICATE_Y_FACTOR
				)
				if (duplicateIndex >= 0) {
					if (score < intersections[duplicateIndex].score) {
						intersections[duplicateIndex] = { x: xRoot, y: yRoot, colorA: a.color, colorB: b.color, score }
					}
					continue
				}

				intersections.push({ x: xRoot, y: yRoot, colorA: a.color, colorB: b.color, score })
			}
		}
	}

	// Final consolidation pass for repeated roots / tangent touches that can still emit
	// multiple nearby candidates across adjacent sample windows.
	const merged: { x: number; y: number; colorA: string; colorB: string; score: number }[] = []
	for (const point of intersections.sort((p1, p2) => p1.x - p2.x)) {
		const existing = merged.find(
			(candidate) =>
				Math.abs(candidate.x - point.x) < dx * INTERSECTION_DUPLICATE_X_FACTOR &&
				Math.abs(candidate.y - point.y) < threshold * INTERSECTION_DUPLICATE_Y_FACTOR
		)
		if (!existing) {
			merged.push(point)
			continue
		}
		if (point.score < existing.score) {
			existing.x = point.x
			existing.y = point.y
			existing.colorA = point.colorA
			existing.colorB = point.colorB
			existing.score = point.score
		}
	}

	return merged.map(({ x, y, colorA, colorB }) => ({ x, y, colorA, colorB }))
}

function areSlidersEqual(a: GraphSlider[], b: GraphSlider[]) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		const left = a[i]
		const right = b[i]
		if (
			left.name !== right.name ||
			left.value !== right.value ||
			left.min !== right.min ||
			left.max !== right.max ||
			left.step !== right.step
		) {
			return false
		}
	}
	return true
}

// @ts-expect-error — tldraw's TLShape union is closed; custom shapes work fine at runtime
export class GraphShapeUtil extends ShapeUtil<IGraphShape> {
	static override type = 'graph' as const
	static override props = graphShapeProps

	override canEdit() {
		return true
	}

	override isAspectRatioLocked(_shape: IGraphShape) {
		return false
	}

	override canResize(_shape: IGraphShape) {
		return true
	}

	override getGeometry(shape: IGraphShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override getDefaultProps(): IGraphShape['props'] {
		return {
			w: 480,
			h: 360,
			functionStr: 'sin(x)',
			xMin: -2 * Math.PI,
			xMax: 2 * Math.PI,
			yMin: -2,
			yMax: 2,
			color: '#60a5fa',
			strokeWidth: 2,
			sliders: [],
		}
	}

	override component(shape: IGraphShape) {
		const isEditing = this.editor.getEditingShapeId() === shape.id
		return (
			<HTMLContainer
				id={shape.id}
				style={{ width: '100%', height: '100%', pointerEvents: 'all', userSelect: 'none' }}
			>
				<GraphRenderer shape={shape} isEditing={isEditing} editor={this.editor} />
			</HTMLContainer>
		)
	}

	override indicator(shape: IGraphShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}

	override onResize = (shape: IGraphShape, info: any) => {
		const rawW =
			info?.bounds?.w ??
			(info?.initialBounds?.w !== undefined && info?.scaleX !== undefined
				? info.initialBounds.w * info.scaleX
				: shape.props.w)
		const rawH =
			info?.bounds?.h ??
			(info?.initialBounds?.h !== undefined && info?.scaleY !== undefined
				? info.initialBounds.h * info.scaleY
				: shape.props.h)

		return {
			props: {
				w: Math.max(100, Math.abs(rawW)),
				h: Math.max(80, Math.abs(rawH)),
			},
		}
	}
}

function buildPath(
	functionStr: string,
	evaluateExpression: (expr: string, x: number) => number,
	xMin: number,
	xMax: number,
	yMin: number,
	yMax: number,
	width: number,
	height: number
): string {
	const toSvgX = (x: number) => ((x - xMin) / (xMax - xMin)) * width
	const toSvgY = (y: number) => height - ((y - yMin) / (yMax - yMin)) * height

	const step = (xMax - xMin) / SAMPLES
	const points: string[] = []
	let penUp = true

	for (let i = 0; i <= SAMPLES; i++) {
		const x = xMin + i * step
		let y: number
		try {
			y = evaluateExpression(functionStr, x)
			if (!isFinite(y)) {
				penUp = true
				continue
			}
		} catch {
			penUp = true
			continue
		}

		const svgX = toSvgX(x)
		const svgY = toSvgY(y)

		if (penUp) {
			points.push(`M ${svgX.toFixed(2)} ${svgY.toFixed(2)}`)
			penUp = false
		} else {
			points.push(`L ${svgX.toFixed(2)} ${svgY.toFixed(2)}`)
		}
	}

	return points.join(' ')
}

// ── Matrix / linear-transformation visualisation ──────────────────────────────

function shortenVec(
	ox: number, oy: number,
	tx: number, ty: number,
	headPx: number,
): [number, number] {
	const dx = tx - ox, dy = ty - oy
	const len = Math.hypot(dx, dy)
	return len <= headPx ? [tx, ty] : [tx - (dx / len) * headPx, ty - (dy / len) * headPx]
}

function MatrixTransformViz({
	matrix,
	xMin, xMax, yMin, yMax, w, h,
	uid,
}: {
	matrix: number[][]
	xMin: number; xMax: number
	yMin: number; yMax: number
	w: number; h: number
	uid: string
}) {
	const [[a, b], [c, d]] = matrix

	const toX = (x: number) => ((x - xMin) / (xMax - xMin)) * w
	const toY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h
	// Transform a world-space point through M then to SVG coords
	const tx = (wx: number, wy: number): [number, number] =>
		[toX(a * wx + b * wy), toY(c * wx + d * wy)]

	// Origin in SVG
	const ox = toX(0), oy = toY(0)

	// Transformed basis tips in SVG
	const [e1sx, e1sy] = [toX(a), toY(c)]   // Me₁ = col 1 = (a, c)
	const [e2sx, e2sy] = [toX(b), toY(d)]   // Me₂ = col 2 = (b, d)

	// Original unit-basis tips in SVG (for reference arrows)
	const [oe1sx, oe1sy] = [toX(1), toY(0)]
	const [oe2sx, oe2sy] = [toX(0), toY(1)]

	// Grid lines: integer x/y values in the original space, covering the viewport
	const ext = Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax)) * 2 + 5
	const gMin = Math.max(-12, Math.ceil(Math.min(xMin, yMin) - 1))
	const gMax = Math.min(12, Math.floor(Math.max(xMax, yMax) + 1))
	const gridInts: number[] = Array.from(
		{ length: Math.max(0, gMax - gMin + 1) },
		(_, i) => gMin + i,
	)

	// Eigenvectors
	const eigen = eigen2(matrix)
	const viewDiag = Math.hypot(xMax - xMin, yMax - yMin)
	const eigLen = viewDiag * 0.28

	const eigenPairs: Array<{ v: [number, number]; λ: number; col: string; mid: string }> = []
	if (eigen.real) {
		const { λ1, λ2 } = eigen
		const ev1 = eigenvec2(matrix, λ1)
		eigenPairs.push({ v: [ev1[0] * eigLen, ev1[1] * eigLen], λ: λ1, col: '#fbbf24', mid: 'ev1' })
		if (Math.abs(λ1 - λ2) > 1e-6) {
			const ev2 = eigenvec2(matrix, λ2)
			eigenPairs.push({ v: [ev2[0] * eigLen, ev2[1] * eigLen], λ: λ2, col: '#fb923c', mid: 'ev2' })
		}
	}

	const mkId = (s: string) => `mtv-${uid}-${s}`

	// SVG arrow vector (from origin to tip, shortened for arrowhead clearance)
	const Arrow = ({
		tipX, tipY,
		markerId,
		stroke,
		strokeWidth = 2.5,
		dashed = false,
	}: {
		tipX: number; tipY: number
		markerId: string
		stroke: string
		strokeWidth?: number
		dashed?: boolean
	}) => {
		const tooShort = Math.hypot(tipX - ox, tipY - oy) < 8
		if (tooShort) return null
		const [sx, sy] = shortenVec(ox, oy, tipX, tipY, 10)
		return (
			<line
				x1={ox} y1={oy} x2={sx} y2={sy}
				stroke={stroke}
				strokeWidth={strokeWidth}
				strokeDasharray={dashed ? '6,3' : undefined}
				markerEnd={`url(#${markerId})`}
			/>
		)
	}

	return (
		<g>
			<defs>
				{[
					{ id: mkId('e1'),   color: '#60a5fa' },
					{ id: mkId('e2'),   color: '#34d399' },
					{ id: mkId('orig'), color: '#334155' },
					{ id: mkId('ev1'),  color: '#fbbf24' },
					{ id: mkId('ev2'),  color: '#fb923c' },
				].map(m => (
					<marker key={m.id} id={m.id} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
						<polygon points="0 0,10 3.5,0 7" fill={m.color} />
					</marker>
				))}
			</defs>

			{/* ── Transformed coordinate grid ─────────────────────────── */}
			{/* Vertical lines: constant original-x values */}
			{gridInts.map(i => {
				const [x0, y0] = tx(i, -ext)
				const [x1, y1] = tx(i,  ext)
				return (
					<line key={`vg${i}`} x1={x0} y1={y0} x2={x1} y2={y1}
						stroke={i === 0 ? 'rgba(96,165,250,0.55)' : 'rgba(96,165,250,0.13)'}
						strokeWidth={i === 0 ? 1.2 : 0.7}
					/>
				)
			})}
			{/* Horizontal lines: constant original-y values */}
			{gridInts.map(j => {
				const [x0, y0] = tx(-ext, j)
				const [x1, y1] = tx( ext, j)
				return (
					<line key={`hg${j}`} x1={x0} y1={y0} x2={x1} y2={y1}
						stroke={j === 0 ? 'rgba(52,211,153,0.55)' : 'rgba(52,211,153,0.13)'}
						strokeWidth={j === 0 ? 1.2 : 0.7}
					/>
				)
			})}

			{/* ── Unit parallelogram (image of [0,1]² under M) ──────── */}
			<polygon
				points={[
					[ox, oy],
					[e1sx, e1sy],
					[toX(a + b), toY(c + d)],
					[e2sx, e2sy],
				].map(([px, py]) => `${px},${py}`).join(' ')}
				fill="rgba(99,102,241,0.10)"
				stroke="rgba(99,102,241,0.45)"
				strokeWidth="1"
				strokeDasharray="4,3"
			/>

			{/* ── Eigenvectors ────────────────────────────────────────── */}
			{eigenPairs.map(({ v, λ, col, mid }) => {
				const [evsx, evsy] = [toX(v[0]), toY(v[1])]
				const [nevsx, nevsy] = [toX(-v[0]), toY(-v[1])]
				// Label past the tip
				const lx = evsx + (evsx - ox) * 0.18
				const ly = evsy + (evsy - oy) * 0.18
				return (
					<g key={mid}>
						<Arrow tipX={evsx}  tipY={evsy}  markerId={mkId(mid)} stroke={col} strokeWidth={2} dashed />
						<Arrow tipX={nevsx} tipY={nevsy} markerId={mkId(mid)} stroke={col} strokeWidth={2} dashed />
						<text x={lx} y={ly} fill={col} fontSize="11" fontFamily="monospace" textAnchor="middle"
							style={{ userSelect: 'none' }}>
							λ={+λ.toFixed(2)}
						</text>
					</g>
				)
			})}

			{/* ── Original unit basis (reference, very faint) ─────────── */}
			<Arrow tipX={oe1sx} tipY={oe1sy} markerId={mkId('orig')} stroke="#475569" strokeWidth={1.5} />
			<Arrow tipX={oe2sx} tipY={oe2sy} markerId={mkId('orig')} stroke="#475569" strokeWidth={1.5} />
			<text x={oe1sx + 5} y={oe1sy + 4} fill="#475569" fontSize="10" fontFamily="monospace"
				style={{ userSelect: 'none' }}>e₁</text>
			<text x={oe2sx + 4} y={oe2sy - 5} fill="#475569" fontSize="10" fontFamily="monospace"
				style={{ userSelect: 'none' }}>e₂</text>

			{/* ── Transformed e₁ arrow ────────────────────────────────── */}
			{Math.hypot(e1sx - ox, e1sy - oy) > 8 && (
				<>
					<Arrow tipX={e1sx} tipY={e1sy} markerId={mkId('e1')} stroke="#60a5fa" />
					<text
						x={e1sx + (e1sx - ox) * 0.14}
						y={e1sy + (e1sy - oy) * 0.14}
						fill="#60a5fa" fontSize="11" fontFamily="monospace" textAnchor="middle"
						style={{ userSelect: 'none' }}>
						({+a.toFixed(2)},{+c.toFixed(2)})
					</text>
				</>
			)}

			{/* ── Transformed e₂ arrow ────────────────────────────────── */}
			{Math.hypot(e2sx - ox, e2sy - oy) > 8 && (
				<>
					<Arrow tipX={e2sx} tipY={e2sy} markerId={mkId('e2')} stroke="#34d399" />
					<text
						x={e2sx + (e2sx - ox) * 0.14}
						y={e2sy + (e2sy - oy) * 0.14}
						fill="#34d399" fontSize="11" fontFamily="monospace" textAnchor="middle"
						style={{ userSelect: 'none' }}>
						({+b.toFixed(2)},{+d.toFixed(2)})
					</text>
				</>
			)}
		</g>
	)
}

function GraphRenderer({
	shape,
	isEditing,
	editor,
}: {
	shape: IGraphShape
	isEditing: boolean
	editor: any
}) {
	const { w, h, functionStr, xMin, xMax, yMin, yMax, color, strokeWidth } = shape.props
	const sliders = shape.props.sliders ?? []
	const [editStr, setEditStr] = useState(functionStr)
	const inputRef = useRef<HTMLInputElement>(null)

	const toSvgX = (x: number) => ((x - xMin) / (xMax - xMin)) * w
	const toSvgY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h
	const xAxisY = toSvgY(0)
	const yAxisX = toSvgX(0)

	// ── Reactive: collect expressions from all equation shapes bound via arrows ──
	// useValue subscribes to the store so any latex change triggers a re-render.
	const boundFunctions = useValue('bound-equation-functions', () => {
		// Find arrow bindings where this graph is the END (target)
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		const results: { expr: string; label: string }[] = []

		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			// Find the start binding of the same arrow
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const sourceShape = editor.getShape(startB.toId)
				if (!sourceShape || sourceShape.type !== 'equation') continue
				const eq = sourceShape as IEquationShape
				const latex = eq.props.latex?.trim()
				if (!latex) continue
				// Split multi-line equations into one expr per line
				const lines = latexToMathjsLines(latex)
				for (const expr of lines) {
					results.push({ expr, label: expr })
				}
			}
		}
		return results
	}, [editor, shape.id])

	// ── Reactive: detect a 2×2 matrix bound via an arrow ──
	const boundMatrix = useValue('bound-matrix-2x2', () => {
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const srcShape = editor.getShape(startB.toId)
				if (!srcShape || srcShape.type !== 'equation') continue
				const m = matrixFromLatex((srcShape as IEquationShape).props.latex?.trim() ?? '')
				if (m && m.length === 2 && m[0].length === 2) return m
			}
		}
		return null
	}, [editor, shape.id])

	// If there are bound equations, use those. Otherwise fall back to the shape's own functionStr.
	const functionsToPlot: { expr: string; label: string; color: string }[] =
		boundFunctions.length > 0
			? boundFunctions.map((f, i) => ({ ...f, color: CURVE_COLORS[i % CURVE_COLORS.length] }))
			: [{ expr: functionStr, label: functionStr, color }]

	const expectedSliders = useMemo(
		() => mergeSliders(functionsToPlot.map((fn) => fn.expr), sliders),
		[functionsToPlot, sliders]
	)
	const slidersDiffer = !areSlidersEqual(expectedSliders, sliders)
	useEffect(() => {
		if (!slidersDiffer) return
		editor.updateShape({
			id: shape.id,
			type: 'graph',
			props: { sliders: expectedSliders },
		})
	}, [editor, expectedSliders, shape.id, slidersDiffer])

	const evaluateExpression = useMemo(() => createExpressionEvaluator(sliders), [sliders])
	const intersections = useMemo(
		() => findIntersections(functionsToPlot, sliders, xMin, xMax),
		[functionsToPlot, sliders, xMin, xMax]
	)

	const handleInputKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.stopPropagation()
			if (e.key === 'Enter') {
				editor.updateShape({
					id: shape.id,
					type: 'graph',
					props: { functionStr: editStr },
				})
			}
			editor.setCurrentTool('select')
		}
	}

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				position: 'relative',
				borderRadius: 8,
				overflow: 'hidden',
				background: 'rgba(15, 17, 23, 0.85)',
				border: '1px solid rgba(255,255,255,0.08)',
			}}
		>
			{/* SVG Graph */}
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${w} ${h}`}
				style={{ position: 'absolute', inset: 0 }}
			>
				{/* Grid lines */}
				{Array.from({ length: 9 }).map((_, i) => {
					const gx = (i / 8) * w
					const gy = (i / 8) * h
					return (
						<g key={i}>
							<line x1={gx} y1={0} x2={gx} y2={h} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
							<line x1={0} y1={gy} x2={w} y2={gy} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
						</g>
					)
				})}

				{/* Axes */}
				{xAxisY >= 0 && xAxisY <= h && (
					<line x1={0} y1={xAxisY} x2={w} y2={xAxisY} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
				)}
				{yAxisX >= 0 && yAxisX <= w && (
					<line x1={yAxisX} y1={0} x2={yAxisX} y2={h} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
				)}

				{/* Matrix linear-transform visualisation */}
				{boundMatrix && (
					<MatrixTransformViz
						matrix={boundMatrix}
						xMin={xMin} xMax={xMax}
						yMin={yMin} yMax={yMax}
						w={w} h={h}
						uid={shape.id.replace(/[^a-zA-Z0-9]/g, '')}
					/>
				)}

				{/* One curve per function — hidden when a matrix is driving the graph */}
				{!boundMatrix && functionsToPlot.map((fn, i) => (
					<path
						key={i}
						d={buildPath(fn.expr, evaluateExpression, xMin, xMax, yMin, yMax, w, h)}
						fill="none"
						stroke={fn.color}
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				))}

				{/* Intersections */}
				{!boundMatrix && intersections
					.filter((p) => p.y >= yMin && p.y <= yMax)
					.map((p, idx) => (
						<g key={`intersection-${idx}`}>
							<circle
								cx={toSvgX(p.x)}
								cy={toSvgY(p.y)}
								r={4}
								fill={INTERSECTION_CENTER_COLOR}
								stroke={INTERSECTION_OUTER_COLOR}
								strokeWidth={1.5}
							/>
							<circle
								cx={toSvgX(p.x)}
								cy={toSvgY(p.y)}
								r={2}
								fill={p.colorA}
								stroke={p.colorB}
								strokeWidth={1}
							/>
							<title>{`(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`}</title>
						</g>
					))}
			</svg>

			{/* Matrix info panel */}
			{boundMatrix && (() => {
				const det = det2(boundMatrix)
				const tr = trace2(boundMatrix)
				const eigen = eigen2(boundMatrix)
				const eigenStr = eigen.real
					? `λ₁=${+eigen.λ1.toFixed(3)}, λ₂=${+eigen.λ2.toFixed(3)}`
					: `${+eigen.re.toFixed(3)} ± ${+eigen.im.toFixed(3)}i`
				return (
					<div
						style={{
							position: 'absolute',
							top: 8,
							left: 8,
							background: 'rgba(10,12,18,0.82)',
							border: '1px solid rgba(255,255,255,0.1)',
							borderRadius: 8,
							padding: '6px 10px',
							display: 'flex',
							flexDirection: 'column',
							gap: 2,
							pointerEvents: 'none',
						}}
					>
						{[
							{ label: 'det', value: +det.toFixed(4), color: '#e2e8f0' },
							{ label: 'tr', value: +tr.toFixed(4), color: '#e2e8f0' },
						].map(({ label, value, color }) => (
							<span key={label} style={{ fontSize: 11, fontFamily: 'monospace', color }}>
								{label} = {value}
							</span>
						))}
						<span style={{ fontSize: 11, fontFamily: 'monospace', color: eigen.real ? '#fbbf24' : '#f472b6' }}>
							{eigenStr}
						</span>
					</div>
				)
			})()}

			{/* Legend (bottom-left) — hidden in matrix mode */}
			{!isEditing && !boundMatrix && (
				<div
					style={{
						position: 'absolute',
						bottom: 8,
						left: 10,
						display: 'flex',
						flexDirection: 'column',
						gap: 2,
						pointerEvents: 'none',
					}}
				>
					{functionsToPlot.map((fn, i) => (
						<span
							key={i}
							style={{
								fontSize: 11,
								fontFamily: 'monospace',
								color: fn.color,
								background: 'rgba(0,0,0,0.45)',
								padding: '1px 6px',
								borderRadius: 4,
							}}
						>
							y = {fn.label}
						</span>
					))}
				</div>
			)}

			{/* Edit overlay (only shown when no equations or matrix are bound) */}
			{isEditing && !boundMatrix && boundFunctions.length === 0 && (
				<div
					style={{
						position: 'absolute',
						bottom: 0,
						left: 0,
						right: 0,
						padding: '8px 10px',
						background: 'rgba(10,12,18,0.92)',
						borderTop: '1px solid rgba(255,255,255,0.1)',
						display: 'flex',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13, flexShrink: 0 }}>y =</span>
					<input
						ref={inputRef}
						autoFocus
						defaultValue={functionStr}
						onChange={(e) => setEditStr(e.target.value)}
						onKeyDown={handleInputKeyDown}
						placeholder="sin(x), x^2, exp(-x^2)…"
						style={{
							flex: 1,
							background: 'transparent',
							border: 'none',
							outline: 'none',
							color,
							fontFamily: 'monospace',
							fontSize: 13,
						}}
					/>
					<span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>Enter to apply</span>
				</div>
			)}

			{/* Slider controls for constants */}
			{sliders.length > 0 && (
				<div
					style={{
						position: 'absolute',
						top: 8,
						right: 8,
						width: Math.min(220, w - 16),
						maxHeight: Math.max(80, h - 20),
						overflowY: 'auto',
						background: 'rgba(10,12,18,0.78)',
						border: '1px solid rgba(255,255,255,0.12)',
						borderRadius: 8,
						padding: 8,
						display: 'flex',
						flexDirection: 'column',
						gap: 6,
						pointerEvents: 'all',
					}}
				>
					{sliders.map((slider) => (
						<div key={slider.name} style={{ display: 'grid', gridTemplateColumns: '16px 1fr auto', gap: 8, alignItems: 'center' }}>
							<span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>{slider.name}</span>
							<input
								type="range"
								min={slider.min}
								max={slider.max}
								step={slider.step}
								value={slider.value}
								onPointerDown={(e) => e.stopPropagation()}
								onChange={(e) => {
									const value = Number(e.target.value)
									editor.updateShape({
										id: shape.id,
										type: 'graph',
										props: {
											sliders: sliders.map((s) =>
												s.name === slider.name ? { ...s, value } : s
											),
										},
									})
								}}
								style={{ width: '100%' }}
							/>
							<span style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', minWidth: 42, textAlign: 'right' }}>
								{slider.value.toFixed(1)}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Hint when editing but a matrix or equations control the graph */}
			{isEditing && (boundMatrix || boundFunctions.length > 0) && (
				<div
					style={{
						position: 'absolute',
						bottom: 0,
						left: 0,
						right: 0,
						padding: '6px 10px',
						background: 'rgba(10,12,18,0.92)',
						borderTop: '1px solid rgba(255,255,255,0.1)',
						fontSize: 11,
						color: '#64748b',
						fontFamily: "'Inter', sans-serif",
						textAlign: 'center',
					}}
				>
					{boundMatrix
						? 'Showing linear transformation — edit the linked matrix equation to update'
						: `Driven by ${boundFunctions.length} linked equation${boundFunctions.length > 1 ? 's' : ''} — edit the MathLive shapes to update`}
				</div>
			)}
		</div>
	)
}
