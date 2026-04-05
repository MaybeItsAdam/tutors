import { createPortal } from 'react-dom'
import { DefaultStylePanel, useEditor, useValue } from 'tldraw'
import { useEffect } from 'react'
import { useBottomPanel, usePortalTarget } from './PanelLayoutContext'

const STYLE_PANEL_WIDTH = 184

/**
 * Bottom-docked style panel that portals out of tldraw's DOM
 * into the shared HUD layer. Matches the chat bar's visual style.
 *
 * Must be rendered inside tldraw's component tree (e.g. Overlays)
 * so that useEditor() and tldraw's internal hooks work.
 */
export function LayoutAwareStylePanel() {
	const editor = useEditor()
	const portalTarget = usePortalTarget()

	const hasSelection = useValue(
		'hasSelection',
		() => editor.getSelectedShapeIds().length > 0,
		[editor]
	)

	const { style, onDragStart, setVisible } = useBottomPanel({
		id: 'style',
		width: STYLE_PANEL_WIDTH,
		defaultSide: 'right',
	})

	useEffect(() => {
		setVisible(hasSelection)
	}, [hasSelection, setVisible])

	if (!hasSelection || !portalTarget) return null

	return createPortal(
		<div
			className="tl-theme__light hud-panel"
			data-panel-id="style"
			style={style}
		>
			<div className="panel-drag-handle" onPointerDown={onDragStart}>
				<div className="panel-drag-pill" />
			</div>
			<DefaultStylePanel />
		</div>,
		portalTarget
	)
}
