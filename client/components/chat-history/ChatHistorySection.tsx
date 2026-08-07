import { SmallSpinner } from '../../../shared/icons/SmallSpinner'
import {
	ChatHistoryActionItem,
	ChatHistoryContinuationItem,
	ChatHistoryFailedActionItem,
	ChatHistoryItem,
	ChatHistoryPromptItem,
} from '../../../shared/types/ChatHistoryItem'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryFailedAction } from './ChatHistoryFailedAction'
import { ChatHistoryGroup, getActionHistoryGroups } from './ChatHistoryGroup'
import { ChatHistoryPrompt } from './ChatHistoryPrompt'

export interface ChatHistorySection {
	prompt: ChatHistoryPromptItem
	items: (ChatHistoryActionItem | ChatHistoryContinuationItem | ChatHistoryFailedActionItem)[]
}

/**
 * Consecutive actions render as groups; a failed action always breaks
 * grouping and renders as its own notice, in stream order.
 */
type SectionRun =
	| { type: 'actions'; items: ChatHistoryActionItem[] }
	| { type: 'failed'; item: ChatHistoryFailedActionItem }

export function getSectionRuns(items: ChatHistorySection['items']): SectionRun[] {
	const runs: SectionRun[] = []
	for (const item of items) {
		if (item.type === 'action') {
			const last = runs[runs.length - 1]
			if (last?.type === 'actions') {
				last.items.push(item)
			} else {
				runs.push({ type: 'actions', items: [item] })
			}
		} else if (item.type === 'failed-action') {
			runs.push({ type: 'failed', item })
		}
		// Continuations are not rendered, as before.
	}
	return runs
}

export function ChatHistorySection({
	section,
	loading,
}: {
	section: ChatHistorySection
	loading: boolean
}) {
	const agent = useAgent()
	const runs = getSectionRuns(section.items)
	return (
		<div className="chat-history-section">
			<ChatHistoryPrompt item={section.prompt} editor={agent.editor} />
			{runs.map((run, i) => {
				if (run.type === 'failed') {
					return <ChatHistoryFailedAction key={'chat-history-failed-' + i} item={run.item} />
				}
				return getActionHistoryGroups(run.items, agent).map((group, j) => (
					<ChatHistoryGroup key={`chat-history-group-${i}-${j}`} group={group} />
				))
			})}
			{loading && <SmallSpinner />}
		</div>
	)
}

export function getAgentHistorySections(items: ChatHistoryItem[]): ChatHistorySection[] {
	const sections: ChatHistorySection[] = []

	for (const item of items) {
		if (item.type === 'prompt') {
			// Filter out 'self' prompts from the UI
			if (item.promptSource === 'self') continue
			sections.push({ prompt: item, items: [] })
			continue
		}

		// Only add to the last section if one exists
		if (sections.length > 0) {
			sections[sections.length - 1].items.push(item)
		}
	}

	return sections
}
