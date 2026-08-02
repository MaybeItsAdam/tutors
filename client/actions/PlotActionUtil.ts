import { createShapeId, TLShapePartial } from 'tldraw'
import { PlotAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { IComplexPlaneShape } from '../shapes/complexplane/ComplexPlaneShape'
import { IGraph3dShape } from '../shapes/graph3d/Graph3dShape'
import { IGraphShape } from '../shapes/graph/GraphShape'
import { IVectorFieldShape } from '../shapes/vectorfield/VectorFieldShape'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

type PlotType = PlotAction['plotType']

/**
 * Per-plot-type canvas size and default axis window.
 *
 * These mirror each shape util's `getDefaultProps`, so a plot the agent makes
 * is indistinguishable from one the user drops with the toolbar.
 */
const PLOT_DEFAULTS: Record<
	PlotType,
	{ w: number; h: number; xMin: number; xMax: number; yMin: number; yMax: number }
> = {
	graph: { w: 480, h: 360, xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -2, yMax: 2 },
	surface: { w: 420, h: 320, xMin: -6, xMax: 6, yMin: -6, yMax: 6 },
	vectorfield: { w: 420, h: 360, xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
	complexplane: { w: 420, h: 360, xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
}

const PLOT_TYPES = Object.keys(PLOT_DEFAULTS) as PlotType[]

const PLOT_TYPE_LABELS: Record<PlotType, string> = {
	graph: 'graph',
	surface: '3D surface',
	vectorfield: 'vector field',
	complexplane: 'complex plane',
}

export const PlotActionUtil = registerActionUtil(
	class PlotActionUtil extends AgentActionUtil<PlotAction> {
		static override type = 'plot' as const

		override getInfo(action: Streaming<PlotAction>) {
			return {
				icon: 'pencil' as const,
				description: action.intent ?? '',
			}
		}

		override sanitizeAction(action: Streaming<PlotAction>, helpers: AgentHelpers) {
			if (!action.complete) return action

			// An unknown plot type has no shape to create, and a plot with no
			// expression would render an empty pair of axes.
			if (!PLOT_TYPES.includes(action.plotType)) return null
			if (!action.expression?.trim()) return null

			const x = helpers.ensureValueIsNumber(action.x)
			const y = helpers.ensureValueIsNumber(action.y)
			if (x === null || y === null) return null
			action.x = x
			action.y = y

			return action
		}

		override applyAction(action: Streaming<PlotAction>, helpers: AgentHelpers) {
			if (!action.complete) return

			const defaults = PLOT_DEFAULTS[action.plotType]
			const expression = action.expression.trim()

			// Fall back to the shape's own window whenever the model leaves a
			// bound out or gives an inverted/degenerate one.
			const range = (
				min: number | undefined,
				max: number | undefined,
				fallbackMin: number,
				fallbackMax: number
			) => {
				if (typeof min !== 'number' || typeof max !== 'number') return [fallbackMin, fallbackMax]
				if (!isFinite(min) || !isFinite(max) || min >= max) return [fallbackMin, fallbackMax]
				return [min, max]
			}

			const [xMin, xMax] = range(action.xMin, action.xMax, defaults.xMin, defaults.xMax)
			const [yMin, yMax] = range(action.yMin, action.yMax, defaults.yMin, defaults.yMax)

			// The action's x/y is where the plot's centre should sit.
			const position = helpers.removeOffsetFromVec({ x: action.x, y: action.y })
			const base = {
				id: createShapeId(),
				x: position.x - defaults.w / 2,
				y: position.y - defaults.h / 2,
			}
			const box = { w: defaults.w, h: defaults.h, xMin, xMax, yMin, yMax }

			let shape: TLShapePartial
			switch (action.plotType) {
				case 'graph': {
					shape = {
						...base,
						type: 'graph',
						props: { ...box, functionStr: expression, color: '#60a5fa', strokeWidth: 2, sliders: [] },
					} satisfies TLShapePartial<IGraphShape>
					break
				}
				case 'surface': {
					shape = {
						...base,
						type: 'graph3d',
						props: { ...box, expression, resolution: 48 },
					} satisfies TLShapePartial<IGraph3dShape>
					break
				}
				case 'vectorfield': {
					shape = {
						...base,
						type: 'vectorfield',
						props: { ...box, expression, density: 18 },
					} satisfies TLShapePartial<IVectorFieldShape>
					break
				}
				case 'complexplane': {
					shape = {
						...base,
						type: 'complexplane',
						props: { ...box, expression },
					} satisfies TLShapePartial<IComplexPlaneShape>
					break
				}
			}

			this.editor.createShape(shape)
		}
	}
)

export { PLOT_TYPE_LABELS }
