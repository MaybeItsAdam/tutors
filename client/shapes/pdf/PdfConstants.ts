export const PDF_SHAPE_DEFAULT_W = 170
export const PDF_SHAPE_DEFAULT_H = 210
export const PDF_PAGE_SUFFIX_TEXT = ' Page '
export const PDF_PAGE_SUFFIX_PATTERN = new RegExp(`${PDF_PAGE_SUFFIX_TEXT}\\d+$`)
export const PDF_OVERLAY_Z_INDEX = 1000
export const PDF_DEFAULT_NAME = 'Document.pdf'
export const PDF_EXTRACTED_PAGE_W = 320
export const PDF_EXTRACTED_PAGE_H = 420
export const PDF_THUMBNAIL_W = 84
export const PDF_THUMBNAIL_H = 112
export const PDF_FALLBACK_ICON_SIZE = 28
export const PDF_FALLBACK_ICON_COLOR = '#cdd6e3'
export const PDF_POPUP_OVERLAY_BG = 'rgba(0,0,0,0.45)'
export const PDF_POPUP_TITLE_MAX_WIDTH = '50%'
export const PDF_POPUP_VIEWPORT_MARGIN = 16
export const PDF_POPUP_MIN_POSITION = 8
export const PDF_POPUP_MIN_W = 420
export const PDF_POPUP_MIN_H = 320
export const PDF_POPUP_DEFAULT_LEFT = 80
export const PDF_POPUP_DEFAULT_TOP = 60
export const PDF_POPUP_DEFAULT_W = 760
export const PDF_POPUP_DEFAULT_H = 540
export const PDF_POPUP_Z_INDEX = 1000000
export const PDF_PLACEMENT_CASCADE_OFFSET = 24
export const PDF_PLACEMENT_VIEWPORT_TOP_OFFSET = 40

export function buildPdfPageAssetName(fileName: string, pageNumber: number) {
	return `${fileName}${PDF_PAGE_SUFFIX_TEXT}${pageNumber}`
}
