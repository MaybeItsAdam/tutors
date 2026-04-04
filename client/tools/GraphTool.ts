import { StateNode, createShapeId } from 'tldraw'

export class GraphTool extends StateNode {
	static override id = 'graph'
	static override initial = 'idle'
	static override children() {
		return [GraphIdle]
	}

	override isLockable = false

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
	}

	override onInterrupt() {
		this.parent.transition('select', {})
	}

	override onCancel() {
		this.parent.transition('select', {})
	}
}

class GraphIdle extends StateNode {
	static override id = 'idle'

	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()

		const id = createShapeId()

		this.editor.markHistoryStoppingPoint('creating graph shape')

		this.editor.createShape({
			id,
			type: 'graph' as any,
			x: x - 240,
			y: y - 180,
		})

		this.editor.select(id)
		this.editor.setCurrentTool('select')
	}
}
