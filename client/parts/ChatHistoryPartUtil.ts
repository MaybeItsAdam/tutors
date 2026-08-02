import { structuredClone } from 'tldraw'
import { ChatHistoryPart } from '../../shared/schema/PromptPartDefinitions'
import { ChatHistoryItem } from '../../shared/types/ChatHistoryItem'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

/**
 * How many of the most recent chat history items to send to the model.
 *
 * The transcript only ever grows, and the whole of it used to go into every
 * request - so a long session's cost climbed with every turn, and under the
 * agent's continuation loop that compounds. The recent window is what the
 * model actually reasons about; the full history stays intact in the UI and in
 * persistence, this only bounds what gets paid for.
 */
export const MAX_CHAT_HISTORY_ITEMS = 60

/**
 * Trim the history to the most recent items, keeping the earliest user prompt
 * so the agent doesn't lose sight of what it was originally asked to do.
 */
export function trimChatHistory(
	history: ChatHistoryItem[],
	maxItems = MAX_CHAT_HISTORY_ITEMS
): ChatHistoryItem[] {
	if (history.length <= maxItems) return history

	const recent = history.slice(-maxItems)

	const originalPrompt = history.find(
		(item) => item.type === 'prompt' && item.promptSource === 'user'
	)
	if (!originalPrompt || recent.includes(originalPrompt)) return recent

	// Swap the oldest item in the window for the original ask, so the window
	// stays exactly the advertised size.
	return [originalPrompt, ...recent.slice(1)]
}

export const ChatHistoryPartUtil = registerPromptPartUtil(
	class ChatHistoryPartUtil extends PromptPartUtil<ChatHistoryPart> {
		static override type = 'chatHistory' as const

		override async getPart(_request: AgentRequest, helpers: AgentHelpers) {
			const history = structuredClone(trimChatHistory(this.agent.chat.getHistory()))

			for (const historyItem of history) {
				if (historyItem.type !== 'prompt') continue

				// Offset and round the context items of each history item
				const contextItems = historyItem.contextItems.map((contextItem) => {
					const offsetContextItem = helpers.applyOffsetToContextItem(contextItem)
					return helpers.roundContextItem(offsetContextItem)
				})

				historyItem.contextItems = contextItems
			}

			return {
				type: 'chatHistory' as const,
				history,
			}
		}
	}
)
