import { createShapeId } from 'tldraw'
import { EquationAction } from '../../shared/schema/AgentActionSchemas'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil } from './AgentActionUtil'
import { IEquationShape } from '../shapes/equation/EquationShape'

import { Streaming } from '../../shared/types/Streaming'

export class EquationActionUtil extends AgentActionUtil<EquationAction> {
	static override type = 'equation' as const

	override sanitizeAction(action: Streaming<EquationAction>): Streaming<EquationAction> | null {
		return {
			...action,
			x: typeof action.x === 'number' ? action.x : 0,
			y: typeof action.y === 'number' ? action.y : 0,
			latex: action.latex || '',
		}
	}

	override applyAction(action: Streaming<EquationAction>, helpers: AgentHelpers) {
		const shapeId = createShapeId()
		
		const x = typeof action.x === 'number' ? action.x : 0
		const y = typeof action.y === 'number' ? action.y : 0

		// Revert the offset so coordinates map to absolute canvas position
		const position = helpers.removeOffsetFromVec({ x, y })

		// Default size; the shape uses auto-resize so it will adjust to KaTeX rendering
		const width = 300
		const height = 100

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
