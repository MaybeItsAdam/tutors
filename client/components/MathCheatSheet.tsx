import { useState } from 'react'
import { useEditor } from 'tldraw'

interface MathCheatSheetProps {
	onClose: () => void
}

const SHORTCUTS = [
	{ keys: ['m'], desc: 'Activate Math tool — click to place an equation' },
	{ keys: ['g'], desc: 'Activate Graph tool — click to place a function graph' },
	{ keys: ['?'], desc: 'Show / hide this cheat sheet' },
	{ keys: ['Esc'], desc: 'Exit edit mode / cancel current tool' },
	{ keys: ['Double-click'], desc: 'Re-enter edit mode on a Math or Graph shape' },
]

const MATHLIVE_SHORTCUTS = [
	{ keys: ['['], desc: 'Insert a matrix (bmatrix)' },
	{ keys: ['/'], desc: 'Insert a fraction' },
	{ keys: ['^'], desc: 'Superscript (exponent)' },
	{ keys: ['_'], desc: 'Subscript' },
	{ keys: ['\\sqrt', 'Space'], desc: 'Square root' },
	{ keys: ['\\sum', 'Space'], desc: 'Summation Σ' },
	{ keys: ['\\int', 'Space'], desc: 'Integral ∫' },
	{ keys: ['\\pi', 'Space'], desc: 'Pi symbol π' },
	{ keys: ['\\infty', 'Space'], desc: 'Infinity ∞' },
	{ keys: ['\\alpha…', 'Space'], desc: 'Greek letters (alpha, beta, theta…)' },
	{ keys: ['Tab'], desc: 'Navigate between placeholders in a matrix' },
	{ keys: ['Enter'], desc: 'New row in matrix' },
	{ keys: ['Shift+Enter', 'Esc'], desc: 'Exit math field and commit' },
]

export function MathCheatSheet({ onClose }: MathCheatSheetProps) {
	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 99999,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: 'rgba(0,0,0,0.5)',
				backdropFilter: 'blur(4px)',
			}}
			onClick={onClose}
		>
			<div
				style={{
					backgroundColor: 'rgba(22, 25, 31, 0.95)',
					border: '1px solid rgba(255,255,255,0.12)',
					borderRadius: 16,
					padding: '28px 32px',
					maxWidth: 620,
					width: '90vw',
					maxHeight: '80vh',
					overflowY: 'auto',
					boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
					color: '#e2e8f0',
					fontFamily: "'Inter', sans-serif",
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
					<h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>
						✦ Math Keyboard Shortcuts
					</h2>
					<button
						onClick={onClose}
						style={{
							background: 'transparent',
							border: 'none',
							color: '#94a3b8',
							cursor: 'pointer',
							fontSize: 20,
							lineHeight: 1,
							padding: '2px 6px',
						}}
					>
						✕
					</button>
				</div>

				<Section title="Canvas Tools">
					{SHORTCUTS.map((s) => <ShortcutRow key={s.desc} keys={s.keys} desc={s.desc} />)}
				</Section>

				<Section title="Inside the Math Field (MathLive)">
					{MATHLIVE_SHORTCUTS.map((s) => <ShortcutRow key={s.desc} keys={s.keys} desc={s.desc} />)}
				</Section>

				<p style={{ margin: '20px 0 0', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
					Press <Kbd>h</Kbd> or <Kbd>?</Kbd> at any time to toggle this panel
				</p>
			</div>
		</div>
	)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div style={{ marginBottom: 20 }}>
			<p style={{
				margin: '0 0 10px',
				fontSize: 11,
				fontWeight: 600,
				textTransform: 'uppercase',
				letterSpacing: '0.08em',
				color: '#60a5fa',
			}}>
				{title}
			</p>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				{children}
			</div>
		</div>
	)
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
			<div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
				{keys.map((k, i) => (
					<span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
						<Kbd>{k}</Kbd>
						{i < keys.length - 1 && <span style={{ color: '#64748b', fontSize: 11 }}>or</span>}
					</span>
				))}
			</div>
			<span style={{ color: '#94a3b8' }}>{desc}</span>
		</div>
	)
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd style={{
			backgroundColor: 'rgba(255,255,255,0.08)',
			border: '1px solid rgba(255,255,255,0.15)',
			borderRadius: 5,
			padding: '2px 7px',
			fontSize: 11,
			fontFamily: 'monospace',
			color: '#e2e8f0',
			whiteSpace: 'nowrap',
		}}>
			{children}
		</kbd>
	)
}
