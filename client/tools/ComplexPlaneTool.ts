import { StateNode, createShapeId } from 'tldraw'

export class ComplexPlaneTool extends StateNode {
	static override id = 'complexplane'
	static override initial = 'idle'
	static override children() {
		return [ComplexPlaneIdle]
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

class ComplexPlaneIdle extends StateNode {
	static override id = 'idle'

	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()
		this.editor.markHistoryStoppingPoint('creating complex plane shape')
		const id = createShapeId()
		this.editor.createShape({
			id,
			type: 'complexplane' as any,
			x: x - 210,
			y: y - 180,
		})
		this.editor.select(id)
		this.editor.setCurrentTool('select')
	}
}
