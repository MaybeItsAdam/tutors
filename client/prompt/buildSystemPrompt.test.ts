import { describe, expect, it } from 'vitest'
// Importing the mode definitions registers every action schema.
import { AGENT_MODE_DEFINITIONS } from '../modes/AgentModeDefinitions'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { buildSystemPrompt } from './buildSystemPrompt'

const workingMode = AGENT_MODE_DEFINITIONS.find(
	(mode): mode is Extract<(typeof AGENT_MODE_DEFINITIONS)[number], { active: true }> =>
		mode.type === 'working'
)!

function makePrompt(): AgentPrompt {
	return {
		mode: {
			type: 'mode',
			modeType: workingMode.type,
			partTypes: [...workingMode.parts],
			actionTypes: [...workingMode.actions],
		},
	} as AgentPrompt
}

describe('the schema section of the system prompt', () => {
	it('is compact, not pretty-printed', () => {
		const prompt = buildSystemPrompt(makePrompt())
		const schemaSection = prompt.slice(prompt.indexOf('## JSON schema'))

		// Pretty-printing would produce '{\n  "' style indentation - roughly a
		// third more tokens, re-billed on every request on the user's own key.
		expect(schemaSection).toContain('{"')
		expect(schemaSection).not.toMatch(/\n\s{2,}"/)
	})

	it('contains the response schema', () => {
		const prompt = buildSystemPrompt(makePrompt())

		expect(prompt).toContain('"actions"')
		expect(prompt).toContain('"equation"')
	})

	it('is cached per mode and action list', () => {
		// Same inputs twice: the section must come from the cache (identical
		// output) rather than being rebuilt per request.
		const first = buildSystemPrompt(makePrompt())
		const second = buildSystemPrompt(makePrompt())

		expect(second).toBe(first)
	})

	it('can be omitted', () => {
		const prompt = buildSystemPrompt(makePrompt(), { withSchema: false })

		expect(prompt).not.toContain('## JSON schema')
	})
})
