import * as pdfjs from 'pdfjs-dist'

// We use Vite's ?worker to load the worker script correctly or ?url for just the path
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

// Set the worker source
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export interface PdfPageData {
	pageNumber: number
	width: number
	height: number
	dataUrl: string // blob URL pointing to the rendered page image
}

export class PdfProcessor {
	/**
	 * Extracts all pages of a given PDF file into blob URLs.
	 * Uses blob URLs instead of base64 data URLs to avoid bloating
	 * memory and localStorage with huge inline strings.
	 * Pages are rendered in parallel for faster processing.
	 */
	static async processFile(file: File): Promise<PdfPageData[]> {
		const arrayBuffer = await file.arrayBuffer()
		const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
		const numPages = pdf.numPages

		const renderPage = async (i: number): Promise<PdfPageData> => {
			const page = await pdf.getPage(i)
			const viewport = page.getViewport({ scale: 2.0 }) // High DPI for better readability

			const canvas = document.createElement('canvas')
			const context = canvas.getContext('2d')

			if (!context) {
				throw new Error('Could not create 2d context for PDF rendering')
			}

			canvas.width = viewport.width
			canvas.height = viewport.height

			await page.render({ canvasContext: context, viewport }).promise

			// Convert to blob URL instead of base64 data URL to save memory
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(b) => (b ? resolve(b) : reject(new Error('Failed to create blob from canvas'))),
					'image/png'
				)
			})
			const blobUrl = URL.createObjectURL(blob)

			return {
				pageNumber: i,
				width: viewport.width,
				height: viewport.height,
				dataUrl: blobUrl,
			}
		}

		// Render all pages in parallel
		const pagePromises: Promise<PdfPageData>[] = []
		for (let i = 1; i <= numPages; i++) {
			pagePromises.push(renderPage(i))
		}

		return Promise.all(pagePromises)
	}
}
