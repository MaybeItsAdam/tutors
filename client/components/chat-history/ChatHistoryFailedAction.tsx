import { CrossIcon } from '../../../shared/icons/CrossIcon'
import { ChatHistoryFailedActionItem } from '../../../shared/types/ChatHistoryItem'

/**
 * A muted one-line notice for an action the agent attempted that was not
 * applied. The model gets the same information via its chat history; this is
 * the user-facing half, so a dropped action never disappears without a trace.
 */
export function ChatHistoryFailedAction({ item }: { item: ChatHistoryFailedActionItem }) {
	const label = item.action._type ? `"${item.action._type}" action failed` : 'An action failed'
	return (
		<div className="chat-history-failed-action" title={JSON.stringify(item.action)}>
			<CrossIcon />
			<span>
				{label}: {item.reason}
			</span>
		</div>
	)
}
