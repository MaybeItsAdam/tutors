import { describe, expect, it } from 'vitest'
import { latexToMathjs, latexToMathjsLines } from './latexToMathjs'

describe('latexToMathjs', () => {
	it('converts \\frac to a parenthesised division', () => {
		expect(latexToMathjs('\\frac{1}{2}')).toBe('(1)/(2)')
		expect(latexToMathjs('\\frac{x+1}{x-1}')).toBe('(x+1)/(x-1)')
	})

	it('converts \\sqrt to sqrt()', () => {
		expect(latexToMathjs('\\sqrt{x+1}')).toBe('sqrt(x+1)')
	})

	it('converts \\cdot and \\times to multiplication', () => {
		// The shared convertLatexCommands chain (also used by matrixFromLatex)
		// now handles these, resolving the old consolidation candidate.
		expect(latexToMathjs('2 \\cdot 3')).toBe('2 * 3')
		expect(latexToMathjs('2 \\times 3')).toBe('2 * 3')
	})

	it('keeps only the RHS of an equation', () => {
		expect(latexToMathjs('y = 2x + 1')).toBe('2x + 1')
		expect(latexToMathjs('f(x) = x^2 + 1')).toBe('x^2 + 1')
	})

	it('strips a leading function-name prefix from the RHS', () => {
		expect(latexToMathjs('y = f(t) t^2')).toBe('t^2')
	})

	it('converts common commands, delimiters, exponents and subscripts', () => {
		expect(latexToMathjs('\\sin\\left(\\pi x\\right)')).toBe('sin(pi x)')
		expect(latexToMathjs('x^{n+1}')).toBe('x^(n+1)')
		expect(latexToMathjs('x_{1} + 2')).toBe('x + 2')
	})

	it('passes plain expressions through unchanged', () => {
		expect(latexToMathjs('x^2 + 1')).toBe('x^2 + 1')
		expect(latexToMathjs('sin(x)')).toBe('sin(x)')
	})

	it('falls back to the original input when everything is stripped', () => {
		expect(latexToMathjs('{}')).toBe('{}')
	})

	it('handles a nested \\frac in the numerator', () => {
		// \frac is matched with a balanced-brace parser, so nested fractions
		// convert innermost-out instead of truncating at the first `}`.
		expect(latexToMathjs('\\frac{\\frac{a}{b}}{c}')).toBe('((a)/(b))/(c)')
		expect(latexToMathjs('\\frac{a}{\\frac{b}{c}}')).toBe('(a)/((b)/(c))')
	})
})

describe('latexToMathjsLines', () => {
	it('splits \\displaylines into one expression per row', () => {
		expect(latexToMathjsLines('\\displaylines{a + b \\\\ c - d}')).toEqual(['a + b', 'c - d'])
	})

	it('filters out rows that convert to nothing', () => {
		expect(latexToMathjsLines('\\displaylines{a + b \\\\ }')).toEqual(['a + b'])
	})

	it('splits align environments, dropping alignment markers via RHS extraction', () => {
		// Each row is converted independently; `&= x` loses the & because
		// everything up to and including the = is discarded.
		expect(latexToMathjsLines('\\begin{align} y &= x \\\\ z &= 2x \\end{align}')).toEqual([
			'x',
			'2x',
		])
	})

	it('handles starred and related environments', () => {
		expect(latexToMathjsLines('\\begin{aligned} y &= x^{2} \\end{aligned}')).toEqual(['x^(2)'])
	})

	it('wraps a plain expression in a single-element array', () => {
		expect(latexToMathjsLines('x + 1')).toEqual(['x + 1'])
	})
})
