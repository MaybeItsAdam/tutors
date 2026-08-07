import { Editor } from 'tldraw'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { BasePromptPart } from '../../shared/types/BasePromptPart'
import { PromptPart } from '../../shared/types/PromptPart'
import { TldrawAgent } from '../agent/TldrawAgent'
import { AgentHelpers } from '../AgentHelpers'

// ============================================================================
// Registry
// ============================================================================

const registry = new Map<string, PromptPartUtilConstructor<BasePromptPart>>()

/**
 * Register a prompt part util class. Call this after defining each util class.
 */
export function registerPromptPartUtil<T extends PromptPartUtilConstructor<BasePromptPart>>(
	util: T
): T {
	if (registry.has(util.type)) {
		throw new Error(`Prompt part util already registered: ${util.type}`)
	}
	registry.set(util.type, util)
	return util
}

/**
 * Get all registered prompt part util classes.
 */
export function getAllPromptPartUtils(): PromptPartUtilConstructor<PromptPart>[] {
	return Array.from(registry.values()) as PromptPartUtilConstructor<PromptPart>[]
}

/**
 * Check whether a prompt part util is registered for a given part type.
 */
export function hasRegisteredPromptPartUtil(type: string): boolean {
	return registry.has(type)
}

/**
 * Get an object containing instantiated prompt part utils for an agent.
 */
export function getPromptPartUtilsRecord(agent: TldrawAgent) {
	const object = {} as Record<PromptPart['type'], PromptPartUtil<PromptPart>>
	for (const util of registry.values()) {
		object[util.type as PromptPart['type']] = new util(agent) as PromptPartUtil<PromptPart>
	}
	return object
}

// ============================================================================
// Base Class
// ============================================================================

export abstract class PromptPartUtil<T extends BasePromptPart = BasePromptPart> {
	static type: string

	agent: TldrawAgent
	editor: Editor

	constructor(agent: TldrawAgent) {
		this.agent = agent
		this.editor = agent?.editor
	}

	/**
	 * Get some data to add to the prompt.
	 *
	 * Must be read-only: getPart runs at prompt-build time, BEFORE the request
	 * has succeeded. Any state consumption (clearing histories, marking things
	 * as surfaced) belongs in commitPart, or a failed/cancelled/retried
	 * request permanently loses that state.
	 *
	 * @returns The prompt part.
	 */
	abstract getPart(request: AgentRequest, helpers: AgentHelpers): Promise<T> | T

	/**
	 * Commit any state consumption for a part. Called exactly once per
	 * SUCCESSFUL request, with the part that getPart produced. Retries re-run
	 * getPart, so implementations should commit based on what the part
	 * actually carried.
	 */
	commitPart?(part: T, request: AgentRequest): void
}

export interface PromptPartUtilConstructor<T extends BasePromptPart = BasePromptPart> {
	new (agent: TldrawAgent): PromptPartUtil<T>
	type: T['type']
}
