import { tool } from 'ai'
import z from 'zod'
import { AgentAction } from '../types/AgentAction'
import { getActionSchemaForMode } from './AgentActionSchemaRegistry'

/**
 * Strip the `_type` discriminator field from an action schema.
 * When using tool use, the tool name *is* the action type — the model
 * doesn't need to repeat it inside the parameters.
 */
function stripTypeField(schema: z.ZodObject<z.ZodRawShape>): z.ZodObject<z.ZodRawShape> {
	const { _type: _, ...rest } = schema.shape
	return z.object(rest)
}

/**
 * Build Vercel AI SDK tool definitions from action schemas.
 *
 * Each action type becomes a named tool whose:
 * - name      = action `_type` value
 * - description = action schema `.meta().description` (or title)
 * - parameters  = action schema *without* the `_type` field
 *
 * The server reconstructs the full `AgentAction` by re-attaching `_type`
 * from the tool name when it emits the SSE event to the client.
 *
 * The `execute` function returns a simple acknowledgment so the model
 * receives feedback after each tool call and can decide on further steps
 * (multi-step loop via `maxSteps` in `streamText`).
 */
export function buildToolDefinitions(actionTypes: AgentAction['_type'][], mode: string) {
	const tools: Record<string, ReturnType<typeof tool>> = {}

	for (const actionType of actionTypes) {
		const schema = getActionSchemaForMode(actionType, mode)
		if (!schema || !(schema instanceof z.ZodObject)) continue

		const meta = (schema.meta() ?? {}) as { description?: string; title?: string }
		const description = meta.description ?? meta.title ?? actionType
		const parameters = stripTypeField(schema as z.ZodObject<z.ZodRawShape>)

		tools[actionType] = tool({
			description,
			parameters,
			execute: async (_args) => ({ success: true, actionType }),
		})
	}

	return tools
}
