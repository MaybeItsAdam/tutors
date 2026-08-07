/**
 * Best-effort conversion: KaTeX/MathLive LaTeX → mathjs expression.
 * Strips structural LaTeX syntax, extracts the RHS of definitions like f(x) = ...,
 * and converts common commands to mathjs equivalents.
 */

/** Read a balanced `{...}` group starting at `start`. Returns the inner content and the index just past the closing brace. */
function readBraceGroup(s: string, start: number): { content: string; end: number } | null {
	if (s[start] !== '{') return null
	let depth = 0
	for (let i = start; i < s.length; i++) {
		if (s[i] === '{') depth++
		else if (s[i] === '}') {
			depth--
			if (depth === 0) return { content: s.slice(start + 1, i), end: i + 1 }
		}
	}
	return null
}

/**
 * Replace every `\frac{num}{den}` with `(num)/(den)` using balanced-brace
 * matching, so nested fractions like `\frac{\frac{a}{b}}{c}` convert
 * correctly to `((a)/(b))/(c)`.
 */
function convertFrac(input: string): string {
	let out = input
	let searchFrom = 0
	for (;;) {
		const idx = out.indexOf('\\frac', searchFrom)
		if (idx === -1) break
		const num = readBraceGroup(out, idx + '\\frac'.length)
		const den = num ? readBraceGroup(out, num.end) : null
		if (!num || !den) {
			// Malformed \frac (missing braces) — skip past it untouched
			searchFrom = idx + '\\frac'.length
			continue
		}
		const replacement = `(${convertFrac(num.content)})/(${convertFrac(den.content)})`
		out = out.slice(0, idx) + replacement + out.slice(den.end)
		searchFrom = idx + replacement.length
	}
	return out
}

/**
 * Shared LaTeX-command → mathjs replacement chain used by both latexToMathjs
 * and matrixFromLatex. Handles \frac (brace-aware, nested), \sqrt, \pi,
 * \cdot and \times. Callers layer their own extra rules on top.
 */
export function convertLatexCommands(fragment: string): string {
	return convertFrac(fragment)
		.replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
		.replace(/\\sqrt/g, 'sqrt')
		.replace(/\\pi/g, 'pi')
		.replace(/\\cdot/g, '*')
		.replace(/\\times/g, '*')
}

export function latexToMathjs(latex: string): string {
	let expr = latex
		// \left( → (   \right) → )   \left[ → [   etc.
		.replace(/\\left\s*([([{|])/g, '$1')
		.replace(/\\right\s*([)\]|}|])/g, '$1')

	expr = convertLatexCommands(expr)
		// Common commands
		.replace(/\\infty/g, 'Infinity')
		.replace(/\\sin/g, 'sin').replace(/\\cos/g, 'cos')
		.replace(/\\tan/g, 'tan').replace(/\\ln/g, 'log')
		.replace(/\\log/g, 'log10')
		.replace(/\\exp/g, 'exp').replace(/\\abs/g, 'abs')
		.replace(/\^\{([^}]+)\}/g, '^($1)')  // x^{2} → x^(2)
		.replace(/_{[^}]+}/g, '')             // drop subscripts
		.replace(/[{}\\]/g, '')               // strip remaining LaTeX syntax
		.trim()

	// If the expression contains = (e.g. f(x) = 2x), keep only the RHS
	const eqIdx = expr.indexOf('=')
	if (eqIdx !== -1) {
		expr = expr.slice(eqIdx + 1).trim()
	}

	// Strip leading function-name prefix like f(x), g(t), etc.
	expr = expr.replace(/^[a-zA-Z]\([^)]*\)\s*/, '')

	return expr || latex // fallback to original if we stripped everything
}

/**
 * Like latexToMathjs but handles multi-line LaTeX environments.
 * Returns one mathjs expression string per line/equation:
 *   - \displaylines{a \\ b}  → ['expr_a', 'expr_b']
 *   - \begin{align}...\.end{align} → one entry per \\-separated row
 *   - plain expression → ['expr']
 */
export function latexToMathjsLines(latex: string): string[] {
	// Helper: split a block of LaTeX on \\ line-breaks, convert each
	const splitLines = (block: string): string[] =>
		block
			.split(/\\\\/)
			.map(l => latexToMathjs(l.trim()))
			.filter(Boolean)

	// \displaylines{...} – MathLive uses this for addRowAfter
	const dlMatch = latex.match(/^\\displaylines\{([\s\S]*)\}$/)
	if (dlMatch) return splitLines(dlMatch[1])

	// \begin{align|aligned|gather|multline}...\end{...}
	const envMatch = latex.match(
		/\\begin\{(?:align|aligned|gather|multline)[*]?\}([\s\S]*)\\end\{(?:align|aligned|gather|multline)[*]?\}/
	)
	if (envMatch) return splitLines(envMatch[1])

	// Plain single expression
	const single = latexToMathjs(latex)
	return single ? [single] : []
}
