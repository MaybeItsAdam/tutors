import { createShapeId } from 'tldraw'
import { EquationAction } from '../../shared/schema/AgentActionSchemas'
import { SimpleShapeId } from '../../shared/types/ids-schema'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'
import { IEquationShape } from '../shapes/equation/EquationShape'

import { Streaming } from '../../shared/types/Streaming'

export const EquationActionUtil = registerActionUtil(
	class EquationActionUtil extends AgentActionUtil<EquationAction> {
		static override type = 'equation' as const

		override getInfo(action: Streaming<EquationAction>) {
			return {
				icon: 'pencil' as const,
				description: action.intent ?? '',
			}
		}

		override sanitizeAction(
			action: Streaming<EquationAction>,
			helpers: AgentHelpers
		): Streaming<EquationAction> | null {
			if (!action.complete) return action

			return {
				...action,
				shapeId: helpers.ensureShapeIdIsUnique(action.shapeId ?? ('equation' as SimpleShapeId)),
				x: typeof action.x === 'number' ? action.x : 0,
				y: typeof action.y === 'number' ? action.y : 0,
				latex: action.latex || '',
			}
		}

		override applyAction(action: Streaming<EquationAction>, helpers: AgentHelpers) {
			// Only create the shape once the action has fully streamed - creating
			// per-chunk would re-render KaTeX on every delta for no benefit.
			if (!action.complete) return

			const shapeId = createShapeId(action.shapeId)

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
)
