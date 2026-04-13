import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useBottomPanel, usePortalTarget } from './PanelLayoutContext'
import {
	dispatchGraph3dControl,
	GRAPH3D_ORIENTATION_EVENT,
	type Graph3dControlAction,
	type Graph3dOrientationEventDetail,
} from '../../shapes/graph3d/Graph3dControlEvents'

const GIMBAL_PANEL_WIDTH = 236
const GIMBAL_AXIS_RADIUS = 44

export function Graph3dGimbalPanel() {
	const editor = useEditor()
	const portalTarget = usePortalTarget()

	const selectedGraph3dId = useValue('selected-graph3d-shape', () => {
		const selectedIds = editor.getSelectedShapeIds()
		if (selectedIds.length !== 1) return null
		const selected = editor.getShape(selectedIds[0])
		return selected?.type === 'graph3d' ? selected.id : null
	}, [editor])
	const hasAnySelection = useValue('any-selection', () => editor.getSelectedShapeIds().length > 0, [editor])
	const [lastGraph3dId, setLastGraph3dId] = useState<string | null>(null)
	const gimbalRef = useRef<HTMLDivElement>(null)
	const dragStateRef = useRef<{
		pointerId: number
		lastX: number
		lastY: number
		startX: number
		startY: number
		dragging: boolean
		snapAction?: Graph3dControlAction
	} | null>(null)
	const [axes, setAxes] = useState({
		x: { x: 1, y: 0, z: 0 },
		y: { x: 0, y: 1, z: 0 },
		z: { x: 0, y: 0, z: 1 },
	})

	const { style, onDragStart, setVisible } = useBottomPanel({
		id: 'gimbal',
		width: GIMBAL_PANEL_WIDTH,
		defaultSide: 'right',
	})
	const panelShapeId = selectedGraph3dId ?? (hasAnySelection ? null : lastGraph3dId)

	useEffect(() => {
		if (selectedGraph3dId) setLastGraph3dId(selectedGraph3dId)
	}, [selectedGraph3dId])

	useEffect(() => {
		setVisible(!!panelShapeId)
	}, [panelShapeId, setVisible])

	useEffect(() => {
		dragStateRef.current = null
	}, [panelShapeId])

	useEffect(() => {
		const handleOrientation = (event: Event) => {
			const detail = (event as CustomEvent<Graph3dOrientationEventDetail>).detail
			if (!panelShapeId || !detail || detail.shapeId !== panelShapeId) return
			setAxes(detail.axes)
		}
		window.addEventListener(GRAPH3D_ORIENTATION_EVENT, handleOrientation as EventListener)
		return () => {
			window.removeEventListener(GRAPH3D_ORIENTATION_EVENT, handleOrientation as EventListener)
		}
	}, [panelShapeId])

	if (!panelShapeId || !portalTarget) return null

	const trigger = (action: Graph3dControlAction) => {
		editor.select(panelShapeId)
		dispatchGraph3dControl({ shapeId: panelShapeId, action })
	}
	const toScreen = (v: { x: number; y: number; z: number }) => ({
		x: v.x * GIMBAL_AXIS_RADIUS,
		y: -v.y * GIMBAL_AXIS_RADIUS,
		z: v.z,
	})
	const xAxis = toScreen(axes.x)
	const yAxis = toScreen(axes.y)
	const zAxis = toScreen(axes.z)
	const axisLineStyle = (v: { x: number; y: number }) => ({
		width: `${Math.max(16, Math.hypot(v.x, v.y))}px`,
		transform: `translate(-1px, -1px) rotate(${(Math.atan2(v.y, v.x) * 180) / Math.PI}deg)`,
	})
	const axisNodeStyle = (v: { x: number; y: number; z: number }, isPositive = true) => {
		const scale = isPositive ? 1 + Math.max(-0.2, v.z * 0.2) : 0.7
		const x = isPositive ? v.x : -v.x
		const y = isPositive ? v.y : -v.y
		return {
			transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`,
			zIndex: isPositive ? 4 + Math.round(v.z * 3) : 1,
		}
	}

	return createPortal(
		<div
			className="tl-theme__light hud-panel graph3d-gimbal-panel"
			style={style}
			onPointerDownCapture={(e) => {
				e.stopPropagation()
				editor.select(panelShapeId)
			}}
		>
			<div
				className="panel-drag-handle"
				onPointerDown={(e) => {
					e.stopPropagation()
					editor.select(panelShapeId)
					onDragStart(e)
				}}
			>
				<div className="panel-drag-pill" />
			</div>
			<div className="graph3d-gimbal-panel__body">
				<div className="graph3d-gimbal-panel__title">3D Controls</div>
				<div
					ref={gimbalRef}
					className="graph3d-gimbal graph3d-gizmo"
					onPointerDown={(e) => {
						e.stopPropagation()
						editor.select(panelShapeId)
						const snapAction = (e.target as Element)
							.closest<HTMLButtonElement>('[data-axis-action]')
							?.dataset.axisAction as Graph3dControlAction | undefined
						dragStateRef.current = {
							pointerId: e.pointerId,
							lastX: e.clientX,
							lastY: e.clientY,
							startX: e.clientX,
							startY: e.clientY,
							dragging: false,
							snapAction,
						}
						;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
					}}
					onPointerMove={(e) => {
						e.stopPropagation()
						if (!dragStateRef.current || dragStateRef.current.pointerId !== e.pointerId) return
						const movement = Math.hypot(e.clientX - dragStateRef.current.startX, e.clientY - dragStateRef.current.startY)
						if (!dragStateRef.current.dragging && movement > 4) {
							dragStateRef.current.dragging = true
						}
						if (!dragStateRef.current.dragging) return
						const dx = (e.clientX - dragStateRef.current.lastX) / 24
						const dy = (e.clientY - dragStateRef.current.lastY) / 24
						dragStateRef.current.lastX = e.clientX
						dragStateRef.current.lastY = e.clientY
						dispatchGraph3dControl({ shapeId: panelShapeId, action: 'orbit-delta', dx, dy })
					}}
					onPointerUp={(e) => {
						e.stopPropagation()
						if (!dragStateRef.current || dragStateRef.current.pointerId !== e.pointerId) return
						if (!dragStateRef.current.dragging && dragStateRef.current.snapAction) {
							trigger(dragStateRef.current.snapAction)
						}
						dragStateRef.current = null
					}}
					onPointerCancel={(e) => {
						e.stopPropagation()
						if (!dragStateRef.current || dragStateRef.current.pointerId !== e.pointerId) return
						dragStateRef.current = null
					}}
				>
					<div className="graph3d-gizmo__axis graph3d-gizmo__axis--x" style={axisLineStyle(xAxis)} />
					<div className="graph3d-gizmo__axis graph3d-gizmo__axis--y" style={axisLineStyle(yAxis)} />
					<div className="graph3d-gizmo__axis graph3d-gizmo__axis--z" style={axisLineStyle(zAxis)} />
					<button
						type="button"
						className="graph3d-gizmo__node graph3d-gizmo__node--x"
						data-axis-action="right"
						style={axisNodeStyle(xAxis)}
					>
						X
					</button>
					<button
						type="button"
						className="graph3d-gizmo__node graph3d-gizmo__node--y"
						data-axis-action="top"
						style={axisNodeStyle(yAxis)}
					>
						Y
					</button>
					<button
						type="button"
						className="graph3d-gizmo__node graph3d-gizmo__node--z"
						data-axis-action="front"
						style={axisNodeStyle(zAxis)}
					>
						Z
					</button>
					<div className="graph3d-gizmo__node graph3d-gizmo__node--x-neg" style={axisNodeStyle(xAxis, false)} />
					<div className="graph3d-gizmo__node graph3d-gizmo__node--y-neg" style={axisNodeStyle(yAxis, false)} />
					<div className="graph3d-gizmo__node graph3d-gizmo__node--z-neg" style={axisNodeStyle(zAxis, false)} />
					<div className="graph3d-gizmo__core" />
				</div>
				<div className="graph3d-gimbal-panel__zoom">
					<button
						type="button"
						className="graph3d-gimbal-panel__btn"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => trigger('reset')}
					>
						Reset
					</button>
					<button
						type="button"
						className="graph3d-gimbal-panel__btn"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => trigger('zoom-out')}
					>
						−
					</button>
					<span className="graph3d-gimbal-panel__zoom-label">Zoom</span>
					<button
						type="button"
						className="graph3d-gimbal-panel__btn"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => trigger('zoom-in')}
					>
						+
					</button>
				</div>
			</div>
		</div>,
		portalTarget
	)
}
