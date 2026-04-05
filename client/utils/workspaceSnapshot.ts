import { Workspace, WorkspaceSnapshot } from '../agent/managers/WorkspaceManager'

export function getLatestWorkspaceSnapshot(
	workspace: Workspace
): { branchId: string; snapshot: WorkspaceSnapshot } | null {
	let latest: { branchId: string; snapshot: WorkspaceSnapshot } | null = null
	for (const branch of Object.values(workspace.branches)) {
		for (const snapshot of branch.snapshots) {
			if (!latest || snapshot.createdAt > latest.snapshot.createdAt) {
				latest = { branchId: branch.id, snapshot }
			}
		}
	}
	return latest
}
