import { Editor, uniqueId } from 'tldraw'
import { Workspace, WorkspaceBranch, WorkspaceSnapshot } from '../agent/managers/WorkspaceManager'

/** Marker identifying a file this app wrote, so imports can reject anything else. */
export const WORKSPACE_FILE_FORMAT = 'tutors-workspace'
export const WORKSPACE_FILE_VERSION = 1

export interface WorkspaceExportFile {
	format: typeof WORKSPACE_FILE_FORMAT
	version: typeof WORKSPACE_FILE_VERSION
	exportedAt: number
	workspace: Workspace
}

/** Turn a workspace name into something safe to use as a filename. */
export function toFileStem(name: string, fallback = 'workspace'): string {
	const stem = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return stem || fallback
}

/**
 * Hand a blob to the browser as a download.
 *
 * The object URL is revoked on the next frame rather than immediately -
 * revoking synchronously can beat the browser to starting the download.
 */
export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	requestAnimationFrame(() => URL.revokeObjectURL(url))
}

/**
 * Export everything on the current page as an image.
 *
 * @returns false when the page is empty, so the caller can say so rather than
 * handing the user a blank file.
 */
export async function downloadCanvasImage(
	editor: Editor,
	format: 'png' | 'svg',
	name = 'canvas'
): Promise<boolean> {
	const shapeIds = [...editor.getCurrentPageShapeIds()]
	if (shapeIds.length === 0) return false

	const result = await editor.toImage(shapeIds, {
		format,
		background: true,
		padding: 32,
		// PNG is a raster, so give it enough pixels to stay readable when a
		// student zooms in on the working. SVG is resolution-independent.
		scale: format === 'png' ? 2 : 1,
	})

	downloadBlob(result.blob, `${toFileStem(name, 'canvas')}.${format}`)
	return true
}

/** Serialize a workspace - canvas, branches, snapshots and agent state - to a file. */
export function downloadWorkspaceFile(workspace: Workspace) {
	const file: WorkspaceExportFile = {
		format: WORKSPACE_FILE_FORMAT,
		version: WORKSPACE_FILE_VERSION,
		exportedAt: Date.now(),
		workspace,
	}
	const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
	downloadBlob(blob, `${toFileStem(workspace.name)}.tutors.json`)
}

/**
 * Parse a workspace export file.
 *
 * @throws Error with a message suitable for showing the user.
 */
export function parseWorkspaceFile(text: string): Workspace {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new Error("That file isn't valid JSON.")
	}

	const file = parsed as Partial<WorkspaceExportFile>
	if (!file || typeof file !== 'object' || file.format !== WORKSPACE_FILE_FORMAT) {
		throw new Error("That doesn't look like a workspace file exported from this app.")
	}
	if (file.version !== WORKSPACE_FILE_VERSION) {
		throw new Error(`That file uses workspace format v${file.version}, which this build can't read.`)
	}

	const workspace = file.workspace
	if (!isWorkspaceShaped(workspace)) {
		throw new Error('That workspace file is missing data or is corrupted.')
	}

	return workspace
}

function isWorkspaceShaped(value: unknown): value is Workspace {
	const workspace = value as Workspace | undefined
	if (!workspace || typeof workspace !== 'object') return false
	if (typeof workspace.name !== 'string') return false
	if (!workspace.branches || typeof workspace.branches !== 'object') return false

	const branches = Object.values(workspace.branches)
	if (branches.length === 0) return false

	return branches.every(
		(branch) =>
			!!branch &&
			typeof branch.name === 'string' &&
			Array.isArray(branch.snapshots) &&
			!!branch.workingState?.editorSnapshot
	)
}

/**
 * Give an imported workspace fresh ids.
 *
 * Ids are only unique within the app that generated them, so importing a file
 * exported from this same app - a common way to duplicate a workspace - would
 * otherwise collide with, and silently overwrite, the original. Every internal
 * reference is rewritten to match; references to ids not present in the file
 * are dropped rather than left dangling.
 */
export function reidentifyWorkspace(workspace: Workspace, name?: string): Workspace {
	const branchIds = new Map<string, string>()
	const snapshotIds = new Map<string, string>()

	for (const branch of Object.values(workspace.branches)) {
		branchIds.set(branch.id, uniqueId())
		for (const snapshot of branch.snapshots) {
			snapshotIds.set(snapshot.id, uniqueId())
		}
	}

	const remapBranch = (id: string | null) => (id ? branchIds.get(id) ?? null : null)
	const remapSnapshot = (id: string | null) => (id ? snapshotIds.get(id) ?? null : null)

	const branches: Record<string, WorkspaceBranch> = {}
	for (const branch of Object.values(workspace.branches)) {
		const id = branchIds.get(branch.id)!
		const snapshots: WorkspaceSnapshot[] = branch.snapshots.map((snapshot) => ({
			...snapshot,
			id: snapshotIds.get(snapshot.id)!,
			parentSnapshotId: remapSnapshot(snapshot.parentSnapshotId),
			mergedFromBranchId: remapBranch(snapshot.mergedFromBranchId),
			mergedFromSnapshotId: remapSnapshot(snapshot.mergedFromSnapshotId),
		}))

		branches[id] = {
			...branch,
			id,
			snapshots,
			parentBranchId: remapBranch(branch.parentBranchId),
			forkedFromSnapshotId: remapSnapshot(branch.forkedFromSnapshotId),
			headSnapshotId: remapSnapshot(branch.headSnapshotId),
		}
	}

	// If the file's current branch is missing, fall back to any branch rather
	// than leaving the workspace pointing at nothing.
	const currentBranchId = remapBranch(workspace.currentBranchId) ?? Object.keys(branches)[0]

	return {
		...workspace,
		id: uniqueId(),
		name: name?.trim() || workspace.name,
		currentBranchId,
		branches,
		updatedAt: Date.now(),
	}
}
