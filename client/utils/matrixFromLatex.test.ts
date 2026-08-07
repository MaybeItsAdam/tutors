import { describe, expect, it } from 'vitest'
import {
	apply2,
	apply3,
	det2,
	det3,
	eigen2,
	eigenvec2,
	matrixFromLatex,
	trace2,
	trace3,
} from './matrixFromLatex'

describe('matrixFromLatex', () => {
	it('parses a pmatrix into a number matrix', () => {
		expect(matrixFromLatex('\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}')).toEqual([
			[1, 2],
			[3, 4],
		])
	})

	it('parses a bmatrix', () => {
		expect(matrixFromLatex('\\begin{bmatrix}5&6\\\\7&8\\end{bmatrix}')).toEqual([
			[5, 6],
			[7, 8],
		])
	})

	it('tolerates whitespace and newlines', () => {
		const latex = '\\begin{pmatrix}\n\t1 & 0 \\\\\n\t0 & 1\n\\end{pmatrix}'
		expect(matrixFromLatex(latex)).toEqual([
			[1, 0],
			[0, 1],
		])
	})

	it('evaluates LaTeX cell expressions', () => {
		const mat = matrixFromLatex('\\begin{pmatrix}\\frac{1}{2} & 2 \\cdot 3 \\\\ \\pi & 0\\end{pmatrix}')
		expect(mat).not.toBeNull()
		expect(mat![0][0]).toBeCloseTo(0.5)
		expect(mat![0][1]).toBeCloseTo(6)
		expect(mat![1][0]).toBeCloseTo(Math.PI)
		expect(mat![1][1]).toBeCloseTo(0)
	})

	it('coerces unevaluable cells to 0', () => {
		expect(matrixFromLatex('\\begin{pmatrix}x & 1 \\\\ 2 & 3\\end{pmatrix}')).toEqual([
			[0, 1],
			[2, 3],
		])
	})

	it('returns null for ragged rows', () => {
		expect(matrixFromLatex('\\begin{pmatrix}1 & 2 \\\\ 3\\end{pmatrix}')).toBeNull()
	})

	it('returns null when no matrix environment is present', () => {
		expect(matrixFromLatex('x^2 + 1')).toBeNull()
		expect(matrixFromLatex('\\begin{pmatrix}\\end{pmatrix}')).toBeNull()
	})
})

describe('linear algebra helpers', () => {
	const m = [
		[1, 2],
		[3, 4],
	]

	it('det2 computes the 2x2 determinant', () => {
		expect(det2(m)).toBeCloseTo(-2)
	})

	it('trace2 computes the 2x2 trace', () => {
		expect(trace2(m)).toBeCloseTo(5)
	})

	it('eigen2 returns real eigenvalues when the discriminant is non-negative', () => {
		const result = eigen2([
			[2, 0],
			[0, 3],
		])
		expect(result.real).toBe(true)
		if (result.real) {
			expect(result.λ1).toBeCloseTo(3)
			expect(result.λ2).toBeCloseTo(2)
		}
	})

	it('eigen2 returns a complex pair for a rotation matrix', () => {
		const result = eigen2([
			[0, -1],
			[1, 0],
		])
		expect(result.real).toBe(false)
		if (!result.real) {
			expect(result.re).toBeCloseTo(0)
			expect(result.im).toBeCloseTo(1)
		}
	})

	it('eigenvec2 returns a unit eigenvector for a real eigenvalue', () => {
		const [vx, vy] = eigenvec2(
			[
				[2, 1],
				[0, 3],
			],
			3
		)
		expect(vx).toBeCloseTo(Math.SQRT1_2)
		expect(vy).toBeCloseTo(Math.SQRT1_2)
	})

	it('apply2 multiplies a 2x2 matrix by a column vector', () => {
		const [x, y] = apply2(m, 1, 1)
		expect(x).toBeCloseTo(3)
		expect(y).toBeCloseTo(7)
	})

	const m3 = [
		[1, 2, 3],
		[4, 5, 6],
		[7, 8, 10],
	]

	it('apply3 multiplies a 3x3 matrix by a column vector', () => {
		const [x, y, z] = apply3(m3, 1, 0, 1)
		expect(x).toBeCloseTo(4)
		expect(y).toBeCloseTo(10)
		expect(z).toBeCloseTo(17)
	})

	it('det3 computes the 3x3 determinant', () => {
		expect(det3(m3)).toBeCloseTo(-3)
	})

	it('trace3 computes the 3x3 trace', () => {
		expect(trace3(m3)).toBeCloseTo(16)
	})
})
