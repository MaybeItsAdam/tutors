import { StateNode, TLShapeId, createShapeId } from 'tldraw'

export class MathTool extends StateNode {
	static override id = 'math'
	static override initial = 'idle'
	static override children() {
		return [MathIdle]
	}

	override isLockable = false

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
	}

	override onInterrupt() {
		this.complete()
	}

	override onCancel() {
		this.complete()
	}

	private complete() {
		this.parent.transition('select', {})
	}
}

class MathIdle extends StateNode {
	static override id = 'idle'

	override onPointerDown() {
		const currentPagePoint = this.editor.inputs.getCurrentPagePoint()
		
		this.editor.markHistoryStoppingPoint('creating math shape')
		
		const id = createShapeId()
		
		this.editor.createShape({
			id,
			type: 'equation',
			x: currentPagePoint.x,
			y: currentPagePoint.y,
			props: {
				latex: '', // Start empty for typing
			},
		})

		// Select the shape and set it to editing mode immediately
		this.editor.select(id)
		this.editor.setCurrentTool('select')
		this.editor.setEditingShape(id)
	}
}
