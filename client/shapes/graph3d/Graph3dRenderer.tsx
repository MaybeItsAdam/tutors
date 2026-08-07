import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { compile } from 'mathjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, useEditor, useValue } from 'tldraw'
import { graph3dShapeProps, IGraph3dShape } from './Graph3dShape'
import { IEquationShape } from '../equation/EquationShape'
import { matrixFromLatex, apply3, det3, trace3 } from '../../utils/matrixFromLatex'
import { latexToMathjsLines } from '../../utils/latexToMathjs'
import { dispatchGraph3dOrientation, GRAPH3D_CONTROL_EVENT, Graph3dControlEventDetail } from './Graph3dControlEvents'

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

	// Loop rather than Math.min(...spread): zValues has (resolution+1)^2 entries
	// and resolution is a model-settable shape prop, so a spread can overflow
	// the JS argument limit.
	let zMin2 = Infinity
	let zMax2 = -Infinity
	for (const z of zValues) {
		if (z < zMin2) zMin2 = z
		if (z > zMax2) zMax2 = z
	}
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

function normalizeSurfaceExpression(expr: string) {
	const trimmed = expr.trim()
	if (!trimmed) return ''
	const equalsIndex = trimmed.indexOf('=')
	if (equalsIndex === -1) return trimmed
	return trimmed.slice(equalsIndex + 1).trim()
}

// ── Three.js renderer component ───────────────────────────────────────────────
export default function Graph3dRenderer({
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
	const matrixArrowsRef = useRef<THREE.ArrowHelper[]>([])
	const rafRef = useRef<number>(0)
	// Schedules a single render frame; set up by the mount effect. Every
	// effect that changes what's on screen calls this instead of relying on a
	// permanent 60fps loop.
	const invalidateRef = useRef<() => void>(() => {})

	const [editExpr, setEditExpr] = useState(expression)

	const isSelected = useValue('graph3d-selected', () => {
		return editor.getSelectedShapeIds().includes(shape.id)
	}, [editor, shape.id])

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
	const boundExpression = useValue('bound-equation-3d-expression', () => {
		const incomingBindings = editor.getBindingsToShape(shape.id, 'arrow')
		for (const binding of incomingBindings) {
			if (binding.props.terminal !== 'end') continue
			const startBindings = editor.getBindingsFromShape(binding.fromId, 'arrow')
			for (const startB of startBindings) {
				if (startB.props.terminal !== 'start') continue
				const srcShape = editor.getShape(startB.toId)
				if (!srcShape || srcShape.type !== 'equation') continue
				const latex = (srcShape as IEquationShape).props.latex?.trim()
				if (!latex) continue
				const maybeMatrix = matrixFromLatex(latex)
				if (maybeMatrix && maybeMatrix.length === 3 && maybeMatrix[0].length === 3) continue
				const lines = latexToMathjsLines(latex)
				for (const line of lines) {
					const normalized = normalizeSurfaceExpression(line)
					if (normalized) return normalized
				}
			}
		}
		return null
	}, [editor, shape.id])
	const activeExpression = boundExpression ?? expression
	const canOrbit = isEditing || isSelected

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

		// Orbit controls (enabled when selected/editing)
		const controls = new OrbitControls(camera, canvas)
		controls.enableDamping = true
		controls.dampingFactor = 0.08
		controls.enablePan = false
		controls.mouseButtons = {
			// null disables the button (MOUSE.NONE does not exist in three)
			LEFT: null,
			MIDDLE: THREE.MOUSE.DOLLY,
			RIGHT: THREE.MOUSE.ROTATE,
		}
		controls.enabled = false
		controlsRef.current = controls

		// Axes helper
		const axesLen = Math.max(xMax - xMin, yMax - yMin) * 0.5
		const axesHelper = new THREE.AxesHelper(axesLen)
		scene.add(axesHelper)

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

		// ── Render on demand ──
		// The previous version ran an unconditional 60fps rAF loop from mount,
		// dispatching a window CustomEvent per frame - N shapes meant N
		// permanent loops, even off-screen with nothing changing. Now a frame
		// renders only when something invalidates (controls, effects), it
		// self-continues only while OrbitControls damping is still settling,
		// and the orientation event fires only when the camera actually moved.
		let rafPending = false
		let visible = true
		const lastQuaternion = new THREE.Quaternion(NaN, NaN, NaN, NaN)

		const renderFrame = () => {
			rafPending = false
			const stillMoving = controls.update()
			if (!camera.quaternion.equals(lastQuaternion)) {
				lastQuaternion.copy(camera.quaternion)
				dispatchGraph3dOrientation({
					shapeId: shape.id,
					axes: {
						x: { x: 1, y: 0, z: 0 },
						y: { x: 0, y: 1, z: 0 },
						z: { x: 0, y: 0, z: 1 },
					},
					quaternion: {
						x: camera.quaternion.x,
						y: camera.quaternion.y,
						z: camera.quaternion.z,
						w: camera.quaternion.w,
					},
				})
			}
			renderer.render(scene, camera)
			if (stillMoving) invalidate()
		}

		const invalidate = () => {
			if (!visible || rafPending) return
			rafPending = true
			rafRef.current = requestAnimationFrame(renderFrame)
		}
		invalidateRef.current = invalidate

		const handleControlsChange = () => invalidate()
		controls.addEventListener('change', handleControlsChange)
		controls.addEventListener('start', handleControlsChange)

		// Pause entirely while scrolled out of view (same pattern as
		// TldrawViewer's IntersectionObserver-gated mounting).
		const intersectionObserver = new IntersectionObserver(([entry]) => {
			visible = entry?.isIntersecting ?? true
			if (visible) {
				invalidate()
			} else if (rafPending) {
				cancelAnimationFrame(rafRef.current)
				rafPending = false
			}
		})
		intersectionObserver.observe(canvas)

		invalidate()

		return () => {
			cancelAnimationFrame(rafRef.current)
			rafPending = false
			invalidateRef.current = () => {}
			intersectionObserver.disconnect()
			controls.removeEventListener('change', handleControlsChange)
			controls.removeEventListener('start', handleControlsChange)
			controls.dispose()
			// Dispose everything the mount owns (the surface mesh and matrix
			// arrows are owned - and disposed - by their own effects).
			axesHelper.dispose()
			gridHelper.dispose()
			renderer.dispose()
		}
		// Only run once on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// ── Update surface mesh when expression or bounds change ──
	// Skipped entirely in matrix mode - the surface is hidden there, and the
	// previous version still built (and then orphaned) a geometry for it.
	const geo = useMemo(
		() =>
			boundMatrix ? null : buildGeometry(activeExpression, xMin, xMax, yMin, yMax, resolution),
		[activeExpression, xMin, xMax, yMin, yMax, resolution, boundMatrix]
	)

	useEffect(() => {
		const scene = sceneRef.current
		if (!scene || !geo) return

		const material = new THREE.MeshPhongMaterial({
			vertexColors: true,
			side: THREE.DoubleSide,
			shininess: 30,
		})
		const mesh = new THREE.Mesh(geo, material)
		scene.add(mesh)

		// Wireframe overlay. This mesh used to be added and never tracked, so
		// every expression/bounds change stacked another wireframe permanently
		// (visual ghosting + GPU memory leak); materials were never disposed.
		const wfMat = new THREE.MeshBasicMaterial({
			color: 0x334155,
			wireframe: true,
			opacity: 0.12,
			transparent: true,
		})
		const wfMesh = new THREE.Mesh(geo, wfMat)
		scene.add(wfMesh)

		invalidateRef.current()

		return () => {
			scene.remove(mesh)
			scene.remove(wfMesh)
			material.dispose()
			wfMat.dispose()
			// The geometry is shared by the surface and the wireframe - one
			// dispose, in the effect that owns it.
			geo.dispose()
			invalidateRef.current()
		}
	}, [geo])

	// ── Matrix 3D visualization: transformed basis arrows ──
	useEffect(() => {
		const scene = sceneRef.current
		if (!scene) return

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

		invalidateRef.current()

		return () => {
			// ArrowHelper owns a line and a cone; dispose() releases both -
			// they used to be removed from the scene but never disposed.
			for (const arrow of matrixArrowsRef.current) {
				scene.remove(arrow)
				arrow.dispose()
			}
			matrixArrowsRef.current = []
			invalidateRef.current()
		}
	}, [boundMatrix, xMin, xMax, yMin, yMax])

	// ── Toggle orbit controls with edit mode ──
	useEffect(() => {
		if (controlsRef.current) {
			controlsRef.current.enabled = canOrbit
			invalidateRef.current()
		}
	}, [canOrbit])

	useEffect(() => {
		const handleControlEvent = (event: Event) => {
			const detail = (event as CustomEvent<Graph3dControlEventDetail>).detail
			if (!detail || detail.shapeId !== shape.id) return
			const camera = cameraRef.current
			const controls = controlsRef.current
			if (!camera || !controls) return

			const size = Math.max(xMax - xMin, yMax - yMin)
			const target = new THREE.Vector3(0, 0, 0)
			const setView = (x: number, y: number, z: number) => {
				camera.position.set(x, y, z)
				controls.target.copy(target)
				controls.update()
			}

			switch (detail.action) {
				case 'reset':
					setView(size * 0.8, size * 0.9, size * 0.8)
					break
				case 'top':
					setView(0, size * 1.45, 0.001)
					break
				case 'front':
					setView(0, size * 0.55, size * 1.35)
					break
				case 'right':
					setView(size * 1.35, size * 0.55, 0)
					break
				case 'left':
					setView(-size * 1.35, size * 0.55, 0)
					break
				case 'zoom-in':
				case 'zoom-out': {
					const factor = detail.action === 'zoom-in' ? 0.82 : 1.22
					const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor)
					camera.position.copy(controls.target.clone().add(offset))
					controls.update()
					break
				}
				case 'orbit-delta': {
					const dx = detail.dx ?? 0
					const dy = detail.dy ?? 0
					if (dx === 0 && dy === 0) break
					const offset = camera.position.clone().sub(controls.target)
					const spherical = new THREE.Spherical().setFromVector3(offset)
					spherical.theta -= dx * 0.09
					spherical.phi = Math.max(0.12, Math.min(Math.PI - 0.12, spherical.phi + dy * 0.09))
					offset.setFromSpherical(spherical)
					camera.position.copy(controls.target.clone().add(offset))
					controls.update()
					break
				}
			}

			invalidateRef.current()
		}

		window.addEventListener(GRAPH3D_CONTROL_EVENT, handleControlEvent as EventListener)
		return () => {
			window.removeEventListener(GRAPH3D_CONTROL_EVENT, handleControlEvent as EventListener)
		}
	}, [shape.id, xMax, xMin, yMax, yMin])

	// ── Resize renderer when shape dimensions change ──
	useEffect(() => {
		const renderer = rendererRef.current
		const camera = cameraRef.current
		if (!renderer || !camera) return
		renderer.setSize(w, h)
		camera.aspect = w / h
		camera.updateProjectionMatrix()
		invalidateRef.current()
	}, [w, h])

	const handleExprKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation()
		if (e.key === 'Enter') {
			const nextExpression = normalizeSurfaceExpression(editExpr) || expression
			if (nextExpression !== expression) {
				editor.updateShape({
					id: shape.id,
					type: 'graph3d',
					props: { expression: nextExpression },
				})
			}
			;(e.target as HTMLInputElement).blur()
		}
	}

	useEffect(() => {
		setEditExpr(expression)
	}, [expression])

	return (
		<div style={{ position: 'relative', width: w, height: h, userSelect: 'none' }}>
			<canvas
				ref={canvasRef}
				width={w}
				height={h}
				style={{ display: 'block', borderRadius: 6 }}
				onContextMenu={(e) => e.preventDefault()}
				onPointerDown={(e) => {
					if (e.button !== 0) e.stopPropagation()
				}}
				onPointerMove={(e) => {
					if ((e.buttons & 2) !== 0 || (e.buttons & 4) !== 0) e.stopPropagation()
				}}
				onWheel={(e) => e.stopPropagation()}
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
					pointerEvents: isEditing && !boundExpression && !boundMatrix ? 'all' : 'none',
				}}
				onPointerDown={e => e.stopPropagation()}
			>
				<span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>z =</span>
				{isEditing && !boundExpression && !boundMatrix ? (
					<input
						value={editExpr}
						onChange={e => setEditExpr(e.target.value)}
						onKeyDown={handleExprKeyDown}
						onBlur={() => {
							const nextExpression = normalizeSurfaceExpression(editExpr) || expression
							if (nextExpression !== expression) {
								editor.updateShape({
									id: shape.id,
									type: 'graph3d',
									props: { expression: nextExpression },
								})
							}
						}}
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
						{activeExpression}
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
					{boundMatrix
						? '3×3 matrix transform'
						: boundExpression
							? 'Driven by linked equation — edit the MathLive shape to update'
							: 'right-drag to rotate · wheel to zoom'}
				</div>
			)}
		</div>
	)
}

// ── Shape util ────────────────────────────────────────────────────────────────
