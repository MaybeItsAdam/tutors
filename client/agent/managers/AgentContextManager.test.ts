import { describe, expect, it } from 'vitest'
import type { ContextItem } from '../../../shared/types/ContextItem'
import { AgentContextManager } from './AgentContextManager'

function areaItem(x: number): ContextItem {
	return { type: 'area', bounds: { x, y: 0, w: 10, h: 10 }, source: 'user' }
}

// The context manager only needs its atom for add/remove/getItems.
function makeManager() {
	return new AgentContextManager({} as any)
}

describe('AgentContextManager.remove', () => {
	it('removes a re-derived (equal but not identical) item', () => {
		const manager = makeManager()
		manager.add(areaItem(5))

		// add() stores a structuredClone, so the caller's reference never
		// matches by identity - removal must work by equality.
		manager.remove(areaItem(5))

		expect(manager.getItems()).toEqual([])
	})

	it('only removes the matching item', () => {
		const manager = makeManager()
		manager.add(areaItem(1))
		manager.add(areaItem(2))

		manager.remove(areaItem(1))

		const remaining = manager.getItems()
		expect(remaining).toHaveLength(1)
		expect((remaining[0] as { bounds: { x: number } }).bounds.x).toBe(2)
	})
})
