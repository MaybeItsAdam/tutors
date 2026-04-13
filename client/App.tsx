import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
	DefaultSizeStyle,
	DefaultToolbar,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiMenuToolItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
	useIsToolSelected,
	useTools,
	Editor,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { DraggableChatPanel } from './components/panels/DraggableChatPanel'
import { LayoutAwareStylePanel } from './components/panels/DraggableStylePanel'
import { Graph3dGimbalPanel } from './components/panels/Graph3dGimbalPanel'
import { PanelLayoutProvider } from './components/panels/PanelLayoutContext'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { MathCheatSheet } from './components/MathCheatSheet'
import { PlotGraphButton } from './components/PlotGraphButton'
import { WorkspaceLandingPage } from './components/WorkspaceLandingPage'
import { WorkspaceTimelineView } from './components/WorkspaceTimelineView'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import { MathTool } from './tools/MathTool'
import { GraphTool } from './tools/GraphTool'
import { Graph3dTool } from './tools/Graph3dTool'
import { VectorFieldTool } from './tools/VectorFieldTool'
import { ComplexPlaneTool } from './tools/ComplexPlaneTool'
import { EquationShapeUtil } from './shapes/equation/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/graph/GraphShapeUtil'
import { Graph3dShapeUtil } from './shapes/graph3d/Graph3dShapeUtil'
import { VectorFieldShapeUtil } from './shapes/vectorfield/VectorFieldShapeUtil'
import { ComplexPlaneShapeUtil } from './shapes/complexplane/ComplexPlaneShapeUtil'
import { PdfDocumentShapeUtil } from './shapes/pdf/PdfDocumentShapeUtil'
import {
	buildPdfPageAssetName,
	PDF_PLACEMENT_CASCADE_OFFSET,
	PDF_PLACEMENT_VIEWPORT_TOP_OFFSET,
	PDF_SHAPE_DEFAULT_H,
	PDF_SHAPE_DEFAULT_W,
} from './shapes/pdf/PdfConstants'
import { AssetRecordType, TLAsset, TLAssetId } from 'tldraw'
import { PdfProcessor } from './utils/PdfProcessor'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

async function addPdfToCanvas(editor: Editor, file: File, point: { x: number; y: number }) {
	if (file.type !== 'application/pdf') return

	const pages = await PdfProcessor.processFile(file)
	if (!pages.length) return

	const assetIds: TLAssetId[] = []
	const assetsToCreate: TLAsset[] = []

	for (const page of pages) {
		const assetId = AssetRecordType.createId()
		assetIds.push(assetId)
		assetsToCreate.push({
			id: assetId,
			type: 'image',
			typeName: 'asset' as const,
			meta: {},
			props: {
				w: page.width,
				h: page.height,
				name: buildPdfPageAssetName(file.name, page.pageNumber),
				isAnimated: false,
				mimeType: 'image/png',
				src: page.dataUrl,
			},
		})
	}

	editor.createAssets(assetsToCreate)
	editor.createShape({
		type: 'pdf',
		x: point.x,
		y: point.y,
		props: {
			w: PDF_SHAPE_DEFAULT_W,
			h: PDF_SHAPE_DEFAULT_H,
			assetIds,
			currentPage: 0,
		},
	})
}

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool, MathTool, GraphTool, Graph3dTool, VectorFieldTool, ComplexPlaneTool]
const shapeUtils = [EquationShapeUtil, GraphShapeUtil, Graph3dShapeUtil, VectorFieldShapeUtil, ComplexPlaneShapeUtil, PdfDocumentShapeUtil]
const PINNED_CUSTOM_TOOLS_STORAGE_KEY = 'tutors.pinned-toolbar-tools'
const CORE_TOOL_ORDER_STORAGE_KEY = 'tutors.core-toolbar-order'
const PINNED_CORE_TOOLS_STORAGE_KEY = 'tutors.pinned-core-toolbar-tools'
const NO_PINNED_TOOLS_SENTINEL = '__none__'
const PINNABLE_CUSTOM_TOOL_IDS = ['math', 'graph', 'graph3d', 'vectorfield', 'complexplane', 'target-area', 'target-shape'] as const
type PinnableCustomToolId = (typeof PINNABLE_CUSTOM_TOOL_IDS)[number]

const PINNABLE_CUSTOM_TOOLS: Array<{ id: PinnableCustomToolId; label: string }> = [
	{ id: 'math', label: 'Math' },
	{ id: 'graph', label: 'Graph' },
	{ id: 'graph3d', label: '3D Graph' },
	{ id: 'vectorfield', label: 'Vector Field' },
	{ id: 'complexplane', label: 'Complex Plane' },
	{ id: 'target-area', label: 'Pick Area' },
	{ id: 'target-shape', label: 'Pick Shape' },
]

const DEFAULT_CORE_TOOL_IDS = [
	'select',
	'hand',
	'draw',
	'eraser',
	'arrow',
	'text',
	'note',
	'asset',
	'rectangle',
	'line',
	'highlight',
	'laser',
	'frame',
] as const
type CoreToolId = (typeof DEFAULT_CORE_TOOL_IDS)[number]

const DEFAULT_PINNED_CUSTOM_TOOL_IDS: PinnableCustomToolId[] = ['math', 'graph3d', 'vectorfield', 'complexplane']
const DEFAULT_PINNED_CORE_TOOL_IDS: CoreToolId[] = ['select', 'hand', 'draw', 'eraser', 'arrow', 'text', 'note', 'asset', 'rectangle']
const MEDIA_UPLOAD_INPUT_ID = 'media-upload-input'
const CORE_TOOL_LABELS: Record<CoreToolId, string> = {
	select: 'Select',
	hand: 'Hand',
	draw: 'Draw',
	eraser: 'Eraser',
	arrow: 'Arrow',
	text: 'Text',
	note: 'Note',
	asset: 'Media',
	rectangle: 'Shape',
	line: 'Line',
	highlight: 'Highlight',
	laser: 'Laser',
	frame: 'Frame',
}

function normalizePinnedCustomToolIds(next: PinnableCustomToolId[]) {
	return Array.from(new Set(next)).filter((id): id is PinnableCustomToolId =>
		(PINNABLE_CUSTOM_TOOL_IDS as readonly string[]).includes(id)
	)
}

function normalizeCoreToolIds(next: string[]) {
	const unique = Array.from(new Set(next)).filter((id): id is CoreToolId =>
		(DEFAULT_CORE_TOOL_IDS as readonly string[]).includes(id)
	)
	const missing = DEFAULT_CORE_TOOL_IDS.filter((id) => !unique.includes(id))
	return [...unique, ...missing]
}

function normalizePinnedCoreToolIds(next: string[]) {
	const unique = Array.from(new Set(next)).filter((id): id is CoreToolId =>
		(DEFAULT_CORE_TOOL_IDS as readonly string[]).includes(id)
	)
	if (!unique.includes('select')) unique.unshift('select')
	return unique
}

function isCoreToolId(id: string): id is CoreToolId {
	return (DEFAULT_CORE_TOOL_IDS as readonly string[]).includes(id)
}

function isPinnableCustomToolId(id: string): id is PinnableCustomToolId {
	return (PINNABLE_CUSTOM_TOOL_IDS as readonly string[]).includes(id)
}

function getPinnedCustomToolIds(): PinnableCustomToolId[] {
	if (typeof window === 'undefined') return DEFAULT_PINNED_CUSTOM_TOOL_IDS

	const parse = (raw: string | null): PinnableCustomToolId[] | null => {
		if (raw === null) return null
		if (raw === NO_PINNED_TOOLS_SENTINEL) return []
		if (raw.trim() === '') return []
		const parsed = raw
			.split(',')
			.map((id) => id.trim())
			.filter((id): id is PinnableCustomToolId => (PINNABLE_CUSTOM_TOOL_IDS as readonly string[]).includes(id))
		return parsed
	}

	const fromQuery = parse(new URLSearchParams(window.location.search).get('pinnedTools'))
	if (fromQuery) return fromQuery

	const fromStorage = parse(window.localStorage.getItem(PINNED_CUSTOM_TOOLS_STORAGE_KEY))
	if (fromStorage) return fromStorage

	return DEFAULT_PINNED_CUSTOM_TOOL_IDS
}

function getCoreToolIds(): CoreToolId[] {
	if (typeof window === 'undefined') return [...DEFAULT_CORE_TOOL_IDS]
	const raw = window.localStorage.getItem(CORE_TOOL_ORDER_STORAGE_KEY)
	if (!raw) return [...DEFAULT_CORE_TOOL_IDS]
	const parsed = raw.split(',').map((id) => id.trim()).filter(Boolean)
	return normalizeCoreToolIds(parsed)
}

function getPinnedCoreToolIds(): CoreToolId[] {
	if (typeof window === 'undefined') return DEFAULT_PINNED_CORE_TOOL_IDS
	const raw = window.localStorage.getItem(PINNED_CORE_TOOLS_STORAGE_KEY)
	if (!raw) return DEFAULT_PINNED_CORE_TOOL_IDS
	const parsed = raw.split(',').map((id) => id.trim()).filter(Boolean)
	return normalizePinnedCoreToolIds(parsed)
}

const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		const nextTools = {
			...tools,
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
			'math': {
				id: 'math',
				label: 'Math (m)',
				kbd: 'm',
				icon: 'tool-text',
				onSelect() {
					editor.setCurrentTool('math')
				},
			},
			'graph': {
				id: 'graph',
				label: 'Graph (g)',
				kbd: 'g',
				icon: 'tool-line',
				onSelect() {
					editor.setCurrentTool('graph')
				},
			},
			'graph3d': {
				id: 'graph3d',
				label: '3D Graph',
				kbd: '3',
				icon: 'tool-line',
				onSelect() {
					editor.setCurrentTool('graph3d')
				},
			},
			'vectorfield': {
				id: 'vectorfield',
				label: 'Vector Field (v)',
				kbd: 'v',
				icon: 'tool-arrow',
				onSelect() {
					editor.setCurrentTool('vectorfield')
				},
			},
			'complexplane': {
				id: 'complexplane',
				label: 'Complex Plane (c)',
				kbd: 'c',
				icon: 'tool-ellipse',
				onSelect() {
					editor.setCurrentTool('complexplane')
				},
			},
		}
		if (tools.asset) {
			nextTools.asset = {
				...tools.asset,
				onSelect() {
					const input = document.getElementById(MEDIA_UPLOAD_INPUT_ID) as HTMLInputElement | null
					input?.click()
					editor.setCurrentTool('select')
				},
			}
		}
		if (tools.rectangle) {
			nextTools.rectangle = {
				...tools.rectangle,
				label: 'Shape',
			}
		}
		return nextTools
	},
}

// Custom toolbar with user-configurable custom tool pins before default items.
function CustomToolbarItem({ toolId }: { toolId: string }) {
	const tools = useTools()
	const isSelected = useIsToolSelected(tools[toolId])
	return <TldrawUiMenuToolItem toolId={toolId} isSelected={isSelected} />
}

function CoreToolbarContent({ toolIds }: { toolIds: CoreToolId[] }) {
	return (
		<>
			{toolIds.map((toolId) => (
				<CustomToolbarItem key={toolId} toolId={toolId} />
			))}
		</>
	)
}

function CustomToolbar({
	pinnedToolIds,
	pinnedCoreToolIds,
	coreToolIds,
	onOpenToolContextMenu,
}: {
	pinnedToolIds: PinnableCustomToolId[]
	pinnedCoreToolIds: CoreToolId[]
	coreToolIds: CoreToolId[]
	onOpenToolContextMenu: (x: number, y: number, toolId: CoreToolId | PinnableCustomToolId, label: string) => void
}) {
	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			const target = e.target as Element | null
			const button = target?.closest<HTMLButtonElement>('button[data-testid^="tools."][data-value]')
			const toolId = button?.dataset.value
			if (!toolId || (!isCoreToolId(toolId) && !isPinnableCustomToolId(toolId))) return
			const normalizedLabel = button?.getAttribute('aria-label')?.replace(/\s*\(.+\)\s*$/, '').trim()
			const fallbackLabel = isCoreToolId(toolId)
				? CORE_TOOL_LABELS[toolId]
				: PINNABLE_CUSTOM_TOOLS.find((tool) => tool.id === toolId)?.label ?? toolId
			e.preventDefault()
			e.stopPropagation()
			onOpenToolContextMenu(
				e.clientX,
				e.clientY,
				toolId,
				normalizedLabel || fallbackLabel
			)
		},
		[onOpenToolContextMenu]
	)
	const pinnedCoreToolsInOrder = pinnedCoreToolIds.filter((id) => coreToolIds.includes(id))
	const unpinnedCoreToolsInOrder = coreToolIds.filter((id) => !pinnedCoreToolIds.includes(id))
	const unpinnedCustomToolIds = PINNABLE_CUSTOM_TOOL_IDS.filter((id) => !pinnedToolIds.includes(id))
	const visibleToolbarCount = Math.max(1, pinnedToolIds.length + pinnedCoreToolsInOrder.length)
	const maxItems = visibleToolbarCount
	const maxSizePx = Math.min(720, Math.max(310, 70 + visibleToolbarCount * 52))

	return (
		<div className="custom-toolbar-context-target" onContextMenu={handleContextMenu}>
			<DefaultToolbar minItems={1} maxItems={maxItems} maxSizePx={maxSizePx}>
				{pinnedToolIds.map((toolId) => (
					<CustomToolbarItem key={toolId} toolId={toolId} />
				))}
				<CoreToolbarContent toolIds={pinnedCoreToolsInOrder} />
				<CoreToolbarContent toolIds={unpinnedCoreToolsInOrder} />
				{unpinnedCustomToolIds.map((toolId) => (
					<CustomToolbarItem key={toolId} toolId={toolId} />
				))}
			</DefaultToolbar>
		</div>
	)
}

function ToolbarToolContextMenu({
	position,
	toolLabel,
	isPinned,
	canToggle,
	onToggle,
	onClose,
}: {
	position: { x: number; y: number }
	toolLabel: string
	isPinned: boolean
	canToggle: boolean
	onToggle: () => void
	onClose: () => void
}) {
	const menuRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handlePointerDown = (e: PointerEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
		}
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('pointerdown', handlePointerDown)
		window.addEventListener('keydown', handleEscape)
		return () => {
			window.removeEventListener('pointerdown', handlePointerDown)
			window.removeEventListener('keydown', handleEscape)
		}
	}, [onClose])

	const menuW = 220
	const menuH = 76
	const left = Math.max(8, Math.min(position.x, window.innerWidth - menuW - 8))
	const top = Math.max(8, Math.min(position.y, window.innerHeight - menuH - 8))

	return (
		<div
			ref={menuRef}
			className="toolbar-pin-menu"
			style={{ left, top }}
			onContextMenu={(e) => e.preventDefault()}
		>
			<div className="toolbar-pin-menu-title">{toolLabel}</div>
			<button
				type="button"
				className="toolbar-pin-menu-item"
				onClick={() => {
					if (!canToggle) return
					onToggle()
					onClose()
				}}
				disabled={!canToggle}
			>
				<span className="toolbar-pin-menu-item-check">{canToggle ? '•' : ''}</span>
				<span>{isPinned ? 'Remove from toolbar' : 'Add to toolbar'}</span>
			</button>
		</div>
	)
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [showCheatSheet, setShowCheatSheet] = useState(false)
	const [uiView, setUiView] = useState<'landing' | 'timeline' | 'editor'>('editor')
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
	const [coreToolIds] = useState<CoreToolId[]>(() => getCoreToolIds())
	const [pinnedCoreToolIds, setPinnedCoreToolIds] = useState<CoreToolId[]>(() => getPinnedCoreToolIds())
	const [pinnedToolIds, setPinnedToolIds] = useState<PinnableCustomToolId[]>(() => getPinnedCustomToolIds())
	const [toolbarToolMenu, setToolbarToolMenu] = useState<{
		x: number
		y: number
		toolId: CoreToolId | PinnableCustomToolId
		label: string
	} | null>(null)
	const editorRef = useRef<Editor | null>(null)

	const handleMediaInputChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
		const editor = editorRef.current
		const files = e.target.files
		if (!editor || !files?.length) return

		const viewport = editor.getViewportPageBounds()
		const pdfOrigin = {
			x: viewport.x + viewport.w / 2 - PDF_SHAPE_DEFAULT_W / 2,
			y: viewport.y + PDF_PLACEMENT_VIEWPORT_TOP_OFFSET,
		}
		const mediaFiles: File[] = []
		const pdfFiles: File[] = []

		for (let i = 0; i < files.length; i++) {
			const file = files[i]
			if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
				pdfFiles.push(file)
			} else {
				mediaFiles.push(file)
			}
		}

		for (let i = 0; i < pdfFiles.length; i++) {
			try {
				await addPdfToCanvas(editor, pdfFiles[i], {
					x: pdfOrigin.x + i * PDF_PLACEMENT_CASCADE_OFFSET,
					y: pdfOrigin.y + i * PDF_PLACEMENT_CASCADE_OFFSET,
				})
			} catch (err) {
				console.error('Failed to process PDF upload', err)
			}
		}

		if (mediaFiles.length) {
			editor.putExternalContent({
				type: 'files',
				files: mediaFiles,
				point: {
					x: viewport.x + viewport.w / 2,
					y: viewport.y + viewport.h / 2,
				},
			})
		}

		e.target.value = ''
	}, [])
	const savePinnedToolIds = useCallback((next: PinnableCustomToolId[]) => {
		const finalIds = normalizePinnedCustomToolIds(next)
		setPinnedToolIds(finalIds)
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(
				PINNED_CUSTOM_TOOLS_STORAGE_KEY,
				finalIds.length ? finalIds.join(',') : NO_PINNED_TOOLS_SENTINEL
			)
		}
	}, [])
	const savePinnedCoreToolIds = useCallback((next: string[]) => {
		const finalIds = normalizePinnedCoreToolIds(next)
		setPinnedCoreToolIds(finalIds)
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(PINNED_CORE_TOOLS_STORAGE_KEY, finalIds.join(','))
		}
	}, [])

	const openToolbarToolMenu = useCallback(
		(x: number, y: number, toolId: CoreToolId | PinnableCustomToolId, label: string) => {
			setToolbarToolMenu({ x, y, toolId, label })
		},
		[]
	)

	const closeToolbarToolMenu = useCallback(() => {
		setToolbarToolMenu(null)
	}, [])

	const togglePinnedToolFromMenu = useCallback((id: PinnableCustomToolId) => {
		const next = pinnedToolIds.includes(id)
			? pinnedToolIds.filter((toolId) => toolId !== id)
			: [...pinnedToolIds, id]
		savePinnedToolIds(next)
	}, [pinnedToolIds, savePinnedToolIds])

	const togglePinnedCoreToolFromMenu = useCallback((id: CoreToolId) => {
		const next = pinnedCoreToolIds.includes(id)
			? pinnedCoreToolIds.filter((toolId) => toolId !== id)
			: [...pinnedCoreToolIds, id]
		savePinnedCoreToolIds(next)
	}, [pinnedCoreToolIds, savePinnedCoreToolIds])

	const movePinnedToolToIndex = useCallback((id: PinnableCustomToolId, index: number) => {
		const without = pinnedToolIds.filter((toolId) => toolId !== id)
		const bounded = Math.max(0, Math.min(index, without.length))
		without.splice(bounded, 0, id)
		savePinnedToolIds(without)
	}, [pinnedToolIds, savePinnedToolIds])

	const movePinnedCoreToolToIndex = useCallback((id: CoreToolId, index: number) => {
		const without = pinnedCoreToolIds.filter((toolId) => toolId !== id)
		const bounded = Math.max(0, Math.min(index, without.length))
		without.splice(bounded, 0, id)
		savePinnedCoreToolIds(without)
	}, [pinnedCoreToolIds, savePinnedCoreToolIds])

	const toolbarMenuSelection = useMemo(() => {
		if (!toolbarToolMenu) return null
		if (isCoreToolId(toolbarToolMenu.toolId)) {
			return {
				isPinned: pinnedCoreToolIds.includes(toolbarToolMenu.toolId),
				canToggle: toolbarToolMenu.toolId !== 'select',
				onToggle: () => togglePinnedCoreToolFromMenu(toolbarToolMenu.toolId),
			}
		}
		if (isPinnableCustomToolId(toolbarToolMenu.toolId)) {
			return {
				isPinned: pinnedToolIds.includes(toolbarToolMenu.toolId),
				canToggle: true,
				onToggle: () => togglePinnedToolFromMenu(toolbarToolMenu.toolId),
			}
		}
		return null
	}, [pinnedCoreToolIds, pinnedToolIds, togglePinnedCoreToolFromMenu, togglePinnedToolFromMenu, toolbarToolMenu])

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	const handleBack = useCallback(() => {
		setUiView((prev) => (prev === 'editor' ? 'timeline' : 'landing'))
	}, [])

	const handleCreateSnapshot = useCallback(() => {
		if (!app) return
		const snapshot = app.workspaces.createSnapshot()
		if (!snapshot) return
		const workspaceId = app.workspaces.getCurrentWorkspaceId()
		if (workspaceId) setSelectedWorkspaceId(workspaceId)
		setUiView('timeline')
	}, [app])

	const currentWorkspaceForTimeline = useMemo(() => {
		if (!app) return null
		const workspaces = app.workspaces.getWorkspaces()
		const targetId = selectedWorkspaceId ?? app.workspaces.getCurrentWorkspaceId()
		return workspaces.find((w) => w.id === targetId) ?? app.workspaces.getCurrentWorkspace()
	}, [app, selectedWorkspaceId])

	// Global hotkey: ? toggles the Math cheat sheet
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
			if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return
			if (e.key === '?') {
				e.preventDefault()
				setShowCheatSheet((prev) => !prev)
			}
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [])

	useEffect(() => {
		if (uiView !== 'editor') setToolbarToolMenu(null)
	}, [uiView])

	useEffect(() => {
		if (uiView !== 'editor') return

		const thresholdSq = 8 * 8
		let dragState: {
			toolId: CoreToolId | PinnableCustomToolId
			type: 'core' | 'custom'
			startX: number
			startY: number
			dragging: boolean
		} | null = null

		const getToolbarButton = (target: EventTarget | null) => {
			if (!(target instanceof Element)) return null
			const button = target.closest<HTMLButtonElement>('.tlui-main-toolbar .tlui-main-toolbar__tools button[data-value]')
			if (!button || button.closest('.tlui-main-toolbar__overflow-content')) return null
			return button
		}

		const getTargetIndexForType = (
			x: number,
			type: 'core' | 'custom'
		) => {
			const buttons = Array.from(
				document.querySelectorAll<HTMLButtonElement>('.tlui-main-toolbar .tlui-main-toolbar__tools button[data-value]')
			).filter((button) => {
				if (button.closest('.tlui-main-toolbar__overflow-content')) return false
				const value = button.dataset.value
				if (!value) return false
				return type === 'core' ? isCoreToolId(value) && pinnedCoreToolIds.includes(value) : isPinnableCustomToolId(value) && pinnedToolIds.includes(value)
			})

			const insertBefore = buttons.findIndex((button) => {
				const rect = button.getBoundingClientRect()
				return x < rect.left + rect.width / 2
			})
			return insertBefore === -1 ? buttons.length : insertBefore
		}

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return
			const button = getToolbarButton(e.target)
			if (!button) return
			const toolId = button.dataset.value
			if (!toolId) return

			if (isPinnableCustomToolId(toolId) && pinnedToolIds.includes(toolId)) {
				dragState = { toolId, type: 'custom', startX: e.clientX, startY: e.clientY, dragging: false }
				return
			}
			if (isCoreToolId(toolId) && pinnedCoreToolIds.includes(toolId)) {
				dragState = { toolId, type: 'core', startX: e.clientX, startY: e.clientY, dragging: false }
			}
		}

		const onPointerMove = (e: PointerEvent) => {
			if (!dragState || dragState.dragging) return
			const dx = e.clientX - dragState.startX
			const dy = e.clientY - dragState.startY
			if (dx * dx + dy * dy >= thresholdSq) dragState.dragging = true
		}

		const onPointerUp = (e: PointerEvent) => {
			if (!dragState) return
			const current = dragState
			dragState = null
			if (!current.dragging) return
			const toolbar = document.querySelector('.tlui-main-toolbar')
			if (!(toolbar instanceof Element)) return
			const rect = toolbar.getBoundingClientRect()
			const droppedOnToolbar = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
			if (!droppedOnToolbar) return

			if (current.type === 'custom' && isPinnableCustomToolId(current.toolId)) {
				movePinnedToolToIndex(current.toolId, getTargetIndexForType(e.clientX, 'custom'))
				return
			}
			if (current.type === 'core' && isCoreToolId(current.toolId)) {
				movePinnedCoreToolToIndex(current.toolId, getTargetIndexForType(e.clientX, 'core'))
			}
		}

		const onPointerCancel = () => {
			dragState = null
		}

		window.addEventListener('pointerdown', onPointerDown)
		window.addEventListener('pointermove', onPointerMove)
		window.addEventListener('pointerup', onPointerUp)
		window.addEventListener('pointercancel', onPointerCancel)
		window.addEventListener('blur', onPointerCancel)
		return () => {
			dragState = null
			window.removeEventListener('pointerdown', onPointerDown)
			window.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('pointercancel', onPointerCancel)
			window.removeEventListener('blur', onPointerCancel)
		}
	}, [movePinnedCoreToolToIndex, movePinnedToolToIndex, pinnedCoreToolIds, pinnedToolIds, uiView])

	// tldraw components — StylePanel is null because we render our own draggable version in Overlays
	const components: TLComponents = useMemo(() => {
		return {
			StylePanel: null,
			Toolbar: () => (
				<CustomToolbar
					pinnedToolIds={pinnedToolIds}
					pinnedCoreToolIds={pinnedCoreToolIds}
					coreToolIds={coreToolIds}
					onOpenToolContextMenu={openToolbarToolMenu}
				/>
			),
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
			Overlays: () => (
				<>
					<TldrawOverlays />
					<PlotGraphButton />
					<LayoutAwareStylePanel />
					<Graph3dGimbalPanel />
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app, coreToolIds, openToolbarToolMenu, pinnedCoreToolIds, pinnedToolIds])

	return (
		<PanelLayoutProvider>
		<TldrawUiToastsProvider>
			<input
				id={MEDIA_UPLOAD_INPUT_ID}
				type="file"
				accept="image/*,video/*,audio/*,application/pdf,.pdf"
				multiple
				style={{ display: 'none' }}
				onChange={handleMediaInputChange}
			/>
			<div className="tldraw-agent-container">
				<div className="tldraw-canvas">
					<Tldraw
						persistenceKey="tldraw-agent-demo"
						onMount={(editor) => {
							editorRef.current = editor
							if (import.meta.env.DEV) {
								// @ts-expect-error - Attach editor to window for debugging
								window.editor = editor
							}

							const handleDrop = async (e: DragEvent) => {
								if (!e.dataTransfer?.files.length) return
								const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'application/pdf')
								if (!files.length) return

								e.preventDefault()
								e.stopPropagation()

								const point = editor.screenToPage({ x: e.clientX, y: e.clientY })

								for (let i = 0; i < files.length; i++) {
									try {
										await addPdfToCanvas(editor, files[i], {
											x: point.x + i * PDF_PLACEMENT_CASCADE_OFFSET,
											y: point.y + i * PDF_PLACEMENT_CASCADE_OFFSET,
										})
									} catch (err) {
										console.error('Failed to process PDF', err)
									}
								}
							}

							const handleDragOver = (e: Event) => e.preventDefault()

							const container = document.querySelector('.tldraw-agent-container')
							if (container) {
								container.addEventListener('drop', handleDrop as any, { capture: true })
								container.addEventListener('dragover', handleDragOver, { capture: true })
							}

							return () => {
								if (container) {
									container.removeEventListener('drop', handleDrop as any, { capture: true })
									container.removeEventListener('dragover', handleDragOver, { capture: true })
								}
							}
						}}
						tools={tools}
						shapeUtils={shapeUtils}
						overrides={overrides}
						components={components}
					>
						<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
					</Tldraw>
					{app && uiView === 'editor' && (
						<div className="workspace-quick-actions">
							<button type="button" className="workspace-back-arrow" onClick={handleBack} title="Back">
								←
							</button>
							<button
								type="button"
								className="workspace-snapshot-fab"
								onClick={handleCreateSnapshot}
								title="Create snapshot"
							>
								Snapshot
							</button>
						</div>
					)}
					{app && uiView === 'editor' && toolbarToolMenu && toolbarMenuSelection && (
						<ToolbarToolContextMenu
							position={{ x: toolbarToolMenu.x, y: toolbarToolMenu.y }}
							toolLabel={toolbarToolMenu.label}
							isPinned={toolbarMenuSelection.isPinned}
							canToggle={toolbarMenuSelection.canToggle}
							onToggle={toolbarMenuSelection.onToggle}
							onClose={closeToolbarToolMenu}
						/>
					)}
				</div>
				{app && uiView === 'editor' && <DraggableChatPanel app={app} />}
				{app && uiView === 'landing' && (
					<TldrawAgentAppContextProvider app={app}>
						<WorkspaceLandingPage
							workspaces={app.workspaces.getWorkspaces()}
							onSelectWorkspace={(workspaceId) => {
								app.workspaces.switchWorkspace(workspaceId)
								setSelectedWorkspaceId(workspaceId)
								setUiView('timeline')
							}}
							onCreateWorkspace={(name) => {
								const workspace = app.workspaces.createWorkspace(name)
								setSelectedWorkspaceId(workspace.id)
								setUiView('timeline')
							}}
						/>
					</TldrawAgentAppContextProvider>
				)}
				{app && uiView === 'timeline' && (
					<TldrawAgentAppContextProvider app={app}>
						{currentWorkspaceForTimeline && (
							<WorkspaceTimelineView
								workspaceId={currentWorkspaceForTimeline.id}
								onContinueLatest={() => {
									const didRestore = app.workspaces.restoreLatestSnapshot(
										currentWorkspaceForTimeline.id
									)
									if (didRestore) setUiView('editor')
								}}
								onOpenEditor={() => setUiView('editor')}
								onRestoreSnapshot={(branchId, snapshotId) => {
									const didRestore = app.workspaces.restoreSnapshot(branchId, snapshotId)
									if (didRestore) setUiView('editor')
								}}
							/>
						)}
					</TldrawAgentAppContextProvider>
				)}
			</div>
			{showCheatSheet && <MathCheatSheet onClose={() => setShowCheatSheet(false)} />}
		</TldrawUiToastsProvider>
		</PanelLayoutProvider>
	)
}

export default App
