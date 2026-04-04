import { IEquationShape } from './shapes/equation/EquationShape'
import { IGraphShape } from './shapes/graph/GraphShape'

// Tell tldraw's TypeScript union about our custom shapes
declare module 'tldraw' {
	interface TLShapeUtilsMap {
		equation: IEquationShape
		graph: IGraphShape
	}
}
