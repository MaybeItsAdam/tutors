import { Atom, atom, structuredClone, TLEditorSnapshot, uniqueId } from 'tldraw'
import { PersistedAppState } from './AgentAppPersistenceManager'
import { BaseAgentAppManager } from './BaseAgentAppManager'
import { formatWorkspaceTime } from '../../utils/workspaceFormat'
import { kvDelete, kvGet, kvSet } from '../../utils/kvStore'

const STORAGE_KEY = 'tldraw-agent-app:workspaces:v1'
const AUTO_SNAPSHOT_CHECK_INTERVAL_MS = 30_000
const WORKING_STATE_SAVE_INTERVAL_MS = 5_000
const MS_PER_MINUTE = 60_000
const MAX_AUTO_SNAPSHOTS_PER_BRANCH = 20

export interface WorkspaceState {
	editorSnapshot: TLEditorSnapshot
	appState: PersistedAppState
}

export interface WorkspaceSnapshot {
	id: string
	name: string
	createdAt: number
	parentSnapshotId: string | null
	mergedFromBranchId: string | null
	mergedFromSnapshotId: string | null
	isAuto: boolean
	state: WorkspaceState
}

export interface WorkspaceBranch {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	parentBranchId: string | null
	forkedFromSnapshotId: string | null
	headSnapshotId: string | null
	workingState: WorkspaceState
	snapshots: WorkspaceSnapshot[]
}

export interface Workspace {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	autoSnapshotIntervalMinutes: number | null
	lastAutoSnapshotAt: number | null
	currentBranchId: string
	branches: Record<string, WorkspaceBranch>
}

interface PersistedWorkspacesState {
	version: 1
	currentWorkspaceId: string
	workspaces: Record<string, Workspace>
}

export class WorkspaceManager extends BaseAgentAppManager {
	private $workspaces: Atom<Record<string, Workspace>>
	private $currentWorkspaceId: Atom<string | null>
	private autoSnapshotTimer: number | null = null
	private workingStateSaveTimer: number | null = null
	private isApplyingState = false

	constructor(app: BaseAgentAppManager['app']) {
		super(app)
		this.$workspaces = atom('workspaces', {})
		this.$currentWorkspaceId = atom('currentWorkspaceId', null)
		this.startTimers()
	}

	getWorkspaces(): Workspace[] {
		const workspaces = this.$workspaces.get()
		return Object.values(workspaces).sort((a, b) => a.createdAt - b.createdAt)
	}

	getCurrentWorkspaceId(): string | null {
		return this.$currentWorkspaceId.get()
	}

	getCurrentWorkspace(): Workspace | null {
		const currentWorkspaceId = this.$currentWorkspaceId.get()
		if (!currentWorkspaceId) return null
		return this.$workspaces.get()[currentWorkspaceId] ?? null
	}

	getCurrentBranch(): WorkspaceBranch | null {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return null
		return workspace.branches[workspace.currentBranchId] ?? null
	}

	getBranchesForCurrentWorkspace(): WorkspaceBranch[] {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return []
		return Object.values(workspace.branches).sort((a, b) => a.createdAt - b.createdAt)
	}

	getSnapshotsForBranch(branchId: string): WorkspaceSnapshot[] {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return []
		const branch = workspace.branches[branchId]
		if (!branch) return []
		return [...branch.snapshots].sort((a, b) => b.createdAt - a.createdAt)
	}

	getLatestSnapshot(workspaceId?: string): { workspaceId: string; branchId: string; snapshot: WorkspaceSnapshot } | null {
		const targetWorkspace =
			(workspaceId && this.$workspaces.get()[workspaceId]) ?? this.getCurrentWorkspace()
		if (!targetWorkspace) return null
		let latest: { workspaceId: string; branchId: string; snapshot: WorkspaceSnapshot } | null = null
		for (const branch of Object.values(targetWorkspace.branches)) {
			for (const snapshot of branch.snapshots) {
				if (!latest || snapshot.createdAt > latest.snapshot.createdAt) {
					latest = { workspaceId: targetWorkspace.id, branchId: branch.id, snapshot }
				}
			}
		}
		return latest
	}

	restoreLatestSnapshot(workspaceId?: string): boolean {
		const latest = this.getLatestSnapshot(workspaceId)
		if (!latest) return false
		if (!this.switchWorkspace(latest.workspaceId)) return false
		return this.restoreSnapshot(latest.branchId, latest.snapshot.id)
	}

	async loadState() {
		const persisted = await this.loadPersistedState()
		if (!persisted) {
			const workspace = this.createInitialWorkspace('Workspace 1')
			this.$workspaces.set({ [workspace.id]: workspace })
			this.$currentWorkspaceId.set(workspace.id)
			this.persistState()
			return
		}

		this.$workspaces.set(persisted.workspaces)
		this.$currentWorkspaceId.set(persisted.currentWorkspaceId)

		const currentWorkspace = persisted.workspaces[persisted.currentWorkspaceId]
		if (!currentWorkspace) return
		const currentBranch = currentWorkspace.branches[currentWorkspace.currentBranchId]
		if (!currentBranch) return
		this.applyWorkspaceState(currentBranch.workingState)
	}

	createWorkspace(name: string): Workspace {
		this.captureCurrentBranchWorkingState()
		const workspace = this.createInitialWorkspace(name)
		this.$workspaces.update((prev) => ({ ...prev, [workspace.id]: workspace }))
		this.$currentWorkspaceId.set(workspace.id)
		this.persistState()
		this.applyWorkspaceState(workspace.branches[workspace.currentBranchId].workingState)
		return workspace
	}

	switchWorkspace(workspaceId: string): boolean {
		const workspaces = this.$workspaces.get()
		const targetWorkspace = workspaces[workspaceId]
		if (!targetWorkspace) return false
		this.captureCurrentBranchWorkingState()
		this.$currentWorkspaceId.set(workspaceId)
		const branch = targetWorkspace.branches[targetWorkspace.currentBranchId]
		if (!branch) return false
		this.persistState()
		this.applyWorkspaceState(branch.workingState)
		return true
	}

	renameWorkspace(workspaceId: string, name: string): boolean {
		const trimmed = name.trim()
		if (!trimmed) return false
		let didRename = false
		this.$workspaces.update((prev) => {
			const workspace = prev[workspaceId]
			if (!workspace) return prev
			didRename = true
			return {
				...prev,
				[workspaceId]: {
					...workspace,
					name: trimmed,
					updatedAt: Date.now(),
				},
			}
		})
		if (didRename) this.persistState()
		return didRename
	}

	createSnapshot(name?: string, options?: { isAuto?: boolean; mergeFromBranchId?: string | null }) {
		if (this.isApplyingState) return null
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return null
		const branch = workspace.branches[workspace.currentBranchId]
		if (!branch) return null
		const now = Date.now()
		const state = this.captureWorkspaceState()
		const snapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: name?.trim() || `Snapshot ${branch.snapshots.length + 1}`,
			createdAt: now,
			parentSnapshotId: branch.headSnapshotId,
			mergedFromBranchId: options?.mergeFromBranchId ?? null,
			mergedFromSnapshotId: null,
			isAuto: options?.isAuto ?? false,
			state,
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentBranch = current.branches[current.currentBranchId]
			if (!currentBranch) return prev
			let nextSnapshots = [...currentBranch.snapshots, snapshot]
			if (snapshot.isAuto) {
				// Prune oldest auto-snapshots beyond the cap; never remove manual snapshots
				const autoSnapshots = nextSnapshots.filter((s) => s.isAuto)
				if (autoSnapshots.length > MAX_AUTO_SNAPSHOTS_PER_BRANCH) {
					const keepIds = new Set(autoSnapshots.slice(-MAX_AUTO_SNAPSHOTS_PER_BRANCH).map((s) => s.id))
					nextSnapshots = nextSnapshots.filter((s) => !s.isAuto || keepIds.has(s.id))
				}
			}
			const nextBranch: WorkspaceBranch = {
				...currentBranch,
				updatedAt: now,
				headSnapshotId: snapshot.id,
				workingState: structuredClone(state),
				snapshots: nextSnapshots,
			}
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					lastAutoSnapshotAt: snapshot.isAuto ? now : current.lastAutoSnapshotAt,
					branches: {
						...current.branches,
						[nextBranch.id]: nextBranch,
					},
				},
			}
		})
		this.persistState()
		return snapshot
	}

	restoreSnapshot(branchId: string, snapshotId: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		const branch = workspace.branches[branchId]
		if (!branch) return false
		const snapshot = branch.snapshots.find((s) => s.id === snapshotId)
		if (!snapshot) return false

		if (workspace.currentBranchId !== branchId) {
			this.switchBranch(branchId)
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentBranch = current.branches[branchId]
			if (!currentBranch) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: Date.now(),
					branches: {
						...current.branches,
						[branchId]: {
							...currentBranch,
							updatedAt: Date.now(),
							headSnapshotId: snapshot.id,
							workingState: structuredClone(snapshot.state),
						},
					},
				},
			}
		})

		this.persistState()
		this.applyWorkspaceState(snapshot.state)
		return true
	}

	switchBranch(branchId: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		if (!workspace.branches[branchId]) return false
		if (workspace.currentBranchId === branchId) return true

		this.captureCurrentBranchWorkingState()

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					currentBranchId: branchId,
					updatedAt: Date.now(),
				},
			}
		})
		this.persistState()

		const updatedWorkspace = this.getCurrentWorkspace()
		if (!updatedWorkspace) return false
		const targetBranch = updatedWorkspace.branches[branchId]
		if (!targetBranch) return false
		this.applyWorkspaceState(targetBranch.workingState)
		return true
	}

	forkBranchFrom(name: string, sourceBranchId: string, fromSnapshotId: string): WorkspaceBranch | null {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return null
		const sourceBranch = workspace.branches[sourceBranchId]
		if (!sourceBranch) return null

		const trimmed = name.trim()
		if (!trimmed) return null

		const now = Date.now()
		const baseSnapshot = sourceBranch.snapshots.find((s) => s.id === fromSnapshotId) ?? null
		if (!baseSnapshot) return null

		const baseState = structuredClone(baseSnapshot.state)
		const forkSnapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: `Fork base: ${baseSnapshot.name}`,
			createdAt: now,
			parentSnapshotId: baseSnapshot.id,
			mergedFromBranchId: null,
			mergedFromSnapshotId: null,
			isAuto: false,
			state: structuredClone(baseState),
		}

		const branch: WorkspaceBranch = {
			id: uniqueId(),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			parentBranchId: sourceBranchId,
			forkedFromSnapshotId: baseSnapshot.id,
			headSnapshotId: forkSnapshot.id,
			workingState: structuredClone(baseState),
			snapshots: [forkSnapshot],
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					branches: {
						...current.branches,
						[branch.id]: branch,
					},
				},
			}
		})
		this.persistState()
		return branch
	}

	forkBranch(name: string, fromSnapshotId?: string): WorkspaceBranch | null {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return null
		const currentBranch = workspace.branches[workspace.currentBranchId]
		if (!currentBranch) return null

		const trimmed = name.trim()
		if (!trimmed) return null

		const now = Date.now()
		const baseSnapshot =
			(fromSnapshotId && currentBranch.snapshots.find((s) => s.id === fromSnapshotId)) || null
		const baseState = structuredClone(baseSnapshot?.state ?? currentBranch.workingState)
		const forkSnapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: baseSnapshot ? `Fork base: ${baseSnapshot.name}` : 'Fork base',
			createdAt: now,
			parentSnapshotId: baseSnapshot?.id ?? currentBranch.headSnapshotId,
			mergedFromBranchId: null,
			mergedFromSnapshotId: null,
			isAuto: false,
			state: structuredClone(baseState),
		}

		const branch: WorkspaceBranch = {
			id: uniqueId(),
			name: trimmed,
			createdAt: now,
			updatedAt: now,
			parentBranchId: currentBranch.id,
			forkedFromSnapshotId: baseSnapshot?.id ?? currentBranch.headSnapshotId,
			headSnapshotId: forkSnapshot.id,
			workingState: structuredClone(baseState),
			snapshots: [forkSnapshot],
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					branches: {
						...current.branches,
						[branch.id]: branch,
					},
				},
			}
		})
		this.persistState()
		return branch
	}

	mergeBranch(sourceBranchId: string, targetBranchId?: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		const source = workspace.branches[sourceBranchId]
		if (!source) return false
		const resolvedTargetBranchId = targetBranchId ?? workspace.currentBranchId
		const target = workspace.branches[resolvedTargetBranchId]
		if (!target) return false
		if (source.id === target.id) return false

		const mergedState = structuredClone(source.workingState)
		const now = Date.now()
		const mergeSnapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: `Merge "${source.name}" into "${target.name}"`,
			createdAt: now,
			parentSnapshotId: target.headSnapshotId,
			mergedFromBranchId: source.id,
			mergedFromSnapshotId: null,
			isAuto: false,
			state: structuredClone(mergedState),
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentTarget = current.branches[resolvedTargetBranchId]
			if (!currentTarget) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					branches: {
						...current.branches,
						[resolvedTargetBranchId]: {
							...currentTarget,
							updatedAt: now,
							headSnapshotId: mergeSnapshot.id,
							workingState: structuredClone(mergedState),
							snapshots: [...currentTarget.snapshots, mergeSnapshot],
						},
					},
				},
			}
		})

		this.persistState()
		if (workspace.currentBranchId === resolvedTargetBranchId) {
			this.applyWorkspaceState(mergedState)
		}
		return true
	}

	mergeSnapshotIntoBranch(sourceBranchId: string, snapshotId: string, targetBranchId: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		const sourceBranch = workspace.branches[sourceBranchId]
		if (!sourceBranch) return false
		const targetBranch = workspace.branches[targetBranchId]
		if (!targetBranch) return false
		if (sourceBranchId === targetBranchId) return false
		const sourceSnapshot = sourceBranch.snapshots.find((s) => s.id === snapshotId)
		if (!sourceSnapshot) return false

		const now = Date.now()
		const mergeSnapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: `Merge "${sourceSnapshot.name}" from "${sourceBranch.name}"`,
			createdAt: now,
			parentSnapshotId: targetBranch.headSnapshotId,
			mergedFromBranchId: sourceBranchId,
			mergedFromSnapshotId: snapshotId,
			isAuto: false,
			state: structuredClone(sourceSnapshot.state),
		}

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentTarget = current.branches[targetBranchId]
			if (!currentTarget) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					branches: {
						...current.branches,
						[targetBranchId]: {
							...currentTarget,
							updatedAt: now,
							headSnapshotId: mergeSnapshot.id,
							workingState: structuredClone(sourceSnapshot.state),
							snapshots: [...currentTarget.snapshots, mergeSnapshot],
						},
					},
				},
			}
		})

		this.persistState()
		if (workspace.currentBranchId === targetBranchId) {
			this.applyWorkspaceState(sourceSnapshot.state)
		}
		return true
	}

	pruneBranch(branchId: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		if (workspace.currentBranchId === branchId) return false
		if (!workspace.branches[branchId]) return false
		if (Object.keys(workspace.branches).length <= 1) return false

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const nextBranches = { ...current.branches }
			delete nextBranches[branchId]
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: Date.now(),
					branches: nextBranches,
				},
			}
		})
		this.persistState()
		return true
	}

	pruneSnapshot(branchId: string, snapshotId: string): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		const branch = workspace.branches[branchId]
		if (!branch) return false
		if (!branch.snapshots.some((s) => s.id === snapshotId)) return false
		if (branch.snapshots.length <= 1) return false

		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentBranch = current.branches[branchId]
			if (!currentBranch) return prev
			const snapshots = currentBranch.snapshots.filter((s) => s.id !== snapshotId)
			const fallbackHead = snapshots[snapshots.length - 1]?.id ?? null
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: Date.now(),
					branches: {
						...current.branches,
						[branchId]: {
							...currentBranch,
							updatedAt: Date.now(),
							headSnapshotId:
								currentBranch.headSnapshotId === snapshotId
									? fallbackHead
									: currentBranch.headSnapshotId,
							snapshots,
						},
					},
				},
			}
		})
		this.persistState()
		return true
	}

	setAutoSnapshotInterval(minutes: number | null): boolean {
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return false
		const value = minutes === null ? null : Math.max(1, Math.floor(minutes))
		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					autoSnapshotIntervalMinutes: value,
					updatedAt: Date.now(),
				},
			}
		})
		this.persistState()
		return true
	}

	reset(): void {
		this.isApplyingState = false
	}

	override dispose(): void {
		if (this.autoSnapshotTimer) {
			window.clearInterval(this.autoSnapshotTimer)
			this.autoSnapshotTimer = null
		}
		if (this.workingStateSaveTimer) {
			window.clearInterval(this.workingStateSaveTimer)
			this.workingStateSaveTimer = null
		}
		super.dispose()
	}

	private captureWorkspaceState(): WorkspaceState {
		return {
			editorSnapshot: structuredClone(this.app.editor.getSnapshot()),
			appState: structuredClone(this.app.persistence.serializeState()),
		}
	}

	private applyWorkspaceState(state: WorkspaceState) {
		this.isApplyingState = true
		try {
			this.app.editor.loadSnapshot(structuredClone(state.editorSnapshot))
			this.app.persistence.loadAppState(structuredClone(state.appState))
		} finally {
			this.isApplyingState = false
		}
	}

	private createInitialWorkspace(name: string): Workspace {
		const now = Date.now()
		const workingState = this.captureWorkspaceState()
		const initialSnapshot: WorkspaceSnapshot = {
			id: uniqueId(),
			name: 'Initial snapshot',
			createdAt: now,
			parentSnapshotId: null,
			mergedFromBranchId: null,
			mergedFromSnapshotId: null,
			isAuto: false,
			state: structuredClone(workingState),
		}
		const mainBranch: WorkspaceBranch = {
			id: uniqueId(),
			name: 'main',
			createdAt: now,
			updatedAt: now,
			parentBranchId: null,
			forkedFromSnapshotId: null,
			headSnapshotId: initialSnapshot.id,
			workingState,
			snapshots: [initialSnapshot],
		}
		return {
			id: uniqueId(),
			name: name.trim() || 'Workspace',
			createdAt: now,
			updatedAt: now,
			autoSnapshotIntervalMinutes: null,
			lastAutoSnapshotAt: null,
			currentBranchId: mainBranch.id,
			branches: {
				[mainBranch.id]: mainBranch,
			},
		}
	}

	private captureCurrentBranchWorkingState() {
		if (this.isApplyingState) return
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return
		const branch = workspace.branches[workspace.currentBranchId]
		if (!branch) return
		const state = this.captureWorkspaceState()
		const now = Date.now()
		this.$workspaces.update((prev) => {
			const current = prev[workspace.id]
			if (!current) return prev
			const currentBranch = current.branches[current.currentBranchId]
			if (!currentBranch) return prev
			return {
				...prev,
				[workspace.id]: {
					...current,
					updatedAt: now,
					branches: {
						...current.branches,
						[current.currentBranchId]: {
							...currentBranch,
							updatedAt: now,
							workingState: structuredClone(state),
						},
					},
				},
			}
		})
	}

	private maybeAutoSnapshot() {
		if (this.isApplyingState) return
		const workspace = this.getCurrentWorkspace()
		if (!workspace) return
		const intervalMinutes = workspace.autoSnapshotIntervalMinutes
		if (!intervalMinutes || intervalMinutes <= 0) return
		const now = Date.now()
		const last = workspace.lastAutoSnapshotAt ?? 0
		if (now - last < intervalMinutes * MS_PER_MINUTE) return
		this.createSnapshot(`Auto ${formatWorkspaceTime(now)}`, { isAuto: true })
	}

	private startTimers() {
		this.autoSnapshotTimer = window.setInterval(
			() => this.maybeAutoSnapshot(),
			AUTO_SNAPSHOT_CHECK_INTERVAL_MS
		)
		this.workingStateSaveTimer = window.setInterval(() => {
			this.captureCurrentBranchWorkingState()
			this.persistState()
		}, WORKING_STATE_SAVE_INTERVAL_MS)
	}

	private isValidPersistedState(parsed: unknown): parsed is PersistedWorkspacesState {
		const state = parsed as PersistedWorkspacesState | null
		return !!state && state.version === 1 && !!state.currentWorkspaceId && !!state.workspaces
	}

	private async loadPersistedState(): Promise<PersistedWorkspacesState | null> {
		// Primary store: IndexedDB (structured clone, no ~5MB quota)
		try {
			const stored = await kvGet<PersistedWorkspacesState>(STORAGE_KEY)
			if (this.isValidPersistedState(stored)) return stored
		} catch (e) {
			console.error('Failed to load workspaces from IndexedDB', e)
		}

		// Migration path: state persisted by older builds lives in localStorage
		try {
			const legacy = globalThis.localStorage?.getItem(STORAGE_KEY)
			if (legacy) {
				const parsed = JSON.parse(legacy)
				if (this.isValidPersistedState(parsed)) {
					// Move it to IndexedDB and clear the old copy
					kvSet(STORAGE_KEY, parsed)
						.then(() => globalThis.localStorage?.removeItem(STORAGE_KEY))
						.catch(() => {})
					return parsed
				}
			}
		} catch {
			// fall through to a fresh workspace
		}

		return null
	}

	/** Chain of pending writes so persists never interleave. */
	private persistQueue: Promise<void> = Promise.resolve()

	/** Only toast the user about persistence failure once per session. */
	private hasReportedPersistError = false

	private persistState() {
		const currentWorkspaceId = this.$currentWorkspaceId.get()
		if (!currentWorkspaceId) return
		const state: PersistedWorkspacesState = {
			version: 1,
			currentWorkspaceId,
			workspaces: this.$workspaces.get(),
		}
		this.persistQueue = this.persistQueue
			.then(() => kvSet(STORAGE_KEY, state))
			.catch((e) => {
				console.error('Failed to persist workspaces', e)
				if (!this.hasReportedPersistError) {
					this.hasReportedPersistError = true
					this.app.options.onError(
						'Failed to save workspace snapshots — recent snapshots may be lost on reload'
					)
				}
			})
	}

	/** Remove all persisted workspace state (unused in the app, useful in dev). */
	async clearPersistedState() {
		await kvDelete(STORAGE_KEY)
	}
}
