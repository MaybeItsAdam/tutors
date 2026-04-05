import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { compile } from 'mathjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, useEditor, useValue } from 'tldraw'
import { graph3dShapeProps, IGraph3dShape } from './Graph3dShape'
import { IEquationShape } from '../equation/EquationShape'
import { matrixFromLatex, apply3, det3, trace3 } from '../../utils/matrixFromLatex'

// ── Height-to-colour (cool→warm rainbow) ─────────────────────────────────────
function heightColor(t: number): [number, number, number] {
	// t ∈ [0,1]: blue → cyan → green → yellow → red
	t = Math.max(0, Math.min(1, t))
	if (t < 0.25) return [0, t * 4, 1]
	if (t < 0.5) return [0, 1, 1 - (t - 0.25) * 4]
	if (t < 0.75) return [(t - 0.5) * 4, 1, 0]
	return [1, 1 - (t - 0.75) * 4, 0]
}

// ── Build a colored surface BufferGeometry ────────────────────────────────────
function buildGeometry(
	expression: string,
	xMin: number, xMax: number,
	yMin: number, yMax: number,
	n: number,
): THREE.BufferGeometry {
	// compile() overload with string returns EvalFunction; cast via any for TS
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let compiled: { evaluate(scope: Record<string, number>): number } | null = null
	try { compiled = compile(expression) as any } catch { /* fall through */ }

	const positions: number[] = []
	const colors: number[] = []
	const indices: number[] = []

	// Sample z values first to find range for colour mapping
	const zValues: number[] = []
	const pts: Array<{ x: number; y: number; z: number }> = []

	for (let j = 0; j <= n; j++) {
		for (let i = 0; i <= n; i++) {
			const x = xMin + (i / n) * (xMax - xMin)
			const y = yMin + (j / n) * (yMax - yMin)
			let z = 0
			if (compiled) {
				try {
					const v = compiled.evaluate({ x, y })
					if (typeof v === 'number' && isFinite(v)) z = v
				} catch { /* NaN patch */ }
			}
			pts.push({ x, y, z })
			zValues.push(z)
		}
	}

	const zMin2 = Math.min(...zValues)
	const zMax2 = Math.max(...zValues)
	const zRange = zMax2 - zMin2 || 1

	for (const { x, y, z } of pts) {
		// Three.js: x→x, z→y (up), y→z
		positions.push(x, z, y)
		const [r, g, b] = heightColor((z - zMin2) / zRange)
		colors.push(r, g, b)
	}

	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const a = j * (n + 1) + i
			const b = a + 1
			const c = a + (n + 1)
			const d = c + 1
			indices.push(a, c, b, b, c, d)
		}
	}

	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	geo.setIndex(indices)
	geo.computeVertexNormals()
	return geo
}

// ── Three.js renderer component ───────────────────────────────────────────────
function Graph3dRenderer({
	shape,
	isEditing,
}: {
	shape: IGraph3dShape
	isEditing: boolean
}) {
	const { w, h, expression, xMin, xMax, yMin, yMax, resolution } = shape.props
	const editor = useEditor()
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
	const sceneRef = useRef<THREE.Scene | null>(null)
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
	const controlsRef = useRef<OrbitControls | null>(null)
	const meshRef = useRef<THREE.Mesh | null>(null)
	const matrixArrowsRef = useRef<THREE.Object3D[]>([])
	const rafRef = useRef<number>(0)

	const [editExpr, setEditExpr] = useState(expression)

	// ── Detect bound 3×3 matrix from an arrow-linked equation shape ──
	const boundMatrix = useValue('bound-matrix-3x3', () => {
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const srcShape = editor.getShape(startB.toId)
				if (!srcShape || srcShape.type !== 'equation') continue
				const m = matrixFromLatex((srcShape as IEquationShape).props.latex?.trim() ?? '')
				if (m && m.length === 3 && m[0].length === 3) return m
			}
		}
		return null
	}, [editor, shape.id])

	// ── Setup scene on mount ──
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
		renderer.setSize(w, h)
		rendererRef.current = renderer

		const scene = new THREE.Scene()
		scene.background = new THREE.Color(0x0f1117)
		sceneRef.current = scene

		// Camera
		const camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 1000)
		camera.position.set(
			(xMax - xMin) * 0.8,
			(xMax - xMin) * 0.9,
			(yMax - yMin) * 0.8
		)
		camera.lookAt(0, 0, 0)
		cameraRef.current = camera

		// Orbit controls (disabled pointer propagation so tldraw doesn't grab events)
		const controls = new OrbitControls(camera, canvas)
		controls.enableDamping = true
		controls.dampingFactor = 0.08
		controls.enabled = false // enabled only when isEditing
		controlsRef.current = controls

		// Axes helper
		const axesLen = Math.max(xMax - xMin, yMax - yMin) * 0.5
		scene.add(new THREE.AxesHelper(axesLen))

		// Grid on XZ plane
		const gridHelper = new THREE.GridHelper(
			Math.max(xMax - xMin, yMax - yMin) * 1.2,
			10,
			0x334155,
			0x1e293b
		)
		scene.add(gridHelper)

		// Light
		const ambLight = new THREE.AmbientLight(0xffffff, 0.6)
		scene.add(ambLight)
		const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
		dirLight.position.set(5, 10, 5)
		scene.add(dirLight)

		// Render loop
		const animate = () => {
			rafRef.current = requestAnimationFrame(animate)
			controls.update()
			renderer.render(scene, camera)
		}
		animate()

		return () => {
			cancelAnimationFrame(rafRef.current)
			controls.dispose()
			renderer.dispose()
		}
		// Only run once on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// ── Update surface mesh when expression or bounds change ──
	const geo = useMemo(
		() => buildGeometry(expression, xMin, xMax, yMin, yMax, resolution),
		[expression, xMin, xMax, yMin, yMax, resolution]
	)

	useEffect(() => {
		const scene = sceneRef.current
		if (!scene) return

		// Remove old mesh
		if (meshRef.current) {
			scene.remove(meshRef.current)
			meshRef.current.geometry.dispose()
		}

		// Hide surface when showing matrix transform
		if (boundMatrix) return

		const material = new THREE.MeshPhongMaterial({
			vertexColors: true,
			side: THREE.DoubleSide,
			shininess: 30,
		})
		const mesh = new THREE.Mesh(geo, material)
		scene.add(mesh)
		meshRef.current = mesh

		// Wireframe overlay
		const wfMat = new THREE.MeshBasicMaterial({
			color: 0x334155,
			wireframe: true,
			opacity: 0.12,
			transparent: true,
		})
		const wfMesh = new THREE.Mesh(geo, wfMat)
		scene.add(wfMesh)
	}, [geo, boundMatrix])

	// ── Matrix 3D visualization: transformed basis arrows ──
	useEffect(() => {
		const scene = sceneRef.current
		if (!scene) return

		// Remove old matrix arrows
		for (const obj of matrixArrowsRef.current) scene.remove(obj)
		matrixArrowsRef.current = []

		if (!boundMatrix) return

		const origin = new THREE.Vector3(0, 0, 0)
		const scale = Math.max(xMax - xMin, yMax - yMin) * 0.4

		// Standard basis e1, e2, e3 → columns of matrix
		const bases: Array<{ src: [number,number,number]; col: number }> = [
			{ src: [1, 0, 0], col: 0x60a5fa },  // e1 → blue
			{ src: [0, 1, 0], col: 0x34d399 },  // e2 → green (Note: Three.js y=up)
			{ src: [0, 0, 1], col: 0xf97316 },  // e3 → orange
		]

		for (const { src, col } of bases) {
			// Apply matrix (world-space: x stays x, z→y maps as Three.js has y up)
			const [tx, ty, tz] = apply3(boundMatrix, src[0], src[1], src[2])
			// Three.js: x→x, z→y (up), y→z
			const tip = new THREE.Vector3(tx * scale, tz * scale, ty * scale)
			const len = tip.length()
			if (len < 0.01) continue
			const dir = tip.clone().normalize()
			const arrow = new THREE.ArrowHelper(dir, origin, len, col, len * 0.18, len * 0.12)
			scene.add(arrow)
			matrixArrowsRef.current.push(arrow)
		}

		// Also show original basis (faint gray)
		for (const src of [[1,0,0],[0,1,0],[0,0,1]] as [number,number,number][]) {
			const tip = new THREE.Vector3(src[0] * scale * 0.55, src[2] * scale * 0.55, src[1] * scale * 0.55)
			const len = tip.length()
			const dir = tip.clone().normalize()
			const arrow = new THREE.ArrowHelper(dir, origin, len, 0x334155, len * 0.18, len * 0.12)
			scene.add(arrow)
			matrixArrowsRef.current.push(arrow)
		}
	}, [boundMatrix, xMin, xMax, yMin, yMax])

	// ── Toggle orbit controls with edit mode ──
	useEffect(() => {
		if (controlsRef.current) {
			controlsRef.current.enabled = isEditing
		}
	}, [isEditing])

	// ── Resize renderer when shape dimensions change ──
	useEffect(() => {
		const renderer = rendererRef.current
		const camera = cameraRef.current
		if (!renderer || !camera) return
		renderer.setSize(w, h)
		camera.aspect = w / h
		camera.updateProjectionMatrix()
	}, [w, h])

	const handleExprKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation()
		if (e.key === 'Enter') {
			// update shape expression
			;(e.target as HTMLInputElement).blur()
		}
	}

	return (
		<div style={{ position: 'relative', width: w, height: h, userSelect: 'none' }}>
			<canvas
				ref={canvasRef}
				width={w}
				height={h}
				style={{ display: 'block', borderRadius: 6 }}
			/>

			{/* Expression label / editor */}
			<div
				style={{
					position: 'absolute',
					bottom: 8,
					left: '50%',
					transform: 'translateX(-50%)',
					background: 'rgba(15,17,23,0.75)',
					backdropFilter: 'blur(4px)',
					borderRadius: 6,
					padding: '3px 10px',
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					pointerEvents: isEditing ? 'all' : 'none',
				}}
				onPointerDown={e => e.stopPropagation()}
			>
				<span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>z =</span>
				{isEditing ? (
					<input
						value={editExpr}
						onChange={e => setEditExpr(e.target.value)}
						onKeyDown={handleExprKeyDown}
						style={{
							background: 'transparent',
							border: 'none',
							outline: 'none',
							color: '#e2e8f0',
							fontSize: 13,
							fontFamily: 'monospace',
							minWidth: 120,
						}}
					/>
				) : (
					<span style={{ color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace' }}>
						{expression}
					</span>
				)}
			</div>

			{/* Matrix 3D info panel */}
			{boundMatrix && (() => {
				const det = det3(boundMatrix)
				const tr = trace3(boundMatrix)
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
						<span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e2e8f0' }}>
							det = {+det.toFixed(4)}
						</span>
						<span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e2e8f0' }}>
							tr = {+tr.toFixed(4)}
						</span>
						<span style={{ fontSize: 10, fontFamily: 'monospace', color: '#60a5fa' }}>e₁→ blue</span>
						<span style={{ fontSize: 10, fontFamily: 'monospace', color: '#34d399' }}>e₂→ green</span>
						<span style={{ fontSize: 10, fontFamily: 'monospace', color: '#f97316' }}>e₃→ orange</span>
					</div>
				)
			})()}

			{isEditing && (
				<div
					style={{
						position: 'absolute',
						top: 8,
						right: 8,
						color: '#64748b',
						fontSize: 10,
						pointerEvents: 'none',
					}}
				>
					{boundMatrix ? '3×3 matrix transform' : 'drag to rotate · scroll to zoom'}
				</div>
			)}
		</div>
	)
}

// ── Shape util ────────────────────────────────────────────────────────────────
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
				style={{ width: '100%', height: '100%', pointerEvents: isEditing ? 'all' : 'none' }}
			>
				<Graph3dRenderer shape={shape} isEditing={isEditing} />
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
