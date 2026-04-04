import { Workspace, WorkspaceBranch } from '../agent/managers/WorkspaceManager'

function formatTime(ts: number) {
	return new Date(ts).toLocaleString()
}

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
						const n = workspaces.length + 1
						onCreateWorkspace(`Workspace ${n}`)
					}}
				>
					New workspace
				</button>
			</div>
			<div className="workspace-landing-grid">
				{workspaces.map((workspace) => {
					const latest = getLatestSnapshot(workspace)
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
									Latest: {latest.snapshot.name} ({formatTime(latest.snapshot.createdAt)})
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

function getLatestSnapshot(workspace: Workspace): { branch: WorkspaceBranch; snapshot: WorkspaceBranch['snapshots'][number] } | null {
	let latest: { branch: WorkspaceBranch; snapshot: WorkspaceBranch['snapshots'][number] } | null = null
	for (const branch of Object.values(workspace.branches)) {
		for (const snapshot of branch.snapshots) {
			if (!latest || snapshot.createdAt > latest.snapshot.createdAt) {
				latest = { branch, snapshot }
			}
		}
	}
	return latest
}
