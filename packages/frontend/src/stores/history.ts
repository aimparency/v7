import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { trpc } from '../trpc'
import { clientId, mutationActivity } from '../utils/mutation-activity'
import { useDataStore } from './data'
import { useProjectStore } from './project-store'
import { useUIStore } from './ui'
import { applySelectionAnchor, captureSelectionAnchor, type SelectionAnchor } from './ui/selection-anchor'

// Undo/redo over entity snapshots.
//
// The backend tags every change event with the raw `previous` file content and
// the `origin` client. One user action (all mutations started after one user
// input, until they settle) becomes one entry: per touched entity the first
// `previous` and the last written state. Undo asks the backend to write the
// `before` states back, but only if every entity still equals its `after` state
// (compare-and-swap). If another client changed one of them in the meantime,
// nothing is written and the entry stays, so it can't clobber their edit.
//
// Each entry also remembers the selection (by identity) right before and right
// after the action, so undo/redo put the selection back where it belongs, e.g.
// a moved aim stays selected when its move is undone.

type EntityType = 'aim' | 'phase' | 'project'

type EntityChange = {
  type: EntityType
  id: string
  before: unknown
  after: unknown
}

type HistoryEntry = {
  changes: EntityChange[]
  // A change arrived without its prior state: undoing the rest would leave a
  // half-reverted action, so the entry acts as a barrier instead.
  incomplete: boolean
  selectionBefore: SelectionAnchor | null
  selectionAfter: SelectionAnchor | null
}

export type ChangeEvent = {
  type: string
  id: string
  entity?: unknown
  deleted?: boolean
  previous?: unknown
  origin?: string
}

const RESTORE_PATH = 'history.restore'
const MESSAGE_MS = 4000

// Recording bookkeeping; deliberately not reactive.
let inputEpoch = 0
let groupEpoch = -1
let mutationsInFlight = 0
let restoring = false
type OpenGroup = {
  changes: Map<string, EntityChange>
  incomplete: boolean
  selectionBefore: SelectionAnchor | null
  selectionAfter: SelectionAnchor | null
}
let openGroup: OpenGroup | null = null
// Selection at the latest user input, i.e. before whatever that input triggers.
let selectionAtInput: SelectionAnchor | null = null
let messageTimer: ReturnType<typeof setTimeout> | undefined
let installed = false

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left).filter((key) => (left as any)[key] !== undefined)
  const rightKeys = Object.keys(right).filter((key) => (right as any)[key] !== undefined)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => isSameValue((left as any)[key], (right as any)[key]))
}

function isTrackedType(type: string): type is EntityType {
  return type === 'aim' || type === 'phase' || type === 'project'
}

export const useHistoryStore = defineStore('history', {
  state: () => ({
    undoStack: [] as HistoryEntry[],
    redoStack: [] as HistoryEntry[],
    message: null as string | null
  }),

  actions: {
    install() {
      if (installed) return
      installed = true
      // Capture phase: runs before the handlers that act on this input.
      const markInput = () => {
        const selection = captureSelectionAnchor(useUIStore())
        // The first input after an action settled sees its resulting selection.
        if (openGroup && mutationsInFlight === 0 && !openGroup.selectionAfter) openGroup.selectionAfter = selection
        selectionAtInput = selection
        inputEpoch++
      }
      window.addEventListener('keydown', markInput, { capture: true })
      window.addEventListener('pointerdown', markInput, { capture: true })

      mutationActivity.onStart = (path) => {
        if (path === RESTORE_PATH) return
        // A new action starts with the first mutation after a user input while
        // nothing is pending; follow-up mutations of that action join its group.
        if (mutationsInFlight === 0 && groupEpoch !== inputEpoch) {
          useHistoryStore().closeGroup()
          openGroup = { changes: new Map(), incomplete: false, selectionBefore: selectionAtInput, selectionAfter: null }
          groupEpoch = inputEpoch
        }
        mutationsInFlight++
      }
      mutationActivity.onEnd = (path) => {
        if (path === RESTORE_PATH) return
        mutationsInFlight = Math.max(0, mutationsInFlight - 1)
      }
    },

    reset() {
      openGroup = null
      this.undoStack = []
      this.redoStack = []
    },

    recordChange(event: ChangeEvent) {
      if (restoring || !openGroup || event.origin !== clientId || !isTrackedType(event.type)) return

      const after = event.deleted ? null : event.entity
      if (event.previous === undefined || after === undefined) openGroup.incomplete = true

      const key = `${event.type}:${event.id}`
      const existing = openGroup.changes.get(key)
      if (existing) {
        existing.after = after ?? null
      } else {
        openGroup.changes.set(key, { type: event.type, id: event.id, before: event.previous ?? null, after: after ?? null })
      }
    },

    closeGroup() {
      if (!openGroup) return
      const changes = [...openGroup.changes.values()].filter((change) => !isSameValue(change.before, change.after))
      if (changes.length > 0) {
        this.undoStack.push(markRaw({
          changes,
          incomplete: openGroup.incomplete,
          selectionBefore: openGroup.selectionBefore,
          selectionAfter: openGroup.selectionAfter ?? captureSelectionAnchor(useUIStore())
        }))
        this.redoStack = []
      }
      openGroup = null
    },

    async undo() {
      await this.travel('undo')
    },

    async redo() {
      await this.travel('redo')
    },

    async travel(direction: 'undo' | 'redo') {
      this.closeGroup()
      if (mutationsInFlight > 0) {
        this.showMessage('Still saving — try again in a moment')
        return
      }

      const from = direction === 'undo' ? this.undoStack : this.redoStack
      const to = direction === 'undo' ? this.redoStack : this.undoStack
      const entry = from[from.length - 1]
      if (!entry) {
        this.showMessage(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo')
        return
      }
      if (entry.incomplete) {
        this.showMessage(`Can't ${direction} ${this.describe(entry)}: it wasn't fully recorded`)
        return
      }

      const changes = entry.changes.map((change) => ({
        type: change.type,
        id: change.id,
        expected: direction === 'undo' ? change.after : change.before,
        target: direction === 'undo' ? change.before : change.after
      }))

      const dataStore = useDataStore()
      // Aims deleted by this client are filtered from pushes; let restored ones back in.
      for (const change of changes) {
        if (change.type === 'aim' && change.target !== null) dataStore.deletedAims.delete(change.id)
      }

      restoring = true
      let result
      try {
        result = await trpc.history.restore.mutate({
          projectPath: useProjectStore().projectPath,
          changes
        })
      } catch (error: any) {
        this.showMessage(`${direction === 'undo' ? 'Undo' : 'Redo'} failed: ${error?.message ?? error}`)
        return
      } finally {
        restoring = false
      }

      if (!result.ok) {
        const names = result.conflicts.map((conflict) => this.describeEntity(conflict.type, conflict.id)).join(', ')
        this.showMessage(`Can't ${direction}: ${names} changed since (another client?)`)
        return
      }

      from.pop()
      to.push(entry)
      const selection = direction === 'undo' ? entry.selectionBefore : entry.selectionAfter
      if (selection) await applySelectionAnchor(useUIStore(), selection)
      this.showMessage(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${this.describe(entry)}`)
    },

    describeEntity(type: string, id: string, snapshot?: unknown): string {
      const dataStore = useDataStore()
      const value = (snapshot ?? (type === 'aim' ? dataStore.aims[id] : dataStore.phases[id])) as any
      if (type === 'aim') return `aim "${value?.text ?? id.slice(0, 8)}"`
      if (type === 'phase') return `phase "${value?.name ?? id.slice(0, 8)}"`
      return 'project settings'
    },

    describe(entry: HistoryEntry): string {
      // Name the entity that appeared or disappeared if there is one, else the first.
      const primary = entry.changes.find((change) => change.before === null || change.after === null) ?? entry.changes[0]!
      const name = this.describeEntity(primary.type, primary.id, primary.after ?? primary.before)
      const others = entry.changes.length - 1
      return others > 0 ? `${name} (+${others} more)` : name
    },

    showMessage(message: string) {
      this.message = message
      if (messageTimer) clearTimeout(messageTimer)
      messageTimer = setTimeout(() => { this.message = null }, MESSAGE_MS)
    }
  }
})
