import { FormEventHandler, useCallback, useRef, useState } from 'react'
import { Editor, ErrorBoundary, useValue } from 'tldraw'
import { TldrawAgentApp } from '../../agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	useAgent,
} from '../../agent/TldrawAgentAppProvider'
import { AgentModelName, AGENT_MODEL_DEFINITIONS } from '../../../shared/models'
import { ChatPanelFallback } from '../ChatPanelFallback'
import { ChatHistory } from '../chat-history/ChatHistory'
import { ChatInput } from '../ChatInput'
import { TodoList } from '../TodoList'
import { BYOKSettings } from '../byok/BYOKSettings'
import { useBottomPanel } from './PanelLayoutContext'

const CHAT_WIDTH = 340
const MINIMIZED_HEIGHT = 44

// ── Expanded panel content ─────────────────────────────────────────────────────

function ExpandedContent({ onMinimize }: { onMinimize: () => void }) {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string
			if (value === '') {
				agent.cancel()
				return
			}
			inputRef.current.value = ''
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	return (
		<>
			<div className="chat-header">
				<button className="new-chat-button" onClick={onMinimize} title="Minimize" style={{ fontSize: 11 }}>
					▾
				</button>
				<div style={{ flex: 1 }} />
				<button className="new-chat-button" onClick={() => agent.reset()} title="New Chat">
					+
				</button>
				<BYOKSettings />
			</div>
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} />
			</div>
		</>
	)
}

// ── Minimized bar content ──────────────────────────────────────────────────────

function MinimizedContent({ onExpand }: { onExpand: () => void }) {
	const agent = useAgent()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])

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
		<form onSubmit={handleSubmit} className="minimized-chat-form">
			<button type="button" onClick={onExpand} className="minimized-chat-expand" title="Expand">
				▴
			</button>

			{selectedShapes.length > 0 && (
				<span className="minimized-chat-badge" onClick={() => editor.selectNone()}>
					{selectedShapes.length} sel
				</span>
			)}
			{contextItems.length > 0 && (
				<span
					className="minimized-chat-badge"
					onClick={() => { for (const item of contextItems) agent.context.remove(item) }}
				>
					{contextItems.length} ctx
				</span>
			)}

			{isGenerating && <span className="minimized-chat-dot" />}

			<input
				ref={inputRef}
				type="text"
				value={inputValue}
				onChange={(e) => setInputValue(e.target.value)}
				placeholder="Ask anything..."
				autoComplete="off"
				className="minimized-chat-input"
			/>

			<span className="minimized-chat-model">{modelName}</span>

			<button
				type="submit"
				disabled={inputValue === '' && !isGenerating}
				className="minimized-chat-submit"
				data-active={inputValue !== '' || isGenerating ? '' : undefined}
			>
				{isGenerating && inputValue === '' ? '◼' : '↑'}
			</button>
		</form>
	)
}

// ── Outer shell ────────────────────────────────────────────────────────────────

export function DraggableChatPanel({ app }: { app: TldrawAgentApp }) {
	const [minimized, setMinimized] = useState(false)

	const { style, onDragStart } = useBottomPanel({
		id: 'chat',
		width: CHAT_WIDTH,
		defaultSide: 'right',
	})

	if (minimized) {
		return (
			<div className="tl-theme__light hud-panel" data-panel-id="chat" style={style}>
				<div className="panel-drag-handle" onPointerDown={onDragStart}>
					<div className="panel-drag-pill" />
				</div>
				<TldrawAgentAppContextProvider app={app}>
					<MinimizedContent onExpand={() => setMinimized(false)} />
				</TldrawAgentAppContextProvider>
			</div>
		)
	}

	return (
		<div
			className="chat-panel tl-theme__dark"
			data-panel-id="chat"
			style={{
				...style,
				height: `calc(100vh - 32px)`,
			}}
		>
			<div className="panel-drag-handle" onPointerDown={onDragStart}>
				<div className="panel-drag-pill panel-drag-pill--dark" />
			</div>
			<ErrorBoundary fallback={ChatPanelFallback}>
				<TldrawAgentAppContextProvider app={app}>
					<ExpandedContent onMinimize={() => setMinimized(true)} />
				</TldrawAgentAppContextProvider>
			</ErrorBoundary>
		</div>
	)
}
