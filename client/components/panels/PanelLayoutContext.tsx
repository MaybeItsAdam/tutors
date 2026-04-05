import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

export type DockSide = 'left' | 'right'

interface DockSlot {
	width: number
	visible: boolean
	side: DockSide
}

interface DockState {
	slots: Record<string, DockSlot>
}

// ── Store (external, minimal) ──────────────────────────────────────────────────

function createDockStore() {
	let state: DockState = { slots: {} }
	const listeners = new Set<() => void>()

	function emit() {
		for (const l of listeners) l()
	}

	return {
		getState: () => state,
		subscribe: (l: () => void) => {
			listeners.add(l)
			return () => listeners.delete(l)
		},
		set(id: string, slot: DockSlot) {
			const prev = state.slots[id]
			if (prev && prev.width === slot.width && prev.visible === slot.visible && prev.side === slot.side) return
			state = { ...state, slots: { ...state.slots, [id]: slot } }
			emit()
		},
		remove(id: string) {
			if (!state.slots[id]) return
			const { [id]: _, ...rest } = state.slots
			state = { ...state, slots: rest }
			emit()
		},
	}
}

type DockStore = ReturnType<typeof createDockStore>

// ── Context ────────────────────────────────────────────────────────────────────

const DockCtx = createContext<DockStore | null>(null)

/** Also provides a portal target div for panels to render into from inside tldraw. */
const PortalTargetCtx = createContext<HTMLDivElement | null>(null)

export function PanelLayoutProvider({ children }: { children: ReactNode }) {
	const storeRef = useRef<DockStore | null>(null)
	if (!storeRef.current) storeRef.current = createDockStore()
	const [portalTarget] = useState<HTMLDivElement>(() => {
		const el = document.createElement('div')
		el.style.position = 'fixed'
		el.style.inset = '0'
		el.style.pointerEvents = 'none'
		el.style.zIndex = '500'
		el.id = 'panel-portal-target'
		document.body.appendChild(el)
		return el
	})

	return (
		<DockCtx.Provider value={storeRef.current}>
			<PortalTargetCtx.Provider value={portalTarget}>{children}</PortalTargetCtx.Provider>
		</DockCtx.Provider>
	)
}

export function useDockStore() {
	const store = useContext(DockCtx)
	if (!store) throw new Error('useDockStore requires PanelLayoutProvider')
	return store
}

export function useDockState() {
	const store = useDockStore()
	return useSyncExternalStore(store.subscribe, store.getState)
}

/** Get the portal target for rendering panels outside tldraw's DOM. */
export function usePortalTarget() {
	return useContext(PortalTargetCtx)
}

// ── Hook: useBottomPanel ───────────────────────────────────────────────────────

const EDGE_GAP = 16
const PANEL_GAP = 8
const BOTTOM = 16

export interface BottomPanelOptions {
	id: string
	width: number
	defaultSide: DockSide
}

/**
 * Registers a bottom-docked panel and returns its horizontal position.
 * Panels on the same side stack inward (rightmost panel hugs the edge,
 * next one tucks to its left, etc.)
 */
export function useBottomPanel({ id, width, defaultSide }: BottomPanelOptions) {
	const store = useDockStore()
	const state = useSyncExternalStore(store.subscribe, store.getState)
	const sideRef = useRef(defaultSide)
	const [side, setSideState] = useState(defaultSide)

	// Register / update slot
	const setVisible = useCallback(
		(visible: boolean) => {
			store.set(id, { width, visible, side: sideRef.current })
		},
		[store, id, width]
	)

	// Ensure registered on first render
	const didRegister = useRef(false)
	if (!didRegister.current) {
		store.set(id, { width, visible: true, side: defaultSide })
		didRegister.current = true
	}

	const setSide = useCallback(
		(s: DockSide) => {
			sideRef.current = s
			setSideState(s)
			const slot = state.slots[id]
			store.set(id, { width: slot?.width ?? width, visible: slot?.visible ?? true, side: s })
		},
		[store, id, width, state.slots]
	)

	// Compute left position: stack panels on same side, edge-most first
	const left = computeLeft(id, side, width, state)

	// ── Drag ──
	const dragRef = useRef<{ startX: number; startLeft: number } | null>(null)
	const [dragOffset, setDragOffset] = useState<number | null>(null)

	const onDragStart = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault()
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)
			dragRef.current = { startX: e.clientX, startLeft: left }
			setDragOffset(0)

			const onMove = (ev: PointerEvent) => {
				if (!dragRef.current) return
				setDragOffset(ev.clientX - dragRef.current.startX)
			}

			const onUp = (ev: PointerEvent) => {
				if (!dragRef.current) return
				const finalLeft = dragRef.current.startLeft + (ev.clientX - dragRef.current.startX)
				const center = finalLeft + width / 2
				const newSide: DockSide = center < window.innerWidth / 2 ? 'left' : 'right'

				// If we moved to the other panel's side, push it away
				for (const [otherId, otherSlot] of Object.entries(state.slots)) {
					if (otherId === id || !otherSlot.visible) continue
					if (otherSlot.side === newSide) {
						const oppositeSide: DockSide = newSide === 'left' ? 'right' : 'left'
						store.set(otherId, { ...otherSlot, side: oppositeSide })
					}
				}

				setSide(newSide)
				dragRef.current = null
				setDragOffset(null)
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
			}

			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
		},
		[left, width, id, state.slots, store, setSide]
	)

	const isDragging = dragOffset !== null
	const displayLeft = isDragging ? left + dragOffset! : left

	const style: React.CSSProperties = {
		position: 'fixed',
		bottom: BOTTOM,
		left: displayLeft,
		width,
		zIndex: isDragging ? 501 : 500,
		transition: isDragging ? 'none' : 'left 0.25s ease',
		pointerEvents: 'all',
	}

	return { style, onDragStart, side, setVisible, isDragging }
}

function computeLeft(
	id: string,
	side: DockSide,
	width: number,
	state: DockState
): number {
	const vw = typeof window !== 'undefined' ? window.innerWidth : 1200

	// Collect visible siblings on the same side, sorted by width (largest = edge)
	const siblings = Object.entries(state.slots)
		.filter(([k, s]) => k !== id && s.visible && s.side === side)
		.map(([, s]) => s)

	const siblingWidth = siblings.reduce((sum, s) => sum + s.width + PANEL_GAP, 0)

	if (side === 'right') {
		return vw - EDGE_GAP - width - siblingWidth
	} else {
		return EDGE_GAP + siblingWidth
	}
}
