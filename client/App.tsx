import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	DefaultSizeStyle,
	DefaultStylePanel,
	DefaultToolbar,
	DefaultToolbarContent,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiMenuToolItem,
	TldrawUiToastsProvider,
	TLUiOverrides,
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
import { AssetRecordType, TLAsset, TLAssetId } from 'tldraw'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

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

// Custom toolbar with Math and Graph buttons pinned before default items
function CustomToolbar() {
	return (
		<DefaultToolbar>
			<TldrawUiMenuToolItem toolId="math" />
			<TldrawUiMenuToolItem toolId="graph" />
			<DefaultToolbarContent />
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
								const file = e.dataTransfer.files[0]
								if (file.type === 'application/pdf') {
									e.preventDefault()
									e.stopPropagation()
									
									const point = editor.screenToPage({ x: e.clientX, y: e.clientY })
									
									try {
										const { PdfProcessor } = await import('./utils/PdfProcessor')
										const pages = await PdfProcessor.processFile(file)
										
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
													name: file.name + ' Page ' + page.pageNumber,
													isAnimated: false,
													mimeType: 'image/png',
													src: page.dataUrl,
												}
											})
										}
										
										editor.createAssets(assetsToCreate)
										
										editor.createShape({
											type: 'pdf',
											x: point.x,
											y: point.y,
											props: {
												w: 400,
												h: 500,
												assetIds,
												currentPage: 0
											}
										})
									} catch(err) {
										console.error("Failed to process PDF", err)
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
