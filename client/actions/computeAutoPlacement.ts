import { Box, Editor } from 'tldraw'
import { ContextItem } from '../../shared/types/ContextItem'

/**
 * Compute the bounding box that covers all provided context items.
 * Context items are in canvas (absolute) space.
 */
function getContextBounds(editor: Editor, items: ContextItem[]): Box | null {
	const boxes: Box[] = []

	for (const item of items) {
		switch (item.type) {
			case 'area': {
				boxes.push(new Box(item.bounds.x, item.bounds.y, item.bounds.w, item.bounds.h))
				break
			}
			case 'shape': {
				const shape = item.shape
				if ('x' in shape && shape.x !== undefined && 'y' in shape && shape.y !== undefined) {
					const w = ('w' in shape ? (shape as any).w : undefined) ?? 100
					const h = ('h' in shape ? (shape as any).h : undefined) ?? 100
					boxes.push(new Box(shape.x, shape.y, w, h))
				}
				break
			}
			case 'shapes': {
				for (const shape of item.shapes) {
					if ('x' in shape && shape.x !== undefined && 'y' in shape && shape.y !== undefined) {
						const w = ('w' in shape ? (shape as any).w : undefined) ?? 100
						const h = ('h' in shape ? (shape as any).h : undefined) ?? 100
						boxes.push(new Box(shape.x, shape.y, w, h))
					}
				}
				break
			}
			case 'point': {
				boxes.push(new Box(item.point.x, item.point.y, 0, 0))
				break
			}
		}
	}

	if (boxes.length === 0) return null

	// Try to look up the actual tldraw shape bounds via the editor for better accuracy
	const shapeBounds = items
		.filter((i) => i.type === 'shape' || i.type === 'shapes')
		.flatMap((i) => {
			if (i.type === 'shape') {
				const id = `shape:${(i.shape as any).shapeId}` as any
				return id ? [editor.getShapePageBounds(id)].filter(Boolean) : []
			}
			if (i.type === 'shapes') {
				return i.shapes
					.map((s) => {
						const id = `shape:${(s as any).shapeId}` as any
						return id ? editor.getShapePageBounds(id) : null
					})
					.filter(Boolean)
			}
			return []
		})

	if (shapeBounds.length > 0) {
		return Box.Common(shapeBounds as Box[])
	}

	return Box.Common(boxes)
}

/**
 * Compute canvas-space (absolute) x/y coordinates for a new shape that has
 * no position specified by the AI.
 *
 * Placement priority:
 *  1. To the right of the union bounding box of all context items
 *  2. To the right of the current selection bounding box
 *  3. Centred in the current viewport
 */
export function computeAutoPlacement(
	editor: Editor,
	contextItems: ContextItem[],
	shapeW = 100,
	shapeH = 100,
	gap = 48
): { x: number; y: number } {
	// 1. Context items
	if (contextItems.length > 0) {
		const ctxBounds = getContextBounds(editor, contextItems)
		if (ctxBounds) {
			return {
				x: ctxBounds.maxX + gap,
				y: ctxBounds.midY - shapeH / 2,
			}
		}
	}

	// 2. Selection
	const selBounds = editor.getSelectionRotatedPageBounds()
	if (selBounds) {
		return {
			x: selBounds.maxX + gap,
			y: selBounds.midY - shapeH / 2,
		}
	}

	// 3. Viewport centre
	const vp = editor.getViewportPageBounds()
	return {
		x: vp.midX - shapeW / 2,
		y: vp.midY - shapeH / 2,
	}
}
