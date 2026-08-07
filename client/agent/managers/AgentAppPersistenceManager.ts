import { PersistedAgentState } from '../TldrawAgent'
import { BaseAgentAppManager } from './BaseAgentAppManager'

/**
 * The localStorage key used by the legacy persistence path (see below).
 */
const LEGACY_STORAGE_KEY = 'tldraw-agent-app:state'

/**
 * The persisted state for the entire app.
 * Contains state for all agents.
 */
export interface PersistedAppState {
	agents: Record<string, PersistedAgentState>
}

/**
 * Manager for app-level agent state (de)serialization.
 *
 * Persistence itself is owned by WorkspaceManager: agent state rides inside
 * the workspace working-state that its dirty-flag timer writes to IndexedDB,
 * and boot restores it via `loadAppState` from there.
 *
 * This class used to ALSO write the whole serialized app state to
 * localStorage reactively - which fired on every streaming delta (chat
 * history updates per chunk), JSON-stringifying multi-megabyte diffs on the
 * main thread, and silently stopping at the ~5MB quota. Nothing ever read
 * that state back, so the path was deleted; `consumeLegacyLocalStorageState`
 * migrates anything a pre-IndexedDB session left behind.
 */
export class AgentAppPersistenceManager extends BaseAgentAppManager {
	/**
	 * Whether we're currently loading state to prevent premature saves.
	 */
	private isLoadingState = false

	/**
	 * Check if state is currently being loaded.
	 */
	getIsLoadingState(): boolean {
		return this.isLoadingState
	}

	/**
	 * Serialize the current app state for persistence.
	 */
	serializeState(): PersistedAppState {
		const agents = this.app.agents.getAgents()

		return {
			agents: agents.reduce(
				(acc, agent) => {
					acc[agent.id] = agent.serializeState()
					return acc
				},
				{} as Record<string, PersistedAgentState>
			),
		}
	}

	/**
	 * Load a provided app state directly.
	 * Creates agents for all state IDs that don't already exist.
	 */
	loadAppState(appState: PersistedAppState) {
		this.isLoadingState = true
		try {
			const targetAgentIds = new Set(Object.keys(appState.agents))
			for (const existingAgent of this.app.agents.getAgents()) {
				if (!targetAgentIds.has(existingAgent.id)) {
					this.app.agents.deleteAgent(existingAgent.id)
				}
			}
			for (const agentId of Object.keys(appState.agents)) {
				this.app.agents.createAgent(agentId)
			}
			const agents = this.app.agents.getAgents()
			agents.forEach((agent) => {
				const agentState = appState.agents[agent.id]
				if (agentState) {
					agent.loadState(agentState)
				}
			})
		} finally {
			this.isLoadingState = false
		}
	}

	/**
	 * Read (and delete) app state left in localStorage by the legacy
	 * persistence path. Returns null when there is nothing usable.
	 *
	 * Call once at boot: when IndexedDB has no workspace state, the returned
	 * state is the pre-IndexedDB session to restore; either way the key is
	 * removed so the dead path can't linger.
	 */
	consumeLegacyLocalStorageState(): PersistedAppState | null {
		const localStorage = globalThis.localStorage
		if (!localStorage) return null

		try {
			const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
			if (!stored) return null
			const parsed = JSON.parse(stored) as PersistedAppState
			localStorage.removeItem(LEGACY_STORAGE_KEY)
			if (parsed && typeof parsed === 'object' && parsed.agents) {
				return parsed
			}
		} catch {
			localStorage.removeItem(LEGACY_STORAGE_KEY)
		}
		return null
	}

	/**
	 * Reset the manager to its initial state.
	 */
	reset() {
		this.isLoadingState = false
	}
}
