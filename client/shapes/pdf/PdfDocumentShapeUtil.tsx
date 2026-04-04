import {
	AssetRecordType,
	BaseBoxShapeUtil,
	HTMLContainer,
	createShapeId,
	TLAsset,
	TLImageShape,
	useEditor
} from 'tldraw'
import { IPdfDocumentShape, pdfDocumentShapeProps } from './PdfDocumentShape'

export class PdfDocumentShapeUtil extends BaseBoxShapeUtil<IPdfDocumentShape> {
	static override type = 'pdf' as const
	static override props = pdfDocumentShapeProps

	override canEdit() {
		return false
	}

	override getDefaultProps(): IPdfDocumentShape['props'] {
		return {
			w: 400,
			h: 500,
			assetIds: [],
			currentPage: 0,
		}
	}

	override component(shape: IPdfDocumentShape) {
		const editor = useEditor()
		const { assetIds, currentPage, w, h } = shape.props

		if (!assetIds.length) {
			return (
				<HTMLContainer id={shape.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0', borderRadius: 8 }}>
					Loading PDF...
				</HTMLContainer>
			)
		}

		const currentAssetId = assetIds[currentPage]
		const asset = editor.getAsset(currentAssetId) as TLAsset & { props: { src: string } }

		const handlePrev = (e: React.MouseEvent) => {
			e.stopPropagation()
			if (currentPage > 0) {
				editor.updateShape<IPdfDocumentShape>({
					id: shape.id,
					type: 'pdf',
					props: { currentPage: currentPage - 1 },
				})
			}
		}

		const handleNext = (e: React.MouseEvent) => {
			e.stopPropagation()
			if (currentPage < assetIds.length - 1) {
				editor.updateShape<IPdfDocumentShape>({
					id: shape.id,
					type: 'pdf',
					props: { currentPage: currentPage + 1 },
				})
			}
		}

		const handleExtract = (e: React.MouseEvent) => {
			e.stopPropagation()
			
			// Extract the current page as a standard image shape to the right of this shape
			editor.createShape<TLImageShape>({
				id: createShapeId(),
				type: 'image',
				x: shape.x + shape.props.w + 20,
				y: shape.y,
				props: {
					w: shape.props.w,
					h: shape.props.h,
					assetId: currentAssetId,
				},
			})
		}

		return (
			<HTMLContainer
				id={shape.id}
				style={{
					display: 'flex',
					flexDirection: 'column',
					pointerEvents: 'all',
					width: '100%',
					height: '100%',
					backgroundColor: 'white',
					boxShadow: '0px 4px 6px rgba(0,0,0,0.1)',
					borderRadius: 8,
					overflow: 'hidden',
				}}
			>
				{/* Image Container */}
				<div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
					{asset?.props?.src ? (
						<img
							src={asset.props.src}
							alt={`Page ${currentPage + 1}`}
							style={{ width: '100%', height: '100%', objectFit: 'contain' }}
							draggable={false}
						/>
					) : (
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>Missing Asset</div>
					)}
				</div>

				{/* Toolbar */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						padding: '8px 12px',
						backgroundColor: '#f8f9fa',
						borderTop: '1px solid #e9ecef',
						fontSize: 14,
						userSelect: 'none',
					}}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div style={{ display: 'flex', gap: 8 }}>
						<button 
							onClick={handlePrev} 
							disabled={currentPage === 0}
							style={{ cursor: currentPage === 0 ? 'default' : 'pointer', padding: '4px 8px'}}
						>
							&lt;
						</button>
						<span style={{ minWidth: 60, textAlign: 'center' }}>
							{currentPage + 1} / {assetIds.length}
						</span>
						<button 
							onClick={handleNext} 
							disabled={currentPage === assetIds.length - 1}
							style={{ cursor: currentPage === assetIds.length - 1 ? 'default' : 'pointer', padding: '4px 8px'}}
						>
							&gt;
						</button>
					</div>
					
					<button 
						onClick={handleExtract}
						style={{ cursor: 'pointer', padding: '4px 8px', backgroundColor: '#e9ecef', border: '1px solid #ced4da', borderRadius: 4 }}
					>
						Extract Page
					</button>
				</div>
			</HTMLContainer>
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
