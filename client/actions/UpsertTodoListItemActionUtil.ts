import { UpsertPersonalTodoItemAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const UpsertTodoListItemActionUtil = registerActionUtil(
	class UpsertTodoListItemActionUtil extends AgentActionUtil<UpsertPersonalTodoItemAction> {
		static override type = 'update-todo-list' as const

		override getInfo() {
			// Don't show todo actions in the chat history because we show them in the dedicated todo list UI
			return null
		}

		override applyAction(action: Streaming<UpsertPersonalTodoItemAction>) {
			if (!action.complete) return

			const { id, text, status } = action

			const index = this.agent.todos.getTodos().findIndex((item) => item.id === id)
			if (index === -1) {
				if (!text) {
					// Skip-and-report. This used to interrupt(), which cancelled
					// the in-flight request and threw away every not-yet-streamed
					// action in the turn - a whole model response lost to one
					// malformed todo item.
					this.agent.actions.recordFailedAction(
						action,
						'apply-error',
						'A new todo item requires text; this item was skipped.'
					)
					return
				}
				this.agent.todos.push(id, text)
			} else {
				this.agent.todos.update({ id, status, text })
			}
		}
	}
)
