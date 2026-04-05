import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
	DefaultSizeStyle,
	DefaultToolbar,
	DefaultToolbarContent,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiMenuToolItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
	Editor,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { MathCheatSheet } from './components/MathCheatSheet'
import { PlotGraphButton } from './components/PlotGraphButton'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { DraggableChatPanel } from './components/panels/DraggableChatPanel'
import { LayoutAwareStylePanel } from './components/panels/DraggableStylePanel'
import { PanelLayoutProvider } from './components/panels/PanelLayoutContext'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import { MathTool } from './tools/MathTool'
import { GraphTool } from './tools/GraphTool'
import { EquationShapeUtil } from './shapes/equation/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/graph/GraphShapeUtil'
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
const tools = [TargetShapeTool, TargetAreaTool, MathTool, GraphTool]
const shapeUtils = [EquationShapeUtil, GraphShapeUtil, PdfDocumentShapeUtil]
const PINNED_CUSTOM_TOOLS_STORAGE_KEY = 'tutors.pinned-toolbar-tools'
const PINNABLE_CUSTOM_TOOL_IDS = ['math', 'graph', 'target-area', 'target-shape'] as const
const DEFAULT_PINNED_CUSTOM_TOOL_IDS: string[] = ['math']

function getPinnedCustomToolIds(): string[] {
	if (typeof window === 'undefined') return DEFAULT_PINNED_CUSTOM_TOOL_IDS

	const parse = (raw: string | null): string[] | null => {
		if (!raw) return null
		const parsed = raw
			.split(',')
			.map((id) => id.trim())
			.filter((id): id is (typeof PINNABLE_CUSTOM_TOOL_IDS)[number] =>
				(PINNABLE_CUSTOM_TOOL_IDS as readonly string[]).includes(id)
			)
		return parsed.length ? parsed : null
	}

	const fromQuery = parse(new URLSearchParams(window.location.search).get('pinnedTools'))
	if (fromQuery) return fromQuery

	const fromStorage = parse(window.localStorage.getItem(PINNED_CUSTOM_TOOLS_STORAGE_KEY))
	if (fromStorage) return fromStorage

	return DEFAULT_PINNED_CUSTOM_TOOL_IDS
}

const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
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
			'pdf-upload': {
				id: 'pdf-upload',
				label: 'Upload PDF',
				icon: 'tool-media',
				onSelect() {
					const input = document.getElementById('pdf-upload-input') as HTMLInputElement | null
					input?.click()
					editor.setCurrentTool('select')
				},
			},
		}
	},
}

// Custom toolbar with user-configurable custom tool pins before default items.
function CustomToolbar({ pinnedToolIds }: { pinnedToolIds: string[] }) {
	return (
		<DefaultToolbar>
			{pinnedToolIds.map((toolId) => (
				<TldrawUiMenuToolItem key={toolId} toolId={toolId} />
			))}
			<DefaultToolbarContent />
			<TldrawUiMenuToolItem toolId="pdf-upload" />
		</DefaultToolbar>
	)
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [showCheatSheet, setShowCheatSheet] = useState(false)
	const editorRef = useRef<Editor | null>(null)

	const handlePdfInputChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
		const editor = editorRef.current
		const files = e.target.files
		if (!editor || !files?.length) return

		const viewport = editor.getViewportPageBounds()
		const origin = {
			x: viewport.x + viewport.w / 2 - PDF_SHAPE_DEFAULT_W / 2,
			y: viewport.y + PDF_PLACEMENT_VIEWPORT_TOP_OFFSET,
		}

		for (let i = 0; i < files.length; i++) {
			const file = files[i]
			try {
				await addPdfToCanvas(editor, file, {
					x: origin.x + i * PDF_PLACEMENT_CASCADE_OFFSET,
					y: origin.y + i * PDF_PLACEMENT_CASCADE_OFFSET,
				})
			} catch (err) {
				console.error('Failed to process PDF upload', err)
			}
		}

		e.target.value = ''
	}, [])
	const pinnedToolIds = useMemo(() => getPinnedCustomToolIds(), [])

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

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

	// tldraw components — StylePanel is null because we render our own draggable version in Overlays
	const components: TLComponents = useMemo(() => {
		return {
			Toolbar: () => <CustomToolbar pinnedToolIds={pinnedToolIds} />,
			StylePanel: null,
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
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app, pinnedToolIds])

	return (
		<PanelLayoutProvider>
			<TldrawUiToastsProvider>
				<input
					id="pdf-upload-input"
					type="file"
					accept="application/pdf"
					multiple
					style={{ display: 'none' }}
					onChange={handlePdfInputChange}
				/>
				<div className="tldraw-agent-container">
					<div className="tldraw-canvas">
						<Tldraw
							persistenceKey="tldraw-agent-demo"
							onMount={(editor) => {
								editorRef.current = editor
								// @ts-expect-error - Attach editor to window for debugging and testing
								window.editor = editor

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
					</div>
					{/* Chat panel rendered outside tldraw — it has its own agent context */}
					{app && <DraggableChatPanel app={app} />}
				</div>
				{showCheatSheet && <MathCheatSheet onClose={() => setShowCheatSheet(false)} />}
			</TldrawUiToastsProvider>
		</PanelLayoutProvider>
	)
}

export default App
