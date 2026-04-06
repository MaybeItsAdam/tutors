import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google'
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai'
import { LanguageModel, ModelMessage, streamText } from 'ai'
import { AgentModelName, getAgentModelDefinition, isValidModelName } from '../shared/models'
import { DebugPart } from '../shared/schema/PromptPartDefinitions'
import { buildToolDefinitions } from '../shared/schema/buildToolDefinitions'
import { AgentAction } from '../shared/types/AgentAction'
import { AgentPrompt } from '../shared/types/AgentPrompt'
import { Streaming } from '../shared/types/Streaming'
import { buildMessages } from './prompt/buildMessages'
import { buildSystemPrompt } from './prompt/buildSystemPrompt'
import { getModelName } from './prompt/getModelName'

export interface ServerEnvironment {
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
}

export class AgentService {
	openai: OpenAIProvider
	anthropic: AnthropicProvider
	google: GoogleGenerativeAIProvider

	constructor(env: ServerEnvironment) {
		this.openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
		this.anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
		this.google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
	}

	getModel(modelName: AgentModelName): LanguageModel {
		const modelDefinition = getAgentModelDefinition(modelName)
		const provider = modelDefinition.provider
		return this[provider](modelDefinition.id)
	}

	async *stream(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		try {
			for await (const event of this.streamActions(prompt)) {
				yield event
			}
		} catch (error: any) {
			console.error('Stream error:', error)
			throw error
		}
	}

	private async *streamActions(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		const modelName = getModelName(prompt)
		const model = this.getModel(modelName)

		if (typeof model === 'string') {
			throw new Error('Model is a string, not a LanguageModel')
		}

		const { modelId, provider } = model
		if (!isValidModelName(modelId)) {
			throw new Error(`Model ${modelId} is not in AGENT_MODEL_DEFINITIONS`)
		}

		const modelDefinition = getAgentModelDefinition(modelId)

		// Build system prompt — schema is omitted because tools provide it
		const systemPrompt = buildSystemPrompt(prompt, { withSchema: false })

		// Build messages with provider-specific options
		const messages: ModelMessage[] = []

		// Add system prompt with Anthropic caching if applicable
		if (provider === 'anthropic.messages') {
			messages.push({
				role: 'system',
				content: systemPrompt,
				providerOptions: {
					anthropic: { cacheControl: { type: 'ephemeral' } },
				},
			})
		} else {
			messages.push({
				role: 'system',
				content: systemPrompt,
			})
		}

		// Add prompt messages
		const promptMessages = buildMessages(prompt)
		messages.push(...promptMessages)

		// Check for debug flags and log if enabled
		const debugPart = prompt.debug as DebugPart | undefined
		if (debugPart) {
			if (debugPart.logSystemPrompt) {
				console.log('[DEBUG] System Prompt:\n', systemPrompt)
			}
			if (debugPart.logMessages) {
				console.log('[DEBUG] Messages:\n', JSON.stringify(promptMessages, null, 2))
			}
		}

		// Build tool definitions from the current mode's action types
		const actionTypes = (prompt.mode as any)?.actionTypes as AgentAction['_type'][] | undefined
		const modeType = (prompt.mode as any)?.modeType as string | undefined
		const tools = actionTypes && modeType ? buildToolDefinitions(actionTypes, modeType) : {}

		// Configure thinking budgets based on model
		const geminiThinkingBudget = modelDefinition.thinking ? 256 : 0
		const openaiReasoningEffort = provider === 'openai.responses' ? 'none' : 'minimal'

		try {
			const result = streamText({
				model,
				messages,
				tools,
				maxSteps: 20,
				maxOutputTokens: 8192,
				temperature: 0,
				providerOptions: {
					anthropic: {
						thinking: { type: 'enabled', budgetTokens: 8000 },
					},
					google: {
						thinkingConfig: { thinkingBudget: geminiThinkingBudget },
					},
					openai: {
						reasoningEffort: openaiReasoningEffort,
					},
				},
				onAbort() {
					console.warn('Stream actions aborted')
				},
				onError: (e) => {
					console.error('Stream text error:', e)
					throw e
				},
			})

			let startTime = Date.now()

			for await (const chunk of result.fullStream) {
				if (chunk.type === 'tool-call') {
					const action = { _type: chunk.toolName, ...chunk.args } as AgentAction
					yield {
						...action,
						complete: true,
						time: Date.now() - startTime,
					}
					startTime = Date.now()
				}
			}
		} catch (error: any) {
			console.error('streamActions error:', error)
			throw error
		}
	}
}
