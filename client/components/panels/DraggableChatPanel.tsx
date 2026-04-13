import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ErrorBoundary, useValue } from 'tldraw'
import { TldrawAgentApp } from '../../agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	useAgent,
} from '../../agent/TldrawAgentAppProvider'
import { Claude, Gemini, OpenAI } from '@lobehub/icons'
import {
	AgentModelName,
	AgentModelProvider,
	AGENT_MODEL_DEFINITIONS,
} from '../../../shared/models'
import { ChatPanelFallback } from '../ChatPanelFallback'
import { ChatHistory } from '../chat-history/ChatHistory'
import { TodoList } from '../TodoList'
import { BYOKSettings } from '../byok/BYOKSettings'
import { usePortalTarget } from './PanelLayoutContext'

const CHAT_WIDTH = 340
const BAR_HEIGHT = 48
const EDGE_GAP = 16
const DEFAULT_TRANSCRIPT_H = 320
const MIN_TRANSCRIPT_H = 80

function snapBarToEdge(x: number, y: number) {
	const vw = window.innerWidth
	const vh = window.innerHeight
	x = Math.max(EDGE_GAP, Math.min(vw - CHAT_WIDTH - EDGE_GAP, x))
	y = Math.max(EDGE_GAP, Math.min(vh - BAR_HEIGHT - EDGE_GAP, y))
	const dL = x - EDGE_GAP
	const dR = vw - CHAT_WIDTH - EDGE_GAP - x
	const dT = y - EDGE_GAP
	const dB = vh - BAR_HEIGHT - EDGE_GAP - y
	const m = Math.min(dL, dR, dT, dB)
	if (m === dL) x = EDGE_GAP
	else if (m === dR) x = vw - CHAT_WIDTH - EDGE_GAP
	else if (m === dT) y = EDGE_GAP
	else y = vh - BAR_HEIGHT - EDGE_GAP
	return { x, y }
}

// ── Provider logos ─────────────────────────────────────────────────────────────

function ProviderIcon({ provider, size = 18 }: { provider: AgentModelProvider; size?: number }) {
	switch (provider) {
		case 'anthropic': return <Claude size={size} />
		case 'openai': return <OpenAI size={size} />
		case 'google': return <Gemini size={size} />
		default: return null
	}
}

// ── Model picker popup ─────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<AgentModelProvider, string> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google',
}
const PROVIDER_ORDER: AgentModelProvider[] = ['anthropic', 'google', 'openai']

function ModelPickerPopup({ onClose }: { onClose: () => void }) {
	const agent = useAgent()
	const currentModel = useValue('modelName', () => agent.modelName.getModelName(), [agent])

	const byProvider = PROVIDER_ORDER.map((p) => ({
		provider: p,
		models: Object.values(AGENT_MODEL_DEFINITIONS).filter((m) => m.provider === p),
	})).filter((g) => g.models.length > 0)

	return (
		<div className="model-picker-popup" onPointerDown={(e) => e.stopPropagation()}>
			{byProvider.map(({ provider, models }) => (
				<div key={provider} className="model-picker-group">
					<div className="model-picker-group-label">
						<ProviderIcon provider={provider} size={12} />
						{PROVIDER_LABELS[provider]}
					</div>
					{models.map((model) => (
						<button
							key={model.id}
							className={`model-picker-item${model.name === currentModel ? ' active' : ''}`}
							onClick={() => {
								agent.modelName.setModelName(model.name as AgentModelName)
								onClose()
							}}
						>
							{model.name}
						</button>
					))}
				</div>
			))}
		</div>
	)
}

// ── Transcript panel (slides up above the bar) ─────────────────────────────────

function TranscriptPanel({
	height,
	onResizeStart,
}: {
	height: number
	onResizeStart: (e: React.PointerEvent) => void
}) {
	const agent = useAgent()
	return (
		<div className="chat-transcript-panel" style={{ height }}>
			{/* Resize grip at very top */}
			<div className="transcript-resize-handle" onPointerDown={onResizeStart}>
				<div className="transcript-resize-pill" />
			</div>
			{/* Compact controls row */}
			<div className="transcript-controls">
				<button
					className="transcript-ctrl-btn"
					onClick={() => agent.reset()}
					title="New chat"
				>
					New chat
				</button>
				<div style={{ flex: 1 }} />
				<span onPointerDown={(e) => e.stopPropagation()}>
					<BYOKSettings />
				</span>
			</div>
			{/* Chat history */}
			<ErrorBoundary fallback={<div style={{ padding: 12, fontSize: 12 }}>Error loading history</div>}>
				<ChatHistory agent={agent} />
			</ErrorBoundary>
			<TodoList agent={agent} />
		</div>
	)
}

// ── Bar ────────────────────────────────────────────────────────────────────────

function ChatBar({
	transcriptOpen,
	onToggleTranscript,
	onDragStart,
}: {
	transcriptOpen: boolean
	onToggleTranscript: () => void
	onDragStart: (e: React.PointerEvent) => void
}) {
	const agent = useAgent()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const [showModelPicker, setShowModelPicker] = useState(false)
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const provider = AGENT_MODEL_DEFINITIONS[modelName]?.provider ?? 'anthropic'

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault()
			const value = inputValue.trim()
			if (!value) {
				if (isGenerating) agent.cancel()
				return
			}
			setInputValue('')
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent, editor, inputValue, isGenerating]
	)

	return (
		<form className="minimized-bar" onSubmit={handleSubmit} onPointerDown={onDragStart}>
			{/* Provider logo */}
			<button
				type="button"
				className="minimized-model-btn"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => setShowModelPicker((p) => !p)}
				title={modelName}
			>
				<ProviderIcon provider={provider} size={18} />
				{isGenerating && <span className="minimized-generating-dot" />}
			</button>

			{showModelPicker && (
				<ModelPickerPopup onClose={() => setShowModelPicker(false)} />
			)}

			{selectedShapes.length > 0 && (
				<span
					className="minimized-badge"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => editor.selectNone()}
				>
					{selectedShapes.length} sel
				</span>
			)}
			{contextItems.length > 0 && (
				<span
					className="minimized-badge"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => { for (const item of contextItems) agent.context.remove(item) }}
				>
					{contextItems.length} ctx
				</span>
			)}

			<input
				type="text"
				value={inputValue}
				onChange={(e) => setInputValue(e.target.value)}
				placeholder="Ask anything..."
				autoComplete="off"
				className="minimized-input"
				onPointerDown={(e) => e.stopPropagation()}
			/>

			<button
				type="submit"
				disabled={inputValue === '' && !isGenerating}
				className="minimized-submit"
				data-active={inputValue !== '' || isGenerating ? '' : undefined}
				onPointerDown={(e) => e.stopPropagation()}
			>
				{isGenerating && inputValue === '' ? '◼' : '↑'}
			</button>

			{/* Toggle transcript */}
			<button
				type="button"
				className="minimized-expand-btn"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={onToggleTranscript}
				title={transcriptOpen ? 'Hide history' : 'Show history'}
			>
				{transcriptOpen ? '▾' : '▴'}
			</button>
		</form>
	)
}

// ── Outer shell ────────────────────────────────────────────────────────────────

export function DraggableChatPanel({ app }: { app: TldrawAgentApp }) {
	const portalTarget = usePortalTarget()
	const [transcriptOpen, setTranscriptOpen] = useState(false)
	const [transcriptHeight, setTranscriptHeight] = useState(DEFAULT_TRANSCRIPT_H)

	// Bar position — track in a ref for drag callbacks, mirror to state for rendering
	const barPosRef = useRef({
		x: window.innerWidth - CHAT_WIDTH - EDGE_GAP,
		y: window.innerHeight - BAR_HEIGHT - EDGE_GAP,
	})
	const [barPos, _setBarPos] = useState(barPosRef.current)
	const setBarPos = useCallback((p: { x: number; y: number }) => {
		barPosRef.current = p
		_setBarPos(p)
	}, [])

	// ── Bar drag ──────────────────────────────────────────────────────────────
	const onDragStart = useCallback((e: React.PointerEvent) => {
		// Only drag from the bar background itself (children stop propagation)
		const startCX = e.clientX
		const startCY = e.clientY
		const startX = barPosRef.current.x
		const startY = barPosRef.current.y

		const onMove = (ev: PointerEvent) => {
			_setBarPos({
				x: startX + (ev.clientX - startCX),
				y: startY + (ev.clientY - startCY),
			})
		}
		const onUp = (ev: PointerEvent) => {
			const snapped = snapBarToEdge(
				startX + (ev.clientX - startCX),
				startY + (ev.clientY - startCY)
			)
			setBarPos(snapped)
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}, [setBarPos])

	// ── Transcript resize (drag the top handle) ───────────────────────────────
	const transcriptHeightRef = useRef(transcriptHeight)
	transcriptHeightRef.current = transcriptHeight

	const onResizeStart = useCallback((e: React.PointerEvent) => {
		e.stopPropagation()
		const startCY = e.clientY
		const startH = transcriptHeightRef.current

		const onMove = (ev: PointerEvent) => {
			// Drag up → bigger, drag down → smaller
			const dy = startCY - ev.clientY
			const maxH = window.innerHeight - BAR_HEIGHT - EDGE_GAP * 3
			setTranscriptHeight(Math.max(MIN_TRANSCRIPT_H, Math.min(maxH, startH + dy)))
		}
		const onUp = () => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
	}, [])

	if (!portalTarget) return null

	// Transcript grows upward from the bar
	const panelTop = transcriptOpen ? barPos.y - transcriptHeight : barPos.y

	const panelStyle: React.CSSProperties = {
		position: 'fixed',
		left: barPos.x,
		top: panelTop,
		width: CHAT_WIDTH,
		zIndex: 350,
		pointerEvents: 'all',
	}

	return createPortal(
		<div className="tl-theme__light chat-compact-shell" data-panel-id="chat" style={panelStyle}>
			<TldrawAgentAppContextProvider app={app}>
				{transcriptOpen && (
					<TranscriptPanel height={transcriptHeight} onResizeStart={onResizeStart} />
				)}
				<ChatBar
					transcriptOpen={transcriptOpen}
					onToggleTranscript={() => setTranscriptOpen((p) => !p)}
					onDragStart={onDragStart}
				/>
			</TldrawAgentAppContextProvider>
		</div>,
		portalTarget
	)
}
