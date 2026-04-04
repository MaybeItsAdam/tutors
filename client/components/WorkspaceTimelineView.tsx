import { useMemo, useState } from 'react'
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
	const [previewIndexBySnapshot, setPreviewIndexBySnapshot] = useState<Record<string, number>>({})

	const previewDataBySnapshot = useMemo(() => {
		const entries: Record<string, { currentPageId: string | null; pages: { id: string; name: string; shapeCount: number }[] }> = {}
		for (const branch of branches) {
			for (const snapshot of branch.snapshots) {
				const editorSnapshot = snapshot.state?.editorSnapshot as
					| {
							session?: { currentPageId?: string }
							document?: { currentPageId?: string }
							store?: Record<string, unknown> | unknown[]
					  }
					| undefined
				const store = editorSnapshot?.store
				const records = Array.isArray(store)
					? store
					: store && typeof store === 'object'
						? Object.values(store)
						: []

				const pages = records
					.filter((record): record is { id: string; typeName: string; name?: string } => {
						if (!record || typeof record !== 'object') return false
						const candidate = record as { id?: unknown; typeName?: unknown; name?: unknown }
						return (
							typeof candidate.id === 'string' &&
							candidate.typeName === 'page' &&
							(candidate.name === undefined || typeof candidate.name === 'string')
						)
					})
					.map((page) => ({
						id: page.id,
						name: page.name || 'Untitled page',
						shapeCount: 0,
					}))

				const shapeCounts = new Map<string, number>()
				for (const record of records) {
					if (!record || typeof record !== 'object') continue
					const candidate = record as { typeName?: unknown; parentId?: unknown }
					if (candidate.typeName !== 'shape' || typeof candidate.parentId !== 'string') continue
					shapeCounts.set(candidate.parentId, (shapeCounts.get(candidate.parentId) ?? 0) + 1)
				}

				const pagesWithShapes = pages.map((page) => ({
					...page,
					shapeCount: shapeCounts.get(page.id) ?? 0,
				}))

				entries[snapshot.id] = {
					currentPageId:
						editorSnapshot?.session?.currentPageId ?? editorSnapshot?.document?.currentPageId ?? null,
					pages: pagesWithShapes,
				}
			}
		}
		return entries
	}, [branches])

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
						<div className="workspace-history-canvas">
							<div className="workspace-history-canvas-inner">
							{[...branch.snapshots]
								.sort((a, b) => b.createdAt - a.createdAt)
								.map((snapshot) => (
									<div key={snapshot.id} className="workspace-timeline-snapshot workspace-history-node">
										<div className="workspace-timeline-snapshot-name">
											{snapshot.name} {snapshot.isAuto ? '(auto)' : ''}
										</div>
										<div className="workspace-timeline-snapshot-meta">
											{formatWorkspaceTime(snapshot.createdAt)}
											{snapshot.parentSnapshotId ? ' · forked' : ''}
											{snapshot.mergedFromBranchId ? ' · merged' : ''}
										</div>
										{(() => {
											const previewData = previewDataBySnapshot[snapshot.id]
											const pages = previewData?.pages ?? []
											if (pages.length === 0) {
												return (
													<div className="workspace-snapshot-preview">
														<div className="workspace-snapshot-preview-title">No page data in snapshot</div>
													</div>
												)
											}
											const preferredIndex = Math.max(
												0,
												pages.findIndex((page) => page.id === previewData?.currentPageId)
											)
											const selectedIndex = Math.min(
												pages.length - 1,
												previewIndexBySnapshot[snapshot.id] ?? preferredIndex
											)
											const selectedPage = pages[selectedIndex]
											return (
												<div className="workspace-snapshot-preview">
													<div className="workspace-snapshot-preview-nav">
														<button
															type="button"
															className="workspace-snapshot-arrow"
															onClick={() =>
																setPreviewIndexBySnapshot((prev) => ({
																	...prev,
																	[snapshot.id]: Math.max(0, selectedIndex - 1),
																}))
															}
															disabled={selectedIndex <= 0}
															aria-label="Previous page preview"
														>
															←
														</button>
														<div className="workspace-snapshot-preview-title">
															{selectedPage.name} ({selectedIndex + 1}/{pages.length})
														</div>
														<button
															type="button"
															className="workspace-snapshot-arrow"
															onClick={() =>
																setPreviewIndexBySnapshot((prev) => ({
																	...prev,
																	[snapshot.id]: Math.min(pages.length - 1, selectedIndex + 1),
																}))
															}
															disabled={selectedIndex >= pages.length - 1}
															aria-label="Next page preview"
														>
															→
														</button>
													</div>
													<div className="workspace-snapshot-preview-canvas" draggable={false}>
														<div className="workspace-snapshot-preview-count">
															{selectedPage.shapeCount} objects on page
														</div>
														<div className="workspace-snapshot-preview-note">
															Auto-arranged history preview (non-draggable)
														</div>
													</div>
												</div>
											)
										})()}
									</div>
								))}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
