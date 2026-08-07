import { Box } from 'tldraw'
import { CanvasLintsPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const CanvasLintsPartUtil = registerPromptPartUtil(
	class CanvasLintsPartUtil extends PromptPartUtil<CanvasLintsPart> {
		static override type = 'canvasLints' as const

		override getPart(request: AgentRequest, _helpers: AgentHelpers): CanvasLintsPart {
			const { editor, agent } = this
			if (!editor) return { type: 'canvasLints', lints: [] }

			const shapes = editor.getCurrentPageShapesSorted()
			const contextBoundsBox = Box.From(request.bounds)
			const shapesInBounds = shapes.filter((shape) => {
				const bounds = editor.getShapeMaskedPageBounds(shape)
				if (!bounds) return false
				return contextBoundsBox.includes(bounds)
			})

			// Use created shapes when in working mode, otherwise use shapes in request bounds
			const shapesToCheck =
				agent.mode.getCurrentModeType() === 'working'
					? agent.lints.getCreatedShapes()
					: shapesInBounds

			return {
				type: 'canvasLints',
				lints: agent.lints.getUnsurfacedLintsForShapes(shapesToCheck),
			}
		}

		override commitPart(part: CanvasLintsPart): void {
			// Marking at build time lost the lints on failed/cancelled requests
			// - the model never saw them, but they'd never be surfaced again.
			// The mark is key-based, so re-passing the same lint objects is safe.
			this.agent.lints.markLintsAsSurfaced(part.lints)
		}
	}
)
