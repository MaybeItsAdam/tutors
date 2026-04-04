import { createShapeId, useEditor, useValue } from 'tldraw'
import { IEquationShape } from '../shapes/equation/EquationShape'
import { latexToMathjs } from '../utils/latexToMathjs'

/**
 * Floating "Plot Graph" button that appears above the selection when
 * exactly one EquationShape is selected. Clicking it spawns a GraphShape
 * pre-populated with the equation's LaTeX, positioned to the right.
 */
export function PlotGraphButton() {
	const editor = useEditor()

	// useValue makes this reactive to pan, zoom, and selection changes
	const state = useValue('plot-graph-button', () => {
		// Never show while any shape is being edited — avoids covering the MathLive field
		if (editor.getEditingShapeId() !== null) return null

		const selectedShapes = editor.getSelectedShapes()
		if (selectedShapes.length !== 1) return null
		const shape = selectedShapes[0]
		if (shape.type !== 'equation') return null
		const eq = shape as IEquationShape
		const latex = eq.props.latex?.trim()
		if (!latex) return null

		const bounds = editor.getSelectionRotatedPageBounds()
		if (!bounds) return null
		// Centre of the top edge in screen space
		const screenMidTop = editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y })
		
		// Spawn position: to the right of the equation in page space
		const spawnPageX = bounds.x + bounds.w + 40
		const spawnPageY = bounds.y + bounds.h / 2 - 180

		return { screenMidTop, spawnPageX, spawnPageY, eq, latex }
	}, [editor])

	if (!state) return null
	const { screenMidTop, spawnPageX, spawnPageY, eq, latex } = state

	const handleClick = () => {
		const graphId = createShapeId()
		const arrowId = createShapeId()

		editor.markHistoryStoppingPoint('plot graph from equation')

		// 1. Create the graph
		editor.createShape({
			id: graphId,
			// @ts-expect-error — custom shape type
			type: 'graph',
			x: spawnPageX,
			y: spawnPageY,
			props: {
				functionStr: latexToMathjs(latex),
			},
		})

		// 2. Create the arrow shape (coordinates will be overridden by bindings)
		editor.createShape({
			id: arrowId,
			type: 'arrow',
			x: 0,
			y: 0,
			props: {
				start: { x: 0, y: 0 },
				end: { x: 10, y: 10 },
			},
		})

		// 3. Bind start → equation (right edge), end → graph (left edge)
		//    tldraw's binding system keeps these connected when shapes move.
		editor.createBinding({
			type: 'arrow',
			fromId: arrowId,
			toId: eq.id,
			props: {
				terminal: 'start',
				normalizedAnchor: { x: 1, y: 0.5 },
				isExact: false,
				isPrecise: false,
			},
		})

		editor.createBinding({
			type: 'arrow',
			fromId: arrowId,
			toId: graphId,
			props: {
				terminal: 'end',
				normalizedAnchor: { x: 0, y: 0.5 },
				isExact: false,
				isPrecise: false,
			},
		})

		editor.select(graphId)
	}

	return (
		<div
			style={{
				position: 'absolute',
				left: screenMidTop.x,
				top: screenMidTop.y - 44,
				transform: 'translateX(-50%)',
				zIndex: 99999,
				pointerEvents: 'all',
			}}
		>
			<button
				onPointerDown={(e) => e.stopPropagation()}
				onClick={handleClick}
				title="Plot this equation as a graph"
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					padding: '5px 12px',
					borderRadius: 8,
					border: '1px solid rgba(96,165,250,0.5)',
					background: 'rgba(15,23,42,0.88)',
					backdropFilter: 'blur(8px)',
					color: '#60a5fa',
					fontSize: 12,
					fontFamily: "'Inter', sans-serif",
					fontWeight: 600,
					cursor: 'pointer',
					boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
					whiteSpace: 'nowrap',
					transition: 'background 0.15s',
				}}
				onMouseEnter={(e) => {
					;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(30,58,138,0.88)'
				}}
				onMouseLeave={(e) => {
					;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(15,23,42,0.88)'
				}}
			>
				<span style={{ fontSize: 14 }}>📈</span>
				Plot Graph
			</button>
		</div>
	)
}
