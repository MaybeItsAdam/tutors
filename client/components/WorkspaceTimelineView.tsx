import { useCallback, useMemo, useRef, useState } from 'react'
import { useValue } from 'tldraw'
import { WorkspaceBranch, WorkspaceSnapshot } from '../agent/managers/WorkspaceManager'
import { useTldrawAgentApp } from '../agent/TldrawAgentAppProvider'
import { formatWorkspaceTime } from '../utils/workspaceFormat'

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_W = 184
const NODE_H = 178
const H_GAP = 52   // space between nodes (holds the arrow)
const V_GAP = 76   // space between branch rows
const STEP_X = NODE_W + H_GAP   // 236
const STEP_Y = NODE_H + V_GAP   // 254
// Forked branches start this many columns ahead of their fork point,
// visually shifting them forward so they don't stack directly below the parent.
const FORK_X_OFFSET = 0.42
const PREVIEW_W = 160
const PREVIEW_H = 80
const BRANCH_LABEL_X = -12  // x offset for branch labels (right-aligned)

// ── Shape-bounds helper ───────────────────────────────────────────────────────
interface ShapeRect { x: number; y: number; w: number; h: number; type: string }

function getShapeRects(snapshot: WorkspaceSnapshot): ShapeRect[] {
	const editorSnapshot = snapshot.state?.editorSnapshot as
		| { session?: { currentPageId?: string }; document?: { currentPageId?: string }; store?: unknown }
		| undefined
	if (!editorSnapshot) return []

	const store = editorSnapshot.store
	const records: unknown[] = Array.isArray(store)
		? store
		: store && typeof store === 'object'
			? Object.values(store as Record<string, unknown>)
			: []

	// Find the first page (by index/name order, fall back to first found)
	type PageRecord = { id: string; typeName: string; name?: string; index?: string }
	const pages = records.filter((r): r is PageRecord => {
		if (!r || typeof r !== 'object') return false
		const c = r as Record<string, unknown>
		return c.typeName === 'page' && typeof c.id === 'string'
	})
	if (pages.length === 0) return []

	pages.sort((a, b) => (a.index ?? '').localeCompare(b.index ?? ''))
	const firstPageId = pages[0].id

	// Collect shapes on the first page
	type ShapeRecord = {
		id: string
		typeName: string
		parentId: string
		x?: number
		y?: number
		type?: string
		props?: Record<string, unknown>
	}
	const shapes = records.filter((r): r is ShapeRecord => {
		if (!r || typeof r !== 'object') return false
		const c = r as Record<string, unknown>
		return c.typeName === 'shape' && c.parentId === firstPageId
	})

	return shapes.map((s) => {
		const x = typeof s.x === 'number' ? s.x : 0
		const y = typeof s.y === 'number' ? s.y : 0
		const props = s.props ?? {}
		let w = typeof props.w === 'number' ? props.w : 0
		let h = typeof props.h === 'number' ? props.h : 0

		// Handle draw shapes with segments
		if ((!w || !h) && Array.isArray(props.segments)) {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
			for (const seg of props.segments as Array<{ points?: Array<{ x?: number; y?: number }> }>) {
				for (const pt of seg.points ?? []) {
					const px = typeof pt.x === 'number' ? pt.x : 0
					const py = typeof pt.y === 'number' ? pt.y : 0
					if (px < minX) minX = px
					if (py < minY) minY = py
					if (px > maxX) maxX = px
					if (py > maxY) maxY = py
				}
			}
			if (minX !== Infinity) {
				w = maxX - minX || 4
				h = maxY - minY || 4
			}
		}

		// Default fallback
		if (!w) w = 60
		if (!h) h = 36

		return { x, y, w, h, type: s.type ?? 'unknown' }
	})
}

// ── Snapshot preview SVG ─────────────────────────────────────────────────────
function SnapshotPreview({ snapshot }: { snapshot: WorkspaceSnapshot }) {
	const rects = useMemo(() => getShapeRects(snapshot), [snapshot])

	if (rects.length === 0) {
		return (
			<div className="stc-preview stc-preview--empty">
				<span>Empty canvas</span>
			</div>
		)
	}

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
	for (const r of rects) {
		if (r.x < minX) minX = r.x
		if (r.y < minY) minY = r.y
		if (r.x + r.w > maxX) maxX = r.x + r.w
		if (r.y + r.h > maxY) maxY = r.y + r.h
	}

	const bW = maxX - minX || 1
	const bH = maxY - minY || 1
	const padding = 8
	const scaleX = (PREVIEW_W - padding * 2) / bW
	const scaleY = (PREVIEW_H - padding * 2) / bH
	const scale = Math.min(scaleX, scaleY, 1.5)
	const scaledW = bW * scale
	const scaledH = bH * scale
	const ox = (PREVIEW_W - scaledW) / 2
	const oy = (PREVIEW_H - scaledH) / 2

	return (
		<svg
			className="stc-preview"
			viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
			width={PREVIEW_W}
			height={PREVIEW_H}
		>
			{rects.map((r, i) => {
				const rx = ox + (r.x - minX) * scale
				const ry = oy + (r.y - minY) * scale
				const rw = Math.max(2, r.w * scale)
				const rh = Math.max(2, r.h * scale)
				return (
					<rect
						key={i}
						x={rx}
						y={ry}
						width={rw}
						height={rh}
						fill="rgba(59,130,246,0.18)"
						stroke="#93c5fd"
						strokeWidth="0.8"
						rx="1.5"
					/>
				)
			})}
		</svg>
	)
}

// ── Layout computation ────────────────────────────────────────────────────────
interface LayoutNode {
	snapshotId: string
	branchId: string
	col: number
	row: number
	x: number
	y: number
}

interface LayoutEdge {
	type: 'sequence' | 'fork' | 'merge'
	x1: number; y1: number
	x2: number; y2: number
}

function computeLayout(branches: WorkspaceBranch[]) {
	const sorted = [...branches].sort((a, b) => a.createdAt - b.createdAt)
	const snapshotCol = new Map<string, number>()
	const snapshotRow = new Map<string, number>()
	const nodes: LayoutNode[] = []

	for (let rowIdx = 0; rowIdx < sorted.length; rowIdx++) {
		const branch = sorted[rowIdx]
		const snaps = [...branch.snapshots].sort((a, b) => a.createdAt - b.createdAt)

		let startCol = 0
		if (branch.forkedFromSnapshotId) {
			const parentCol = snapshotCol.get(branch.forkedFromSnapshotId)
			if (parentCol !== undefined) startCol = parentCol + FORK_X_OFFSET
		}

		snaps.forEach((snap, i) => {
			const col = startCol + i
			snapshotCol.set(snap.id, col)
			snapshotRow.set(snap.id, rowIdx)
			nodes.push({
				snapshotId: snap.id,
				branchId: branch.id,
				col,
				row: rowIdx,
				x: col * STEP_X,
				y: rowIdx * STEP_Y,
			})
		})
	}

	const edges: LayoutEdge[] = []

	for (const branch of sorted) {
		const snaps = [...branch.snapshots].sort((a, b) => a.createdAt - b.createdAt)

		// Sequence edges within branch
		for (let i = 1; i < snaps.length; i++) {
			const prev = nodes.find(n => n.snapshotId === snaps[i - 1].id)
			const curr = nodes.find(n => n.snapshotId === snaps[i].id)
			if (prev && curr) {
				edges.push({
					type: 'sequence',
					x1: prev.x + NODE_W,
					y1: prev.y + NODE_H / 2,
					x2: curr.x,
					y2: curr.y + NODE_H / 2,
				})
			}
		}

		// Fork edge from parent snapshot to this branch's first snapshot
		if (branch.forkedFromSnapshotId && snaps.length > 0) {
			const src = nodes.find(n => n.snapshotId === branch.forkedFromSnapshotId)
			const dst = nodes.find(n => n.snapshotId === snaps[0].id)
			if (src && dst) {
				// src is above dst (lower row index), arrow exits src bottom, enters dst top
				edges.push({
					type: 'fork',
					x1: src.x + NODE_W / 2,
					y1: src.y + NODE_H,
					x2: dst.x + NODE_W / 2,
					y2: dst.y,
				})
			}
		}

		// Merge edges: snapshot.mergedFromSnapshotId → this snapshot
		for (const snap of snaps) {
			if (!snap.mergedFromSnapshotId) continue
			const src = nodes.find(n => n.snapshotId === snap.mergedFromSnapshotId)
			const dst = nodes.find(n => n.snapshotId === snap.id)
			if (!src || !dst) continue

			const srcBelow = src.row > dst.row
			edges.push({
				type: 'merge',
				// depart from the side of source closer to target row
				x1: src.x + NODE_W / 2,
				y1: srcBelow ? src.y : src.y + NODE_H,
				// arrive at the far side of target
				x2: dst.x + NODE_W / 2,
				y2: srcBelow ? dst.y + NODE_H : dst.y,
			})
		}
	}

	const maxX = nodes.reduce((m, n) => Math.max(m, n.x + NODE_W), NODE_W)
	const maxY = nodes.reduce((m, n) => Math.max(m, n.y + NODE_H), NODE_H)

	return { nodes, edges, sorted, totalW: maxX + STEP_X, totalH: maxY + STEP_Y }
}

// ── Arrow marker path ─────────────────────────────────────────────────────────
function ArrowMarker({ id, color }: { id: string; color: string }) {
	return (
		<marker id={id} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
			<path d="M0,0 L0,6 L8,3 z" fill={color} />
		</marker>
	)
}

// ── Fork dialog ───────────────────────────────────────────────────────────────
function ForkDialog({
	onConfirm,
	onCancel,
}: {
	onConfirm: (name: string) => void
	onCancel: () => void
}) {
	const [name, setName] = useState('')
	return (
		<div className="stc-fork-dialog" onMouseDown={e => e.stopPropagation()}>
			<div className="stc-fork-dialog-inner">
				<div className="stc-fork-dialog-title">New branch name</div>
				<input
					className="stc-fork-input"
					autoFocus
					value={name}
					onChange={e => setName(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
						if (e.key === 'Escape') onCancel()
					}}
					placeholder="feature/my-branch"
				/>
				<div className="stc-fork-dialog-actions">
					<button className="stc-btn stc-btn--primary" onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}>
						Create branch
					</button>
					<button className="stc-btn" onClick={onCancel}>Cancel</button>
				</div>
			</div>
		</div>
	)
}

// ── Merge dialog ─────────────────────────────────────────────────────────────
function MergeDialog({
	sourceBranchId,
	branches,
	onConfirm,
	onCancel,
}: {
	sourceBranchId: string
	branches: WorkspaceBranch[]
	onConfirm: (targetBranchId: string) => void
	onCancel: () => void
}) {
	const targets = branches.filter(b => b.id !== sourceBranchId)
	const [selected, setSelected] = useState(targets[0]?.id ?? '')

	return (
		<div className="stc-fork-dialog" onMouseDown={e => e.stopPropagation()}>
			<div className="stc-fork-dialog-inner">
				<div className="stc-fork-dialog-title">Merge into branch</div>
				<select
					className="stc-fork-input"
					value={selected}
					onChange={e => setSelected(e.target.value)}
					autoFocus
				>
					{targets.map(b => (
						<option key={b.id} value={b.id}>{b.name}</option>
					))}
				</select>
				<div className="stc-fork-dialog-actions">
					<button
						className="stc-btn stc-btn--primary"
						onClick={() => selected && onConfirm(selected)}
						disabled={!selected}
					>
						Merge
					</button>
					<button className="stc-btn" onClick={onCancel}>Cancel</button>
				</div>
			</div>
		</div>
	)
}

// ── Main component ────────────────────────────────────────────────────────────
export function WorkspaceTimelineView({
	workspaceId,
	onContinueLatest,
	onOpenEditor,
	onRestoreSnapshot,
}: {
	workspaceId: string
	onContinueLatest: () => void
	onOpenEditor: () => void
	onRestoreSnapshot: (branchId: string, snapshotId: string) => void
}) {
	const app = useTldrawAgentApp()
	const workspace = useValue('workspace', () => {
		const ws = app.workspaces.getWorkspaces()
		return ws.find(w => w.id === workspaceId) ?? null
	}, [app, workspaceId])

	const branches = useMemo(() =>
		workspace ? Object.values(workspace.branches) : [],
		[workspace]
	)

	const { nodes, edges, sorted: sortedBranches, totalW, totalH } = useMemo(
		() => computeLayout(branches),
		[branches]
	)

	const snapshotMap = useMemo(() => {
		const m = new Map<string, WorkspaceSnapshot>()
		for (const b of branches) for (const s of b.snapshots) m.set(s.id, s)
		return m
	}, [branches])

	const branchMap = useMemo(() => {
		const m = new Map<string, WorkspaceBranch>()
		for (const b of branches) m.set(b.id, b)
		return m
	}, [branches])

	// Pan & zoom state
	const [pan, setPan] = useState({ x: 80, y: 60 })
	const [zoom, setZoom] = useState(1)
	const isDragging = useRef(false)
	const dragOrigin = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
	const viewportRef = useRef<HTMLDivElement>(null)

	// Fork / merge dialog state
	const [forkTarget, setForkTarget] = useState<{ branchId: string; snapshotId: string } | null>(null)
	const [mergeTarget, setMergeTarget] = useState<{ branchId: string; snapshotId: string } | null>(null)

	const handleViewportMouseDown = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return
		isDragging.current = true
		dragOrigin.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
	}, [pan])

	const handleViewportMouseMove = useCallback((e: React.MouseEvent) => {
		if (!isDragging.current || !dragOrigin.current) return
		setPan({
			x: dragOrigin.current.px + (e.clientX - dragOrigin.current.mx),
			y: dragOrigin.current.py + (e.clientY - dragOrigin.current.my),
		})
	}, [])

	const handleViewportMouseUp = useCallback(() => {
		isDragging.current = false
		dragOrigin.current = null
	}, [])

	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault()
		setZoom(z => Math.max(0.2, Math.min(2.5, z * (1 - e.deltaY * 0.001))))
	}, [])

	const handleForkConfirm = useCallback((name: string) => {
		if (!forkTarget) return
		app.workspaces.forkBranchFrom(name, forkTarget.branchId, forkTarget.snapshotId)
		setForkTarget(null)
	}, [app, forkTarget])

	const handleMergeConfirm = useCallback((targetBranchId: string) => {
		if (!mergeTarget) return
		app.workspaces.mergeSnapshotIntoBranch(mergeTarget.branchId, mergeTarget.snapshotId, targetBranchId)
		setMergeTarget(null)
	}, [app, mergeTarget])

	if (!workspace) return null

	const currentBranchId = workspace.currentBranchId

	return (
		<div className="workspace-screen stc-screen">
			{/* Header */}
			<div className="workspace-screen-header">
				<h2>{workspace.name}</h2>
				<button className="workspace-screen-primary" onClick={onContinueLatest}>
					Continue latest
				</button>
				<button className="workspace-screen-secondary" onClick={onOpenEditor}>
					Open editor
				</button>
			</div>

			{/* Canvas viewport */}
			<div
				ref={viewportRef}
				className="stc-viewport"
				onMouseDown={handleViewportMouseDown}
				onMouseMove={handleViewportMouseMove}
				onMouseUp={handleViewportMouseUp}
				onMouseLeave={handleViewportMouseUp}
				onWheel={handleWheel}
				style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
			>
				<div
					className="stc-canvas"
					style={{
						width: totalW,
						height: totalH,
						transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						transformOrigin: '0 0',
					}}
				>
					{/* SVG layer for edges and branch labels */}
					<svg
						className="stc-svg"
						width={totalW}
						height={totalH}
						style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
					>
						<defs>
							<ArrowMarker id="arrow-seq" color="#9ca3af" />
							<ArrowMarker id="arrow-fork" color="#818cf8" />
							<ArrowMarker id="arrow-merge" color="#f59e0b" />
						</defs>

						{/* Branch labels */}
						{sortedBranches.map((branch, i) => {
							const isCurrent = branch.id === currentBranchId
							return (
								<g key={branch.id}>
									<text
										x={BRANCH_LABEL_X}
										y={i * STEP_Y + NODE_H / 2 + 5}
										textAnchor="end"
										fontSize="11"
										fontWeight={isCurrent ? '700' : '400'}
										fill={isCurrent ? '#2563eb' : '#6b7280'}
										fontFamily="system-ui, sans-serif"
									>
										{branch.name}{isCurrent ? ' ●' : ''}
									</text>
								</g>
							)
						})}

						{/* Edges */}
						{edges.map((edge, i) => {
							if (edge.type === 'sequence') {
								return (
									<line
										key={i}
										x1={edge.x1 + 2}
										y1={edge.y1}
										x2={edge.x2 - 6}
										y2={edge.y2}
										stroke="#9ca3af"
										strokeWidth="1.5"
										markerEnd="url(#arrow-seq)"
									/>
								)
							}
							if (edge.type === 'merge') {
								// S-curve from source to merge target (orange)
								const dy = edge.y2 - edge.y1
								const cx1 = edge.x1
								const cy1 = edge.y1 + dy * 0.45
								const cx2 = edge.x2
								const cy2 = edge.y1 + dy * 0.55
								const ey2 = dy > 0 ? edge.y2 - 6 : edge.y2 + 6
								return (
									<path
										key={i}
										d={`M ${edge.x1} ${edge.y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${edge.x2} ${ey2}`}
										stroke="#f59e0b"
										strokeWidth="1.5"
										fill="none"
										strokeDasharray="4,3"
										markerEnd="url(#arrow-merge)"
									/>
								)
							}
							// Fork: S-curve from bottom of source down-right to top of fork target
							const dy = edge.y2 - edge.y1
							const cx1 = edge.x1
							const cy1 = edge.y1 + dy * 0.45
							const cx2 = edge.x2
							const cy2 = edge.y1 + dy * 0.55
							return (
								<path
									key={i}
									d={`M ${edge.x1} ${edge.y1 + 2} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${edge.x2} ${edge.y2 - 6}`}
									stroke="#818cf8"
									strokeWidth="1.5"
									fill="none"
									strokeDasharray="5,3"
									markerEnd="url(#arrow-fork)"
								/>
							)
						})}
					</svg>

					{/* Snapshot nodes */}
					{nodes.map(node => {
						const snapshot = snapshotMap.get(node.snapshotId)
						const branch = branchMap.get(node.branchId)
						if (!snapshot || !branch) return null

						const isHead = branch.headSnapshotId === node.snapshotId
						const isCurrent = node.branchId === currentBranchId && isHead

						return (
							<div
								key={node.snapshotId}
								className={`stc-node${isCurrent ? ' stc-node--current' : ''}${isHead ? ' stc-node--head' : ''}`}
								style={{ left: node.x, top: node.y, width: NODE_W }}
								onMouseDown={e => e.stopPropagation()}
							>
								<div className="stc-node-header">
									<span className="stc-node-name" title={snapshot.name}>
										{snapshot.name}
										{snapshot.isAuto ? <span className="stc-node-badge">auto</span> : null}
									</span>
									{isCurrent && <span className="stc-node-current-badge">current</span>}
								</div>
								<div className="stc-node-meta">
									{formatWorkspaceTime(snapshot.createdAt)}
									{snapshot.mergedFromBranchId ? ' · merged' : ''}
								</div>
								<div className="stc-node-preview-wrap">
									<SnapshotPreview snapshot={snapshot} />
								</div>
								<div className="stc-node-actions">
									<button
										className="stc-btn stc-btn--restore"
										onClick={() => onRestoreSnapshot(node.branchId, node.snapshotId)}
										title="Restore this snapshot"
									>
										Restore
									</button>
									<button
										className="stc-btn stc-btn--fork"
										onClick={() => setForkTarget({ branchId: node.branchId, snapshotId: node.snapshotId })}
										title="Create a new branch from this snapshot"
									>
										Branch ↓
									</button>
									<button
										className="stc-btn stc-btn--merge"
										onClick={() => setMergeTarget({ branchId: node.branchId, snapshotId: node.snapshotId })}
										title="Merge this snapshot into another branch"
									>
										Merge →
									</button>
								</div>
							</div>
						)
					})}
				</div>
			</div>

			{/* Zoom indicator */}
			<div className="stc-zoom-hint">
				{Math.round(zoom * 100)}% · drag to pan · scroll to zoom
			</div>

			{/* Fork dialog */}
			{forkTarget && (
				<ForkDialog
					onConfirm={handleForkConfirm}
					onCancel={() => setForkTarget(null)}
				/>
			)}

			{/* Merge dialog */}
			{mergeTarget && (
				<MergeDialog
					sourceBranchId={mergeTarget.branchId}
					branches={sortedBranches}
					onConfirm={handleMergeConfirm}
					onCancel={() => setMergeTarget(null)}
				/>
			)}
		</div>
	)
}
