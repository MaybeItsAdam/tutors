/**
 * Best-effort conversion: KaTeX/MathLive LaTeX → mathjs expression.
 * Strips structural LaTeX syntax, extracts the RHS of definitions like f(x) = ...,
 * and converts common commands to mathjs equivalents.
 */
export function latexToMathjs(latex: string): string {
	let expr = latex
		// \left( → (   \right) → )   \left[ → [   etc.
		.replace(/\\left\s*([([{|])/g, '$1')
		.replace(/\\right\s*([)\]|}|])/g, '$1')
		// Common commands
		.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
		.replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
		.replace(/\\sqrt/g, 'sqrt')
		.replace(/\\pi/g, 'pi')
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
