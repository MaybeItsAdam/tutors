import { JsonValue, RecordsDiff, TLRecord } from 'tldraw'
import { FocusedShape } from '../format/FocusedShape'
import { AgentAction } from './AgentAction'
import { AgentRequestSource } from './AgentRequest'
import { ContextItem } from './ContextItem'
import { Streaming } from './Streaming'

export type ChatHistoryItem =
	| ChatHistoryActionItem
	| ChatHistoryPromptItem
	| ChatHistoryContinuationItem
	| ChatHistoryFailedActionItem

/**
 * A prompt from a user, another agent, or the agent itself.
 */
export interface ChatHistoryPromptItem {
	type: 'prompt'
	promptSource: AgentRequestSource
	agentFacingMessage: string
	userFacingMessage: string | null
	contextItems: ContextItem[]
	selectedShapes: FocusedShape[]
}

/**
 * An action done by the agent.
 */
export interface ChatHistoryActionItem {
	type: 'action'
	action: Streaming<AgentAction>
	diff: RecordsDiff<TLRecord>
	acceptance: 'pending' | 'accepted' | 'rejected'
}

/**
 * A follow-up request from the agent, with data retrieved from the previous request.
 */
export interface ChatHistoryContinuationItem {
	type: 'continuation'
	data: JsonValue[]
}

/**
 * An action the agent attempted that was NOT applied.
 *
 * This must be recorded in history: the model is told to assume its previous
 * actions succeeded, so a silently dropped action leaves it referencing
 * shapes and state that don't exist, compounding the error across
 * continuations. A distinct type (rather than a fourth acceptance state on
 * ChatHistoryActionItem) keeps the accept/reject diff UI's assumptions
 * intact, and carries no RecordsDiff - there were no changes.
 */
export interface ChatHistoryFailedActionItem {
	type: 'failed-action'
	action: Streaming<AgentAction>
	kind:
		| 'mode-unavailable'
		| 'unrecognized-type'
		| 'schema-invalid'
		| 'sanitize-rejected'
		| 'apply-error'
	/** Model-facing explanation, e.g. 'Shape shape:eq3 not found in canvas'. */
	reason: string
}
