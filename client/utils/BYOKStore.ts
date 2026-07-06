import { useState, useEffect } from 'react'

export type AIProvider = 'openai' | 'anthropic' | 'google'

export interface BYOKConfig {
	/** Which provider the saved key belongs to (label only — the request
	 * provider is derived from the selected model). */
	provider: AIProvider
	apiKey: string
	/** Whether to persist the key across browser sessions (localStorage)
	 * or keep it for this session only (sessionStorage). */
	remember: boolean
}

const STORAGE_KEY = 'tutor-whiteboard-byok'

export const DEFAULT_CONFIG: BYOKConfig = {
	provider: 'anthropic',
	apiKey: '',
	remember: true,
}

function parseStored(stored: string | null, remember: boolean): BYOKConfig | null {
	if (!stored) return null
	try {
		const parsed = JSON.parse(stored)
		// 'gemini' was a separate provider option in older saved configs
		const provider = parsed.provider === 'gemini' ? 'google' : parsed.provider
		return {
			provider: provider || DEFAULT_CONFIG.provider,
			apiKey: parsed.apiKey || '',
			remember,
		}
	} catch (e) {
		console.error('Failed to parse BYOK config from storage', e)
		return null
	}
}

export class BYOKStore {
	static getConfig(): BYOKConfig {
		const sessionConfig = parseStored(sessionStorage.getItem(STORAGE_KEY), false)
		if (sessionConfig) return sessionConfig
		const localConfig = parseStored(localStorage.getItem(STORAGE_KEY), true)
		if (localConfig) return localConfig
		return { ...DEFAULT_CONFIG }
	}

	static saveConfig(config: BYOKConfig) {
		const { remember, ...stored } = config
		const target = remember ? localStorage : sessionStorage
		const other = remember ? sessionStorage : localStorage
		target.setItem(STORAGE_KEY, JSON.stringify(stored))
		other.removeItem(STORAGE_KEY)
		window.dispatchEvent(new Event('byok-config-changed'))
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
