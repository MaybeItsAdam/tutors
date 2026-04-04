import { Workspace } from '../agent/managers/WorkspaceManager'
import { formatWorkspaceTime } from '../utils/workspaceFormat'
import { getLatestWorkspaceSnapshot } from '../utils/workspaceSnapshot'

export function WorkspaceLandingPage({
	workspaces,
	onSelectWorkspace,
	onCreateWorkspace,
}: {
	workspaces: Workspace[]
	onSelectWorkspace: (workspaceId: string) => void
	onCreateWorkspace: (name: string) => void
}) {
	return (
		<div className="workspace-screen">
			<div className="workspace-screen-header">
				<h1>Workspaces</h1>
				<button
					className="workspace-screen-primary"
					onClick={() => {
						const usedNums = workspaces
							.map((workspace) => {
								const match = workspace.name.match(/^Workspace\s+(\d+)$/)
								return match ? Number(match[1]) : null
							})
							.filter((v): v is number => v !== null)
						const n = (usedNums.length ? Math.max(...usedNums) : 0) + 1
						onCreateWorkspace(`Workspace ${n}`)
					}}
				>
					New workspace
				</button>
			</div>
			<div className="workspace-landing-grid">
				{workspaces.map((workspace) => {
					const latest = getLatestWorkspaceSnapshot(workspace)
					return (
						<button
							key={workspace.id}
							className="workspace-landing-card"
							onClick={() => onSelectWorkspace(workspace.id)}
						>
							<div className="workspace-landing-card-title">{workspace.name}</div>
							<div className="workspace-landing-card-meta">
								{Object.keys(workspace.branches).length} branches
							</div>
							{latest ? (
								<div className="workspace-landing-card-latest">
									Latest: {latest.snapshot.name} ({formatWorkspaceTime(latest.snapshot.createdAt)})
								</div>
							) : (
								<div className="workspace-landing-card-latest">No snapshots yet</div>
							)}
						</button>
					)
				})}
			</div>
		</div>
	)
}
