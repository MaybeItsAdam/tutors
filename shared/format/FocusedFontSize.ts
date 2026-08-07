import { z } from 'zod'

/**
 * Pixel sizes of tldraw's text size styles at the default theme font size
 * (16px). tldraw 5 removed the FONT_SIZES export in favour of theme-relative
 * display values (s: 1.125, m: 1.5, l: 2.25, xl: 2.75 × theme.fontSize); we
 * pin the default-theme pixel values here since focused font sizes are
 * expressed in absolute pixels.
 */
export const FONT_SIZES = {
	s: 18,
	m: 24,
	l: 36,
	xl: 44,
} as const

export const FocusedFontSize = z.number()

/**
 * Calculates the closest predefined font size and scale combination to achieve a target font size
 * @param targetFontSize - The desired font size in pixels
 * @returns An object containing the closest predefined font size key and the scale factor
 */
export function convertFocusedFontSizeToTldrawFontSizeAndScale(targetFontSize: number) {
	const fontSizeEntries = Object.entries(FONT_SIZES)
	let closestSize = fontSizeEntries[0]
	let minDifference = Math.abs(targetFontSize - closestSize[1])

	for (const [size, fontSize] of fontSizeEntries) {
		const difference = Math.abs(targetFontSize - fontSize)
		if (difference < minDifference) {
			minDifference = difference
			closestSize = [size, fontSize]
		}
	}

	const textSize = closestSize[0] as keyof typeof FONT_SIZES
	const baseFontSize = closestSize[1]
	const scale = targetFontSize / baseFontSize

	return { textSize, scale }
}

/**
 * Converts a tldraw font size and scale to a focused font size
 * @param textSize - The tldraw font size
 * @param scale - The tldraw scale
 * @returns The focused font size
 */
export function convertTldrawFontSizeAndScaleToFocusedFontSize(
	textSize: keyof typeof FONT_SIZES,
	scale: number
) {
	return Math.round(FONT_SIZES[textSize] * scale)
}
