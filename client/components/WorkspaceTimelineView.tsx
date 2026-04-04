import { Workspace } from '../agent/managers/WorkspaceManager'
import { formatWorkspaceTime } from '../utils/workspaceFormat'
import { getLatestWorkspaceSnapshot } from '../utils/workspaceSnapshot'

export function WorkspaceTimelineView({
	workspace,
	onContinueLatest,
	onOpenEditor,
}: {
	workspace: Workspace
	onContinueLatest: () => void
	onOpenEditor: () => void
}) {
	const branches = Object.values(workspace.branches).sort((a, b) => a.createdAt - b.createdAt)
	const latest = getLatestWorkspaceSnapshot(workspace)
	return (
		<div className="workspace-screen">
			<div className="workspace-screen-header">
				<h2>{workspace.name}</h2>
				{latest && (
					<button className="workspace-screen-primary" onClick={onContinueLatest}>
						Continue latest ({latest.snapshot.name})
					</button>
				)}
				<button className="workspace-screen-secondary" onClick={onOpenEditor}>
					Open workspace editor
				</button>
			</div>
			<div className="workspace-timeline-grid">
				{branches.map((branch) => (
					<div key={branch.id} className="workspace-timeline-branch">
						<div className="workspace-timeline-branch-title">
							{branch.name}
							{workspace.currentBranchId === branch.id ? ' (current)' : ''}
						</div>
						<div className="workspace-timeline-branch-meta">
							Updated {formatWorkspaceTime(branch.updatedAt)}
						</div>
						<div className="workspace-timeline-snapshots">
							{[...branch.snapshots]
								.sort((a, b) => b.createdAt - a.createdAt)
								.map((snapshot) => (
									<div key={snapshot.id} className="workspace-timeline-snapshot">
										<div className="workspace-timeline-snapshot-name">
											{snapshot.name} {snapshot.isAuto ? '(auto)' : ''}
										</div>
										<div className="workspace-timeline-snapshot-meta">
											{formatWorkspaceTime(snapshot.createdAt)}
											{snapshot.parentSnapshotId ? ' · forked' : ''}
											{snapshot.mergedFromBranchId ? ' · merged' : ''}
										</div>
									</div>
								))}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
