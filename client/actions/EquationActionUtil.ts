import { createShapeId } from 'tldraw'
import { EquationAction } from '../../shared/schema/AgentActionSchemas'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil } from './AgentActionUtil'
import { IEquationShape } from '../shapes/equation/EquationShape'

import { Streaming } from '../../shared/types/Streaming'
import { computeAutoPlacement } from './computeAutoPlacement'

export class EquationActionUtil extends AgentActionUtil<EquationAction> {
	static override type = 'equation' as const

	override sanitizeAction(action: Streaming<EquationAction>): Streaming<EquationAction> | null {
		return {
			...action,
			// x/y left undefined if not provided — applyAction handles fallback via auto-placement
			x: typeof action.x === 'number' ? action.x : undefined,
			y: typeof action.y === 'number' ? action.y : undefined,
			latex: action.latex || '',
		}
	}

	override applyAction(action: Streaming<EquationAction>, helpers: AgentHelpers) {
		const shapeId = createShapeId()

		// Default size — the shape auto-resizes to fit KaTeX rendering
		const width = 300
		const height = 100

		let position: { x: number; y: number }

		if (typeof action.x === 'number' && typeof action.y === 'number') {
			// AI provided explicit coordinates — convert from model space to canvas space
			position = helpers.removeOffsetFromVec({ x: action.x, y: action.y })
		} else {
			// Auto-place near context (Claude Code style: AI decides WHAT, client decides WHERE)
			const contextItems = helpers.agent.context.getItems()
			position = computeAutoPlacement(this.editor, contextItems, width, height)
		}

		this.editor.createShape<IEquationShape>({
			id: shapeId,
			type: 'equation',
			x: position.x - width / 2,
			y: position.y - height / 2,
			props: {
				latex: action.latex || '',
				w: width,
				h: height,
				fontSize: 24,
				color: 'text',
			},
		})
	}
}
