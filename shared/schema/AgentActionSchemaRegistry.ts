import z from 'zod'

// Registry: actionType -> schema
const schemaRegistry = new Map<string, z.ZodType>()

/**
 * Register an action schema. Call this for each action type.
 *
 * @param type - The action type (the `_type` literal value).
 * @param schema - The Zod schema for this action.
 * @returns The schema (for chaining).
 */
export function registerActionSchema<T extends z.ZodType>(type: string, schema: T): T {
	if (schemaRegistry.has(type)) {
		throw new Error(`Action schema already registered: ${type}`)
	}
	schemaRegistry.set(type, schema)
	return schema
}

/**
 * Get the schema for an action type.
 *
 * @param type - The action type to look up.
 * @returns The schema, or undefined if not found.
 */
export function getRegisteredActionSchema(type: string): z.ZodType | undefined {
	return schemaRegistry.get(type)
}

/**
 * Check if a schema is already registered for a type.
 */
export function hasRegisteredActionSchema(type: string): boolean {
	return schemaRegistry.has(type)
}
