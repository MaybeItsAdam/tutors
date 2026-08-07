import { describe, expect, it } from 'vitest'
import {
	AgentRequestFailedError,
	backoffDelayMs,
	isRetryableError,
	isRetryableHttpStatus,
} from './AgentRequestOutcome'

describe('isRetryableHttpStatus', () => {
	it.each([
		[400, false],
		[401, false],
		[403, false],
		[404, false],
		[408, true],
		[413, false],
		[429, true],
		[500, true],
		[502, true],
		[503, true],
	])('status %i -> %s', (status, expected) => {
		expect(isRetryableHttpStatus(status)).toBe(expected)
	})
})

describe('AgentRequestFailedError', () => {
	it('derives retryability from the http status when not given', () => {
		expect(new AgentRequestFailedError('x', { httpStatus: 503 }).retryable).toBe(true)
		expect(new AgentRequestFailedError('x', { httpStatus: 401 }).retryable).toBe(false)
	})

	it('an explicit retryable flag wins', () => {
		expect(new AgentRequestFailedError('x', { retryable: false, httpStatus: 500 }).retryable).toBe(
			false
		)
	})

	it('defaults to non-retryable with no information', () => {
		expect(new AgentRequestFailedError('x').retryable).toBe(false)
	})
})

describe('isRetryableError', () => {
	it('network failures (fetch TypeError) are retryable', () => {
		expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true)
	})

	it('abort-signal reasons are retryable unless they are the user cancel', () => {
		expect(isRetryableError('Timed out waiting for the model to respond')).toBe(true)
		expect(isRetryableError('Cancelled by user')).toBe(false)
	})

	it('AbortError exceptions are retryable (idle timeout path)', () => {
		const e = new Error('aborted')
		e.name = 'AbortError'
		expect(isRetryableError(e)).toBe(true)
	})

	it('backend error events are not retryable', () => {
		expect(isRetryableError(new AgentRequestFailedError('provider says no', { retryable: false }))).toBe(
			false
		)
	})

	it('unknown errors are not retryable', () => {
		expect(isRetryableError(new Error('who knows'))).toBe(false)
	})
})

describe('backoffDelayMs', () => {
	it('grows exponentially and caps at 8s (plus jitter)', () => {
		for (let attempt = 0; attempt < 6; attempt++) {
			const delay = backoffDelayMs(attempt)
			const base = Math.min(8000, 1000 * 2 ** attempt)
			expect(delay).toBeGreaterThanOrEqual(base)
			expect(delay).toBeLessThan(base + 250)
		}
	})
})
