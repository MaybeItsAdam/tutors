import { useCallback, useMemo, useRef, useState } from 'react'
import { useTldrawAgentApp } from '../agent/TldrawAgentAppProvider'
import {
	Workspace,
	WorkspaceBranch,
	WorkspaceSnapshot,
} from '../agent/managers/WorkspaceManager'
import { formatWorkspaceTime } from '../utils/workspaceFormat'
import {
	downloadCanvasImage,
	downloadWorkspaceFile,
	parseWorkspaceFile,
	reidentifyWorkspace,
} from '../utils/workspaceExport'

export function WorkspacePanel({ currentWorkspace }: { currentWorkspace: Workspace | null }) {
	const app = useTldrawAgentApp()
	const [snapshotName, setSnapshotName] = useState('')
	const [forkName, setForkName] = useState('')
	const [newWorkspaceName, setNewWorkspaceName] = useState('')
	const [autoMinutes, setAutoMinutes] = useState('')

	const branches = useMemo(() => app.workspaces.getBranchesForCurrentWorkspace(), [app, currentWorkspace])
	const currentBranch = currentWorkspace
		? currentWorkspace.branches[currentWorkspace.currentBranchId] ?? null
		: null

	if (!currentWorkspace || !currentBranch) {
		return null
	}

	const snapshots = app.workspaces.getSnapshotsForBranch(currentBranch.id)
	const candidateMergeBranchId = branches.find((branch) => branch.id !== currentBranch.id)?.id ?? ''

	return (
		<div className="workspace-panel">
			<div className="workspace-row">
				<input
					className="workspace-input"
					placeholder="New workspace name"
					value={newWorkspaceName}
					onChange={(e) => setNewWorkspaceName(e.currentTarget.value)}
				/>
				<button
					className="workspace-btn"
					onClick={() => {
						const name = newWorkspaceName.trim()
						if (!name) return
						app.workspaces.createWorkspace(name)
						setNewWorkspaceName('')
					}}
				>
					Create Workspace
				</button>
			</div>

			<div className="workspace-row">
				<label className="workspace-label">Workspace</label>
				<select
					className="workspace-select"
					value={currentWorkspace.id}
					onChange={(e) => app.workspaces.switchWorkspace(e.currentTarget.value)}
				>
					{app.workspaces.getWorkspaces().map((workspace) => (
						<option key={workspace.id} value={workspace.id}>
							{workspace.name}
						</option>
					))}
				</select>
			</div>

			<div className="workspace-row">
				<label className="workspace-label">Branch</label>
				<select
					className="workspace-select"
					value={currentBranch.id}
					onChange={(e) => app.workspaces.switchBranch(e.currentTarget.value)}
				>
					{branches.map((branch) => (
						<option key={branch.id} value={branch.id}>
							{branch.name}
						</option>
					))}
				</select>
			</div>

			<div className="workspace-row">
				<input
					className="workspace-input"
					placeholder="Fork branch name"
					value={forkName}
					onChange={(e) => setForkName(e.currentTarget.value)}
				/>
				<button
					className="workspace-btn"
					onClick={() => {
						const name = forkName.trim()
						if (!name) return
						app.workspaces.forkBranch(name)
						setForkName('')
					}}
				>
					Fork
				</button>
				<button
					className="workspace-btn"
					onClick={() => {
						const sourceId = candidateMergeBranchId
						if (!sourceId) return
						app.workspaces.mergeBranch(sourceId)
					}}
				>
					Merge
				</button>
			</div>

			<div className="workspace-row">
				<input
					className="workspace-input"
					placeholder="Snapshot name"
					value={snapshotName}
					onChange={(e) => setSnapshotName(e.currentTarget.value)}
				/>
				<button
					className="workspace-btn"
					onClick={() => {
						app.workspaces.createSnapshot(snapshotName.trim() || undefined)
						setSnapshotName('')
					}}
				>
					Snapshot
				</button>
			</div>

			<div className="workspace-row">
				<input
					className="workspace-input"
					type="number"
					min={1}
					placeholder="Auto snapshot mins (empty=off)"
					value={autoMinutes}
					onChange={(e) => setAutoMinutes(e.currentTarget.value)}
				/>
				<button
					className="workspace-btn"
					onClick={() => {
						if (!autoMinutes.trim()) {
							app.workspaces.setAutoSnapshotInterval(null)
							return
						}
						const value = Number(autoMinutes)
						if (Number.isFinite(value) && value > 0) {
							app.workspaces.setAutoSnapshotInterval(value)
						}
					}}
				>
					Set Auto
				</button>
			</div>

			<ShareRow workspace={currentWorkspace} />

			<div className="workspace-history">
				<div className="workspace-meta">Current branch snapshots: {snapshots.length}</div>
				{branches.map((branch) => (
					<BranchHistory
						key={branch.id}
						branch={branch}
						currentBranchId={currentBranch.id}
						onSwitch={() => app.workspaces.switchBranch(branch.id)}
						onRestore={(snapshotId) => app.workspaces.restoreSnapshot(branch.id, snapshotId)}
						onPruneSnapshot={(snapshotId) => app.workspaces.pruneSnapshot(branch.id, snapshotId)}
						onPruneBranch={() => app.workspaces.pruneBranch(branch.id)}
					/>
				))}
			</div>
		</div>
	)
}

/**
 * Getting work out of the app and back into it: the canvas as an image to hand
 * in or revise from, and the whole workspace - canvas, branches, snapshots and
 * chat - as a file to back up, move between machines, or share.
 */
function ShareRow({ workspace }: { workspace: Workspace }) {
	const app = useTldrawAgentApp()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [status, setStatus] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const exportImage = useCallback(
		async (format: 'png' | 'svg') => {
			setBusy(true)
			setStatus(null)
			try {
				const exported = await downloadCanvasImage(app.editor, format, workspace.name)
				if (!exported) setStatus('Nothing on the canvas to export yet.')
			} catch (e) {
				console.error('Failed to export canvas image', e)
				setStatus("Couldn't export the canvas.")
			} finally {
				setBusy(false)
			}
		},
		[app, workspace.name]
	)

	const exportWorkspace = useCallback(() => {
		setStatus(null)
		try {
			downloadWorkspaceFile(workspace)
		} catch (e) {
			console.error('Failed to export workspace', e)
			setStatus("Couldn't export this workspace.")
		}
	}, [workspace])

	const importWorkspace = useCallback(
		async (file: File) => {
			setBusy(true)
			setStatus(null)
			try {
				const imported = parseWorkspaceFile(await file.text())
				// Fresh ids, so importing a file exported from this same app
				// adds a copy instead of overwriting the original.
				const ok = app.workspaces.importWorkspace(reidentifyWorkspace(imported))
				setStatus(ok ? `Imported "${imported.name}".` : "Couldn't import that workspace.")
			} catch (e) {
				setStatus(e instanceof Error ? e.message : "Couldn't read that file.")
			} finally {
				setBusy(false)
			}
		},
		[app]
	)

	return (
		<div className="workspace-share">
			<div className="workspace-row">
				<label className="workspace-label">Export</label>
				<button className="workspace-btn" disabled={busy} onClick={() => exportImage('png')}>
					PNG
				</button>
				<button className="workspace-btn" disabled={busy} onClick={() => exportImage('svg')}>
					SVG
				</button>
				<button className="workspace-btn" disabled={busy} onClick={exportWorkspace}>
					Workspace file
				</button>
			</div>
			<div className="workspace-row">
				<label className="workspace-label">Import</label>
				<button
					className="workspace-btn"
					disabled={busy}
					onClick={() => fileInputRef.current?.click()}
				>
					Open workspace file
				</button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".json,application/json"
					style={{ display: 'none' }}
					onChange={(e) => {
						const file = e.currentTarget.files?.[0]
						// Reset first, so picking the same file twice still fires.
						e.currentTarget.value = ''
						if (file) importWorkspace(file)
					}}
				/>
			</div>
			{status && <div className="workspace-meta workspace-share-status">{status}</div>}
		</div>
	)
}

function BranchHistory({
	branch,
	currentBranchId,
	onSwitch,
	onRestore,
	onPruneSnapshot,
	onPruneBranch,
}: {
	branch: WorkspaceBranch
	currentBranchId: string
	onSwitch: () => void
	onRestore: (snapshotId: string) => void
	onPruneSnapshot: (snapshotId: string) => void
	onPruneBranch: () => void
}) {
	const isCurrent = branch.id === currentBranchId
	return (
		<div className={'workspace-branch ' + (isCurrent ? 'workspace-branch-current' : '')}>
			<div className="workspace-branch-header">
				<div>
					<strong>{branch.name}</strong>
					<div className="workspace-meta">
						{isCurrent ? 'current' : 'branch'} · updated {formatWorkspaceTime(branch.updatedAt)}
					</div>
				</div>
				<div className="workspace-branch-actions">
					{!isCurrent && (
						<button className="workspace-btn" onClick={onSwitch}>
							Switch
						</button>
					)}
					{!isCurrent && (
						<button className="workspace-btn workspace-btn-danger" onClick={onPruneBranch}>
							Prune
						</button>
					)}
				</div>
			</div>
			<div className="workspace-snapshots">
				{[...branch.snapshots]
					.sort((a, b) => b.createdAt - a.createdAt)
					.map((snapshot) => (
						<SnapshotRow
							key={snapshot.id}
							snapshot={snapshot}
							onRestore={() => onRestore(snapshot.id)}
							onPrune={() => onPruneSnapshot(snapshot.id)}
						/>
					))}
			</div>
		</div>
	)
}

function SnapshotRow({
	snapshot,
	onRestore,
	onPrune,
}: {
	snapshot: WorkspaceSnapshot
	onRestore: () => void
	onPrune: () => void
}) {
	return (
		<div className="workspace-snapshot">
			<div className="workspace-snapshot-main">
				<div className="workspace-snapshot-name">
					{snapshot.name} {snapshot.isAuto ? '(auto)' : ''}
				</div>
				<div className="workspace-meta">
					{formatWorkspaceTime(snapshot.createdAt)}
					{snapshot.parentSnapshotId ? ' · forked' : ''}
					{snapshot.mergedFromBranchId ? ' · merge commit' : ''}
				</div>
			</div>
			<div className="workspace-snapshot-actions">
				<button className="workspace-btn" onClick={onRestore}>
					Restore
				</button>
				<button className="workspace-btn workspace-btn-danger" onClick={onPrune}>
					Prune
				</button>
			</div>
		</div>
	)
}
