import { StateNode, TLShapeId, createShapeId } from 'tldraw'

export class MathTool extends StateNode {
	static override id = 'math'
	static override initial = 'idle'
	static override children() {
		return [MathIdle]
	}

	override isLockable = true

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
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

		// Select the shape, enter editing mode, then return to select tool
		// so the toolbar correctly reflects "select" while the user edits.
		this.editor.select(id)
		this.editor.setEditingShape(id)
		this.editor.setCurrentTool('select')
	}
}
