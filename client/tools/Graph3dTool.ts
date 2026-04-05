import { StateNode, createShapeId } from 'tldraw'

export class Graph3dTool extends StateNode {
	static override id = 'graph3d'
	static override initial = 'idle'
	static override children() {
		return [Graph3dIdle]
	}

	override isLockable = false

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
	}

	override onCancel() {
		this.parent.transition('select', {})
	}
}

class Graph3dIdle extends StateNode {
	static override id = 'idle'

	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()

		this.editor.markHistoryStoppingPoint('creating 3d graph shape')

		const id = createShapeId()
		this.editor.createShape({
			id,
			type: 'graph3d' as any,
			x: x - 210,
			y: y - 160,
		})

		this.editor.select(id)
		this.editor.setCurrentTool('select')
	}
}
