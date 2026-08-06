/**
 * The result of a single model request, propagated from the stream loop up to
 * the prompt loop so failures are handled deliberately instead of being
 * swallowed. Before this existed, a failed request looked identical to a
 * successful one, and `working.onPromptEnd` would schedule an instant
 * zero-backoff retry against a failing backend - up to the full continuation
 * budget, one error toast each.
 */
export type AgentRequestOutcome =
	| { status: 'success' }
	| { status: 'cancelled' }
	| { status: 'error'; error: unknown; retryable: boolean }

/** How many times a single logical request is attempted before giving up. */
export const MAX_REQUEST_ATTEMPTS = 3

/**
 * A request that failed at the HTTP/stream layer, carrying enough information
 * to decide whether retrying could help.
 */
export class AgentRequestFailedError extends Error {
	readonly httpStatus?: number
	readonly retryable: boolean

	constructor(message: string, opts: { httpStatus?: number; retryable?: boolean } = {}) {
		super(message)
		this.name = 'AgentRequestFailedError'
		this.httpStatus = opts.httpStatus
		this.retryable =
			opts.retryable ?? (opts.httpStatus !== undefined && isRetryableHttpStatus(opts.httpStatus))
	}
}

export function isRetryableHttpStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500
}

/**
 * Whether a fresh attempt at the same request could plausibly succeed.
 * User cancellation is handled before this is consulted.
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof AgentRequestFailedError) return error.retryable
	// fetch throws TypeError on network failure (DNS, connection refused...)
	if (error instanceof TypeError) return true
	// The idle-timeout abort surfaces as the signal's reason (a plain string)
	// or as a DOMException named AbortError.
	if (typeof error === 'string') return error !== 'Cancelled by user'
	if (error instanceof Error && error.name === 'AbortError') return true
	return false
}

/** Exponential backoff with a little jitter: 1s, 2s, 4s... capped at 8s. */
export function backoffDelayMs(attempt: number): number {
	const base = Math.min(8000, 1000 * 2 ** attempt)
	return base + Math.floor(Math.random() * 250)
}
