import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessibility behavior for a modal dialog: moves focus into the dialog when
 * it opens, restores it to the previously focused element on close, closes on
 * Escape, and wraps Tab focus within the dialog. Attach the returned ref to
 * the dialog element (which should carry role="dialog" and aria-modal).
 */
export function useDialog(isOpen: boolean, onClose: () => void) {
	const dialogRef = useRef<HTMLDivElement>(null)
	const onCloseRef = useRef(onClose)

	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	useEffect(() => {
		if (!isOpen) return
		const dialog = dialogRef.current
		if (!dialog) return

		const previouslyFocused = document.activeElement as HTMLElement | null
		const getFocusable = () =>
			Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

		if (!dialog.contains(document.activeElement)) {
			const first = getFocusable()[0]
			if (first) first.focus()
			else dialog.focus()
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation()
				onCloseRef.current()
				return
			}
			if (e.key !== 'Tab') return
			const focusable = getFocusable()
			if (focusable.length === 0) return
			const first = focusable[0]
			const last = focusable[focusable.length - 1]
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault()
				last.focus()
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault()
				first.focus()
			}
		}

		dialog.addEventListener('keydown', handleKeyDown)
		return () => {
			dialog.removeEventListener('keydown', handleKeyDown)
			previouslyFocused?.focus()
		}
	}, [isOpen])

	return dialogRef
}
