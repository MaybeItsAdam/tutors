import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
	DefaultSizeStyle,
	DefaultStylePanel,
	DefaultToolbar,
	DefaultToolbarContent,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiMenuItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
	useTools,
	useEditor,
	Editor,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { MathCheatSheet } from './components/MathCheatSheet'
import { PlotGraphButton } from './components/PlotGraphButton'
import { AgentViewportBoundsHighlights } from './components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from './components/highlights/ContextHighlights'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import { MathTool } from './tools/MathTool'
import { GraphTool } from './tools/GraphTool'
import { EquationShapeUtil } from './shapes/equation/EquationShapeUtil'
import { GraphShapeUtil } from './shapes/graph/GraphShapeUtil'
import { PdfDocumentShapeUtil } from './shapes/pdf/PdfDocumentShapeUtil'
import {
	PDF_OVERLAY_Z_INDEX,
	PDF_PAGE_SUFFIX_TEXT,
	PDF_SHAPE_DEFAULT_H,
	PDF_SHAPE_DEFAULT_W,
} from './shapes/pdf/PdfConstants'
import { AssetRecordType, TLAsset, TLAssetId } from 'tldraw'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

async function addPdfToCanvas(editor: Editor, file: File, point: { x: number; y: number }) {
	if (file.type !== 'application/pdf') return

	const { PdfProcessor } = await import('./utils/PdfProcessor')
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
				name: `${file.name}${PDF_PAGE_SUFFIX_TEXT}${page.pageNumber}`,
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
		}
	},
}

// Custom toolbar with Math and Graph buttons appended
function CustomToolbar() {
	const tools = useTools()
	return (
		<DefaultToolbar>
			<DefaultToolbarContent />
			<TldrawUiMenuItem {...tools['math']} />
			<TldrawUiMenuItem {...tools['graph']} />
		</DefaultToolbar>
	)
}

// Render the StylePanel shifted left so it doesn't overlap the floating chat panel.
// The chat panel is 340px wide + 16px margin from the right edge = 356px total offset.
const CHAT_PANEL_OFFSET = 340 + 16 + 8 // px from right edge where panel starts

function OffsetStylePanel() {
	return (
		<div style={{
			position: 'absolute',
			top: 0,
			right: CHAT_PANEL_OFFSET,
			zIndex: 300,
			pointerEvents: 'all',
		}}>
			<DefaultStylePanel />
		</div>
	)
}

function PdfUploadButton() {
	const editor = useEditor()

	const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files?.length) return

		const viewport = editor.getViewportPageBounds()
		const origin = { x: viewport.x + viewport.w / 2 - PDF_SHAPE_DEFAULT_W / 2, y: viewport.y + 40 }

		for (let i = 0; i < files.length; i++) {
			const file = files[i]
			try {
				await addPdfToCanvas(editor, file, { x: origin.x + i * 24, y: origin.y + i * 24 })
			} catch (err) {
				console.error('Failed to process PDF upload', err)
			}
		}

		e.target.value = ''
	}

	return (
		<div
			style={{
				position: 'absolute',
				top: 12,
				left: 12,
				zIndex: PDF_OVERLAY_Z_INDEX,
				pointerEvents: 'all',
			}}
		>
			<label
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: 6,
					padding: '6px 10px',
					borderRadius: 8,
					border: '1px solid rgba(148,163,184,0.45)',
					background: 'rgba(15,23,42,0.88)',
					backdropFilter: 'blur(8px)',
					color: '#e2e8f0',
					fontSize: 12,
					fontWeight: 600,
					cursor: 'pointer',
					boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
				}}
			>
				<span style={{ fontSize: 14 }}>📎</span>
				Upload PDF
				<input type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={handleChange} />
			</label>
		</div>
	)
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [showCheatSheet, setShowCheatSheet] = useState(false)

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	// Global hotkey: h or ? toggles the Math cheat sheet
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			// Don't trigger when the user is typing in an input
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

	// Custom components to visualize what the agent is doing
	// These use TldrawAgentAppContextProvider to access the app/agent
	const components: TLComponents = useMemo(() => {
		return {
			Toolbar: CustomToolbar,
			StylePanel: OffsetStylePanel,
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
					<PdfUploadButton />
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<AgentViewportBoundsHighlights />
							<AllContextHighlights />
						</TldrawAgentAppContextProvider>
					)}
				</>
			),
		}
	}, [app])

	return (
		<TldrawUiToastsProvider>
			<div className="tldraw-agent-container">
				<div className="tldraw-canvas">
					<Tldraw
						persistenceKey="tldraw-agent-demo"
						onMount={(editor) => {
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
										await addPdfToCanvas(editor, files[i], { x: point.x + i * 24, y: point.y + i * 24 })
									} catch (err) {
										console.error('Failed to process PDF', err)
									}
								}
							}
							
							const container = document.querySelector('.tldraw-agent-container')
							if (container) {
								container.addEventListener('drop', handleDrop as any, { capture: true })
								container.addEventListener('dragover', (e) => e.preventDefault(), { capture: true })
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
				<ErrorBoundary fallback={ChatPanelFallback}>
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<ChatPanel />
						</TldrawAgentAppContextProvider>
					)}
				</ErrorBoundary>
			</div>
			{showCheatSheet && <MathCheatSheet onClose={() => setShowCheatSheet(false)} />}
		</TldrawUiToastsProvider>
	)
}

export default App
