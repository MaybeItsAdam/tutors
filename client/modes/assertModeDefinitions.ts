import { getActionSchema } from '../../shared/types/AgentAction'
import { hasRegisteredActionUtil } from '../actions/AgentActionUtil'
import { hasRegisteredPromptPartUtil } from '../parts/PromptPartUtil'
import type { AgentModeDefinition } from './AgentModeDefinitions'

/**
 * Assert that every action and prompt part listed in the mode definitions
 * resolves to a registered util and schema.
 *
 * Without this check, a mode can advertise an action to the model that
 * silently falls through to `UnknownActionUtil` and does nothing - the model
 * is told it can act, the action validates and gets logged as done, but
 * nothing happens on the canvas. (This exact bug shipped with the `equation`
 * action.) Registration only happens via each util's `registerActionUtil`
 * wrapper, which the type system cannot enforce, so we enforce it here at
 * module load instead.
 *
 * Throws in dev and prod alike: a mode advertising a dead action is a hard
 * invariant violation, and the vitest suite runs this assertion so CI fails
 * before any user sees a white screen.
 */
export function assertModeDefinitions(definitions: readonly AgentModeDefinition[]) {
	for (const mode of definitions) {
		if (!mode.active) continue

		for (const type of mode.actions) {
			if (type === 'unknown') continue
			if (!hasRegisteredActionUtil(type)) {
				throw new Error(
					`Mode "${mode.type}" lists action "${type}" but no ActionUtil is registered for it - ` +
						`it would silently fall through to UnknownActionUtil. ` +
						`Wrap the util class in registerActionUtil(...).`
				)
			}
			if (!getActionSchema(type)) {
				throw new Error(
					`Mode "${mode.type}" lists action "${type}" but no schema is registered for it - ` +
						`export the schema from AgentActionSchemas.ts.`
				)
			}
		}

		for (const part of mode.parts) {
			if (!hasRegisteredPromptPartUtil(part)) {
				throw new Error(
					`Mode "${mode.type}" lists prompt part "${part}" but no PromptPartUtil is registered for it - ` +
						`wrap the util class in registerPromptPartUtil(...).`
				)
			}
		}
	}
}
