import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import {
	dispatchGraph3dControl,
	GRAPH3D_ORIENTATION_EVENT,
	type Graph3dControlAction,
	type Graph3dOrientationEventDetail,
} from './Graph3dControlEvents'

const SIZE = 132

function makeLabelTexture(text: string, bgHex: string): THREE.CanvasTexture {
	const c = document.createElement('canvas')
	c.width = 64
	c.height = 64
	const ctx = c.getContext('2d')!
	ctx.fillStyle = bgHex
	ctx.beginPath()
	ctx.arc(32, 32, 28, 0, Math.PI * 2)
	ctx.fill()
	ctx.strokeStyle = 'rgba(0,0,0,0.2)'
	ctx.lineWidth = 2
	ctx.stroke()
	ctx.fillStyle = '#fff'
	ctx.font = 'bold 26px sans-serif'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(text, 32, 33)
	return new THREE.CanvasTexture(c)
}

const AXES = [
	{ dir: new THREE.Vector3(1, 0, 0), bgHex: '#ef4444', threeColor: 0xef4444, label: 'X', action: 'right' as Graph3dControlAction },
	{ dir: new THREE.Vector3(0, 1, 0), bgHex: '#84cc16', threeColor: 0x84cc16, label: 'Y', action: 'top' as Graph3dControlAction },
	{ dir: new THREE.Vector3(0, 0, 1), bgHex: '#3b82f6', threeColor: 0x3b82f6, label: 'Z', action: 'front' as Graph3dControlAction },
]

const UP = new THREE.Vector3(0, 1, 0)

export function Graph3dGizmo3D({
	shapeId,
	onTrigger,
}: {
	shapeId: string
	onTrigger: (a: Graph3dControlAction) => void
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	// Refs so native event handlers always see current values without re-registering
	const shapeIdRef = useRef(shapeId)
	const onTriggerRef = useRef(onTrigger)
	shapeIdRef.current = shapeId
	onTriggerRef.current = onTrigger

	useEffect(() => {
		const canvas = canvasRef.current!

		// ── Three.js setup ────────────────────────────────────────────────────
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
		renderer.setSize(SIZE, SIZE)

		const scene = new THREE.Scene()
		const f = 1.7
		const camera = new THREE.OrthographicCamera(-f, f, f, -f, 0.1, 10)
		camera.position.set(0, 0, 3)

		const axesGroup = new THREE.Group()
		scene.add(axesGroup)

		const labelSprites: Array<{ sprite: THREE.Sprite; action: Graph3dControlAction }> = []
		const toDispose: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = []

		for (const { dir, bgHex, threeColor, label, action } of AXES) {
			const mat = new THREE.MeshBasicMaterial({ color: threeColor, depthTest: false })
			toDispose.push(mat)

			const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.78, 8)
			toDispose.push(shaftGeo)
			const shaft = new THREE.Mesh(shaftGeo, mat)
			shaft.position.copy(dir.clone().multiplyScalar(0.39))
			shaft.quaternion.setFromUnitVectors(UP, dir)
			axesGroup.add(shaft)

			const coneGeo = new THREE.ConeGeometry(0.12, 0.24, 8)
			toDispose.push(coneGeo)
			const cone = new THREE.Mesh(coneGeo, mat)
			cone.position.copy(dir.clone().multiplyScalar(0.78 + 0.12))
			cone.quaternion.setFromUnitVectors(UP, dir)
			axesGroup.add(cone)

			const negMat = new THREE.MeshBasicMaterial({ color: threeColor, depthTest: false, transparent: true, opacity: 0.3 })
			toDispose.push(negMat)
			const negGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8)
			toDispose.push(negGeo)
			const negStub = new THREE.Mesh(negGeo, negMat)
			negStub.position.copy(dir.clone().multiplyScalar(-0.225))
			negStub.quaternion.setFromUnitVectors(UP, dir)
			axesGroup.add(negStub)

			const tex = makeLabelTexture(label, bgHex)
			toDispose.push(tex)
			const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false })
			toDispose.push(spriteMat)
			const sprite = new THREE.Sprite(spriteMat)
			sprite.scale.set(0.38, 0.38, 0.38)
			sprite.position.copy(dir.clone().multiplyScalar(1.22))
			axesGroup.add(sprite)
			labelSprites.push({ sprite, action })
		}

		const raycaster = new THREE.Raycaster()
		let raf = 0
		const animate = () => {
			raf = requestAnimationFrame(animate)
			renderer.render(scene, camera)
		}
		animate()

		// ── Orientation sync (native listener, uses shapeIdRef) ───────────────
		const handleOrientation = (e: Event) => {
			const detail = (e as CustomEvent<Graph3dOrientationEventDetail>).detail
			if (!detail || detail.shapeId !== shapeIdRef.current) return
			const q = detail.quaternion
			axesGroup.quaternion.set(q.x, q.y, q.z, q.w).invert()
		}
		window.addEventListener(GRAPH3D_ORIENTATION_EVENT, handleOrientation as EventListener)

		// ── Pointer handling (native, bypasses React capture stopPropagation) ──
		const drag = { id: -1, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: false, active: false }

		const handleDown = (e: PointerEvent) => {
			e.stopPropagation()
			drag.id = e.pointerId
			drag.lastX = drag.startX = e.clientX
			drag.lastY = drag.startY = e.clientY
			drag.moved = false
			drag.active = true
			canvas.setPointerCapture(e.pointerId)
		}

		const handleMove = (e: PointerEvent) => {
			if (!drag.active || drag.id !== e.pointerId) return
			e.stopPropagation()
			if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true
			if (!drag.moved) return
			dispatchGraph3dControl({
				shapeId: shapeIdRef.current,
				action: 'orbit-delta',
				dx: (e.clientX - drag.lastX) / 24,
				dy: (e.clientY - drag.lastY) / 24,
			})
			drag.lastX = e.clientX
			drag.lastY = e.clientY
		}

		const handleUp = (e: PointerEvent) => {
			if (!drag.active || drag.id !== e.pointerId) return
			e.stopPropagation()
			if (!drag.moved) {
				const rect = canvas.getBoundingClientRect()
				const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1
				const my = -((e.clientY - rect.top) / rect.height) * 2 + 1
				raycaster.setFromCamera(new THREE.Vector2(mx, my), camera)
				const hits = raycaster.intersectObjects(labelSprites.map((l) => l.sprite))
				if (hits.length > 0) {
					const hit = labelSprites.find((l) => l.sprite === hits[0].object)
					if (hit) onTriggerRef.current(hit.action)
				}
			}
			drag.active = false
		}

		const handleCancel = (e: PointerEvent) => {
			if (drag.id === e.pointerId) drag.active = false
		}

		canvas.addEventListener('pointerdown', handleDown)
		canvas.addEventListener('pointermove', handleMove)
		canvas.addEventListener('pointerup', handleUp)
		canvas.addEventListener('pointercancel', handleCancel)

		return () => {
			cancelAnimationFrame(raf)
			canvas.removeEventListener('pointerdown', handleDown)
			canvas.removeEventListener('pointermove', handleMove)
			canvas.removeEventListener('pointerup', handleUp)
			canvas.removeEventListener('pointercancel', handleCancel)
			window.removeEventListener(GRAPH3D_ORIENTATION_EVENT, handleOrientation as EventListener)
			for (const obj of toDispose) obj.dispose()
			renderer.dispose()
		}
	}, []) // empty deps — changing values accessed via refs

	return (
		<canvas
			ref={canvasRef}
			width={SIZE}
			height={SIZE}
			style={{
				display: 'block',
				width: SIZE,
				height: SIZE,
				cursor: 'grab',
				borderRadius: '50%',
				border: '1px solid #d1d5db',
				background: 'radial-gradient(circle at center, #ffffff 20%, #f8fafc 100%)',
				touchAction: 'none',
			}}
		/>
	)
}
