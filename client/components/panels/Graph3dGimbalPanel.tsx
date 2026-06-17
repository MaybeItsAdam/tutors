import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useBottomPanel, usePortalTarget } from './PanelLayoutContext'
import {
	dispatchGraph3dControl,
	type Graph3dControlAction,
} from '../../shapes/graph3d/Graph3dControlEvents'
import { Graph3dGizmo3D } from '../../shapes/graph3d/Graph3dGizmo3D'

const GIMBAL_PANEL_WIDTH = 200

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

	if (!panelShapeId || !portalTarget) return null

	const trigger = (action: Graph3dControlAction) => {
		editor.select(panelShapeId)
		dispatchGraph3dControl({ shapeId: panelShapeId, action })
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
				<Graph3dGizmo3D shapeId={panelShapeId} onTrigger={trigger} />
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
