import { useMemo } from 'react'
import { TLShapeId, useEditor, useValue } from 'tldraw'
import { TldrawAgent } from '../../agent/TldrawAgent'
import { useAgents } from '../../agent/TldrawAgentAppProvider'
import { AreaHighlight, AreaHighlightProps } from './AreaHighlight'
import { PointHighlight, PointHighlightProps } from './PointHighlight'

/**
 * Renders context highlights for all agents.
 */
export function AllContextHighlights() {
	const agents = useAgents()

	return (
		<>
			{agents.map((agent) => (
				<ContextHighlights key={agent.id} agent={agent} />
			))}
		</>
	)
}

/**
 * Derives all area and point highlights from a list of context items.
 */
function deriveHighlights(
	editor: ReturnType<typeof useEditor>,
	contextItems: ReturnType<TldrawAgent['context']['getItems']>,
	generating: boolean
) {
	const areas: AreaHighlightProps[] = []
	const points: PointHighlightProps[] = []

	for (const item of contextItems) {
		switch (item.type) {
			case 'area':
				areas.push({
					pageBounds: item.bounds,
					generating,
					color: 'var(--tl-color-selected)',
					label: generating && item.source === 'agent' ? 'Reviewing' : undefined,
				})
				break
			case 'shapes': {
				const bounds = editor.getShapesPageBounds(
					item.shapes.map((shape) => `shape:${shape.shapeId}` as TLShapeId)
				)
				if (bounds) {
					areas.push({ pageBounds: bounds, generating, color: 'var(--tl-color-selected)' })
				}
				break
			}
			case 'shape': {
				const bounds = editor.getShapePageBounds(`shape:${item.shape.shapeId}` as TLShapeId)
				if (bounds) {
					areas.push({ pageBounds: bounds, generating, color: 'var(--tl-color-selected)' })
				}
				break
			}
			case 'point':
				points.push({
					pagePoint: item.point,
					generating,
					color: 'var(--tl-color-selected)',
				})
				break
		}
	}

	return { areas, points }
}

/**
 * Renders context highlights for a single agent.
 */
export function ContextHighlights({ agent }: { agent: TldrawAgent }) {
	const editor = useEditor()

	const selectedContextItems = useValue(
		'contextItems',
		() => (agent.requests.isGenerating() ? [] : agent.context.getItems()),
		[agent]
	)
	const activeContextItems = useValue(
		'activeContextItems',
		() => agent.requests.getActiveRequest()?.contextItems ?? [],
		[agent]
	)

	const selected = useMemo(
		() => deriveHighlights(editor, selectedContextItems, false),
		[editor, selectedContextItems]
	)
	const active = useMemo(
		() => deriveHighlights(editor, activeContextItems, true),
		[editor, activeContextItems]
	)

	const allAreas = useMemo(
		() => [...selected.areas, ...active.areas],
		[selected.areas, active.areas]
	)
	const allPoints = useMemo(
		() => [...selected.points, ...active.points],
		[selected.points, active.points]
	)

	return (
		<>
			{allAreas.map((highlight, i) => (
				<AreaHighlight
					key={'context-highlight-' + i}
					pageBounds={highlight.pageBounds}
					color={highlight.color}
					generating={highlight.generating}
					label={highlight.label}
				/>
			))}

			{allPoints.map((highlight, i) => (
				<PointHighlight
					key={'context-point-' + i}
					pagePoint={highlight.pagePoint}
					color={highlight.color}
					generating={highlight.generating}
				/>
			))}
		</>
	)
}
