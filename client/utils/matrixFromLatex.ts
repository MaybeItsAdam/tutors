import { evaluate } from 'mathjs'

/**
 * Parse a LaTeX matrix environment into a number[][].
 * Handles \begin{pmatrix}, \begin{bmatrix}, \begin{matrix}, \begin{vmatrix}, etc.
 * Returns null if no valid matrix is found.
 */
export function matrixFromLatex(latex: string): number[][] | null {
	const match = latex.match(
		/\\begin\{([BbpvV])?matrix\*?\}([\s\S]*?)\\end\{([BbpvV])?matrix\*?\}/
	)
	if (!match) return null

	const body = match[2]
	const rows = body.split(/\\\\/).map(r => r.trim()).filter(Boolean)
	if (rows.length === 0) return null

	const mat: number[][] = []
	for (const row of rows) {
		const cells = row.split('&').map(c => c.trim())
		const values: number[] = []
		for (const cell of cells) {
			// Convert common LaTeX to mathjs
			const expr = cell
				.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
				.replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
				.replace(/\\sqrt/g, 'sqrt')
				.replace(/\\pi/g, 'pi')
				.replace(/\\cdot/g, '*')
				.replace(/\\times/g, '*')
				.replace(/[{}]/g, '')
				.replace(/\\/g, '')
				.trim()
			if (!expr) { values.push(0); continue }
			try {
				const v = evaluate(expr)
				values.push(typeof v === 'number' && isFinite(v) ? v : 0)
			} catch {
				values.push(0)
			}
		}
		if (values.length > 0) mat.push(values)
	}

	if (mat.length === 0) return null
	const cols = mat[0].length
	if (!mat.every(r => r.length === cols)) return null
	return mat
}

// ── Linear algebra helpers ────────────────────────────────────────────────────

export type Eigen2Result =
	| { real: true;  λ1: number; λ2: number }
	| { real: false; re: number; im: number }

export function det2(m: number[][]): number {
	return m[0][0] * m[1][1] - m[0][1] * m[1][0]
}

export function trace2(m: number[][]): number {
	return m[0][0] + m[1][1]
}

export function eigen2(m: number[][]): Eigen2Result {
	const tr = trace2(m)
	const d  = det2(m)
	const disc = tr * tr - 4 * d
	if (disc >= 0) {
		return { real: true, λ1: (tr + Math.sqrt(disc)) / 2, λ2: (tr - Math.sqrt(disc)) / 2 }
	}
	return { real: false, re: tr / 2, im: Math.sqrt(-disc) / 2 }
}

/**
 * Return a unit eigenvector for a real eigenvalue of a 2×2 matrix.
 * Falls back to axis-aligned vectors for degenerate cases.
 */
export function eigenvec2(m: number[][], λ: number): [number, number] {
	const [[a, b], [c]] = m
	let vx: number, vy: number
	if (Math.abs(b) > 1e-9) {
		vx = b; vy = λ - a
	} else if (Math.abs(c) > 1e-9) {
		vx = λ - m[1][1]; vy = c
	} else {
		// Diagonal: return the standard basis vector corresponding to this eigenvalue
		vx = Math.abs(m[0][0] - λ) < 1e-9 ? 1 : 0
		vy = Math.abs(m[0][0] - λ) < 1e-9 ? 0 : 1
	}
	const norm = Math.sqrt(vx * vx + vy * vy) || 1
	return [vx / norm, vy / norm]
}

/** Apply a matrix to a 2D column vector. Works for any NxN with 2D input. */
export function apply2(m: number[][], x: number, y: number): [number, number] {
	return [m[0][0] * x + m[0][1] * y, m[1][0] * x + m[1][1] * y]
}

/** Apply a 3×3 matrix to a 3D column vector. */
export function apply3(m: number[][], x: number, y: number, z: number): [number, number, number] {
	return [
		m[0][0] * x + m[0][1] * y + m[0][2] * z,
		m[1][0] * x + m[1][1] * y + m[1][2] * z,
		m[2][0] * x + m[2][1] * y + m[2][2] * z,
	]
}

export function det3(m: number[][]): number {
	const [r0, r1, r2] = m
	return (
		r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) -
		r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) +
		r0[2] * (r1[0] * r2[1] - r1[1] * r2[0])
	)
}

export function trace3(m: number[][]): number {
	return m[0][0] + m[1][1] + m[2][2]
}
