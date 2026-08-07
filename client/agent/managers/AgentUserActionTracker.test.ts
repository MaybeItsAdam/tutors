import { describe, expect, it } from 'vitest'
import type { RecordsDiff, TLRecord } from 'tldraw'
import { AgentUserActionTracker } from './AgentUserActionTracker'

function makeDiff(id: string): RecordsDiff<TLRecord> {
	return {
		added: {},
		updated: { [id]: [{ id } as any, { id, x: 1 } as any] },
		removed: {},
	} as RecordsDiff<TLRecord>
}

// The tracker's history methods only need the atom; the agent is untouched
// until startRecording(), which these tests don't call.
function makeTracker() {
	return new AgentUserActionTracker({} as any)
}

describe('removeConsumed', () => {
	it('removes exactly the consumed diffs by identity', () => {
		const tracker = makeTracker()
		const a = makeDiff('shape:a')
		const b = makeDiff('shape:b')
		// There is no public push (entries arrive via editor side effects), so
		// seed through the private atom.
		;(tracker as any).$userActionHistory.set([a, b])

		tracker.removeConsumed([a])

		expect(tracker.getHistory()).toEqual([b])
	})

	it('preserves diffs added after the consumed batch was taken', () => {
		const tracker = makeTracker()
		const consumed = [makeDiff('shape:a'), makeDiff('shape:b')]
		;(tracker as any).$userActionHistory.set([...consumed])

		// A user edit lands mid-generation, after the stash:
		const during = makeDiff('shape:c')
		;(tracker as any).$userActionHistory.update((h: unknown[]) => [...h, during])

		tracker.removeConsumed(consumed)

		expect(tracker.getHistory()).toEqual([during])
	})

	it('an equal-but-different diff object is not removed (identity, not equality)', () => {
		const tracker = makeTracker()
		const original = makeDiff('shape:a')
		const lookalike = makeDiff('shape:a')
		;(tracker as any).$userActionHistory.set([original])

		tracker.removeConsumed([lookalike])

		expect(tracker.getHistory()).toEqual([original])
	})
})
