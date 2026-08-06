import { Editor, RecordsDiff, reverseRecordsDiff, structuredClone, TLRecord } from 'tldraw'
import { convertTldrawShapeToFocusedShape } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { AgentModelName, AGENT_MODEL_DEFINITIONS } from '../../shared/models'
import { AgentAction, getActionSchema } from '../../shared/types/AgentAction'
import { AgentInput } from '../../shared/types/AgentInput'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { ChatHistoryItem, ChatHistoryPromptItem } from '../../shared/types/ChatHistoryItem'
import { ContextItem } from '../../shared/types/ContextItem'
import { PromptPart } from '../../shared/types/PromptPart'
import { Streaming } from '../../shared/types/Streaming'
import { TodoItem } from '../../shared/types/TodoItem'
import { BYOKStore } from '../utils/BYOKStore'
import { AgentHelpers } from '../AgentHelpers'
import { getModeNode } from '../modes/AgentModeChart'
import { AgentModeType } from '../modes/AgentModeDefinitions'
import { getPromptPartUtilsRecord, PromptPartUtil } from '../parts/PromptPartUtil'
import { buildMessages } from '../prompt/buildMessages'
import { buildSystemPrompt } from '../prompt/buildSystemPrompt'
import {
	AgentRequestFailedError,
	AgentRequestOutcome,
	backoffDelayMs,
	isRetryableError,
	MAX_REQUEST_ATTEMPTS,
} from './AgentRequestOutcome'
import { AgentActionManager } from './managers/AgentActionManager'
import { AgentChatManager } from './managers/AgentChatManager'
import { AgentChatOriginManager } from './managers/AgentChatOriginManager'
import { AgentContextManager } from './managers/AgentContextManager'
import { AgentDebugFlags, AgentDebugManager } from './managers/AgentDebugManager'
import { AgentLintManager } from './managers/AgentLintManager'
import { AgentModeManager } from './managers/AgentModeManager'
import { AgentModelNameManager } from './managers/AgentModelNameManager'
import { AgentRequestManager } from './managers/AgentRequestManager'
import { AgentTodoManager } from './managers/AgentTodoManager'
import { AgentUsageManager } from './managers/AgentUsageManager'
import { AgentUserActionTracker } from './managers/AgentUserActionTracker'
import { AgentUsageTotals, isAgentUsageEvent } from '../../shared/types/AgentUsage'

/**
 * How many times in a row the agent may schedule more work for itself before
 * it has to stop and hand back to the user.
 *
 * Generous enough that ordinary multi-step work (plan, draw, review, tidy)
 * finishes well inside it, but low enough that a model which never marks its
 * todos done can't bill the user indefinitely.
 */
export const MAX_CONSECUTIVE_CONTINUATIONS = 12

/**
 * The persisted state of an agent.
 * Used for saving and loading agent state.
 */
export interface PersistedAgentState {
	chatHistory?: ChatHistoryItem[]
	chatOrigin?: { x: number; y: number }
	todoList?: TodoItem[]
	contextItems?: ContextItem[]
	modelName?: AgentModelName
	debugFlags?: AgentDebugFlags
	usageTotals?: AgentUsageTotals
}

export interface TldrawAgentOptions {
	/** The editor to associate the agent with. */
	editor: Editor
	/** A key used to differentiate the agent from other agents. */
	id: string
	/** A callback for when an error occurs. */
	onError: (e: any) => void
}

/**
 * An agent that can be prompted to edit the canvas.
 * Access the agent via `useAgent()` hook from TldrawAgentAppProvider,
 * or via `AgentAppAgentsManager.getAgent(editor)`.
 *
 * @example
 * ```tsx
 * const agent = useAgent()
 * agent.prompt('Draw a snowman')
 * ```
 */
export class TldrawAgent {
	/** The editor associated with this agent. */
	editor: Editor

	/** An id to differentiate the agent from other agents. */
	id: string

	/** A callback for when an error occurs. */
	onError: (e: any) => void

	// ==================== Managers ====================

	/** The action manager associated with this agent. */
	actions: AgentActionManager

	/** The chat manager associated with this agent. */
	chat: AgentChatManager

	/** The chat origin manager associated with this agent. */
	chatOrigin: AgentChatOriginManager

	/** The context manager associated with this agent. */
	context: AgentContextManager

	/** The debug manager associated with this agent. */
	debug: AgentDebugManager

	/** The lint manager associated with this agent. */
	lints: AgentLintManager

	/** The mode manager associated with this agent. */
	mode: AgentModeManager

	/** The model name manager associated with this agent. */
	modelName: AgentModelNameManager

	/** The request manager associated with this agent. */
	requests: AgentRequestManager

	/** The todo manager associated with this agent. */
	todos: AgentTodoManager

	/** The token usage / cost tracker associated with this agent. */
	usage: AgentUsageManager

	/** The user action tracker associated with this agent. */
	userAction: AgentUserActionTracker

	// ==================== Prompt Part Utils ====================

	/**
	 * A record of the agent's prompt part util instances.
	 * Used by the `getPromptPartUtil` method.
	 */
	promptPartUtils: Record<PromptPart['type'], PromptPartUtil<PromptPart>>

	/**
	 * Get a prompt part util for a specific part type.
	 *
	 * @param type - The type of part to get the util for.
	 * @returns The part util.
	 */
	getPromptPartUtil(type: PromptPart['type']) {
		return this.promptPartUtils[type]
	}

	/**
	 * Create a new tldraw agent.
	 */
	constructor({ editor, id, onError }: TldrawAgentOptions) {
		this.editor = editor
		this.id = id
		this.onError = onError

		// Initialize managers
		// Note: mode must be initialized before actions, since actions depends on mode
		this.mode = new AgentModeManager(this)
		this.actions = new AgentActionManager(this)
		this.chat = new AgentChatManager(this)
		this.chatOrigin = new AgentChatOriginManager(this)
		this.context = new AgentContextManager(this)
		this.debug = new AgentDebugManager(this)
		this.lints = new AgentLintManager(this)
		this.modelName = new AgentModelNameManager(this)
		this.requests = new AgentRequestManager(this)
		this.todos = new AgentTodoManager(this)
		this.usage = new AgentUsageManager(this)
		this.userAction = new AgentUserActionTracker(this)

		// Note: Agent registration is handled by AgentAppAgentsManager.createAgent()

		// Initialize prompt part utils
		this.promptPartUtils = getPromptPartUtilsRecord(this)

		// Start recording user actions
		this.userAction.startRecording()
	}

	// ==================== State Persistence ====================

	/**
	 * Serialize the agent's state to a plain object for persistence.
	 * This is called by the app-level persistence manager to save agent state.
	 */
	serializeState(): PersistedAgentState {
		return {
			chatHistory: this.chat.getHistory(),
			chatOrigin: this.chatOrigin.getOrigin(),
			todoList: this.todos.getTodos(),
			contextItems: this.context.getItems(),
			modelName: this.modelName.getModelName(),
			debugFlags: this.debug.getDebugFlags(),
			usageTotals: this.usage.getTotals(),
		}
	}

	/**
	 * Load previously persisted state into the agent.
	 * This is called by the app-level persistence manager to restore agent state.
	 *
	 * @param state - The persisted state to load.
	 */
	loadState(state: PersistedAgentState) {
		if (state.chatHistory) {
			this.chat.setHistory(state.chatHistory)
		}
		if (state.chatOrigin) {
			this.chatOrigin.setOrigin(state.chatOrigin)
		}
		if (state.todoList) {
			this.todos.setTodos(state.todoList)
		}
		if (state.contextItems) {
			this.context.setItems(state.contextItems)
		}
		if (state.modelName) {
			this.modelName.setModelName(state.modelName)
		}
		if (state.debugFlags) {
			this.debug.setDebugFlags(state.debugFlags)
		}
		if (state.usageTotals) {
			this.usage.setTotals(state.usageTotals)
		}
	}

	/**
	 * Dispose of the agent by cancelling requests and stopping listeners.
	 */
	dispose() {
		this.cancel()
		this.userAction.dispose()

		// Dispose all managers
		this.actions.dispose()
		this.chat.dispose()
		this.chatOrigin.dispose()
		this.context.dispose()
		this.debug.dispose()
		this.lints.dispose()
		this.mode.dispose()
		this.modelName.dispose()
		this.requests.dispose()
		this.todos.dispose()
		this.usage.dispose()

		// Note: Agent removal from registry is handled by AgentAppAgentsManager.deleteAgent()
	}

	/**
	 * Whether the agent is currently acting on the editor or not.
	 * This flag is used to prevent agent actions from being recorded as user actions.
	 *
	 * Do not use this to check if the agent is currently working on a request. Use `isGenerating` instead.
	 */
	private isActingOnEditor = false

	/**
	 * Get whether the agent is currently acting on the editor.
	 * @returns true if the agent is currently acting, false otherwise.
	 */
	getIsActingOnEditor(): boolean {
		return this.isActingOnEditor
	}

	/**
	 * Set whether the agent is currently acting on the editor.
	 * @param value - true if the agent is acting, false otherwise.
	 */
	setIsActingOnEditor(value: boolean): void {
		this.isActingOnEditor = value
	}

	// ==================== Request Handling ====================

	/**
	 * Get a full prompt based on a request.
	 *
	 * @param request - The request to use for the prompt.
	 * @param helpers - The helpers to use.
	 * @returns The fully assembled prompt.
	 */
	async preparePrompt(request: AgentRequest, helpers: AgentHelpers): Promise<AgentPrompt> {
		const { promptPartUtils } = this
		const transformedParts: PromptPart[] = []

		// Get available prompt part types from the current mode
		const modeDefinition = this.mode.getCurrentModeDefinition()
		if (!modeDefinition.active) {
			throw new Error(
				`Fairy is not in an active mode so can't act right now. Current mode: ${modeDefinition.type}`
			)
		}

		const availablePromptPartTypes = modeDefinition.parts

		// One clone shared by every part util instead of one per util (~18x),
		// with request.data's promises resolved first - structuredClone throws
		// DataCloneError on a pending Promise. Frozen (shallow) so a part util
		// that mutates the request fails loudly instead of corrupting its
		// siblings' view of it.
		const resolvedData = await Promise.all(request.data)
		const preparedRequest = Object.freeze(
			structuredClone({ ...request, data: resolvedData })
		) as AgentRequest

		for (const promptPartType of availablePromptPartTypes) {
			const util = promptPartUtils[promptPartType]
			if (!util) throw new Error(`Prompt part util not found for part type: ${promptPartType}`)
			const part = await util.getPart(preparedRequest, helpers)
			if (!part) continue
			transformedParts.push(part)
		}

		return Object.fromEntries(transformedParts.map((part) => [part.type, part])) as AgentPrompt
	}

	/**
	 * Commit the state consumption of every part in a prompt. Called exactly
	 * once per successful request - see PromptPartUtil.commitPart.
	 */
	private commitPromptParts(prompt: AgentPrompt, request: AgentRequest) {
		for (const part of Object.values(prompt)) {
			if (!part) continue
			const util = this.promptPartUtils[part.type as PromptPart['type']]
			util?.commitPart?.(part as never, request)
		}
	}

	/**
	 * Prompt the agent to edit the canvas.
	 *
	 * @example
	 * ```tsx
	 * const agent = useAgent()
	 * agent.prompt('Draw a cat')
	 * ```
	 *
	 * ```tsx
	 * agent.prompt({
	 *   message: 'Draw a cat in this area',
	 *   bounds: {
	 *     x: 0,
	 *     y: 0,
	 *     w: 300,
	 *     h: 400,
	 *   },
	 * })
	 * ```
	 *
	 * @returns A promise for when the agent has finished its work.
	 */
	async prompt(input: AgentInput, { nested = false }: { nested?: boolean } = {}) {
		if (this.requests.isGenerating() && !nested) {
			throw new Error('Agent is already prompting. Please wait for the current prompt to finish.')
		}

		if (this.isActingOnEditor) {
			throw new Error(
				"Agent is already acting. It's illegal to prompt an agent during an action. Please use schedule instead."
			)
		}

		this.requests.setIsPrompting(true)

		// Everything below runs inside try/finally: any throw - a mode hook, the
		// mode invariant, prompt assembly - previously left $isPrompting stuck
		// true, bricking the agent for the session ("Agent is already
		// prompting") with no way back but a reset.
		try {
			const request = this.requests.getFullRequestFromInput(input)

			// A new instruction from the user starts a fresh stretch of work, so
			// the agent gets its full continuation budget back.
			if (request.source === 'user') {
				this.requests.resetContinuationCount()

				// Anchor the chat origin on the conversation's first prompt. The
				// origin offsets every coordinate sent to the model to keep the
				// numbers small; it was previously only ever set by "new chat",
				// so most sessions ran with a zero vector and the entire offset
				// machinery was inert. Helpers snapshot the origin when they're
				// constructed, so this must happen before the request runs.
				const hasPromptedBefore = this.chat
					.getHistory()
					.some((item) => item.type === 'prompt')
				if (!hasPromptedBefore) {
					const viewport = this.editor.getViewportPageBounds()
					this.chatOrigin.setOrigin({ x: viewport.x, y: viewport.y })
				}
			}

			const startingNode = this.mode.getCurrentModeNode()
			startingNode.onPromptStart?.(this, request)

			// Submit the request, retrying transient failures with backoff.
			// Retries are re-POSTs: actions already applied from a failed
			// attempt stay applied and appear in the rebuilt chat history, so
			// the model continues rather than duplicating them.
			let outcome: AgentRequestOutcome = { status: 'success' }
			for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
				outcome = await this.request(request, { silentPromptItem: attempt > 0 })
				if (!(outcome.status === 'error' && outcome.retryable)) break
				if (attempt < MAX_REQUEST_ATTEMPTS - 1) {
					const cancelled = await this.waitForRetry(attempt)
					if (cancelled) {
						outcome = { status: 'cancelled' }
						break
					}
				}
			}

			if (outcome.status === 'error') {
				// Surface once (not once per attempt), and do NOT run
				// onPromptEnd - it would schedule an instant continuation off a
				// failed request. A self-scheduled follow-up is dropped; a
				// user interrupt survives and is consumed below.
				this.onError(outcome.error)
				const failedSchedule = this.requests.getScheduledRequest()
				if (failedSchedule && failedSchedule.source !== 'user') {
					this.requests.clearScheduledRequest()
				}
				if (!this.requests.getScheduledRequest() && this.mode.getCurrentModeDefinition().active) {
					this.mode.setMode('idling')
				}
			} else if (outcome.status === 'success') {
				let modeChanged = true
				while (!this.requests.getScheduledRequest() && modeChanged) {
					modeChanged = false
					const currentModeType = this.mode.getCurrentModeType()
					const currentModeNode = this.mode.getCurrentModeNode()
					currentModeNode.onPromptEnd?.(this, request) // in case onPromptEnd switches modes
					const newModeType = this.mode.getCurrentModeType()
					if (newModeType !== currentModeType) {
						modeChanged = true
					}
				}
			} else {
				// Cancelled. onPromptCancel (via agent.cancel) already moved the
				// mode; a bare interrupt cancel leaves it active with a user
				// request scheduled, which is consumed below. If neither
				// happened, don't strand the agent in an active mode.
				if (!this.requests.getScheduledRequest() && this.mode.getCurrentModeDefinition().active) {
					this.mode.setMode('idling')
				}
			}

			// Shared tail for every outcome: consume a scheduled request if one
			// exists. This is how interrupt-while-generating works - the user's
			// message lands as a scheduled request on a cancelled prompt - so
			// the error and cancel paths must consume it too.
			const scheduledRequest = this.requests.getScheduledRequest()
			if (!scheduledRequest) {
				const eventualModeType = this.mode.getCurrentModeType()
				if (outcome.status === 'success' && this.mode.getCurrentModeDefinition().active) {
					throw new Error(
						`Agent is not allowed to become inactive during the active mode: ${eventualModeType}`
					)
				}
				return
			}

			// Budget check. A user-sourced request resets the counter BEFORE the
			// check - previously the increment ran first, so a user interrupt
			// arriving exactly at the budget boundary was silently discarded by
			// stopRunawayLoop.
			if (scheduledRequest.source === 'user') {
				this.requests.resetContinuationCount()
			} else if (this.requests.incrementContinuationCount() > MAX_CONSECUTIVE_CONTINUATIONS) {
				// The agent has used up its self-directed budget. Without this
				// the loop is unbounded: `working.onPromptEnd` reschedules while
				// any todo is outstanding, and only the model marks todos done.
				this.stopRunawayLoop()
				return
			}

			// Add the scheduled request to chat history
			const resolvedData = await Promise.all(scheduledRequest.data)
			this.chat.push({
				type: 'continuation',
				data: resolvedData,
			})

			// Handle the scheduled request and clear it
			this.requests.clearScheduledRequest()
			await this.prompt(scheduledRequest, { nested: true })
		} catch (e) {
			this.onError(e)
		} finally {
			this.requests.setIsPrompting(false)
			this.requests.setCancelFn(null)
		}
	}

	/**
	 * Wait out a retry backoff. Returns true if the wait was cancelled (via
	 * agent.cancel or an interrupt), in which case the retry must not happen.
	 */
	private waitForRetry(attempt: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.requests.setCancelFn(null)
				resolve(false)
			}, backoffDelayMs(attempt))
			this.requests.setCancelFn(() => {
				clearTimeout(timer)
				resolve(true)
			})
		})
	}

	/**
	 * Stop the agent after it has used up its continuation budget.
	 *
	 * Told plainly in the chat rather than silently: from the user's side the
	 * agent just stopped mid-task, and they need to know it hit a limit (and
	 * can be told to carry on) rather than that it finished or crashed.
	 */
	private stopRunawayLoop() {
		this.requests.clearScheduledRequest()

		const outstanding = this.todos.getTodos().filter((todo) => todo.status !== 'done')
		const summary =
			outstanding.length > 0
				? ` ${outstanding.length} todo item${outstanding.length === 1 ? '' : 's'} still outstanding.`
				: ''

		this.chat.push({
			type: 'action',
			action: {
				_type: 'message',
				complete: true,
				time: 0,
				text:
					`I've worked on this for ${MAX_CONSECUTIVE_CONTINUATIONS} rounds without stopping, so I've paused to check in.${summary}` +
					` Tell me to keep going if you'd like me to continue.`,
			},
			diff: { added: {}, updated: {}, removed: {} },
			acceptance: 'accepted',
		})

		if (this.mode.getCurrentModeType() !== 'idling') {
			this.mode.setMode('idling')
		}
		// isPrompting/cancelFn are cleared by prompt()'s finally.
	}

	/**
	 * Send a single request to the agent and handle its response.
	 *
	 * Note: This method does not chain multiple requests together. For a full
	 * agentic system, use the `prompt` method.
	 *
	 * Most developers will not want to use this method directly. It's mostly
	 * used internally by the `prompt` method, but can also be useful for
	 * carrying out evals.
	 *
	 * @param input - The input to form the request from.
	 * @returns The outcome of the request: success, cancelled, or an error
	 * with a retryability judgement.
	 */
	async request(
		input: AgentInput,
		opts: { silentPromptItem?: boolean } = {}
	): Promise<AgentRequestOutcome> {
		const request = this.requests.getFullRequestFromInput(input)

		// Interrupt any currently active request
		if (this.requests.getActiveRequest() !== null) {
			this.cancel()
		}
		this.requests.setActiveRequest(request)

		// Call an external helper function to request the agent
		const { promise, cancel } = this.requestAgentActions(request, opts)

		this.requests.setCancelFn(cancel)

		const outcome = await promise
		// Only clear our own request - a successor may already be active if
		// this one was interrupted, and clearing unconditionally would break
		// the UI highlights bound to the active request.
		if (this.requests.getActiveRequest() === request) {
			this.requests.clearActiveRequest()
		}

		return outcome
	}

	/**
	 * Schedule further work for the agent to do after this request has finished.
	 * What you schedule will get merged with the currently scheduled request, if there is one.
	 *
	 * @example
	 * ```tsx
	 * // Add an instruction
	 * agent.schedule('Add more detail.')
	 * ```
	 *
	 * @example
	 * ```tsx
	 * // Move the viewport
	 * agent.schedule({
	 *  bounds: { x: 0, y: 0, w: 100, h: 100 },
	 * })
	 * ```
	 *
	 * @example
	 * ```tsx
	 * // Add data to the request
	 * agent.schedule({ data: [value] })
	 * ```
	 */
	schedule(input: AgentInput) {
		const scheduledRequest = this.requests.getScheduledRequest()

		// If there's no request scheduled yet, schedule one
		if (!scheduledRequest) {
			this._schedule(input)
			return
		}

		const newRequest = this.requests.getPartialRequestFromInput(input)

		this._schedule({
			// Append to properties where possible
			agentMessages: [...scheduledRequest.agentMessages, ...(newRequest.agentMessages ?? [])],
			userMessages: [...scheduledRequest.userMessages, ...(newRequest.userMessages ?? [])],
			data: [...scheduledRequest.data, ...(newRequest.data ?? [])],

			// Override specific properties
			bounds: newRequest.bounds ?? scheduledRequest.bounds,
			contextItems: [...scheduledRequest.contextItems, ...(newRequest.contextItems ?? [])],
			source: newRequest.source ?? scheduledRequest.source ?? 'self',
		})
	}

	/**
	 * Manually override what the agent should do next.
	 *
	 * @example
	 * ```tsx
	 * agent.setScheduledRequest('Add more detail.')
	 * ```
	 *
	 * @example
	 * ```tsx
	 * agent.setScheduledRequest({
	 *  message: 'Add more detail to this area.',
	 *  bounds: { x: 0, y: 0, w: 100, h: 100 },
	 * })
	 * ```
	 *
	 * @example
	 * ```tsx
	 * // Cancel the scheduled request
	 * agent.setScheduledRequest(null)
	 * ```
	 *
	 * @param input - What to set the scheduled request to, or null to cancel
	 * the scheduled request.
	 */
	private _schedule(input: AgentInput | null) {
		if (input === null) {
			this.requests.clearScheduledRequest()
			return
		}

		const partialRequest = this.requests.getPartialRequestFromInput(input)
		partialRequest.source = partialRequest.source ?? 'self' // when scheduling, we want the default source to be 'self' if none is provided
		const request = this.requests.getFullRequestFromInput(partialRequest)

		const isCurrentlyActive = this.requests.isGenerating()

		if (isCurrentlyActive) {
			this.requests.setScheduledRequest(request)
		} else {
			// Every user prompt flows through here un-awaited (via the chat
			// panel's interrupt -> schedule), so a rejection would otherwise be
			// an unhandled promise rejection with no toast.
			this.prompt(request).catch((e) => this.onError(e))
		}
	}

	/**
	 * Interrupt the agent and set their mode.
	 * Optionally, schedule a request.
	 */
	interrupt({ input, mode }: { input: AgentInput | null; mode?: AgentModeType }) {
		this.requests.cancel()
		if (mode) {
			this.mode.setMode(mode)
		}
		if (input !== null) {
			this.schedule(input)
		}
	}

	// ==================== Cancel & Reset ====================

	/**
	 * Cancel the agent's current prompt, if one is active.
	 */
	cancel() {
		const activeRequest = this.requests.getActiveRequest()

		if (activeRequest) {
			const modeType = this.mode.getCurrentModeType()
			const modeNode = getModeNode(modeType)
			modeNode.onPromptCancel?.(this, activeRequest)

			const newModeDefinition = this.mode.getCurrentModeDefinition()
			if (newModeDefinition.active) {
				throw new Error(
					`Agent is not allowed to become inactive during the active mode: ${this.mode.getCurrentModeType()}`
				)
			}
		}

		this.requests.cancel()
	}

	/**
	 * Reset the agent's chat and memory.
	 * Cancel the current request if there's one active.
	 */
	reset() {
		this.cancel()

		// Reset all managers
		this.actions.reset()
		this.chat.reset()
		this.chatOrigin.reset()
		this.context.reset()
		this.lints.reset()
		this.mode.reset()
		this.requests.reset()
		this.todos.reset()
		this.usage.reset()
		this.userAction.reset()
	}

	// ==================== Request Helpers ====================

	/**
	 * Send a request to the agent and handle its response.
	 *
	 * This is a helper function that is used internally by the agent.
	 */
	private requestAgentActions(
		request: AgentRequest,
		{ silentPromptItem = false }: { silentPromptItem?: boolean } = {}
	) {
		const { editor } = this

		// The mode check runs BEFORE the history push - previously an
		// inactive-mode throw left an orphaned prompt item in the chat.
		const modeDefinition = this.mode.getCurrentModeDefinition()
		if (!modeDefinition.active) {
			this.cancel()
			throw new Error(
				`Agent is not in an active mode so cannot take actions. Current mode: ${modeDefinition.type}`
			)
		}

		// Add user prompt to chat history. Retries of the same logical request
		// skip this - the prompt is already there from the first attempt.
		if (!silentPromptItem) {
			const promptHistoryItem: ChatHistoryPromptItem = {
				type: 'prompt',
				promptSource: request.source,
				agentFacingMessage: request.agentMessages.join('\n'),
				userFacingMessage: request.userMessages.length > 0 ? request.userMessages.join('\n') : null,
				contextItems: structuredClone(request.contextItems),
				selectedShapes: this.editor
					.getSelectedShapes()
					.map((shape) => convertTldrawShapeToFocusedShape(this.editor, structuredClone(shape))),
			}
			this.chat.push(promptHistoryItem)
		}

		let cancelled = false
		const controller = new AbortController()
		const signal = controller.signal
		const helpers = new AgentHelpers(this)

		const availableActions: readonly AgentAction['_type'][] = modeDefinition.actions

		const requestPromise: Promise<AgentRequestOutcome> = (async () => {
			const prompt = await this.preparePrompt(request, helpers)
			let incompleteDiff: RecordsDiff<TLRecord> | null = null
			const actionPromises: Promise<void>[] = []
			try {
				for await (const action of this.streamAgentActions({ prompt, signal })) {
					if (cancelled) break

					// Set acting flag BEFORE editor.run so user action tracker ignores all changes
					// including diff reverts that happen before act() is called
					this.setIsActingOnEditor(true)
					try {
						editor.run(
							() => {
								const actionUtilType = this.actions.getAgentActionUtilType(action._type)
								const actionUtil = this.actions.getAgentActionUtil(action._type)

								// An unrecognized _type resolves to 'unknown', which IS in
								// the mode's actions array - without this check it would
								// sail through, apply nothing, and be logged to history as
								// a success the model then builds on.
								if (
									action.complete &&
									action._type &&
									action._type !== 'unknown' &&
									actionUtilType === 'unknown'
								) {
									this.actions.recordFailedAction(
										action,
										'unrecognized-type',
										`No action of type "${action._type}" exists.`
									)
									return
								}

								// If the action is not in the mode's available actions, skip it
								if (!availableActions.includes(actionUtilType)) {
									this.actions.recordFailedAction(
										action,
										'mode-unavailable',
										`The "${actionUtilType}" action is not available right now.`
									)
									return
								}

								// If there was a diff from an incomplete action, revert it so that we can reapply the action
								// This must happen BEFORE sanitize so we're working with clean state
								if (incompleteDiff) {
									const inversePrevDiff = reverseRecordsDiff(incompleteDiff)
									editor.store.applyDiff(inversePrevDiff)
									// Track the inverse diff to update created shapes tracking
									this.lints.trackShapesFromDiff(inversePrevDiff)
									incompleteDiff = null
								}

								// Validate completed actions against their schema. Partial
								// actions are inherently incomplete so are only validated once
								// the model has finished streaming them.
								if (action.complete) {
									const schema = getActionSchema(action._type)
									if (schema) {
										const result = schema.safeParse(action)
										if (!result.success) {
											const reason = result.error.issues
												.slice(0, 3)
												.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
												.join('; ')
											this.actions.recordFailedAction(action, 'schema-invalid', reason)
											console.warn('Skipping action that failed schema validation:', action)
											return
										}
									}
								}

								// Sanitize the agent's action
								const transformedAction = actionUtil.sanitizeAction(action, helpers)
								if (!transformedAction) {
									this.actions.recordFailedAction(
										action,
										'sanitize-rejected',
										'The action referred to something that does not exist, or had invalid fields.'
									)
									return
								}

								// Apply the action to the app and editor
								const { diff, promise } = this.actions.act(transformedAction, helpers)

								if (promise) {
									actionPromises.push(promise)
								}

								// Track shapes from diff for both complete and incomplete actions
								this.lints.trackShapesFromDiff(diff)

								// If the action is incomplete, save the diff so that we can revert it in the future
								if (transformedAction.complete) {
									// Log completed action if debug logging is enabled
									this.debug.logCompletedAction(transformedAction)
								} else {
									incompleteDiff = diff
								}
							},
							{
								ignoreShapeLock: true,
								history: 'ignore',
							}
						)
					} finally {
						this.setIsActingOnEditor(false)
					}
				}
				await Promise.all(actionPromises)
				// The request succeeded: only now do prompt parts consume the
				// state they reported (user-action history, surfaced lints).
				this.commitPromptParts(prompt, request)
				return { status: 'success' } as const
			} catch (e) {
				// User cancellation: the cancel() below sets `cancelled` before
				// aborting, so an AbortError here without the flag is the idle
				// timeout, which is a retryable failure rather than a cancel.
				if (cancelled || e === 'Cancelled by user') {
					return { status: 'cancelled' } as const
				}
				// The retry loop in prompt() owns surfacing - reporting here
				// used to produce one toast per attempt.
				return { status: 'error', error: e, retryable: isRetryableError(e) } as const
			} finally {
				// If the stream ended (cancel, error, truncation) while an
				// incomplete action was still applied, revert it. Otherwise a
				// locked, half-formed shape is left stranded on the canvas.
				const danglingDiff: RecordsDiff<TLRecord> | null = incompleteDiff
				if (danglingDiff) {
					incompleteDiff = null
					this.setIsActingOnEditor(true)
					try {
						editor.run(
							() => {
								const inverseDiff = reverseRecordsDiff(danglingDiff)
								editor.store.applyDiff(inverseDiff)
								this.lints.trackShapesFromDiff(inverseDiff)
							},
							{ ignoreShapeLock: true, history: 'ignore' }
						)
					} finally {
						this.setIsActingOnEditor(false)
					}
				}
			}
		})()

		const cancel = () => {
			cancelled = true
			controller.abort('Cancelled by user')
		}

		return { promise: requestPromise, cancel }
	}

	/**
	 * Stream a response from the model.
	 * Act on the model's events as they come in.
	 *
	 * This is a helper function that is used internally by the agent.
	 */
	private async *streamAgentActions({
		prompt,
		signal,
	}: {
		prompt: AgentPrompt
		signal: AbortSignal
	}): AsyncGenerator<Streaming<AgentAction>> {
		
		const systemPrompt = buildSystemPrompt(prompt)
		const messages = buildMessages(prompt)
		
		// Insert system prompt
		messages.unshift({
			role: 'system',
			content: systemPrompt
		})

		const modelName = this.modelName.getModelName()
		const modelDef = AGENT_MODEL_DEFINITIONS[modelName]
		const byokConfig = BYOKStore.getConfig()

		// The provider must match the selected model — the BYOK setting only
		// says which key the user saved, and the two can disagree.
		const provider = modelDef.provider === 'google' ? 'gemini' : modelDef.provider

		// Abort if the stream goes quiet for too long, rather than capping the
		// total duration — a healthy long generation should never be killed.
		const IDLE_TIMEOUT_MS = 90_000
		const idleController = new AbortController()
		let idleTimer: ReturnType<typeof setTimeout> | null = null
		const resetIdleTimer = () => {
			if (idleTimer) clearTimeout(idleTimer)
			idleTimer = setTimeout(
				() => idleController.abort('Timed out waiting for the model to respond'),
				IDLE_TIMEOUT_MS
			)
		}
		resetIdleTimer()

		try {
			const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
			const res = await fetch(`${apiBase}/api/chat`, {
				method: 'POST',
				body: JSON.stringify({
					messages,
				}),
				headers: {
					'Content-Type': 'application/json',
					...(byokConfig.apiKey ? {
						'X-API-Key': byokConfig.apiKey,
						'X-Provider': provider,
						'X-Model': modelDef.id,
					} : {}),
				},
				signal: AbortSignal.any([signal, idleController.signal]),
			})

			if (!res.ok) {
				const text = await res.text().catch(() => `HTTP ${res.status}`)
				// Retryability is judged from the status: 408/429/5xx are
				// transient, 4xx (bad key, invalid model...) are not.
				throw new AgentRequestFailedError(`Request failed (${res.status}): ${text}`, {
					httpStatus: res.status,
				})
			}

			if (!res.body) {
				throw Error('No body in response')
			}

			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ''

			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break
					resetIdleTimer()

					buffer += decoder.decode(value, { stream: true })
					const actions = buffer.split('\n\n')
					buffer = actions.pop() || ''

					for (const action of actions) {
						const match = action.match(/^data: (.+)$/m)
						if (!match) continue

						// A malformed event shouldn't kill the whole stream — skip it
						let data: any
						try {
							data = JSON.parse(match[1])
						} catch {
							console.warn('Skipping malformed stream event:', match[1])
							continue
						}

						// If the response contains an error, throw it. Backend error
						// events are provider-level failures that already crossed
						// the relay - a retry would hit the same thing.
						if (data && typeof data === 'object' && 'error' in data) {
							throw new AgentRequestFailedError(String(data.error), { retryable: false })
						}

						// The stream ends with a usage summary rather than an action.
						// Record it and keep reading - it isn't something to apply.
						if (isAgentUsageEvent(data)) {
							this.usage.record(data.usage)
							continue
						}

						yield data as Streaming<AgentAction>
					}
				}
			} finally {
				reader.releaseLock()
			}
		} finally {
			if (idleTimer) clearTimeout(idleTimer)
		}
	}
}
