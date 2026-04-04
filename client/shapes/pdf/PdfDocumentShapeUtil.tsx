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
import { useMemo, useState } from 'react'

export class PdfDocumentShapeUtil extends BaseBoxShapeUtil<IPdfDocumentShape> {
	static override type = 'pdf' as const
	static override props = pdfDocumentShapeProps

	override canEdit() {
		return false
	}

	override getDefaultProps(): IPdfDocumentShape['props'] {
		return {
			w: 260,
			h: 180,
			assetIds: [],
			currentPage: 0,
		}
	}

	override component(shape: IPdfDocumentShape) {
		const editor = useEditor()
		const { assetIds, currentPage } = shape.props
		const [isOpen, setIsOpen] = useState(false)
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
		const inferredName = firstAsset?.props?.name?.replace(/ Page \d+$/, '') ?? 'Document.pdf'

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
			const offset = pageIndex - safeCurrentPage
			const yOffset = offset * 24
			const xOffset = 20 + Math.max(0, offset) * 12

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
					pdfSourcePage: pageIndex + 1,
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

		const pageLabel = `${safeCurrentPage + 1} / ${assetIds.length}`

		const documentFace = useMemo(() => {
			return (
				<div
					style={{
						height: '100%',
						display: 'flex',
						flexDirection: 'column',
						backgroundColor: '#f8f9fb',
						borderRadius: 10,
						border: '1px solid #d9dde5',
						overflow: 'hidden',
						boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
					}}
				>
					<div
						style={{
							padding: '12px 14px',
							backgroundColor: '#eef2f7',
							borderBottom: '1px solid #d9dde5',
							fontSize: 13,
							fontWeight: 600,
							whiteSpace: 'nowrap',
							textOverflow: 'ellipsis',
							overflow: 'hidden',
						}}
					>
						📄 {inferredName}
					</div>
					<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6578', fontSize: 13 }}>
						{assetIds.length} pages
					</div>
					<div
						style={{
							padding: '10px 12px',
							borderTop: '1px solid #d9dde5',
							backgroundColor: '#fdfdff',
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
						}}
						onPointerDown={(e) => e.stopPropagation()}
					>
						<span style={{ fontSize: 12, color: '#5a6578' }}>{pageLabel}</span>
						<button
							onClick={(e) => {
								e.stopPropagation()
								setIsOpen(true)
							}}
							style={{
								cursor: 'pointer',
								fontSize: 12,
								padding: '4px 8px',
								borderRadius: 6,
								border: '1px solid #c8d0dd',
								backgroundColor: 'white',
							}}
						>
							Open
						</button>
					</div>
				</div>
			)
		}, [assetIds.length, inferredName, pageLabel])

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
							zIndex: 99999,
							backgroundColor: 'rgba(0,0,0,0.45)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
						}}
						onClick={() => setIsOpen(false)}
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
										onClick={() => setIsOpen(false)}
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
