import { AnthropicProvider, createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google'
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai'
import { LanguageModel, ModelMessage, streamText } from 'ai'
import { AgentModelName, getAgentModelDefinition, isValidModelName } from '../shared/models'
import { DebugPart } from '../shared/schema/PromptPartDefinitions'
import { AgentAction } from '../shared/types/AgentAction'
import { AgentPrompt } from '../shared/types/AgentPrompt'
import { Streaming } from '../shared/types/Streaming'
import { buildMessages } from './prompt/buildMessages'
import { buildSystemPrompt } from './prompt/buildSystemPrompt'
import { getModelName } from './prompt/getModelName'
import { closeAndParseJson } from './closeAndParseJson'

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
		const systemPrompt = buildSystemPrompt(prompt)

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
				const promptWithoutSchema = buildSystemPrompt(prompt, { withSchema: false })
				console.log('[DEBUG] System Prompt (without schema):\n', promptWithoutSchema)
			}
			if (debugPart.logMessages) {
				console.log('[DEBUG] Messages:\n', JSON.stringify(promptMessages, null, 2))
			}
		}

		// Add the assistant message to indicate the start of the actions
		messages.push({
			role: 'assistant',
			content: '{"actions": [{"_type":',
		})

		// Configure thinking budgets based on model
		const geminiThinkingBudget = modelDefinition.thinking ? 256 : 0
		const openaiReasoningEffort = provider === 'openai.responses' ? 'none' : 'minimal'

		try {
			const { textStream } = streamText({
				model,
				messages,
				maxOutputTokens: 8192,
				temperature: 0,
				providerOptions: {
					anthropic: {
						thinking: { type: 'disabled' },
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

			const canForceResponseStart =
				provider === 'anthropic.messages' || provider === 'google.generative-ai'
			let buffer = canForceResponseStart ? '{"actions": [{"_type":' : ''
			let cursor = 0
			let maybeIncompleteAction: AgentAction | null = null

			let startTime = Date.now()
			for await (const text of textStream) {
				buffer += text

				const partialObject = closeAndParseJson(buffer)
				if (!partialObject) continue

				const actions = partialObject.actions
				if (!Array.isArray(actions)) continue
				if (actions.length === 0) continue

				if (actions.length > cursor) {
					const action = actions[cursor - 1] as AgentAction
					if (action) {
						yield {
							...action,
							complete: true,
							time: Date.now() - startTime,
						}
						maybeIncompleteAction = null
					}
					cursor++
				}

				const action = actions[cursor - 1] as AgentAction
				if (action) {
					if (!maybeIncompleteAction) {
						startTime = Date.now()
					}

					maybeIncompleteAction = action

					yield {
						...action,
						complete: false,
						time: Date.now() - startTime,
					}
				}
			}

			if (maybeIncompleteAction) {
				yield {
					...maybeIncompleteAction,
					complete: true,
					time: Date.now() - startTime,
				}
			}
		} catch (error: any) {
			console.error('streamActions error:', error)
			throw error
		}
	}
}
