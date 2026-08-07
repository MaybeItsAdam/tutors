import { describe, expect, it } from 'vitest'
import {
	ChatHistoryActionItem,
	ChatHistoryFailedActionItem,
} from '../../../shared/types/ChatHistoryItem'
import { getSectionRuns } from './ChatHistorySection'

function action(text: string): ChatHistoryActionItem {
	return {
		type: 'action',
		action: { _type: 'think', text, complete: true, time: 0 } as any,
		diff: { added: {}, updated: {}, removed: {} },
		acceptance: 'accepted',
	}
}

function failed(reason: string): ChatHistoryFailedActionItem {
	return {
		type: 'failed-action',
		action: { _type: 'delete', complete: true, time: 0 } as any,
		kind: 'apply-error',
		reason,
	}
}

describe('getSectionRuns', () => {
	it('groups consecutive actions into one run', () => {
		const runs = getSectionRuns([action('a'), action('b'), action('c')])

		expect(runs).toHaveLength(1)
		expect(runs[0].type).toBe('actions')
	})

	it('a failure breaks grouping and keeps stream order', () => {
		const runs = getSectionRuns([action('a'), failed('nope'), action('b')])

		expect(runs.map((r) => r.type)).toEqual(['actions', 'failed', 'actions'])
	})

	it('consecutive failures each get their own notice', () => {
		const runs = getSectionRuns([failed('one'), failed('two')])

		expect(runs.map((r) => r.type)).toEqual(['failed', 'failed'])
	})

	it('continuation items are not rendered', () => {
		const runs = getSectionRuns([action('a'), { type: 'continuation', data: [] }, action('b')])

		// Continuations are invisible, so the surrounding actions merge.
		expect(runs).toHaveLength(1)
	})
})
