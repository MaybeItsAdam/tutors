import { evaluate } from 'mathjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, useEditor, useValue } from 'tldraw'
import { IEquationShape } from '../equation/EquationShape'
import { graphShapeProps, IGraphShape } from './GraphShape'
import { latexToMathjsLines } from '../../utils/latexToMathjs'

const SAMPLES = 400
const INTERSECTION_EPSILON = 1e-3
const INTERSECTION_THRESHOLD_DIVISOR = 2
const INTERSECTION_DUPLICATE_X_FACTOR = 1.5
const INTERSECTION_DUPLICATE_Y_FACTOR = 2
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
	const intersections: { x: number; y: number; colorA: string; colorB: string }[] = []
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

				const xRoot = rootBetween(d0, d1, x0, x1)
				let yRoot: number
				try {
					yRoot = evaluateExpression(a.expr, xRoot)
					if (!isFinite(yRoot)) continue
				} catch {
					continue
				}

				const duplicate = intersections.some(
					(point) =>
						Math.abs(point.x - xRoot) < dx * INTERSECTION_DUPLICATE_X_FACTOR &&
						Math.abs(point.y - yRoot) < threshold * INTERSECTION_DUPLICATE_Y_FACTOR
				)
				if (duplicate) continue

				intersections.push({ x: xRoot, y: yRoot, colorA: a.color, colorB: b.color })
			}
		}
	}

	return intersections
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
	const intersections = findIntersections(functionsToPlot, sliders, xMin, xMax)

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

				{/* One curve per function */}
				{functionsToPlot.map((fn, i) => (
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
				{intersections
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
						</g>
					))}
			</svg>

			{/* Legend (bottom-left) */}
			{!isEditing && (
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

			{/* Edit overlay (only shown when no equations are bound) */}
			{isEditing && boundFunctions.length === 0 && (
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

			{/* Hint when editing but equations control the graph */}
			{isEditing && boundFunctions.length > 0 && (
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
					Driven by {boundFunctions.length} linked equation{boundFunctions.length > 1 ? 's' : ''} — edit the MathLive shapes to update
				</div>
			)}
		</div>
	)
}
