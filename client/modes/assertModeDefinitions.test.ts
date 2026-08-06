import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../../shared/types/AgentAction'
import type { PromptPart } from '../../shared/types/PromptPart'
import { AGENT_MODE_DEFINITIONS } from './AgentModeDefinitions'
import type { AgentModeDefinition } from './AgentModeDefinitions'
import { assertModeDefinitions } from './assertModeDefinitions'

describe('assertModeDefinitions', () => {
	// Importing AgentModeDefinitions above registers every action/part util and
	// already runs this assertion at module load, so a regression would fail
	// this whole file at import time. The explicit test keeps the C1 guard
	// visible and gives it a name in the test output.
	it('accepts the real mode definitions', () => {
		expect(() => assertModeDefinitions(AGENT_MODE_DEFINITIONS)).not.toThrow()
	})

	it('rejects an active mode listing an unregistered action, naming the action', () => {
		const mode: AgentModeDefinition = {
			type: 'fabricated',
			active: true,
			parts: [],
			actions: ['not-a-real-action' as AgentAction['_type']],
		}
		expect(() => assertModeDefinitions([mode])).toThrow(/not-a-real-action/)
	})

	it('rejects an active mode listing an unregistered prompt part, naming the part', () => {
		const mode: AgentModeDefinition = {
			type: 'fabricated',
			active: true,
			parts: ['not-a-real-part' as PromptPart['type']],
			actions: [],
		}
		expect(() => assertModeDefinitions([mode])).toThrow(/not-a-real-part/)
	})

	it('skips inactive modes entirely', () => {
		expect(() => assertModeDefinitions([{ type: 'dormant', active: false }])).not.toThrow()
	})
})
