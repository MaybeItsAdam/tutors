import { describe, expect, it } from 'vitest'
import { ChatHistoryItem } from '../types/ChatHistoryItem'
import { ChatHistoryPartDefinition } from './PromptPartDefinitions'

function buildMessages(history: ChatHistoryItem[]) {
	return ChatHistoryPartDefinition.buildMessages!({ type: 'chatHistory', history })
}

const failedItem: ChatHistoryItem = {
	type: 'failed-action',
	action: { _type: 'delete', shapeId: 'ghost', intent: 'remove it', complete: true, time: 5 } as any,
	kind: 'sanitize-rejected',
	reason: 'Shape "ghost" not found in canvas',
}

const actionItem: ChatHistoryItem = {
	type: 'action',
	action: { _type: 'think', text: 'hm', complete: true, time: 1 } as any,
	diff: { added: {}, updated: {}, removed: {} },
	acceptance: 'accepted',
}

describe('failed-action history rendering', () => {
	it('renders as environment feedback with role user', () => {
		const messages = buildMessages([failedItem])

		expect(messages).toHaveLength(1)
		expect(messages[0].role).toBe('user')
	})

	it('marks the action as failed and not applied, with the reason', () => {
		const text = (buildMessages([failedItem])[0].content[0] as { text: string }).text

		expect(text).toContain('[ACTION FAILED — NOT APPLIED]')
		expect(text).toContain('Shape "ghost" not found in canvas')
		expect(text).toContain('"_type":"delete"')
	})

	it('strips the streaming bookkeeping fields from the payload', () => {
		const text = (buildMessages([failedItem])[0].content[0] as { text: string }).text

		expect(text).not.toContain('"complete"')
		expect(text).not.toContain('"time"')
	})

	it('successful actions still render as plain [ACTION]s', () => {
		const messages = buildMessages([actionItem, failedItem])

		const first = (messages[0].content[0] as { text: string }).text
		expect(first).toContain('[THOUGHT]')
		expect(messages[0].role).toBe('assistant')
	})
})
