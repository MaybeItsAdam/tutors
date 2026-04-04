/**
 * Format a Unix timestamp in milliseconds into a locale-specific date/time string.
 */
export function formatWorkspaceTime(ts: number) {
	return new Date(ts).toLocaleString()
}
