import { useCallback, useState } from 'react'
import { useValue } from 'tldraw'
import { AgentUsageTotals } from '../../shared/types/AgentUsage'
import { TldrawAgent } from '../agent/TldrawAgent'

/**
 * Compact running total of what this conversation has cost.
 *
 * Keys are the user's own and one instruction can fan out into a dozen model
 * requests, so spend is worth showing rather than leaving to the provider
 * dashboard. Collapsed it's a single line; clicking opens the breakdown.
 */
export function UsageMeter({ agent }: { agent: TldrawAgent }) {
	const totals = useValue('usageTotals', () => agent.usage.getTotals(), [agent])
	const [expanded, setExpanded] = useState(false)

	const toggle = useCallback(() => setExpanded((prev) => !prev), [])

	if (totals.requests === 0) return null

	return (
		<div className="usage-meter">
			<button
				className="usage-meter-summary"
				onClick={toggle}
				aria-expanded={expanded}
				title="Model usage for this conversation"
			>
				<span className="usage-meter-tokens">{formatTokens(totals.totalTokens)} tokens</span>
				<span className="usage-meter-cost">{formatCost(totals)}</span>
				<span className="usage-meter-chevron">{expanded ? '▾' : '▸'}</span>
			</button>
			{expanded && (
				<dl className="usage-meter-detail">
					<UsageRow label="Requests" value={String(totals.requests)} />
					<UsageRow label="Input" value={`${formatTokens(totals.promptTokens)} tokens`} />
					<UsageRow label="Output" value={`${formatTokens(totals.completionTokens)} tokens`} />
					{totals.unpricedRequests > 0 && (
						<UsageRow
							label="Unpriced"
							value={`${totals.unpricedRequests} request${totals.unpricedRequests === 1 ? '' : 's'}`}
						/>
					)}
				</dl>
			)}
		</div>
	)
}

function UsageRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="usage-meter-row">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	)
}

/** 1234 -> "1.2k", 1234567 -> "1.2M". */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens)
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
	return `${(tokens / 1_000_000).toFixed(1)}M`
}

/**
 * Format spend without ever implying more precision than we have.
 *
 * Sub-cent totals still get shown rather than rounded away to "$0.00" - early
 * in a session that's the number the user is actually checking. A `~` marks
 * totals that exclude requests litellm couldn't price.
 */
export function formatCost(totals: Pick<AgentUsageTotals, 'costUsd' | 'unpricedRequests'>): string {
	const prefix = totals.unpricedRequests > 0 ? '~' : ''
	if (totals.costUsd === 0) return `${prefix}$0.00`
	if (totals.costUsd < 0.01) return `${prefix}<$0.01`
	return `${prefix}$${totals.costUsd.toFixed(2)}`
}
