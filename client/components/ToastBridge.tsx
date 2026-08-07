import { useEffect } from 'react'
import { useToasts } from 'tldraw'

type ToastInput = Parameters<ReturnType<typeof useToasts>['addToast']>[0]

let addToastFn: ((toast: ToastInput) => void) | null = null

/**
 * Show a toast from outside the React tree (module-level handlers like the
 * PDF drop/upload paths, which run in editor callbacks where useToasts isn't
 * reachable). No-ops if the bridge isn't mounted.
 */
export function showAppToast(toast: ToastInput) {
	addToastFn?.(toast)
}

/**
 * Mount once inside <Tldraw> to expose its toast system to module-level code.
 */
export function ToastBridge() {
	const toasts = useToasts()
	useEffect(() => {
		addToastFn = (toast) => toasts.addToast(toast)
		return () => {
			addToastFn = null
		}
	}, [toasts])
	return null
}
