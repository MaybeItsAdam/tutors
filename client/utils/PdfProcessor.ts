import * as pdfjs from 'pdfjs-dist'

// We use Vite's ?worker to load the worker script correctly or ?url for just the path
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'

// Set the worker source
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export interface PdfPageData {
	pageNumber: number
	width: number
	height: number
	dataUrl: string // base64 representation of the page
}

export class PdfProcessor {
	/**
	 * Extracts all pages of a given PDF file into data URLs.
	 */
	static async processFile(file: File): Promise<PdfPageData[]> {
		const arrayBuffer = await file.arrayBuffer()
		const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
		const numPages = pdf.numPages

		const pages: PdfPageData[] = []

		for (let i = 1; i <= numPages; i++) {
			const page = await pdf.getPage(i)
			const viewport = page.getViewport({ scale: 2.0 }) // High DPI for better readability

			const canvas = document.createElement('canvas')
			const context = canvas.getContext('2d')
			
			if (!context) {
				throw new Error('Could not create 2d context for PDF rendering')
			}

			canvas.width = viewport.width
			canvas.height = viewport.height

			const renderContext = {
				canvasContext: context,
				viewport: viewport,
			}

			await page.render(renderContext).promise

			const dataUrl = canvas.toDataURL('image/png')
			
			pages.push({
				pageNumber: i,
				width: viewport.width,
				height: viewport.height,
				dataUrl,
			})
		}

		return pages
	}
}
