import { Box, FileHelpers } from 'tldraw'
import { ScreenshotPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ScreenshotPartUtil = registerPromptPartUtil(
	class ScreenshotPartUtil extends PromptPartUtil<ScreenshotPart> {
		static override type = 'screenshot' as const

		override async getPart(request: AgentRequest): Promise<ScreenshotPart> {
			const { editor } = this

			const contextBounds = request.bounds

			const contextBoundsBox = Box.From(contextBounds)

			const shapes = editor.getCurrentPageShapesSorted().filter((shape) => {
				const bounds = editor.getShapeMaskedPageBounds(shape)
				if (!bounds) return false
				return contextBoundsBox.includes(bounds)
			})

			if (shapes.length === 0) {
				return { type: 'screenshot', screenshot: '' }
			}

			// Every major vision model downsamples to roughly this on its way in
			// (Claude tops out at 1568px on the longest edge), so anything larger
			// is upload and token cost for detail the model never sees - and this
			// image is rebuilt on every turn of the agent loop.
			const MAX_SCREENSHOT_DIMENSION = 1568

			const largestDimension = Math.max(request.bounds.w, request.bounds.h)
			const scale =
				largestDimension > MAX_SCREENSHOT_DIMENSION
					? MAX_SCREENSHOT_DIMENSION / largestDimension
					: 1

			const result = await editor.toImage(shapes, {
				format: 'jpeg',
				background: true,
				bounds: Box.From(request.bounds),
				padding: 0,
				pixelRatio: 1,
				scale,
			})

			return {
				type: 'screenshot',
				screenshot: await FileHelpers.blobToDataUrl(result.blob),
			}
		}
	}
)
