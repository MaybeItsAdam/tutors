import { RecordsDiff, squashRecordDiffs, TLRecord } from 'tldraw'
import {
	convertTldrawIdToSimpleId,
	convertTldrawShapeToFocusedShape,
	convertTldrawShapeToFocusedType,
} from '../../shared/format/convertTldrawShapeToFocusedShape'
import { FocusedShape } from '../../shared/format/FocusedShape'
import { UserActionHistoryPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const UserActionHistoryPartUtil = registerPromptPartUtil(
	class UserActionHistoryPartUtil extends PromptPartUtil<UserActionHistoryPart> {
		static override type = 'userActionHistory' as const

		/**
		 * The exact diffs the latest getPart consumed. Committed (removed from
		 * the tracker) only once the request succeeds - clearing at build time
		 * permanently lost the user-edit context on failed or cancelled
		 * requests. One request is in flight per agent at a time, and retries
		 * re-run getPart, so overwriting the stash is correct.
		 */
		private consumedDiffs: RecordsDiff<TLRecord>[] = []

		override getPart(_request: AgentRequest, helpers: AgentHelpers): UserActionHistoryPart {
			const { editor, agent } = helpers

			const diffs = agent.userAction.getHistory()
			this.consumedDiffs = diffs

			const part: UserActionHistoryPart = {
				type: 'userActionHistory',
				added: [],
				removed: [],
				updated: [],
			}

			const squashedDiff = squashRecordDiffs(diffs)
			const { added, updated, removed } = squashedDiff

			// Collect user-added shapes
			for (const shape of Object.values(added)) {
				if (shape.typeName !== 'shape') continue
				part.added.push({
					shapeId: convertTldrawIdToSimpleId(shape.id),
					type: convertTldrawShapeToFocusedType(shape),
				})
			}

			// Collect user-removed shapes
			for (const shape of Object.values(removed)) {
				if (shape.typeName !== 'shape') continue
				const focusedShape = convertTldrawShapeToFocusedShape(editor, shape)
				part.removed.push({
					shapeId: focusedShape.shapeId,
					type: focusedShape._type,
				})
			}

			// Collect user-updated shapes
			for (const [from, to] of Object.values(updated)) {
				if (from.typeName !== 'shape' || to.typeName !== 'shape') continue
				const fromFocusedShape = convertTldrawShapeToFocusedShape(editor, from)
				const toFocusedShape = convertTldrawShapeToFocusedShape(editor, to)

				const changeFocusedShape = getFocusedShapeChange(fromFocusedShape, toFocusedShape)
				if (!changeFocusedShape) continue

				const before = helpers.applyOffsetToShapePartial(changeFocusedShape.from)
				const after = helpers.applyOffsetToShapePartial(changeFocusedShape.to)

				part.updated.push({
					shapeId: toFocusedShape.shapeId,
					type: toFocusedShape._type,
					before: helpers.roundShapePartial(before),
					after: helpers.roundShapePartial(after),
				})
			}

			return part
		}

		override commitPart(): void {
			// Identity-based removal: edits the user made DURING the generation
			// arrived after the stash was taken and must survive for the next
			// prompt.
			this.agent.userAction.removeConsumed(this.consumedDiffs)
			this.consumedDiffs = []
		}
	}
)

/**
 * Get any changed properties between two focused shapes.
 * @param from - The original shape.
 * @param to - The new shape.
 * @returns The changed properties.
 */
function getFocusedShapeChange<T extends FocusedShape['_type']>(
	from: FocusedShape & { _type: T },
	to: FocusedShape & { _type: T }
) {
	if (from._type !== to._type) {
		return null
	}

	const change: {
		from: Partial<FocusedShape>
		to: Partial<FocusedShape>
	} = {
		from: {},
		to: {},
	}

	for (const key in to) {
		const fromValue = from[key]
		const toValue = to[key]
		if (fromValue === toValue) {
			continue
		}
		;(change.from as any)[key] = fromValue
		;(change.to as any)[key] = toValue
	}
	return change
}
