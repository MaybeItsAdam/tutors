import { RecordProps, TLAssetId, TLBaseShape, T } from 'tldraw'

export type IPdfDocumentShape = TLBaseShape<
	'pdf',
	{
		w: number
		h: number
		assetIds: TLAssetId[] // Ordered array of asset IDs representing the pages
		currentPage: number
	}
>

// tldraw module augmentation
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		pdf: IPdfDocumentShape['props']
	}
}

export const pdfDocumentShapeProps: RecordProps<IPdfDocumentShape> = {
	w: T.number,
	h: T.number,
	assetIds: T.arrayOf(T.string as unknown as T.Validator<TLAssetId>),
	currentPage: T.number,
}
