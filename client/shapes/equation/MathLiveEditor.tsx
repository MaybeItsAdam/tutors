import 'mathlive'
import { useEffect, useRef } from 'react'
import { IEquationShape } from './EquationShape'

// ── MathLive editor ────────────────────────────────────────────────────────────
export default function MathLiveEditor({ shape, editor }: { shape: IEquationShape; editor: any }) {
	const mfRef = useRef<any>(null)

	useEffect(() => {
		if (!mfRef.current) return

		const mf = mfRef.current

		// Initialise with the shape's current LaTeX
		mf.value = shape.props.latex

		// One undo step per editing session, not one per keystroke: mark when
		// editing starts, squash everything since the mark when it ends.
		const editMark = editor.markHistoryStoppingPoint('equation-edit')

		// Auto-focus after mount
		const focusTimer = setTimeout(() => mf.focus(), 10)

		// ── Sync LaTeX + auto-resize height on every input ──
		const handleInput = (ev: Event) => {
			const latex = (ev.target as any).value
			const naturalH = Math.max(60, mf.offsetHeight)
			editor.updateShape({
				id: shape.id,
				type: 'equation',
				props: { latex, h: naturalH },
			})
		}

		// ── Keyboard handling ──
		const handleKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.shiftKey)) {
				ev.preventDefault()
				ev.stopPropagation()
				editor.setEditingShape(null)
				return
			}
			if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
				ev.preventDefault()
				ev.stopPropagation()
				mf.executeCommand('addRowAfter')
			}
		}

		// ── Auto-resize: watch the field's rendered height ──
		const ro = new ResizeObserver(() => {
			const naturalH = Math.max(60, mf.offsetHeight)
			// Read the height from the editor rather than the captured `shape`.
			// This effect deliberately doesn't re-run on prop changes (see the
			// dependency list below), so the captured height goes stale after
			// the first resize and the threshold check stops filtering anything.
			const currentH = editor.getShape(shape.id)?.props.h ?? shape.props.h
			if (Math.abs(naturalH - currentH) > 4) {
				editor.updateShape({
					id: shape.id,
					type: 'equation',
					props: { h: naturalH },
				})
			}
		})
		ro.observe(mf)

		mf.addEventListener('input', handleInput)
		mf.addEventListener('keydown', handleKeyDown)

		return () => {
			clearTimeout(focusTimer)
			mf.removeEventListener('input', handleInput)
			mf.removeEventListener('keydown', handleKeyDown)
			ro.disconnect()
			editor.squashToMark(editMark)
			if (window.mathVirtualKeyboard) {
				window.mathVirtualKeyboard.hide()
			}
		}
	}, [editor, shape.id]) // Not tracking shape.props.latex to avoid cursor-jumping

	return (
		// @ts-expect-error math-field is a custom web component
		<math-field
			ref={mfRef}
			math-virtual-keyboard-policy="manual"
			style={{
				width: `${shape.props.w}px`,
				minHeight: '60px',
				fontSize: `${shape.props.fontSize}px`,
				backgroundColor: 'var(--tl-color-panel)',
				color: 'var(--color-text)',
				border: '1.5px solid var(--color-primary)',
				borderRadius: '8px',
				outline: 'none',
				padding: '10px 14px',
				boxSizing: 'border-box',
				display: 'block',
			}}
		/>
	)
}
