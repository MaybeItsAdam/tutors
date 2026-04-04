import { useState } from 'react'
import { AIProvider, BYOKConfig, useBYOKConfig } from '../../utils/BYOKStore'

export function BYOKSettings() {
	const [isOpen, setIsOpen] = useState(false)
	const { config, updateConfig } = useBYOKConfig()

	// local state for forms
	const [provider, setProvider] = useState<AIProvider>(config.provider)
	const [apiKey, setApiKey] = useState(config.apiKey)
	const [model, setModel] = useState(config.model)

	const handleSave = () => {
		updateConfig({ provider, apiKey, model })
		setIsOpen(false)
	}

	return (
		<>
			<button
				className="byok-settings-btn"
				onClick={() => setIsOpen(true)}
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
								<option value="anthropic">Anthropic</option>
								<option value="openai">OpenAI</option>
								<option value="gemini">Google Gemini</option>
							</select>
						</div>

						<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<label style={{ fontSize: 12, fontWeight: 600 }}>Model Name</label>
							<input
								type="text"
								value={model}
								onChange={(e) => setModel(e.target.value)}
								style={{ padding: 8, borderRadius: 4, background: 'var(--color-bg)' }}
								placeholder="e.g. claude-3-7-sonnet-20250219"
							/>
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
								onClick={() => setIsOpen(false)}
								style={{ padding: '8px 16px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--color-border)' }}
							>
								Cancel
							</button>
							<button
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
