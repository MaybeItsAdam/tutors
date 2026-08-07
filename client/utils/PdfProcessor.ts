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

export interface PdfProcessOptions {
	/** Called after each page finishes rendering. */
	onProgress?: (done: number, total: number) => void
}

/** How many pages render concurrently. Unbounded parallelism meant a
 * 100-page PDF held 100 live 2x-DPI canvases at once. */
const PAGE_CONCURRENCY = 3

export class PdfProcessor {
	/**
	 * Extracts all pages of a given PDF file into data URLs.
	 * Data URLs (rather than blob: URLs) are required so the images survive
	 * a page reload — asset records are persisted by tldraw and by workspace
	 * snapshots, and blob: URLs die with the document that created them.
	 * JPEG keeps the persisted size manageable.
	 *
	 * Pages render through a small concurrency pool; canvases are zeroed after
	 * their data URL is taken so backing stores release immediately. Succeeds
	 * if at least one page rendered, throwing only when nothing was usable -
	 * per-page failures are counted and reported via the return's gaps.
	 */
	static async processFile(file: File, opts: PdfProcessOptions = {}): Promise<PdfPageData[]> {
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

			try {
				await page.render({ canvasContext: context, viewport }).promise
				const dataUrl = canvas.toDataURL('image/jpeg', 0.9)

				return {
					pageNumber: i,
					width: viewport.width,
					height: viewport.height,
					dataUrl,
				}
			} finally {
				// Release the backing store now rather than at GC time.
				canvas.width = 0
				canvas.height = 0
			}
		}

		// Worker pool: a few pages in flight at a time, results kept in order.
		const results: (PdfPageData | null)[] = new Array(numPages).fill(null)
		const errors: { page: number; error: unknown }[] = []
		let nextPage = 1
		let done = 0

		const worker = async () => {
			while (nextPage <= numPages) {
				const i = nextPage++
				try {
					results[i - 1] = await renderPage(i)
				} catch (error) {
					errors.push({ page: i, error })
				}
				done++
				opts.onProgress?.(done, numPages)
			}
		}

		await Promise.all(
			Array.from({ length: Math.min(PAGE_CONCURRENCY, numPages) }, () => worker())
		)

		const pages = results.filter((page): page is PdfPageData => page !== null)
		if (pages.length === 0) {
			throw new Error(
				errors.length > 0
					? `Could not render any pages of this PDF (${errors.length} failed).`
					: 'This PDF has no pages.'
			)
		}
		if (errors.length > 0) {
			console.warn(`PDF import: ${errors.length}/${numPages} pages failed to render`, errors)
		}
		return pages
	}
}
