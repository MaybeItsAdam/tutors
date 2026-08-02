import { Atom, atom } from 'tldraw'
import {
	AgentUsageEvent,
	AgentUsageTotals,
	EMPTY_AGENT_USAGE_TOTALS,
} from '../../../shared/types/AgentUsage'
import type { TldrawAgent } from '../TldrawAgent'
import { BaseAgentManager } from './BaseAgentManager'

/**
 * Tracks what the agent has spent.
 *
 * The backend reports token counts and an estimated cost at the end of every
 * model request; this accumulates them so the user can see the running total
 * for the session. Keys are the user's own, and one instruction can turn into
 * a dozen requests, so the number is worth showing.
 */
export class AgentUsageManager extends BaseAgentManager {
	private $totals: Atom<AgentUsageTotals>

	constructor(agent: TldrawAgent) {
		super(agent)
		this.$totals = atom('usageTotals', EMPTY_AGENT_USAGE_TOTALS)
	}

	/**
	 * Get the running totals for this agent.
	 */
	getTotals(): AgentUsageTotals {
		return this.$totals.get()
	}

	/**
	 * Set the totals directly. Used when restoring persisted state.
	 */
	setTotals(totals: AgentUsageTotals) {
		this.$totals.set(totals)
	}

	/**
	 * Fold one request's usage into the running totals.
	 */
	record(event: AgentUsageEvent) {
		this.$totals.update((prev) => ({
			requests: prev.requests + 1,
			promptTokens: prev.promptTokens + (event.promptTokens || 0),
			completionTokens: prev.completionTokens + (event.completionTokens || 0),
			totalTokens: prev.totalTokens + (event.totalTokens || 0),
			costUsd: prev.costUsd + (event.costUsd ?? 0),
			unpricedRequests: prev.unpricedRequests + (event.costUsd === null ? 1 : 0),
		}))
	}

	/**
	 * Clear the totals. Called when the chat is reset, since the meter is
	 * scoped to a conversation.
	 */
	reset(): void {
		this.$totals.set(EMPTY_AGENT_USAGE_TOTALS)
	}
}
