import { describe, expect, it } from 'vitest'
import { AGENT_MODE_DEFINITIONS } from '../modes/AgentModeDefinitions'
import { getSystemPromptFlags } from './getSystemPromptFlags'

const working = AGENT_MODE_DEFINITIONS.find((mode) => mode.type === 'working')
if (!working || !working.active) throw new Error('Expected an active "working" mode definition')

describe('getSystemPromptFlags', () => {
	it('derives the full flag set for the working mode', () => {
		expect(getSystemPromptFlags([...working.actions], [...working.parts])).toEqual({
			// Communication
			hasMessage: true,

			// Planning
			hasThink: true,
			hasReview: true,
			hasSetMyView: true,
			hasTodoList: true,
			hasAddDetail: true,

			// Maths
			hasEquation: true,
			hasPlot: true,

			// Individual shapes
			hasCreate: true,
			hasDelete: true,
			hasUpdate: true,
			hasLabel: true,
			hasMove: true,

			// Groups of shapes
			hasPlace: true,
			hasBringToFront: true,
			hasSendToBack: true,
			hasRotate: true,
			hasResize: true,
			hasAlign: true,
			hasDistribute: true,
			hasStack: true,
			// `clear` is deliberately excluded from the working mode: agent edits
			// bypass the undo stack, so a stray clear would be unrecoverable
			hasClear: false,

			// Drawing
			hasPen: true,

			// Request
			hasMessagesPart: true,
			hasDataPart: true,
			hasContextItemsPart: true,

			// Viewport
			hasScreenshotPart: true,
			hasUserViewportBoundsPart: true,
			hasAgentViewportBoundsPart: true,

			// Shapes
			hasBlurryShapesPart: true,
			hasPeripheralShapesPart: true,
			hasSelectedShapesPart: true,

			// History
			hasChatHistoryPart: true,
			hasUserActionHistoryPart: true,
			hasTodoListPart: true,

			// Lints
			hasCanvasLintsPart: true,

			// Metadata
			hasTimePart: true,

			// Derived
			canEdit: true,
		})
	})

	it('produces all-false flags for empty inputs', () => {
		const flags = getSystemPromptFlags([], [])
		expect(Object.values(flags).every((flag) => flag === false)).toBe(true)
	})

	it('only sets hasTodoList when both the action and the prompt part are enabled', () => {
		expect(getSystemPromptFlags(['update-todo-list'], []).hasTodoList).toBe(false)
		expect(getSystemPromptFlags([], ['todoList']).hasTodoList).toBe(false)
		expect(getSystemPromptFlags(['update-todo-list'], ['todoList']).hasTodoList).toBe(true)
	})

	it('derives canEdit from edit-category actions only', () => {
		expect(getSystemPromptFlags(['move'], []).canEdit).toBe(true)
		expect(getSystemPromptFlags(['message', 'think'], []).canEdit).toBe(false)
	})
})
