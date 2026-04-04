import {
	BaseBoxShapeUtil,
	HTMLContainer,
	createShapeId,
	TLAsset,
	TLAssetId,
	TLImageShape,
	useEditor
} from 'tldraw'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IPdfDocumentShape, pdfDocumentShapeProps } from './PdfDocumentShape'
import {
	PDF_DEFAULT_NAME,
	PDF_EXTRACTED_PAGE_H,
	PDF_EXTRACTED_PAGE_W,
	PDF_FALLBACK_ICON_COLOR,
	PDF_FALLBACK_ICON_SIZE,
	PDF_POPUP_DEFAULT_H,
	PDF_POPUP_DEFAULT_LEFT,
	PDF_POPUP_DEFAULT_TOP,
	PDF_POPUP_DEFAULT_W,
	PDF_POPUP_MIN_H,
	PDF_POPUP_MIN_POSITION,
	PDF_POPUP_MIN_W,
	PDF_PAGE_SUFFIX_PATTERN,
	PDF_POPUP_TITLE_MAX_WIDTH,
	PDF_POPUP_VIEWPORT_MARGIN,
	PDF_POPUP_Z_INDEX,
	PDF_SHAPE_DEFAULT_H,
	PDF_SHAPE_DEFAULT_W,
	PDF_THUMBNAIL_H,
	PDF_THUMBNAIL_CONTAINER_H_PADDING,
	PDF_THUMBNAIL_CONTAINER_MIN_H,
	PDF_THUMBNAIL_CONTAINER_MIN_W,
	PDF_THUMBNAIL_CONTAINER_W_PADDING,
	PDF_THUMBNAIL_W,
} from './PdfConstants'

type PdfShapeMeta = {
	pdfPopupOpen?: boolean
	customName?: string
}

export class PdfDocumentShapeUtil extends BaseBoxShapeUtil<IPdfDocumentShape> {
	static override type = 'pdf' as const
	static override props = pdfDocumentShapeProps

	override canResize() {
		return true
	}

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
		const shapeMeta = (shape.meta as PdfShapeMeta | undefined) ?? {}
		const isOpen = Boolean(shapeMeta.pdfPopupOpen)
		const maxPageIndex = assetIds.length - 1
		const safeCurrentPage = maxPageIndex < 0 ? 0 : Math.min(Math.max(currentPage, 0), maxPageIndex)
		const thumbnailContainerW = Math.max(
			PDF_THUMBNAIL_CONTAINER_MIN_W,
			shape.props.w - PDF_THUMBNAIL_CONTAINER_W_PADDING
		)
		const thumbnailContainerH = Math.max(
			PDF_THUMBNAIL_CONTAINER_MIN_H,
			shape.props.h - PDF_THUMBNAIL_CONTAINER_H_PADDING
		)
		const [popupRect, setPopupRect] = useState({
			left: PDF_POPUP_DEFAULT_LEFT,
			top: PDF_POPUP_DEFAULT_TOP,
			width: PDF_POPUP_DEFAULT_W,
			height: PDF_POPUP_DEFAULT_H,
		})
		const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
		const resizeStateRef = useRef<{ pointerId: number; startX: number; startY: number; startW: number; startH: number } | null>(null)

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
			: PDF_DEFAULT_NAME
		const displayName = shapeMeta.customName ?? inferredName

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
					w: PDF_EXTRACTED_PAGE_W,
					h: PDF_EXTRACTED_PAGE_H,
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
					...shapeMeta,
					pdfPopupOpen: true,
				},
			})
		}
		const closePopup = useCallback(() => {
			editor.updateShape<IPdfDocumentShape>({
				id: shape.id,
				type: 'pdf',
				meta: {
					...shapeMeta,
					pdfPopupOpen: false,
				},
			})
		}, [editor, shape.id, shapeMeta])

		useEffect(() => {
			if (!isOpen) return
			const onMove = (e: PointerEvent) => {
				const dragState = dragStateRef.current
				const resizeState = resizeStateRef.current
				if (dragState) {
					setPopupRect((current) => ({
						...current,
						left: Math.max(PDF_POPUP_MIN_POSITION, dragState.startLeft + (e.clientX - dragState.startX)),
						top: Math.max(PDF_POPUP_MIN_POSITION, dragState.startTop + (e.clientY - dragState.startY)),
					}))
				}
				if (resizeState) {
					setPopupRect((current) => ({
						...current,
						width: Math.max(PDF_POPUP_MIN_W, resizeState.startW + (e.clientX - resizeState.startX)),
						height: Math.max(PDF_POPUP_MIN_H, resizeState.startH + (e.clientY - resizeState.startY)),
					}))
				}
			}
			const onKeyDown = (e: KeyboardEvent) => {
				if (e.key === 'Escape') closePopup()
			}
			const onUp = (e: PointerEvent) => {
				if (dragStateRef.current?.pointerId === e.pointerId) dragStateRef.current = null
				if (resizeStateRef.current?.pointerId === e.pointerId) resizeStateRef.current = null
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
			window.addEventListener('keydown', onKeyDown)
			return () => {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
				window.removeEventListener('keydown', onKeyDown)
			}
		}, [isOpen, closePopup])
		const documentFace = (
			<div
				style={{
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 10,
					backgroundColor: 'transparent',
				}}
			>
				<div
					style={{
						width: thumbnailContainerW,
						height: thumbnailContainerH,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
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
							style={{
								maxWidth: '100%',
								maxHeight: '100%',
								objectFit: 'contain',
								borderRadius: 4,
							}}
							draggable={false}
						/>
					) : (
						<div style={{ color: PDF_FALLBACK_ICON_COLOR, fontSize: PDF_FALLBACK_ICON_SIZE }}>📄</div>
					)}
				</div>
				<div
					style={{
						maxWidth: 140,
						padding: '0 6px',
						borderRadius: 8,
						backgroundColor: 'transparent',
						color: '#e2e8f0',
						fontSize: 12,
						fontWeight: 700,
						height: 26,
						display: 'flex',
						alignItems: 'center',
					}}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<input
						aria-label="PDF filename"
						value={displayName}
						onChange={(e) =>
							editor.updateShape<IPdfDocumentShape>({
								id: shape.id,
								type: 'pdf',
								meta: {
									...shapeMeta,
									customName: e.currentTarget.value,
								},
							})
						}
						onBlur={(e) => {
							const trimmed = e.currentTarget.value.trim()
							editor.updateShape<IPdfDocumentShape>({
								id: shape.id,
								type: 'pdf',
								meta: {
									...shapeMeta,
									customName: trimmed.length ? trimmed : undefined,
								},
							})
						}}
						style={{
							width: '100%',
							background: 'transparent',
							border: 'none',
							outline: 'none',
							color: '#e2e8f0',
							fontSize: 12,
							fontWeight: 700,
							textAlign: 'center',
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					/>
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
							position: 'absolute',
							left: popupRect.left,
							top: popupRect.top,
							width: `min(${popupRect.width}px, calc(100vw - ${PDF_POPUP_VIEWPORT_MARGIN}px))`,
							height: `min(${popupRect.height}px, calc(100vh - ${PDF_POPUP_VIEWPORT_MARGIN}px))`,
							zIndex: PDF_POPUP_Z_INDEX,
							backgroundColor: 'white',
							borderRadius: 12,
							boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
							display: 'flex',
							flexDirection: 'column',
							overflow: 'hidden',
							pointerEvents: 'all',
							touchAction: 'auto',
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
								cursor: 'move',
								userSelect: 'none',
							}}
							onPointerDown={(e) => {
								e.stopPropagation()
								dragStateRef.current = {
									pointerId: e.pointerId,
									startX: e.clientX,
									startY: e.clientY,
									startLeft: popupRect.left,
									startTop: popupRect.top,
								}
							}}
						>
							<div style={{ fontSize: 14, fontWeight: 600, maxWidth: PDF_POPUP_TITLE_MAX_WIDTH, textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
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
								<span style={{ fontSize: 13, minWidth: 72, textAlign: 'center' }}>{safeCurrentPage + 1} / {assetIds.length}</span>
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
									aria-label="Close PDF viewer"
									style={{ cursor: 'pointer', padding: '4px 8px', border: '1px solid #ced4da', borderRadius: 4, backgroundColor: '#fff' }}
								>
									Close (Esc)
								</button>
							</div>
						</div>
						<div
							style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', backgroundColor: '#f1f3f8' }}
							onWheel={(e) => e.stopPropagation()}
							onPointerDown={(e) => e.stopPropagation()}
						>
							{asset?.props?.src ? (
								<img
									src={asset.props.src}
									alt={`Page ${safeCurrentPage + 1}`}
									style={{ width: '100%', height: 'auto', display: 'block' }}
									draggable={false}
								/>
							) : (
								<div style={{ color: '#5a6578' }}>Missing Asset</div>
							)}
						</div>
						<div
							style={{
								position: 'absolute',
								right: 0,
								bottom: 0,
								width: 18,
								height: 18,
								cursor: 'nwse-resize',
							}}
							onPointerDown={(e) => {
								e.stopPropagation()
								resizeStateRef.current = {
									pointerId: e.pointerId,
									startX: e.clientX,
									startY: e.clientY,
									startW: popupRect.width,
									startH: popupRect.height,
								}
							}}
						/>
					</div>
				)}
			</>
		)
	}

	override indicator(shape: IPdfDocumentShape) {
		return <rect width={shape.props.w} height={shape.props.h} rx={8} />
	}
	
	override onResize = (shape: IPdfDocumentShape, info: any) => {
		const nextW = info?.bounds?.w ?? shape.props.w
		const nextH = info?.bounds?.h ?? shape.props.h
		return {
			props: {
				w: Math.max(100, nextW),
				h: Math.max(100, nextH),
			},
		}
	}
}
