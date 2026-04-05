import { evaluate } from 'mathjs'
import { useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, useEditor, useValue } from 'tldraw'
import { IEquationShape } from '../equation/EquationShape'
import { vectorFieldShapeProps, IVectorFieldShape } from './VectorFieldShape'
import { latexToMathjsLines } from '../../utils/latexToMathjs'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Find the first comma not inside parentheses (splits "P, Q" at the top level)
function findTopLevelComma(expr: string): number {
	let depth = 0
	for (let i = 0; i < expr.length; i++) {
		if (expr[i] === '(') depth++
		else if (expr[i] === ')') depth--
		else if (expr[i] === ',' && depth === 0) return i
	}
	return -1
}

// Map normalised magnitude t ∈ [0,1] → rgb string (blue → cyan → green → yellow → red)
function magnitudeColor(t: number): string {
	t = Math.max(0, Math.min(1, t))
	const stops: [number, number, number][] = [
		[96, 165, 250],
		[34, 211, 238],
		[74, 222, 128],
		[250, 204, 21],
		[239, 68, 68],
	]
	const scaled = t * (stops.length - 1)
	const i = Math.floor(Math.min(scaled, stops.length - 2))
	const f = scaled - i
	const a = stops[i], b = stops[i + 1]
	return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function VectorFieldRenderer({
	shape,
	isEditing,
}: {
	shape: IVectorFieldShape
	isEditing: boolean
}) {
	const editor = useEditor()
	const { w, h, expression, xMin, xMax, yMin, yMax, density } = shape.props
	const [editExpr, setEditExpr] = useState(expression)
	const inputRef = useRef<HTMLInputElement>(null)

	const toSvgX = (x: number) => ((x - xMin) / (xMax - xMin)) * w
	const toSvgY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h

	// Detect an equation shape bound via arrow → use its lines as "P, Q"
	const boundExpression = useValue('vf-bound', () => {
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const srcShape = editor.getShape(startB.toId)
				if (!srcShape || srcShape.type !== 'equation') continue
				const eq = srcShape as IEquationShape
				const latex = eq.props.latex?.trim()
				if (!latex) continue
				const lines = latexToMathjsLines(latex)
				// Two separate lines → P on line 1, Q on line 2; or single "P, Q" line
				if (lines.length >= 2) {
					const joined = `${lines[0]}, ${lines[1]}`
					if (findTopLevelComma(joined) !== -1) return joined
				}
				if (lines.length === 1 && findTopLevelComma(lines[0]) !== -1) return lines[0]
			}
		}
		return null
	}, [editor, shape.id])

	const activeExpression = boundExpression ?? expression

	// Compute arrow positions and colors
	const { arrows, maxMag } = useMemo(() => {
		const commaIdx = findTopLevelComma(activeExpression)
		if (commaIdx === -1) return { arrows: [], maxMag: 0 }
		const pExpr = activeExpression.slice(0, commaIdx).trim()
		const qExpr = activeExpression.slice(commaIdx + 1).trim()

		const cols = Math.max(2, density)
		const rows = Math.max(2, Math.round(cols * (h / w)))
		const cellW = (xMax - xMin) / cols
		const cellH = (yMax - yMin) / rows

		const data: Array<{ wx: number; wy: number; p: number; q: number; mag: number }> = []
		let maxMag = 0

		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				const wx = xMin + (i + 0.5) * cellW
				const wy = yMin + (j + 0.5) * cellH
				let p = 0, q = 0
				try {
					p = evaluate(pExpr, { x: wx, y: wy })
					q = evaluate(qExpr, { x: wx, y: wy })
					if (!isFinite(p) || !isFinite(q)) continue
				} catch { continue }
				const mag = Math.hypot(p, q)
				if (mag < 1e-12) continue
				maxMag = Math.max(maxMag, mag)
				data.push({ wx, wy, p, q, mag })
			}
		}

		if (maxMag === 0) return { arrows: [], maxMag: 0 }

		const arrowLen = (w / cols) * 0.44

		return {
			arrows: data.map(({ wx, wy, p, q, mag }) => {
				const sx = toSvgX(wx)
				const sy = toSvgY(wy)
				const t = mag / maxMag
				// Use variable length so faint regions are visible; min 30% of max len
				const scale = (0.3 + t * 0.7) * arrowLen
				const ux = p / mag, uy = q / mag
				return {
					x1: sx, y1: sy,
					x2: sx + ux * scale,
					y2: sy - uy * scale,  // SVG y-axis is flipped
					t,
				}
			}),
			maxMag,
		}
	}, [activeExpression, xMin, xMax, yMin, yMax, density, w, h])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation()
		if (e.key === 'Enter') {
			editor.updateShape({ id: shape.id, type: 'vectorfield' as any, props: { expression: editExpr } })
			editor.setCurrentTool('select')
		} else if (e.key === 'Escape') {
			editor.setCurrentTool('select')
		}
	}

	// Build the expressed P/Q label from active expression
	const commaIdx = findTopLevelComma(activeExpression)
	const pLabel = commaIdx !== -1 ? activeExpression.slice(0, commaIdx).trim() : activeExpression
	const qLabel = commaIdx !== -1 ? activeExpression.slice(commaIdx + 1).trim() : ''

	const axX = toSvgX(0)
	const axY = toSvgY(0)

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				position: 'relative',
				borderRadius: 8,
				overflow: 'hidden',
				background: 'rgba(15,17,23,0.87)',
				border: '1px solid rgba(255,255,255,0.08)',
			}}
		>
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${w} ${h}`}
				style={{ position: 'absolute', inset: 0 }}
			>
				{/* Subtle grid */}
				{Array.from({ length: 9 }).map((_, i) => (
					<g key={i}>
						<line x1={(i / 8) * w} y1={0} x2={(i / 8) * w} y2={h} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
						<line x1={0} y1={(i / 8) * h} x2={w} y2={(i / 8) * h} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
					</g>
				))}

				{/* Axes */}
				{axY >= 0 && axY <= h && (
					<line x1={0} y1={axY} x2={w} y2={axY} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
				)}
				{axX >= 0 && axX <= w && (
					<line x1={axX} y1={0} x2={axX} y2={h} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
				)}

				{/* Arrows */}
				{arrows.map(({ x1, y1, x2, y2, t }, idx) => {
					const dx = x2 - x1, dy = y2 - y1
					const len = Math.hypot(dx, dy)
					if (len < 1.5) return null
					const ux = dx / len, uy = dy / len
					const hs = Math.max(3, len * 0.32)
					// Arrowhead base is hs pixels behind the tip
					const bx = x2 - ux * hs, by = y2 - uy * hs
					const color = magnitudeColor(t)
					const pts = `${x2},${y2} ${bx - uy * hs * 0.36},${by + ux * hs * 0.36} ${bx + uy * hs * 0.36},${by - ux * hs * 0.36}`
					return (
						<g key={idx} opacity={0.88}>
							<line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={1.2} />
							<polygon points={pts} fill={color} />
						</g>
					)
				})}
			</svg>

			{/* Field expression label */}
			{!isEditing && (
				<div
					style={{
						position: 'absolute',
						top: 6,
						left: 8,
						fontSize: 11,
						fontFamily: 'monospace',
						color: 'rgba(148,163,184,0.8)',
						pointerEvents: 'none',
						background: 'rgba(10,12,18,0.5)',
						borderRadius: 4,
						padding: '1px 5px',
					}}
				>
					({pLabel}, {qLabel})
				</div>
			)}

			{/* Magnitude colorbar */}
			{!isEditing && maxMag > 0 && (
				<div
					style={{
						position: 'absolute',
						bottom: 8,
						right: 8,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'flex-end',
						gap: 2,
						pointerEvents: 'none',
					}}
				>
					<span style={{ fontSize: 10, fontFamily: 'monospace', color: '#ef4444' }}>
						{maxMag >= 100 ? maxMag.toExponential(1) : +maxMag.toFixed(2)}
					</span>
					<div
						style={{
							width: 8,
							height: 44,
							background: 'linear-gradient(to bottom, #ef4444, #facc15, #4ade80, #22d3ee, #60a5fa)',
							borderRadius: 2,
						}}
					/>
					<span style={{ fontSize: 10, fontFamily: 'monospace', color: '#60a5fa' }}>0</span>
				</div>
			)}

			{/* Expression editor (edit mode, no binding) */}
			{isEditing && !boundExpression && (
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
					<span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>
						(P, Q) =
					</span>
					<input
						ref={inputRef}
						autoFocus
						defaultValue={expression}
						onChange={(e) => setEditExpr(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="y, -x  ·  sin(y), cos(x)  ·  x*y, x-y"
						style={{
							flex: 1,
							background: 'transparent',
							border: 'none',
							outline: 'none',
							color: '#e2e8f0',
							fontFamily: 'monospace',
							fontSize: 12,
						}}
					/>
					<span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>Enter to apply</span>
				</div>
			)}

			{/* Hint when driven by linked equation */}
			{isEditing && boundExpression && (
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
					Driven by linked equation — edit the MathLive shape to update
				</div>
			)}
		</div>
	)
}

// ── Shape util ────────────────────────────────────────────────────────────────

export class VectorFieldShapeUtil extends BaseBoxShapeUtil<IVectorFieldShape> {
	static override type = 'vectorfield' as const
	static override props = vectorFieldShapeProps

	override canEdit() {
		return true
	}

	override getDefaultProps(): IVectorFieldShape['props'] {
		return {
			w: 420,
			h: 360,
			expression: 'y, -x',
			xMin: -4,
			xMax: 4,
			yMin: -4,
			yMax: 4,
			density: 18,
		}
	}

	override component(shape: IVectorFieldShape) {
		const isEditing = this.editor.getEditingShapeId() === shape.id
		return (
			<HTMLContainer
				id={shape.id}
				style={{ width: '100%', height: '100%', pointerEvents: 'all', userSelect: 'none' }}
			>
				<VectorFieldRenderer shape={shape} isEditing={isEditing} />
			</HTMLContainer>
		)
	}

	override indicator(shape: IVectorFieldShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}

	override onResize = (shape: IVectorFieldShape, info: any) => {
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
