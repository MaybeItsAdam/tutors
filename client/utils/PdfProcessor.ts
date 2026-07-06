import * as pdfjs from 'pdfjs-dist'

// We use Vite's ?url to get the path to the worker script
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Set the worker source
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export interface PdfPageData {
	pageNumber: number
	width: number
	height: number
	dataUrl: string // data URL of the rendered page image
}

export class PdfProcessor {
	/**
	 * Extracts all pages of a given PDF file into data URLs.
	 * Data URLs (rather than blob: URLs) are required so the images survive
	 * a page reload — asset records are persisted by tldraw and by workspace
	 * snapshots, and blob: URLs die with the document that created them.
	 * JPEG keeps the persisted size manageable. Pages render in parallel.
	 */
	static async processFile(file: File): Promise<PdfPageData[]> {
		const arrayBuffer = await file.arrayBuffer()
		const pdf = await pdfjs.getDocument({
			data: arrayBuffer,
			// Defence in depth against malicious PDFs executing JS via font
			// matrices (CVE-2024-4367 class of issues) — never allow eval.
			isEvalSupported: false,
		}).promise
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

			const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

			return {
				pageNumber: i,
				width: viewport.width,
				height: viewport.height,
				dataUrl,
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
