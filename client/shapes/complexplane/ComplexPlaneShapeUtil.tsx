import { compile, complex } from 'mathjs'
import { useEffect, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, useEditor, useValue } from 'tldraw'
import { complexPlaneShapeProps, IComplexPlaneShape } from './ComplexPlaneShape'
import { IEquationShape } from '../equation/EquationShape'
import { latexToMathjsLines } from '../../utils/latexToMathjs'

// ── Domain colouring ──────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const hp = h * 6
	const x = c * (1 - Math.abs((hp % 2) - 1))
	const m = l - c / 2
	let r = 0, g = 0, b = 0
	if (hp < 1)      { r = c; g = x }
	else if (hp < 2) { r = x; g = c }
	else if (hp < 3) { g = c; b = x }
	else if (hp < 4) { g = x; b = c }
	else if (hp < 5) { r = x; b = c }
	else             { r = c; b = x }
	return [
		Math.round(Math.max(0, Math.min(255, (r + m) * 255))),
		Math.round(Math.max(0, Math.min(255, (g + m) * 255))),
		Math.round(Math.max(0, Math.min(255, (b + m) * 255))),
	]
}

// Enhanced phase portrait: hue = arg(f(z)), log-magnitude bands for lightness
function domainColor(reVal: number, imVal: number): [number, number, number] {
	if (!isFinite(reVal) || !isFinite(imVal)) return [0, 0, 0]
	const mag = Math.hypot(reVal, imVal)
	if (mag === 0) return [0, 0, 0]
	const angle = Math.atan2(imVal, reVal)            // ∈ [-π, π]
	const hue = ((angle / (2 * Math.PI)) + 1) % 1    // ∈ [0, 1)
	// Log-periodic brightness rings for |f(z)| = 2^n contours
	const logM = Math.log2(mag)
	const frac = logM - Math.floor(logM)              // ∈ [0, 1)
	const light = 0.5 + 0.16 * Math.cos(frac * 2 * Math.PI)
	return hslToRgb(hue, 0.88, Math.max(0.08, Math.min(0.92, light)))
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function ComplexPlaneRenderer({
	shape,
	isEditing,
}: {
	shape: IComplexPlaneShape
	isEditing: boolean
}) {
	const editor = useEditor()
	const { w, h, expression, xMin, xMax, yMin, yMax } = shape.props
	const [editExpr, setEditExpr] = useState(expression)
	const canvasRef = useRef<HTMLCanvasElement>(null)

	// Detect an equation shape bound via arrow → use its first mathjs line as f(z)
	const boundExpression = useValue('cp-bound', () => {
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
				if (lines.length > 0) return lines[0]
			}
		}
		return null
	}, [editor, shape.id])

	const activeExpression = boundExpression ?? expression

	// Recompute domain colouring whenever the expression or viewport changes
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		let cancelled = false

		// Render at 1/3 pixel density then scale up — keeps it snappy
		const DOWNSAMPLE = 3
		const cw = Math.max(1, Math.round(w / DOWNSAMPLE))
		const ch = Math.max(1, Math.round(h / DOWNSAMPLE))

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let compiled: { evaluate(scope: Record<string, unknown>): unknown } | null = null
		try {
			compiled = compile(activeExpression) as any
		} catch {
			canvas.width = w
			canvas.height = h
			ctx.fillStyle = '#0f1117'
			ctx.fillRect(0, 0, w, h)
			ctx.fillStyle = 'rgba(239,68,68,0.6)'
			ctx.font = '12px monospace'
			ctx.fillText('parse error', 8, 20)
			return
		}

		const pixels = new Uint8ClampedArray(cw * ch * 4)

		for (let py = 0; py < ch; py++) {
			if (cancelled) break
			for (let px = 0; px < cw; px++) {
				const wx = xMin + (px + 0.5) / cw * (xMax - xMin)
				const wy = yMax - (py + 0.5) / ch * (yMax - yMin)

				let r = 18, g = 18, b = 28
				try {
					const result = compiled!.evaluate({
						z: complex(wx, wy),
						i: complex(0, 1),
					})
					const rePart = typeof result === 'number' ? result : (result as any)?.re ?? 0
					const imPart = typeof result === 'number' ? 0 : (result as any)?.im ?? 0
					;[r, g, b] = domainColor(rePart, imPart)
				} catch { /* leave dark */ }

				const idx = (py * cw + px) * 4
				pixels[idx] = r
				pixels[idx + 1] = g
				pixels[idx + 2] = b
				pixels[idx + 3] = 255
			}
		}

		if (!cancelled) {
			const tmp = document.createElement('canvas')
			tmp.width = cw
			tmp.height = ch
			tmp.getContext('2d')!.putImageData(new ImageData(pixels, cw, ch), 0, 0)
			canvas.width = w
			canvas.height = h
			ctx.imageSmoothingEnabled = false
			ctx.drawImage(tmp, 0, 0, w, h)
		}

		return () => { cancelled = true }
	}, [activeExpression, xMin, xMax, yMin, yMax, w, h])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation()
		if (e.key === 'Enter') {
			editor.updateShape({
				id: shape.id,
				type: 'complexplane' as any,
				props: { expression: editExpr },
			})
			editor.setCurrentTool('select')
		} else if (e.key === 'Escape') {
			editor.setCurrentTool('select')
		}
	}

	const toSvgX = (x: number) => ((x - xMin) / (xMax - xMin)) * w
	const toSvgY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h
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
				border: '1px solid rgba(255,255,255,0.08)',
			}}
		>
			{/* Domain-coloured canvas */}
			<canvas
				ref={canvasRef}
				width={w}
				height={h}
				style={{ position: 'absolute', inset: 0, borderRadius: 8 }}
			/>

			{/* Axes + labels overlay */}
			<svg
				width={w}
				height={h}
				viewBox={`0 0 ${w} ${h}`}
				style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
			>
				{axY >= 0 && axY <= h && (
					<line
						x1={0} y1={axY} x2={w} y2={axY}
						stroke="rgba(255,255,255,0.28)" strokeWidth={1}
					/>
				)}
				{axX >= 0 && axX <= w && (
					<line
						x1={axX} y1={0} x2={axX} y2={h}
						stroke="rgba(255,255,255,0.28)" strokeWidth={1}
					/>
				)}
				{/* Axis labels */}
				{axY >= 0 && axY <= h && (
					<text x={w - 5} y={axY - 5} fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="monospace" textAnchor="end">Re</text>
				)}
				{axX >= 0 && axX <= w && (
					<text x={axX + 4} y={13} fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="monospace">Im</text>
				)}
				{/* Tick marks at integer positions on Re axis */}
				{Array.from({ length: Math.floor(xMax) - Math.ceil(xMin) + 1 }).map((_, k) => {
					const v = Math.ceil(xMin) + k
					if (v === 0) return null
					const sx = toSvgX(v)
					return (
						<g key={v}>
							<line x1={sx} y1={axY - 4} x2={sx} y2={axY + 4} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
							<text x={sx} y={axY + 14} fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" textAnchor="middle">{v}</text>
						</g>
					)
				})}
				{/* Tick marks at integer positions on Im axis */}
				{Array.from({ length: Math.floor(yMax) - Math.ceil(yMin) + 1 }).map((_, k) => {
					const v = Math.ceil(yMin) + k
					if (v === 0) return null
					const sy = toSvgY(v)
					return (
						<g key={v}>
							<line x1={axX - 4} y1={sy} x2={axX + 4} y2={sy} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
							<text x={axX + 6} y={sy + 4} fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">{v}i</text>
						</g>
					)
				})}
			</svg>

			{/* f(z) expression label */}
			{!isEditing && (
				<div
					style={{
						position: 'absolute',
						top: 6,
						left: 8,
						background: 'rgba(10,12,18,0.72)',
						backdropFilter: 'blur(3px)',
						borderRadius: 4,
						padding: '2px 8px',
						fontSize: 12,
						fontFamily: 'monospace',
						color: '#e2e8f0',
						pointerEvents: 'none',
					}}
				>
					f(z) = {activeExpression}
				</div>
			)}

			{/* Phase colour legend */}
			{!isEditing && (
				<div
					style={{
						position: 'absolute',
						bottom: 8,
						right: 8,
						background: 'rgba(10,12,18,0.72)',
						borderRadius: 4,
						padding: '4px 7px',
						pointerEvents: 'none',
					}}
				>
					<div
						style={{
							width: 84,
							height: 8,
							// Full HSL rainbow: red → yellow → green → cyan → blue → violet → red
							background: 'linear-gradient(to right, hsl(0,80%,55%), hsl(60,80%,55%), hsl(120,80%,45%), hsl(180,80%,50%), hsl(240,80%,60%), hsl(300,80%,55%), hsl(360,80%,55%))',
							borderRadius: 2,
						}}
					/>
					<div
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							marginTop: 2,
						}}
					>
						<span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8' }}>−π</span>
						<span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8' }}>arg</span>
						<span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8' }}>+π</span>
					</div>
				</div>
			)}

			{/* Expression editor */}
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
						f(z) =
					</span>
					<input
						autoFocus
						defaultValue={expression}
						onChange={(e) => setEditExpr(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="z^2  ·  1/(z-1)  ·  sin(z)  ·  exp(z)"
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
					f(z) driven by linked equation — edit the MathLive shape to update
				</div>
			)}
		</div>
	)
}

// ── Shape util ────────────────────────────────────────────────────────────────

export class ComplexPlaneShapeUtil extends BaseBoxShapeUtil<IComplexPlaneShape> {
	static override type = 'complexplane' as const
	static override props = complexPlaneShapeProps

	override canEdit() {
		return true
	}

	override getDefaultProps(): IComplexPlaneShape['props'] {
		return {
			w: 420,
			h: 360,
			expression: 'z^2',
			xMin: -2,
			xMax: 2,
			yMin: -2,
			yMax: 2,
		}
	}

	override component(shape: IComplexPlaneShape) {
		const isEditing = this.editor.getEditingShapeId() === shape.id
		return (
			<HTMLContainer
				id={shape.id}
				style={{ width: '100%', height: '100%', pointerEvents: 'all', userSelect: 'none' }}
			>
				<ComplexPlaneRenderer shape={shape} isEditing={isEditing} />
			</HTMLContainer>
		)
	}

	override indicator(shape: IComplexPlaneShape) {
		return <rect width={shape.props.w} height={shape.props.h} />
	}

	override onResize = (shape: IComplexPlaneShape, info: any) => {
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
