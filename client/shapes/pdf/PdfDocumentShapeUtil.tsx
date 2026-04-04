import {
	BaseBoxShapeUtil,
	HTMLContainer,
	createShapeId,
	TLAsset,
	TLAssetId,
	TLImageShape,
	useEditor
} from 'tldraw'
import { IPdfDocumentShape, pdfDocumentShapeProps } from './PdfDocumentShape'
import {
	PDF_OVERLAY_Z_INDEX,
	PDF_PAGE_SUFFIX_PATTERN,
	PDF_SHAPE_DEFAULT_H,
	PDF_SHAPE_DEFAULT_W,
} from './PdfConstants'

export class PdfDocumentShapeUtil extends BaseBoxShapeUtil<IPdfDocumentShape> {
	static override type = 'pdf' as const
	static override props = pdfDocumentShapeProps

	override canEdit() {
		return false
	}

	override getDefaultProps(): IPdfDocumentShape['props'] {
		return {
			w: PDF_SHAPE_DEFAULT_W,
			h: PDF_SHAPE_DEFAULT_H,
			assetIds: [],
			currentPage: 0,
		}
	}

	override component(shape: IPdfDocumentShape) {
		const editor = useEditor()
		const { assetIds, currentPage } = shape.props
		const isOpen = Boolean((shape.meta as Record<string, unknown> | undefined)?.pdfPopupOpen)
		const safeCurrentPage = Math.min(currentPage, Math.max(0, assetIds.length - 1))

		if (!assetIds.length) {
			return (
				<HTMLContainer
					id={shape.id}
					style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0', borderRadius: 8 }}
				>
					Empty PDF
				</HTMLContainer>
			)
		}

		const currentAssetId = assetIds[safeCurrentPage]
		const asset = editor.getAsset(currentAssetId) as TLAsset & { props: { src: string } }
		const firstAsset = editor.getAsset(assetIds[0]) as (TLAsset & { props: { name?: string } }) | undefined
		const firstAssetName = firstAsset?.props?.name
		const inferredName = firstAssetName
			? PDF_PAGE_SUFFIX_PATTERN.test(firstAssetName)
				? firstAssetName.replace(PDF_PAGE_SUFFIX_PATTERN, '')
				: firstAssetName
			: 'Document.pdf'

		const handlePrev = (e: React.MouseEvent) => {
			e.stopPropagation()
			if (safeCurrentPage > 0) {
				editor.updateShape<IPdfDocumentShape>({
					id: shape.id,
					type: 'pdf',
					props: { currentPage: safeCurrentPage - 1 },
				})
			}
		}

		const handleNext = (e: React.MouseEvent) => {
			e.stopPropagation()
			if (safeCurrentPage < assetIds.length - 1) {
				editor.updateShape<IPdfDocumentShape>({
					id: shape.id,
					type: 'pdf',
					props: { currentPage: safeCurrentPage + 1 },
				})
			}
		}

		const createExtractedPageShape = (assetId: TLAssetId, pageIndex: number) => {
			const pageOffset = pageIndex - safeCurrentPage
			const yOffset = pageOffset * 24
			const xOffset = 20 + Math.max(0, pageOffset) * 12

			editor.createShape<TLImageShape>({
				id: createShapeId(),
				type: 'image',
				x: shape.x + shape.props.w + xOffset,
				y: shape.y + yOffset,
				props: {
					w: 320,
					h: 420,
					assetId,
				},
				meta: {
					pdfSourceShapeId: shape.id,
					pdfSourcePageIndex: pageIndex,
				},
			})
		}

		const handleExtractCurrent = (e: React.MouseEvent) => {
			e.stopPropagation()
			createExtractedPageShape(currentAssetId, safeCurrentPage)
		}

		const handleExtractAll = (e: React.MouseEvent) => {
			e.stopPropagation()
			for (let i = 0; i < assetIds.length; i++) {
				createExtractedPageShape(assetIds[i], i)
			}
		}

		const openPopup = () => {
			editor.updateShape<IPdfDocumentShape>({
				id: shape.id,
				type: 'pdf',
				meta: {
					...shape.meta,
					pdfPopupOpen: true,
				},
			})
		}
		const closePopup = () => {
			editor.updateShape<IPdfDocumentShape>({
				id: shape.id,
				type: 'pdf',
				meta: {
					...shape.meta,
					pdfPopupOpen: false,
				},
			})
		}
		const documentFace = (
			<div
				style={{
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 10,
					backgroundColor: '#2a2f3a',
					borderRadius: 10,
				}}
			>
				<div
					style={{
						width: 112,
						height: 142,
						borderRadius: 8,
						border: '1px solid rgba(255,255,255,0.22)',
						background: '#1e232d',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						boxShadow: '0 5px 18px rgba(0,0,0,0.32)',
						cursor: 'pointer',
					}}
					onDoubleClick={(e) => {
						e.stopPropagation()
						openPopup()
					}}
					title="Double-click to open"
				>
					{asset?.props?.src ? (
						<img
							src={asset.props.src}
							alt={inferredName}
							style={{ width: 84, height: 112, objectFit: 'cover', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}
							draggable={false}
						/>
					) : (
						<div style={{ color: '#cdd6e3', fontSize: 28 }}>📄</div>
					)}
				</div>
				<div
					style={{
						maxWidth: 140,
						padding: '3px 10px',
						borderRadius: 8,
						backgroundColor: '#0c62d6',
						color: '#ffffff',
						fontSize: 13,
						fontWeight: 700,
						whiteSpace: 'nowrap',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
					}}
				>
					{inferredName}
				</div>
			</div>
		)

		return (
			<>
				<HTMLContainer id={shape.id} style={{ pointerEvents: 'all', width: '100%', height: '100%' }}>
					{documentFace}
				</HTMLContainer>
				{isOpen && (
					<div
						style={{
							position: 'fixed',
							inset: 0,
							zIndex: PDF_OVERLAY_Z_INDEX,
							backgroundColor: 'rgba(0,0,0,0.45)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
						}}
						onClick={closePopup}
						onPointerDown={(e) => e.stopPropagation()}
					>
						<div
							style={{
								width: 'min(1100px, 92vw)',
								height: 'min(800px, 90vh)',
								backgroundColor: 'white',
								borderRadius: 12,
								boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
								display: 'flex',
								flexDirection: 'column',
								overflow: 'hidden',
							}}
							onClick={(e) => e.stopPropagation()}
							onPointerDown={(e) => e.stopPropagation()}
						>
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									padding: '10px 14px',
									borderBottom: '1px solid #e4e7ee',
									backgroundColor: '#f8f9fc',
								}}
							>
								<div style={{ fontSize: 14, fontWeight: 600, maxWidth: '50%', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
									📄 {inferredName}
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									<button
										onClick={handlePrev}
										disabled={safeCurrentPage === 0}
										style={{ cursor: safeCurrentPage === 0 ? 'default' : 'pointer', padding: '4px 8px' }}
									>
										&lt;
									</button>
									<span style={{ fontSize: 13, minWidth: 72, textAlign: 'center' }}>{pageLabel}</span>
									<button
										onClick={handleNext}
										disabled={safeCurrentPage === assetIds.length - 1}
										style={{ cursor: safeCurrentPage === assetIds.length - 1 ? 'default' : 'pointer', padding: '4px 8px' }}
									>
										&gt;
									</button>
									<button
										onClick={handleExtractCurrent}
										style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid #ced4da', borderRadius: 4, backgroundColor: '#fff' }}
									>
										Add Page Object
									</button>
									<button
										onClick={handleExtractAll}
										style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid #ced4da', borderRadius: 4, backgroundColor: '#fff' }}
									>
										Add All Pages
									</button>
									<button
										onClick={closePopup}
										style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid #ced4da', borderRadius: 4, backgroundColor: '#fff' }}
									>
										Close
									</button>
								</div>
							</div>
							<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f3f8' }}>
								{asset?.props?.src ? (
									<img
										src={asset.props.src}
										alt={`Page ${safeCurrentPage + 1}`}
										style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
										draggable={false}
									/>
								) : (
									<div style={{ color: '#5a6578' }}>Missing Asset</div>
								)}
							</div>
						</div>
					</div>
				)}
			</>
		)
	}

	override indicator(shape: IPdfDocumentShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
	
	override onResize = (shape: IPdfDocumentShape, info: any) => {
		return {
			props: {
				w: Math.max(100, info.bounds.w),
				h: Math.max(100, info.bounds.h),
			},
		}
	}
}
