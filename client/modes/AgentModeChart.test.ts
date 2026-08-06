import { describe, expect, it, vi } from 'vitest'
import { getModeNode } from './AgentModeChart'

/**
 * The mode hooks only touch a few manager methods, so a plain stub stands in
 * for the agent. What matters here is WHICH todo method each hook calls:
 * flush() drops done items and keeps unfinished ones, reset() erases
 * everything - and the runaway-stop recovery ("N todos outstanding, tell me
 * to keep going") only works if unfinished todos survive the working ->
 * idling -> working round trip.
 */
function makeAgentStub() {
	return {
		todos: { flush: vi.fn(), reset: vi.fn(), getTodos: vi.fn(() => []) },
		userAction: { clearHistory: vi.fn() },
		context: { clear: vi.fn() },
		lints: {
			clearCreatedShapes: vi.fn(),
			unlockCreatedShapes: vi.fn(),
			hasUnsurfacedLints: vi.fn(() => false),
			getCreatedShapes: vi.fn(() => []),
		},
		mode: { setMode: vi.fn() },
		schedule: vi.fn(),
	} as any
}

describe('todo preservation across mode transitions', () => {
	it('entering idling flushes todos instead of resetting them', () => {
		const agent = makeAgentStub()

		getModeNode('idling').onEnter!(agent, 'working')

		expect(agent.todos.flush).toHaveBeenCalled()
		expect(agent.todos.reset).not.toHaveBeenCalled()
	})

	it('entering working keeps existing todos', () => {
		const agent = makeAgentStub()

		getModeNode('working').onEnter!(agent, 'idling')

		expect(agent.todos.reset).not.toHaveBeenCalled()
		expect(agent.todos.flush).not.toHaveBeenCalled()
	})

	it('a user prompt while working still flushes finished todos', () => {
		const agent = makeAgentStub()

		getModeNode('working').onPromptStart!(agent, { source: 'user' } as any)

		expect(agent.todos.flush).toHaveBeenCalled()
	})
})

describe('working.onPromptEnd continuation', () => {
	it('schedules a continuation while todos are outstanding', () => {
		const agent = makeAgentStub()
		agent.todos.getTodos = vi.fn(() => [{ id: '1', text: 'x', status: 'todo' }])

		getModeNode('working').onPromptEnd!(agent, {} as any)

		expect(agent.schedule).toHaveBeenCalled()
		expect(agent.mode.setMode).not.toHaveBeenCalled()
	})

	it('returns to idling when all work is done', () => {
		const agent = makeAgentStub()
		agent.todos.getTodos = vi.fn(() => [{ id: '1', text: 'x', status: 'done' }])

		getModeNode('working').onPromptEnd!(agent, {} as any)

		expect(agent.schedule).not.toHaveBeenCalled()
		expect(agent.mode.setMode).toHaveBeenCalledWith('idling')
	})
})
