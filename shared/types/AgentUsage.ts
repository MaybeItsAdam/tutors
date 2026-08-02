/**
 * Token usage reported by the backend at the end of a model request.
 *
 * `costUsd` is null when litellm has no pricing for the model - a brand-new or
 * self-hosted model still reports tokens, it just can't be priced.
 */
export interface AgentUsageEvent {
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	costUsd: number | null
}

/**
 * Running totals across every request an agent has made.
 *
 * This is a BYOK app: the bill lands on the user's own API key, and the agent
 * can take several turns per instruction, so what a session has cost so far is
 * information the user needs rather than a nicety.
 */
export interface AgentUsageTotals {
	/** How many model requests have completed. */
	requests: number
	promptTokens: number
	completionTokens: number
	totalTokens: number
	/** Summed cost of the requests that could be priced. */
	costUsd: number
	/** Requests whose model had no known pricing, so `costUsd` understates spend. */
	unpricedRequests: number
}

export const EMPTY_AGENT_USAGE_TOTALS: AgentUsageTotals = {
	requests: 0,
	promptTokens: 0,
	completionTokens: 0,
	totalTokens: 0,
	costUsd: 0,
	unpricedRequests: 0,
}

/** Type guard for the terminal `usage` event on the action stream. */
export function isAgentUsageEvent(value: unknown): value is { usage: AgentUsageEvent } {
	if (!value || typeof value !== 'object' || !('usage' in value)) return false
	const usage = (value as { usage: unknown }).usage
	return !!usage && typeof usage === 'object' && 'totalTokens' in usage
}
