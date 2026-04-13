import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { AIProvider, useBYOKConfig } from '../../utils/BYOKStore'

const PROVIDER_OPTIONS: Array<{ value: AIProvider; label: string }> = [
	{ value: 'anthropic', label: 'Anthropic' },
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'google', label: 'Google (google)' },
	{ value: 'gemini', label: 'Google Gemini (gemini)' },
]

export function BYOKSettings() {
	const [isOpen, setIsOpen] = useState(false)
	const { config, updateConfig } = useBYOKConfig()

	// local state for forms
	const [provider, setProvider] = useState<AIProvider>(config.provider)
	const [apiKey, setApiKey] = useState(config.apiKey)

	const resetDraft = useCallback(() => {
		setProvider(config.provider)
		setApiKey(config.apiKey)
	}, [config.apiKey, config.provider])

	useEffect(() => {
		if (!isOpen) return
		resetDraft()
	}, [isOpen, resetDraft])

	const openModal = useCallback((e: MouseEvent<HTMLButtonElement>) => {
		e.stopPropagation()
		resetDraft()
		setIsOpen(true)
	}, [resetDraft])

	const handleSave = () => {
		updateConfig({ ...config, provider, apiKey })
		setIsOpen(false)
	}

	return (
		<>
			<button
				type="button"
				className="byok-settings-btn"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={openModal}
				style={{
					background: 'transparent',
					border: 'none',
					color: 'var(--color-text)',
					cursor: 'pointer',
					fontSize: 18,
					padding: '4px 8px',
				}}
				title="API Settings"
			>
				⚙️
			</button>

			{isOpen && (
				<div
					className="byok-modal-overlay"
					style={{
						position: 'fixed',
						inset: 0,
						backgroundColor: 'rgba(0,0,0,0.5)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						zIndex: 999999,
					}}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => setIsOpen(false)}
				>
					<div
						className="byok-modal-content"
						style={{
							backgroundColor: 'var(--color-panel)',
							padding: 24,
							borderRadius: 8,
							width: 400,
							display: 'flex',
							flexDirection: 'column',
							gap: 16,
							color: 'var(--color-text)',
							boxShadow: 'var(--shadow-4)',
						}}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={(e) => e.stopPropagation()}
					>
						<h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>BYOK Settings</h2>
						<p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
							Configure your own API key to bypass the proxy. Keys are stored locally in your browser.
						</p>

						<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<label style={{ fontSize: 12, fontWeight: 600 }}>Provider</label>
							<select
								value={provider}
								onChange={(e) => setProvider(e.target.value as AIProvider)}
								style={{ padding: 8, borderRadius: 4, background: 'var(--color-bg)' }}
							>
								{PROVIDER_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<span style={{ fontSize: 11, opacity: 0.75 }}>
								Saved provider: <strong>{config.provider}</strong>
							</span>
						</div>

						<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<label style={{ fontSize: 12, fontWeight: 600 }}>API Key</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								style={{ padding: 8, borderRadius: 4, background: 'var(--color-bg)' }}
								placeholder="Enter API Key"
							/>
						</div>

						<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
							<button
								type="button"
								onClick={() => setIsOpen(false)}
								style={{ padding: '8px 16px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--color-border)' }}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSave}
								style={{ padding: '8px 16px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-primary)', color: 'white', border: 'none' }}
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	)
}
