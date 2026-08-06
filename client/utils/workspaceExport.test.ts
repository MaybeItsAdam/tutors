import { describe, expect, it } from 'vitest'
import type { Workspace, WorkspaceState } from '../agent/managers/WorkspaceManager'
import {
	parseWorkspaceFile,
	reidentifyWorkspace,
	WORKSPACE_FILE_FORMAT,
	WORKSPACE_FILE_VERSION,
} from './workspaceExport'

const makeState = (): WorkspaceState =>
	({ editorSnapshot: {}, appState: {} }) as unknown as WorkspaceState

const makeSnapshot = (id: string, parentSnapshotId: string | null) => ({
	id,
	name: `snapshot ${id}`,
	createdAt: 1,
	parentSnapshotId,
	mergedFromBranchId: null,
	mergedFromSnapshotId: null,
	isAuto: false,
	state: makeState(),
})

const makeWorkspace = (): Workspace => ({
	id: 'ws-old',
	name: 'Algebra',
	createdAt: 1,
	updatedAt: 2,
	autoSnapshotIntervalMinutes: null,
	lastAutoSnapshotAt: null,
	currentBranchId: 'branch-main',
	branches: {
		'branch-main': {
			id: 'branch-main',
			name: 'main',
			createdAt: 1,
			updatedAt: 2,
			parentBranchId: null,
			forkedFromSnapshotId: null,
			headSnapshotId: 'snap-2',
			workingState: makeState(),
			snapshots: [
				makeSnapshot('snap-1', null),
				{
					...makeSnapshot('snap-2', 'snap-1'),
					mergedFromBranchId: 'branch-fork',
					mergedFromSnapshotId: 'snap-1',
				},
			],
		},
		'branch-fork': {
			id: 'branch-fork',
			name: 'fork',
			createdAt: 1,
			updatedAt: 2,
			parentBranchId: 'branch-main',
			forkedFromSnapshotId: 'snap-1',
			headSnapshotId: null,
			workingState: makeState(),
			snapshots: [],
		},
	},
})

const makeFile = (overrides: object = {}) =>
	JSON.stringify({
		format: WORKSPACE_FILE_FORMAT,
		version: WORKSPACE_FILE_VERSION,
		exportedAt: 3,
		workspace: makeWorkspace(),
		...overrides,
	})

const allIds = (workspace: Workspace): string[] => {
	const ids = [workspace.id]
	for (const branch of Object.values(workspace.branches)) {
		ids.push(branch.id, ...branch.snapshots.map((snapshot) => snapshot.id))
	}
	return ids
}

describe('parseWorkspaceFile', () => {
	it('accepts a minimal valid export', () => {
		const workspace = parseWorkspaceFile(makeFile())
		expect(workspace.name).toBe('Algebra')
		expect(Object.keys(workspace.branches)).toEqual(['branch-main', 'branch-fork'])
	})

	it('rejects text that is not JSON', () => {
		expect(() => parseWorkspaceFile('not json{')).toThrow(/valid JSON/)
	})

	it('rejects JSON with the wrong top-level shape', () => {
		expect(() => parseWorkspaceFile('42')).toThrow(/exported from this app/)
		expect(() => parseWorkspaceFile(makeFile({ format: 'other-app' }))).toThrow(
			/exported from this app/
		)
	})

	it('rejects unknown format versions', () => {
		expect(() => parseWorkspaceFile(makeFile({ version: 2 }))).toThrow(/v2/)
	})

	it('rejects a workspace with missing data', () => {
		const noBranches = { ...makeWorkspace(), branches: {} }
		expect(() => parseWorkspaceFile(makeFile({ workspace: noBranches }))).toThrow(/corrupted/)

		const broken = makeWorkspace() as unknown as Record<string, unknown>
		delete broken.name
		expect(() => parseWorkspaceFile(makeFile({ workspace: broken }))).toThrow(/corrupted/)
	})
})

describe('reidentifyWorkspace', () => {
	it('replaces every workspace, branch and snapshot id', () => {
		const original = makeWorkspace()
		const result = reidentifyWorkspace(original)
		const oldIds = new Set(allIds(original))
		for (const id of allIds(result)) {
			expect(oldIds.has(id)).toBe(false)
		}
		for (const [key, branch] of Object.entries(result.branches)) {
			expect(branch.id).toBe(key)
		}
	})

	it('remaps every internal reference consistently', () => {
		const result = reidentifyWorkspace(makeWorkspace())
		const branches = Object.values(result.branches)
		const main = branches.find((branch) => branch.name === 'main')!
		const fork = branches.find((branch) => branch.name === 'fork')!
		const [snap1, snap2] = main.snapshots

		expect(result.currentBranchId).toBe(main.id)
		expect(fork.parentBranchId).toBe(main.id)
		expect(fork.forkedFromSnapshotId).toBe(snap1.id)
		expect(main.headSnapshotId).toBe(snap2.id)
		expect(snap2.parentSnapshotId).toBe(snap1.id)
		expect(snap2.mergedFromBranchId).toBe(fork.id)
		expect(snap2.mergedFromSnapshotId).toBe(snap1.id)
	})

	it('drops references to ids that are not in the file', () => {
		const original = makeWorkspace()
		original.branches['branch-fork'].forkedFromSnapshotId = 'ghost-snapshot'
		original.currentBranchId = 'ghost-branch'
		const result = reidentifyWorkspace(original)
		const fork = Object.values(result.branches).find((branch) => branch.name === 'fork')!
		expect(fork.forkedFromSnapshotId).toBeNull()
		// The current branch falls back to an existing branch instead of dangling
		expect(Object.keys(result.branches)).toContain(result.currentBranchId)
	})

	it('produces disjoint id sets on consecutive runs', () => {
		const original = makeWorkspace()
		const first = new Set(allIds(reidentifyWorkspace(original)))
		const second = allIds(reidentifyWorkspace(original))
		expect(second.some((id) => first.has(id))).toBe(false)
	})

	it('applies a trimmed name override, keeping the original by default', () => {
		expect(reidentifyWorkspace(makeWorkspace(), '  Copy of Algebra  ').name).toBe('Copy of Algebra')
		expect(reidentifyWorkspace(makeWorkspace()).name).toBe('Algebra')
	})
})
