import { describe, expect, it } from 'vitest'
import { getAllActionSchemas } from '../types/AgentAction'
import type { AgentActionSchema } from '../types/AgentAction'
import { AlignAction, EquationAction } from './AgentActionSchemas'

const typeOf = (schema: AgentActionSchema): string =>
	(schema as unknown as { shape: { _type: { value: string } } }).shape._type.value

const geoShape = {
	_type: 'rectangle',
	color: 'blue',
	fill: 'none',
	h: 100,
	note: 'a worked example box',
	shapeId: 'box1',
	w: 200,
	x: 0,
	y: 0,
}

/** One known-good payload per exported action schema, keyed by _type. */
const validPayloads: Record<string, object> = {
	'add-detail': { _type: 'add-detail', intent: 'add detail to the diagram' },
	'update-todo-list': { _type: 'update-todo-list', id: 1, status: 'in-progress', text: 'explain step 2' },
	align: { _type: 'align', alignment: 'top', intent: 'line them up', shapeIds: ['a', 'b'] },
	bringToFront: { _type: 'bringToFront', intent: 'raise it', shapeIds: ['a'] },
	clear: { _type: 'clear' },
	count: { _type: 'count', expression: 'rectangles' },
	create: { _type: 'create', intent: 'draw a box', shape: geoShape },
	delete: { _type: 'delete', intent: 'remove the box', shapeId: 'box1' },
	distribute: { _type: 'distribute', direction: 'horizontal', intent: 'space them', shapeIds: ['a', 'b', 'c'] },
	equation: { _type: 'equation', intent: 'show the identity', shapeId: 'eq1', latex: 'e^{i\\pi} = -1', x: 0, y: 0 },
	label: { _type: 'label', intent: 'name the box', shapeId: 'box1', text: 'Step 1' },
	message: { _type: 'message', text: 'Take a look at the graph.' },
	move: { _type: 'move', intent: 'shift it right', anchor: 'top-left', shapeId: 'box1', x: 50, y: 60 },
	pen: {
		_type: 'pen',
		shapeId: 'stroke1',
		color: 'red',
		closed: false,
		fill: 'none',
		intent: 'underline the answer',
		points: [
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
		],
		style: 'straight',
	},
	place: {
		_type: 'place',
		align: 'start',
		alignOffset: 0,
		intent: 'put the label above the box',
		referenceShapeId: 'box1',
		side: 'top',
		sideOffset: 8,
		shapeId: 'label1',
	},
	plot: { _type: 'plot', intent: 'plot a sine wave', plotType: 'graph', expression: 'sin(x)', x: 100, y: 50 },
	resize: { _type: 'resize', intent: 'double it', originX: 0, originY: 0, scaleX: 2, scaleY: 2, shapeIds: ['a'] },
	review: { _type: 'review', intent: 'check the working', x: 0, y: 0, w: 800, h: 600 },
	rotate: { _type: 'rotate', degrees: 90, intent: 'turn it', originX: 0, originY: 0, shapeIds: ['a'] },
	sendToBack: { _type: 'sendToBack', intent: 'tuck it behind', shapeIds: ['a'] },
	setMyView: { _type: 'setMyView', intent: 'look at the corner', x: 0, y: 0, w: 800, h: 600 },
	stack: { _type: 'stack', direction: 'vertical', gap: 16, intent: 'stack the steps', shapeIds: ['a', 'b'] },
	think: { _type: 'think', text: 'The student needs a hint.' },
	unknown: { _type: 'unknown' },
	update: { _type: 'update', intent: 'recolour the box', update: { ...geoShape, color: 'green' } },
}

describe('exported action schemas', () => {
	const schemas = getAllActionSchemas()

	it('exports at least one schema and has a fixture for each', () => {
		expect(schemas.length).toBeGreaterThan(0)
		for (const schema of schemas) {
			expect(validPayloads, `missing fixture for "${typeOf(schema)}"`).toHaveProperty(
				typeOf(schema)
			)
		}
	})

	for (const schema of getAllActionSchemas()) {
		const type = typeOf(schema)
		it(`accepts a known-good "${type}" payload`, () => {
			const result = schema.safeParse(validPayloads[type])
			expect(result.success, result.error?.message).toBe(true)
		})
	}
})

describe('malformed payloads', () => {
	it('rejects an equation without latex', () => {
		const { latex: _latex, ...payload } = validPayloads.equation as Record<string, unknown>
		expect(EquationAction.safeParse(payload).success).toBe(false)
	})

	it('rejects an equation without shapeId', () => {
		// shapeId is a required field on EquationAction (added so later actions
		// can refer back to the created shape)
		const { shapeId: _shapeId, ...payload } = validPayloads.equation as Record<string, unknown>
		expect(EquationAction.safeParse(payload).success).toBe(false)
	})

	it('rejects a payload whose _type does not match the schema', () => {
		expect(EquationAction.safeParse({ ...validPayloads.equation, _type: 'plot' }).success).toBe(
			false
		)
	})

	it('strips unknown keys instead of failing', () => {
		const parsed = AlignAction.parse({ ...validPayloads.align, gap: 12 })
		expect(parsed).not.toHaveProperty('gap')
	})
})
