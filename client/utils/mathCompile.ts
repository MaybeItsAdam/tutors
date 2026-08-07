import { create, all, factory } from 'mathjs'

/**
 * A dedicated mathjs instance with the known freeze vectors capped.
 *
 * Expressions come from the model and from imported workspace files, so a
 * pathological expression (factorial(99999999), combinations of huge
 * numbers...) is deliverable by a third party and would freeze the tab on
 * every render of the persisted shape - recurring on reload. This caps the
 * known unbounded-computation entry points and disables runtime imports.
 * (Honest scope note: this is not a complete sandbox - a worker with a
 * timeout is the full fix and is deferred; see the audit doc.)
 */
const math = create(all)

const MAX_FACTORIAL_ARG = 10_000

function capped(name: string, limit: number, original: (...args: never[]) => unknown) {
	return factory(name, [], () => (...args: unknown[]) => {
		for (const arg of args) {
			if (typeof arg === 'number' && Math.abs(arg) > limit) {
				throw new Error(`${name}: argument too large (max ${limit})`)
			}
		}
		return (original as (...a: unknown[]) => unknown)(...args)
	})
}

math.import(
	[
		capped('factorial', MAX_FACTORIAL_ARG, math.factorial as never),
		capped('combinations', MAX_FACTORIAL_ARG, math.combinations as never),
		capped('permutations', MAX_FACTORIAL_ARG, math.permutations as never),
		capped('gamma', MAX_FACTORIAL_ARG, math.gamma as never),
	],
	{ override: true }
)

// The documented mathjs hardening recipe: no runtime imports or unit
// definitions from expression content.
math.import(
	{
		import: () => {
			throw new Error('import is disabled')
		},
		createUnit: () => {
			throw new Error('createUnit is disabled')
		},
	},
	{ override: true }
)

const compile = math.compile.bind(math)

/**
 * Compile-once mathjs evaluation.
 *
 * `evaluate(expr, scope)` parses and compiles the expression string on every
 * call. The plot shapes evaluate the same expression hundreds of times per
 * render (401 samples per curve, one call per vector-field cell, per
 * complex-plane pixel...), so paying the parse per sample made rendering
 * orders of magnitude slower than needed. Compile once per distinct string,
 * cache the compiled function, and evaluate cheaply per sample.
 *
 * Failed parses are cached as null so a bad expression doesn't re-throw its
 * way through every sample of every render.
 */

interface CompiledExpression {
	evaluate(scope?: Record<string, unknown>): unknown
}

const CACHE_LIMIT = 256

// Map preserves insertion order, giving a cheap LRU: on hit, delete+reinsert
// moves the entry to the back; on overflow, evict the front.
const cache = new Map<string, CompiledExpression | null>()

/**
 * Compile an expression, memoized on the exact string.
 * Returns null if the expression doesn't parse.
 */
export function compileExpression(expr: string): CompiledExpression | null {
	if (cache.has(expr)) {
		const hit = cache.get(expr)!
		cache.delete(expr)
		cache.set(expr, hit)
		return hit
	}

	let compiled: CompiledExpression | null
	try {
		compiled = compile(expr)
	} catch {
		compiled = null
	}

	cache.set(expr, compiled)
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}
	return compiled
}

/**
 * Evaluate an expression against a scope, with compile-once caching.
 * Throws like mathjs evaluate() would on evaluation errors (callers already
 * catch those); throws a SyntaxError-like Error if the expression doesn't
 * parse, matching evaluate()'s behavior.
 */
export function evaluateExpr(expr: string, scope: Record<string, unknown>): unknown {
	const compiled = compileExpression(expr)
	if (!compiled) throw new Error(`Could not parse expression: ${expr}`)
	return compiled.evaluate(scope)
}
