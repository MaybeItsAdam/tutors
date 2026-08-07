import { useCallback, useRef, useState } from 'react'
import { Workspace } from '../agent/managers/WorkspaceManager'
import { downloadWorkspaceFile, parseWorkspaceFile, reidentifyWorkspace } from '../utils/workspaceExport'
import { formatWorkspaceTime } from '../utils/workspaceFormat'
import { getLatestWorkspaceSnapshot } from '../utils/workspaceSnapshot'

export function WorkspaceLandingPage({
	workspaces,
	onSelectWorkspace,
	onCreateWorkspace,
	onImportWorkspace,
}: {
	workspaces: Workspace[]
	onSelectWorkspace: (workspaceId: string) => void
	onCreateWorkspace: (name: string) => void
	/** Hand a parsed + re-identified workspace to the manager. Returns success. */
	onImportWorkspace?: (workspace: Workspace) => boolean
}) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [status, setStatus] = useState<string | null>(null)

	const importWorkspaceFile = useCallback(
		async (file: File) => {
			if (!onImportWorkspace) return
			setStatus(null)
			try {
				const imported = parseWorkspaceFile(await file.text())
				// Fresh ids, so importing a file exported from this same app
				// adds a copy instead of overwriting the original.
				const ok = onImportWorkspace(reidentifyWorkspace(imported))
				setStatus(ok ? `Imported "${imported.name}".` : "Couldn't import that workspace.")
			} catch (e) {
				setStatus(e instanceof Error ? e.message : "Couldn't read that file.")
			}
		},
		[onImportWorkspace]
	)

	const exportWorkspace = useCallback((workspace: Workspace) => {
		try {
			downloadWorkspaceFile(workspace)
		} catch (e) {
			console.error('Failed to export workspace', e)
			setStatus(`Couldn't export "${workspace.name}".`)
		}
	}, [])

	return (
		<div className="workspace-screen">
			<div className="workspace-screen-header">
				<h1>Workspaces</h1>
				{onImportWorkspace && (
					<>
						<button
							className="workspace-landing-import-btn"
							onClick={() => fileInputRef.current?.click()}
						>
							Import workspace file
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept=".json,application/json"
							aria-label="Import a workspace file"
							style={{ display: 'none' }}
							onChange={(e) => {
								const file = e.currentTarget.files?.[0]
								// Reset first, so picking the same file twice still fires.
								e.currentTarget.value = ''
								if (file) importWorkspaceFile(file)
							}}
						/>
					</>
				)}
			</div>
			{status && <div className="workspace-landing-status">{status}</div>}
			<div className="workspace-landing-grid">
				<button
					className="workspace-landing-card workspace-landing-card-add"
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
					<div className="workspace-landing-card-title">+ Add workspace</div>
					<div className="workspace-landing-card-meta">Create a new workspace</div>
				</button>
				{workspaces.map((workspace) => {
					const latest = getLatestWorkspaceSnapshot(workspace)
					return (
						<div key={workspace.id} className="workspace-landing-card-wrap">
							<button
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
							<button
								className="workspace-landing-export-btn"
								title={`Export "${workspace.name}" as a .tutors.json file`}
								aria-label={`Export ${workspace.name}`}
								onClick={(e) => {
									e.stopPropagation()
									exportWorkspace(workspace)
								}}
							>
								Export
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
}
