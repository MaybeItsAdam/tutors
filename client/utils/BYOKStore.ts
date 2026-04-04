import { useState, useEffect } from 'react'

export type AIProvider = 'openai' | 'anthropic' | 'gemini'

export interface BYOKConfig {
	provider: AIProvider
	apiKey: string
	model: string
}

const STORAGE_KEY = 'tutor-whiteboard-byok'

export const DEFAULT_CONFIG: BYOKConfig = {
	provider: 'anthropic',
	apiKey: '',
	model: 'claude-3-7-sonnet-20250219',
}

export class BYOKStore {
	static getConfig(): BYOKConfig {
		try {
			const stored = localStorage.getItem(STORAGE_KEY)
			if (stored) {
				const parsed = JSON.parse(stored)
				// Ensure all required fields exist
				return {
					provider: parsed.provider || DEFAULT_CONFIG.provider,
					apiKey: parsed.apiKey || '',
					model: parsed.model || DEFAULT_CONFIG.model,
				}
			}
		} catch (e) {
			console.error('Failed to parse BYOK config from local storage', e)
		}
		return { ...DEFAULT_CONFIG }
	}

	static saveConfig(config: BYOKConfig) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
		window.dispatchEvent(new Event('byok-config-changed'))
	}

	static getHeaders(): Record<string, string> {
		const config = this.getConfig()
		if (!config.apiKey) return {}
		return {
			'X-API-Key': config.apiKey,
			'X-Provider': config.provider,
			'X-Model': config.model,
		}
	}
}

/**
 * React hook to access BYOK keys reactively.
 */
export function useBYOKConfig() {
	const [config, setConfig] = useState<BYOKConfig>(BYOKStore.getConfig())

	useEffect(() => {
		const listener = () => {
			setConfig(BYOKStore.getConfig())
		}
		window.addEventListener('byok-config-changed', listener)
		return () => window.removeEventListener('byok-config-changed', listener)
	}, [])

	return {
		config,
		updateConfig: BYOKStore.saveConfig,
	}
}
