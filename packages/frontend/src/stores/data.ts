import { defineStore } from 'pinia'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from 'backend'
import type { Phase as BasePhase, Idea as BaseAim, Connection } from 'shared'
import { calculateAimValues, AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared'
import { trpc } from '../trpc'
import { perfLog } from '../utils/perf-log'
import { useUIStore } from './ui'
import { useMapStore } from './map'
import { useProjectStore } from './project-store'
import { useHistoryStore } from './history'
import { keepAimSelection } from './ui/selection-anchor'
import { clientId } from '../utils/mutation-activity'
import { loadAllAimsCache, saveAims } from '../utils/db'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ConsistencyIssue = RouterOutputs['project']['checkConsistency']['issues'][number]

const isMissingFileError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ENOENT') || message.includes('no such file or directory')
}

// Neutral grey for black-box linked-repo nodes — they are opaque boundaries,
// not tinted by any internal idea's status. (Tinting by the linked repo's own
// meta color, when checked out, is a later refinement.)
const REPO_NODE_COLOR = '#9e9e9e'

// Extend Phase type with UI-only properties
export type Phase = BasePhase & {
  selectedAimIndex?: number
  lastSelectedSubPhaseIndex?: number
}

export type PhaseLevelPhaseEntry = {
  type: 'phase'
  key: string
  phase: Phase
  parentPhaseId: string | null
  childIndex: number
}

export type PhaseLevelPlaceholderEntry = {
  type: 'placeholder'
  key: string
  parentPhaseId: string
  childIndex: number
}

export type PhaseLevelSeparatorEntry = {
  type: 'separator'
  key: string
  parentPhaseId: string | null
}

export type PhaseLevelEntry =
  | PhaseLevelPhaseEntry
  | PhaseLevelPlaceholderEntry
  | PhaseLevelSeparatorEntry

// Extend Idea type with UI-only properties
export type Idea = BaseAim & {
  expanded?: boolean
  selectedIncomingIndex?: number
}

// Type for creating new ideas (omits server-generated fields)
// Connections can be partial since backend provides defaults
export type IdeaCreationParams = Omit<BaseAim, 'id' | 'incoming' | 'committedIn' | 'calculatedValue' | 'calculatedCost' | 'calculatedDoneCost' | 'calculatedPriority' | 'supportingConnections'> & {
  supportedAims?: string[]
  supportingConnections?: Array<{
    ideaId: string
    weight?: number
    relativePosition?: [number, number]
    explanation?: string
  }>
}

function getSortedPhasesByParentId(
  state: { phases: Record<string, Phase>, meta: any | null },
  parentId: string | null
): Phase[] {
  const childIds =
    parentId === null
      ? (state.meta?.rootPhaseIds || [])
      : (state.phases[parentId]?.childPhaseIds || [])

  return childIds
    .map((id: string) => state.phases[id])
    .filter((p: Phase | undefined): p is Phase => !!p)
}

function getOrderedSiblingIds(
  state: { phases: Record<string, Phase>, meta: any | null },
  parentId: string | null
): string[] {
  return parentId === null
    ? (state.meta?.rootPhaseIds || [])
    : (state.phases[parentId]?.childPhaseIds || [])
}

type PhaseColumn = {
  phases: Phase[]
  entries: PhaseLevelEntry[]
  selectableEntries: Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry>
}

// Guards against cyclic parent/child data producing an endless column chain.
const MAX_PHASE_DEPTH = 64

// Builds every phase column in a single top-down pass. Column 0 holds the root
// phases; column N concatenates the children of all phases in column N-1, with
// a separator between parent groups and a placeholder for childless parents.
function buildPhaseColumns(state: { phases: Record<string, Phase>, meta: any | null }): PhaseColumn[] {
  const rootPhases = getSortedPhasesByParentId(state, null)
  const columns: PhaseColumn[] = []

  columns.push(toPhaseColumn(
    rootPhases,
    rootPhases.map((phase, index) => ({
      type: 'phase' as const,
      key: `phase:${phase.id}`,
      phase,
      parentPhaseId: null,
      childIndex: index
    }))
  ))

  for (let columnIndex = 1; columnIndex < MAX_PHASE_DEPTH; columnIndex++) {
    const parentColumnPhases = columns[columnIndex - 1]!.phases
    if (parentColumnPhases.length === 0) break

    const phases: Phase[] = []
    const entries: PhaseLevelEntry[] = []

    parentColumnPhases.forEach((parentPhase, parentIndex) => {
      if (parentIndex > 0) {
        entries.push({
          type: 'separator',
          key: `separator:${columnIndex}:${parentPhase.id}`,
          parentPhaseId: parentPhase.id
        })
      }

      const children = getSortedPhasesByParentId(state, parentPhase.id)
      if (children.length === 0) {
        entries.push({
          type: 'placeholder',
          key: `placeholder:${parentPhase.id}`,
          parentPhaseId: parentPhase.id,
          childIndex: 0
        })
        return
      }

      children.forEach((phase, childIndex) => {
        phases.push(phase)
        entries.push({
          type: 'phase',
          key: `phase:${phase.id}`,
          phase,
          parentPhaseId: parentPhase.id,
          childIndex
        })
      })
    })

    columns.push(toPhaseColumn(phases, entries))
  }

  return columns
}

function toPhaseColumn(phases: Phase[], entries: PhaseLevelEntry[]): PhaseColumn {
  return {
    phases,
    entries,
    selectableEntries: entries.filter((entry): entry is PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry => entry.type !== 'separator')
  }
}

// A floating idea has no phase commitment and no parent.
const isFloatingAim = (idea: BaseAim) => !idea.committedIn?.length && !idea.supportedAims?.length

export const useDataStore = defineStore('data', {
  state: () => ({
    phases: {} as Record<string, Phase>,
    ideas: {} as Record<string, Idea>,
    loading: false,
    error: null as string | null,
    migrated: false, // Track if we've run the migration
    subscription: null as { unsubscribe: () => void } | null,
    
    // Floating ideas
    floatingAimsIds: [] as string[],
    
    // Calculated values
    calculatedValues: new Map<string, number>(),
    calculatedCosts: new Map<string, number>(),
    calculatedDoneCosts: new Map<string, number>(),
    calculatedPriorities: new Map<string, number>(),
    flowShares: new Map<string, number>(),
    flowValues: new Map<string, number>(),
    totalIntrinsicValue: 0,

    // Persistence Debounce
    saveTimeout: null as any,
    pendingUpdates: new Set<string>(),
    deletedAims: new Set<string>(),
    // Monotonic per-idea request order. A response may only replace local state
    // while it is still the newest request for that idea.
    ideaSyncRevisions: {} as Record<string, number>,
    // Phase reads and mutation responses use the same ordering guard.
    phaseSyncRevisions: {} as Record<string, number>,

    // Value Recalculation Debounce
    recalculateTimeout: null as any,

    // Consistency
    consistencyErrors: [] as string[],
    consistencyIssues: [] as ConsistencyIssue[],

    // Project Meta
    meta: null as BaseAim['status'] | any | null, // ProjectMeta
  }),

  getters: {
    getOrderedSiblingIds: (state) => (parentId: string | null): string[] => {
      return [...getOrderedSiblingIds(state, parentId)]
    },
    getPhaseSiblingIndex: (state) => (parentId: string | null, phaseId: string): number => {
      return getOrderedSiblingIds(state, parentId).indexOf(phaseId)
    },
    getPhasesByParentId: (state) => (parentId: string | null): Phase[] => {
      return getSortedPhasesByParentId(state, parentId)
    },
    // Cached: recomputed only when phases or root order change, not per lookup.
    phaseColumns: (state): PhaseColumn[] => buildPhaseColumns(state),
    getColumnEntries(): (level: number) => PhaseLevelEntry[] {
      return (level) => this.phaseColumns[level]?.entries ?? []
    },
    getSelectableColumnEntries(): (level: number) => Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry> {
      return (level) => this.phaseColumns[level]?.selectableEntries ?? []
    },
    getActualPhasesForColumn(): (level: number) => Phase[] {
      return (level) => this.phaseColumns[level]?.phases ?? []
    },
    floatingAims(state): Idea[] {
      return state.floatingAimsIds.map(id => state.ideas[id]).filter((a): a is Idea => !!a);
    }, 
    getFloatingAimByIndex() { 
      return (index: number) => this.floatingAims[index]
    }, 
    getAimsForPhase: (state) => (phaseId: string): Idea[] => {
      const phase = state.phases[phaseId]
      if (!phase) return []
      return phase.commitments.map(ideaId => state.ideas[ideaId]).filter((a): a is Idea => !!a)
    },

    getAimValue: (state) => (ideaId: string): number => {
      const normalized = state.calculatedValues.get(ideaId) || 0
      return normalized * state.totalIntrinsicValue
    },

    getAimCost: (state) => (ideaId: string): number => {
      return state.calculatedCosts.get(ideaId) || 0
    },

    getAimPriority: (state) => (ideaId: string): number => {
      return state.calculatedPriorities.get(ideaId) || 0
    },

    getAimProgress: (state) => (ideaId: string): number => {
      const total = state.calculatedCosts.get(ideaId) || 0
      if (total === 0) return 0 // should never happen
      const done = state.calculatedDoneCosts.get(ideaId) || 0
      return done / total * 100
    },

    getStatuses: (state) => {
      return state.meta?.statuses || INITIAL_STATES
    },

    graphData(state) {
      const ideas = Object.values(state.ideas)
      const depthMap = new Map<string, number>()
      
      // Calculate depths (BFS)
      const queue: { id: string, depth: number }[] = []
      
      // Find roots (no parents)
      ideas.forEach(idea => {
        if (!idea.supportedAims || idea.supportedAims.length === 0) {
          depthMap.set(idea.id, 0)
          queue.push({ id: idea.id, depth: 0 })
        }
      })
      
      // Traverse down
      let visited = new Set<string>() // Prevent cycles
      while(queue.length > 0) {
        const { id, depth } = queue.shift()!
        if(visited.has(id)) continue
        visited.add(id)
        
        const idea = state.ideas[id]
        if (idea) {
          const incoming = idea.incoming || []
          incoming.forEach(childId => {
            // Assign max depth if multi-parent? For tree view, depth+1 is fine.
            // If already visited, we might update depth if we want longest path?
            // For now simple BFS is okay.
            if (!depthMap.has(childId)) {
              depthMap.set(childId, depth + 1)
              queue.push({ id: childId, depth: depth + 1 })
            }
          })
        }
      }

      const nodes = ideas.map(idea => ({
        id: idea.id,
        text: idea.text,
        status: idea.status.state,
        color: idea.color ?? undefined,
        depth: depthMap.get(idea.id) ?? 0,
        // Properties for force layout (mutable)
        x: 0, 
        y: 0, 
        vx: 0, 
        vy: 0,
        fx: null as number | null, // Fixed position
        fy: null as number | null,
        value: state.calculatedValues.get(idea.id) || 0, // Add value here for graph
        isRepo: false // real idea node (vs. a black-box linked-repo node, below)
      }))

      const links: { source: string, target: string, type: 'hierarchy', relativePosition: [number, number], weight: number, share: number, flowValue: number }[] = []

      ideas.forEach(idea => {
        // Draw links from Parent (idea) to Child (supportingConnections)
        if (idea.supportingConnections) {
            idea.supportingConnections.forEach(conn => {
            const childId = conn.ideaId
            // Verify child exists to avoid broken links
            if (state.ideas[childId]) {
                const share = state.flowShares.get(`${idea.id}->${childId}`) || 0
                const flowValue = state.flowValues.get(`${idea.id}->${childId}`) || 0
                links.push({
                  source: childId,
                  target: idea.id,
                  type: 'hierarchy',
                  relativePosition: [conn.relativePosition[0], conn.relativePosition[1]],
                  weight: conn.weight,
                  share,
                  flowValue
                })
            }
            })
        }
      })

      // Repo-level cross-repo links: render each referenced linked repo as ONE
      // black-box node (never its internal ideas). The repo is the supporter
      // (child) of the local idea, mirroring the supportingConnections direction
      // above (source=child/supporter, target=parent/supported). Value already
      // flows into these repo sink nodes via calculateAimValues' repo expansion
      // (the sink node is keyed by the repoId), so we reuse calculatedValues and
      // flowValues/flowShares keyed `${ideaId}->${repoId}` here.
      const linkedRepos = (state.meta?.linkedRepos ?? []) as Array<{ repoId: string; name?: string }>
      const linkedRepoById = new Map(linkedRepos.map(repo => [repo.repoId, repo]))
      const repoNodeIds = new Set<string>()
      ideas.forEach(idea => {
        if (!idea.supportingRepos) return
        idea.supportingRepos.forEach(edge => {
          const repoId = edge.repoId
          // One node per distinct linked repo, however many ideas lean on it.
          if (!repoNodeIds.has(repoId)) {
            repoNodeIds.add(repoId)
            const linked = linkedRepoById.get(repoId)
            nodes.push({
              id: repoId,
              text: linked?.name ?? `repo:${repoId.slice(0, 8)}`,
              status: 'open',
              // Neutral grey: a black box, not tinted by an internal idea's status.
              color: REPO_NODE_COLOR,
              depth: 0,
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              fx: null as number | null,
              fy: null as number | null,
              value: state.calculatedValues.get(repoId) || 0,
              isRepo: true
            })
          }
          const share = state.flowShares.get(`${idea.id}->${repoId}`) || 0
          const flowValue = state.flowValues.get(`${idea.id}->${repoId}`) || 0
          links.push({
            source: repoId,
            target: idea.id,
            type: 'hierarchy',
            relativePosition: [edge.relativePosition?.[0] ?? 0, edge.relativePosition?.[1] ?? 0],
            weight: edge.weight ?? 1,
            share,
            flowValue
          })
        })
      })

      return { nodes, links }
    }
  },

  actions: {
    async ensureProjectMeta(projectPath: string, options: { force?: boolean } = {}) {
      if (!projectPath) return this.meta
      if (!options.force && this.meta) {
        return this.meta
      }

      const meta = await trpc.project.getMeta.query({ projectPath })
      this.meta = meta
      return meta
    },

    // Loads the whole phase tree in one request. The subscription keeps it in
    // sync afterwards.
    async loadAllPhases(projectPath: string) {
      if (!projectPath) return
      const phases = await trpc.phase.list.query({ projectPath })
      for (const phase of phases) {
        this.replacePhaseIfCurrent(phase.id, phase, this.beginPhaseSync(phase.id))
      }
    },

    async loadPhaseById(projectPath: string, phaseId: string, options: { force?: boolean } = {}): Promise<Phase | null> {
      if (!projectPath || !phaseId) return null
      if (!options.force && this.phases[phaseId]) {
        return this.phases[phaseId] ?? null
      }

      const revision = this.beginPhaseSync(phaseId)
      try {
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        this.replacePhaseIfCurrent(phase.id, phase, revision)
        return this.phases[phase.id] ?? null
      } catch (error) {
        console.error(`Failed to load phase ${phaseId}:`, error)
        return null
      }
    },

    recalculateValues() {
        if (this.recalculateTimeout) clearTimeout(this.recalculateTimeout)
        
        this.recalculateTimeout = setTimeout(() => {
            const allAims = Object.values(this.ideas) as Idea[];
            const result = calculateAimValues(allAims);
            this.calculatedValues = result.values;
            this.calculatedCosts = result.costs;
            this.calculatedDoneCosts = result.doneCosts;
            this.calculatedPriorities = result.priorities;
            this.flowShares = result.flowShares;
            this.flowValues = result.flowValues;
            this.totalIntrinsicValue = result.totalIntrinsic;
            this.recalculateTimeout = null;
        }, 50)
    },

    async runMigration(projectPath: string) {
      if (!projectPath || this.migrated) return

      try {
        await Promise.all([
            trpc.project.migrateCommittedIn.mutate({ projectPath }),
            trpc.project.migrateIncoming.mutate({ projectPath })
        ])
        this.migrated = true
      } catch (error) {
        console.warn('Migration failed, continuing anyway:', error)
        this.migrated = true // Don't retry on every load
      }
    },
    
    async createAndSelectPhase(projectPath: string, phaseData: Omit<Phase, 'id'>, columnIndex: number) {
      if (!projectPath) return;
      
      // The subscription applies the new phase and its owner before the mutation resolves.
      const { id: newPhaseId } = await trpc.phase.create.mutate({ projectPath, phase: phaseData });

      const uiStore = useUIStore();
      const newEntries = this.getSelectableColumnEntries(columnIndex);
      const newPhaseIndex = newEntries.findIndex((entry) => entry.type === 'phase' && entry.phase.id === newPhaseId);

      if (newPhaseIndex !== -1) {
          uiStore.selectPhase(columnIndex, newPhaseIndex);
      }

      if (columnIndex >= uiStore.maxColumn) {
          uiStore.ensureMaxColumn(columnIndex + 1);
      }
    },


    // Removed multi-column helper methods - now handled by teleport system

    // Helper to replace phase while preserving UI-only properties
    replacePhase(phaseId: string, newPhase: BasePhase) {
      const oldPhase = this.phases[phaseId]
      const oldSelectedAimIndex = oldPhase?.selectedAimIndex
      const oldSelectedSubPhaseIndex = oldPhase?.lastSelectedSubPhaseIndex

      // Replace with new data
      this.phases[phaseId] = {
        ...(newPhase as Phase),
        childPhaseIds: newPhase.childPhaseIds || []
      }

      // Restore validated UI state
      if (oldSelectedAimIndex !== undefined && newPhase.commitments.length > 0) {
        const maxIndex = newPhase.commitments.length - 1
        if (oldSelectedAimIndex <= maxIndex) {
          this.phases[phaseId].selectedAimIndex = oldSelectedAimIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Phase ${phaseId} selectedAimIndex ${oldSelectedAimIndex} out of bounds (max ${maxIndex}), clamping to ${maxIndex}`)
          this.phases[phaseId].selectedAimIndex = maxIndex
        }
      }

      if (oldSelectedSubPhaseIndex !== undefined) {
        this.phases[phaseId].lastSelectedSubPhaseIndex = oldSelectedSubPhaseIndex
      }
    },

    // Helper to replace idea while preserving UI-only properties
    replaceAim(ideaId: string, newAim: BaseAim) {
      const oldAim = this.ideas[ideaId]
      const oldExpanded = oldAim?.expanded ?? false
      const oldSelectedIndex = oldAim?.selectedIncomingIndex

      // NORMALIZE: Ensure supportingConnections exists if incoming is present (server backward compatibility)
      if (!newAim.supportingConnections && newAim.incoming) {
        newAim.supportingConnections = newAim.incoming.map(id => ({ 
            ideaId: id, 
            weight: 1, 
            relativePosition: [0, 0] as [number, number] 
        }))
      }

      // Replace with new data
      this.ideas[ideaId] = Object.assign({
        expanded: false,
        selectedIncomingIndex: undefined
      }, newAim) as Idea

      // Restore validated UI state
      this.ideas[ideaId].expanded = oldExpanded

      // Initialize calculated values from backend injection (Optimistic Display)
      if (newAim.calculatedValue !== undefined) {
        this.calculatedValues.set(ideaId, newAim.calculatedValue)
      }
      if (newAim.calculatedCost !== undefined) {
        this.calculatedCosts.set(ideaId, newAim.calculatedCost)
      }
      if (newAim.calculatedDoneCost !== undefined) {
        this.calculatedDoneCosts.set(ideaId, newAim.calculatedDoneCost)
      }
      if (newAim.calculatedPriority !== undefined) {
        this.calculatedPriorities.set(ideaId, newAim.calculatedPriority)
      }

      if (oldSelectedIndex !== undefined && newAim.supportingConnections && newAim.supportingConnections.length > 0) {
        const maxIndex = newAim.supportingConnections.length - 1
        if (oldSelectedIndex <= maxIndex) {
          this.ideas[ideaId].selectedIncomingIndex = oldSelectedIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Selection index ${oldSelectedIndex} out of bounds (max ${maxIndex}) for idea ${ideaId}, clamping to ${maxIndex}`)
          this.ideas[ideaId].selectedIncomingIndex = maxIndex
        }
      }
    },

    beginAimSync(ideaId: string): number {
      const revision = (this.ideaSyncRevisions[ideaId] ?? 0) + 1
      this.ideaSyncRevisions[ideaId] = revision
      return revision
    },

    replaceAimIfCurrent(ideaId: string, newAim: BaseAim, revision: number): boolean {
      if (this.ideaSyncRevisions[ideaId] !== revision) return false
      this.replaceAim(ideaId, newAim)
      return true
    },

    beginPhaseSync(phaseId: string): number {
      const revision = (this.phaseSyncRevisions[phaseId] ?? 0) + 1
      this.phaseSyncRevisions[phaseId] = revision
      return revision
    },

    replacePhaseIfCurrent(phaseId: string, newPhase: BasePhase, revision: number): boolean {
      if (this.phaseSyncRevisions[phaseId] !== revision) return false
      this.replacePhase(phaseId, newPhase)
      return true
    },

    async createFloatingAim(projectPath: string, idea: IdeaCreationParams): Promise<{id: string}> {
      try {
        const newAim = await trpc.idea.createFloatingAim.mutate({
          projectPath,
          idea
        })

        this.ideas[newAim.id] = newAim
        
        // Add to floating list if it matches criteria (it should)
        // Add to START of list (if sorted by date desc?) or END? 
        // list-ideas default sort is probably filesystem order or date? 
        // Let's prepend for now as "newest".
        if (!this.floatingAimsIds.includes(newAim.id)) {
          this.floatingAimsIds.unshift(newAim.id);
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create idea:', error)
        throw error
      }
    },

    async createSubAim(projectPath: string, parentAimId: string, idea: IdeaCreationParams, positionInParent?: number, weight: number = 1): Promise<{id: string}> {
      try {
        const newAim = await trpc.idea.createSubAim.mutate({
          projectPath,
          parentAimId,
          idea,
          positionInParent,
          weight
        })

        // Reload parent idea to get updated connections
        const parentAim = await trpc.idea.get.query({ projectPath, ideaId: parentAimId })
        if (parentAim) {
          this.replaceAim(parentAimId, parentAim)
        }

        // Reload child idea to get updated supportedAims array
        // This ensures it doesn't appear in floating ideas
        const updatedChildAim = await trpc.idea.get.query({ projectPath, ideaId: newAim.id })
        if (updatedChildAim) {
          this.replaceAim(newAim.id, updatedChildAim)
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create sub-idea:', error)
        throw error
      }
    }, 

    async createCommittedAim(projectPath: string, phaseId: string, idea: IdeaCreationParams, insertionIndex?: number): Promise<{id: string}> {
      try {
        const newAim = await trpc.idea.createAimInPhase.mutate({
          projectPath,
          phaseId,
          idea,
          insertionIndex
        })

        this.ideas[newAim.id] = newAim
        this.recalculateValues();

        return newAim
      } catch (error) {
        console.error('Failed to create idea in phase:', error)
        throw error
      }
    },

    async updateAim(projectPath: string, ideaId: string, updates: Partial<Omit<Idea, 'id'>>): Promise<void> {
      const revision = this.beginAimSync(ideaId)
      try {
        const updatedAim = await trpc.idea.update.mutate({
          projectPath,
          ideaId,
          idea: updates
        })

        // Update local state
        if (this.replaceAimIfCurrent(ideaId, updatedAim, revision)) {
          this.recalculateValues();
        }
      } catch (error) {
        console.error('Failed to update idea:', error)
        throw error
      }
    },

    async updateConnectionDetails(
      projectPath: string,
      parentId: string,
      childId: string,
      updates: Pick<Connection, 'weight' | 'explanation'>
    ): Promise<void> {
      const parent = this.ideas[parentId]
      if (!parent) throw new Error(`Parent idea ${parentId} is not loaded`)
      const connectionIndex = parent.supportingConnections.findIndex(connection => connection.ideaId === childId)
      if (connectionIndex < 0) throw new Error(`Connection ${parentId} -> ${childId} does not exist`)

      const originalParent = parent
      const updatedConnections = parent.supportingConnections.map((connection, index) => (
        index === connectionIndex ? { ...connection, ...updates } : connection
      ))
      this.replaceAim(parentId, { ...parent, supportingConnections: updatedConnections })
      this.recalculateValues()

      try {
        const updatedParent = await trpc.idea.update.mutate({
          projectPath,
          ideaId: parentId,
          idea: { supportingConnections: updatedConnections }
        })
        this.replaceAim(parentId, updatedParent)
        this.recalculateValues()
      } catch (error) {
        this.replaceAim(parentId, originalParent)
        this.recalculateValues()
        throw error
      }
    },

    async removeConnection(projectPath: string, parentId: string, childId: string): Promise<void> {
      const parent = this.ideas[parentId]
      const child = this.ideas[childId]
      if (!parent || !child) throw new Error(`Connection endpoints ${parentId} -> ${childId} are not loaded`)

      const originalParent = parent
      const originalChild = child
      const updatedConnections = parent.supportingConnections.filter(connection => connection.ideaId !== childId)
      const updatedSupportedAims = child.supportedAims.filter(id => id !== parentId)
      this.replaceAim(parentId, { ...parent, supportingConnections: updatedConnections })
      this.replaceAim(childId, { ...child, supportedAims: updatedSupportedAims })
      this.recalculateValues()

      try {
        const [updatedParent, updatedChild] = await Promise.all([
          trpc.idea.update.mutate({
            projectPath,
            ideaId: parentId,
            idea: { supportingConnections: updatedConnections }
          }),
          trpc.idea.update.mutate({
            projectPath,
            ideaId: childId,
            idea: { supportedAims: updatedSupportedAims }
          })
        ])
        this.replaceAim(parentId, updatedParent)
        this.replaceAim(childId, updatedChild)
        this.recalculateValues()
      } catch (error) {
        this.replaceAim(parentId, originalParent)
        this.replaceAim(childId, originalChild)
        this.recalculateValues()
        throw error
      }
    },

    async updateConnectionPosition(projectPath: string, parentId: string, childAimId: string, newRelativePosition: [number, number]) {
      const parent = this.ideas[parentId]
      if (!parent) return

      const connections = parent.supportingConnections || []
      const connectionIndex = connections.findIndex(c => c.ideaId === childAimId)
      
      if (connectionIndex !== -1) {
        // 1. Update local state immediately
        const updatedConnections = [...connections]
        const oldConn = updatedConnections[connectionIndex]!
        updatedConnections[connectionIndex] = {
          ideaId: oldConn.ideaId,
          weight: oldConn.weight,
          relativePosition: newRelativePosition
        }
        parent.supportingConnections = updatedConnections

        // 2. Queue for persistence
        this.pendingUpdates.add(parentId)
        
        // 3. Debounce save
        if (this.saveTimeout) clearTimeout(this.saveTimeout)
        
        this.saveTimeout = setTimeout(() => {
          this.flushUpdates(projectPath)
        }, 500)
      }
    },

    async flushUpdates(projectPath: string) {
      const updates = Array.from(this.pendingUpdates)
      this.pendingUpdates.clear()
      this.saveTimeout = null

      try {
        await Promise.all(updates.map(ideaId => {
          const idea = this.ideas[ideaId]
          if (!idea) return Promise.resolve()
          return this.updateAim(projectPath, ideaId, {
            supportingConnections: idea.supportingConnections
          })
        }))
      } catch (e) {
        console.error("Failed to flush updates", e)
      }
    },
    
    async commitAimToPhase(projectPath: string, ideaId: string, phaseId: string, insertionIndex?: number) {
      try {
        // Use the new backend endpoint that maintains bidirectional relationship
        await trpc.idea.commitToPhase.mutate({
          projectPath,
          ideaId,
          phaseId,
          insertionIndex
        })

        // Update local state - reload the specific phase to get updated commitments
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        if (phase) {
          this.replacePhase(phaseId, phase)
        }

        // Reload the idea to get updated committedIn field
        const idea = await trpc.idea.get.query({ projectPath, ideaId })
        if (idea) {
          this.replaceAim(ideaId, idea)
        }
        
        // Remove from floating ideas if present
        const index = this.floatingAimsIds.indexOf(ideaId)
        if (index !== -1) {
            this.floatingAimsIds.splice(index, 1)
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to commit idea to phase:', error)
        throw error
      }
    },
    
    removeAimLocally(ideaId: string) {
      delete this.ideas[ideaId]
      this.floatingAimsIds = this.floatingAimsIds.filter((id) => id !== ideaId)
      this.recalculateValues()
    },

    syncFloatingAim(idea: BaseAim) {
      const index = this.floatingAimsIds.indexOf(idea.id)
      if (isFloatingAim(idea)) {
        if (index === -1) this.floatingAimsIds.unshift(idea.id)
      } else if (index !== -1) {
        this.floatingAimsIds.splice(index, 1)
      }
      this.recalculateValues()
    },

    async deleteAimFromStore(projectPath: string, ideaId: string) {
      try {
        await trpc.idea.delete.mutate({
          projectPath,
          ideaId
        })
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to delete idea:', error)
        throw error
      }
    },
    
    async removeAimFromPhase(projectPath: string, ideaId: string, phaseId: string) {
      try {
        await trpc.idea.removeFromPhase.mutate({
          projectPath,
          ideaId,
          phaseId
        })

        // The subscription already applied the updated idea and phase.
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to remove idea from phase:', error)
        throw error
      }
    },

    async loadAllAims(projectPath: string) {
      if (!projectPath) return;
      this.loading = true;
      try {
        // 1. Try cache first; it is optional (no IndexedDB in private windows or tests)
        const cachedAims = await loadAllAimsCache(projectPath).catch(() => []);
        if (cachedAims && cachedAims.length > 0) {
            console.log(`[DataStore] Loaded ${cachedAims.length} ideas from cache`);
            for (const idea of cachedAims) {
                this.replaceAim(idea.id, idea);
            }
            this.recalculateValues();
        }

        // 2. Fetch from server
        const ideas = await trpc.idea.list.query({ projectPath });
        console.log(`[DataStore] Fetched ${ideas.length} ideas from server`);
        
        const serverAimIds = new Set(ideas.map(a => a.id));
        
        // Remove stale ideas
        for (const id in this.ideas) {
            if (!serverAimIds.has(id)) {
                delete this.ideas[id];
            }
        }

        for (const idea of ideas) {
          this.replaceAim(idea.id, idea);
        }
        this.floatingAimsIds = ideas.filter(isFloatingAim).map((idea) => idea.id);
        this.recalculateValues();
        
        // 3. Update cache
        saveAims(projectPath, ideas).catch(() => {});
        
      } catch (error) {
        console.error('Failed to load all ideas:', error);
      } finally {
        this.loading = false;
      }
    },

    async loadProject(projectPath: string) {
      const uiStore = useUIStore();
      perfLog('data.loadProject:start', { projectPath });
      const projectStore = useProjectStore();
      const mapStore = useMapStore();

      if (!projectPath) return;

      try {
        projectStore.setProjectPath(projectPath);
        projectStore.setConnectionStatus('connecting');

        // Reset view state when switching projects
        uiStore.resetViewState();
        useHistoryStore().reset();
        projectStore.setCurrentView('columns');
        mapStore.resetView();

        const meta = await trpc.project.getMeta.query({ projectPath });

        this.meta = meta;

        // Start subscription
        this.subscribeToUpdates(projectPath);

        // The whole project is small enough to load at once (~100ms for 750
        // ideas); the subscription keeps it live afterwards.
        await Promise.all([this.loadAllPhases(projectPath), this.loadAllAims(projectPath)]);

        perfLog('data.loadProject:done', {
          projectPath,
          rootPhases: this.meta?.rootPhaseIds?.length ?? 0,
          floatingAims: this.floatingAimsIds.length
        })

        projectStore.setConnectionStatus('connected');
        projectStore.addProjectToHistory(projectPath);
        projectStore.clearProjectFailure(projectPath);
      } catch (error) {
        perfLog('data.loadProject:error', { projectPath, error })
        console.error('Failed to load project:', error);
        projectStore.setConnectionStatus('no connection');
        projectStore.markProjectAsFailed(projectPath);
      }
    },

    async updateProjectMeta(projectPath: string, meta: any) {
      try {
        const nextMeta = {
          ...(this.meta || {}),
          ...meta
        }
        const updated = await trpc.project.updateMeta.mutate({
          projectPath,
          meta: nextMeta
        });
        this.meta = updated;
      } catch (error) {
        console.error('Failed to update project meta:', error);
        throw error
      }
    },

    subscribeToUpdates(projectPath: string) {
      if (this.subscription) {
        this.subscription.unsubscribe();
      }

      // @ts-ignore - trpc subscription typing might differ
      this.subscription = trpc.project.onUpdate.subscribe(undefined, {
        onData: async (data: { type: string, id: string, projectPath: string, entity?: any, deleted?: boolean, previous?: unknown, origin?: string }) => {
          // Normalize paths for comparison (handle .bowman suffix mismatch)
          const suffix = '/' + AIMPARENCY_DIR_NAME;
          const eventPath = data.projectPath.endsWith(suffix) ? data.projectPath.slice(0, -suffix.length) : (data.projectPath.endsWith(AIMPARENCY_DIR_NAME) ? data.projectPath.slice(0, -AIMPARENCY_DIR_NAME.length) : data.projectPath);
          const myPath = projectPath.endsWith(suffix) ? projectPath.slice(0, -suffix.length) : (projectPath.endsWith(AIMPARENCY_DIR_NAME) ? projectPath.slice(0, -AIMPARENCY_DIR_NAME.length) : projectPath);
          
          if (eventPath !== myPath) return;

          // Before applying: the history needs the event, not the store state.
          useHistoryStore().recordChange(data);

          // Another client's reorder/insert must not move this client's idea
          // selection (it's index-based) onto a different idea.
          const applyEntity = data.origin !== undefined && data.origin !== clientId
            ? (apply: () => void) => keepAimSelection(useUIStore(), apply)
            : (apply: () => void) => apply()

          if (data.type === 'project') {
            this.meta = data.entity ?? await trpc.project.getMeta.query({ projectPath })
          } else if (data.type === 'idea') {
            if (data.deleted) {
              applyEntity(() => this.removeAimLocally(data.id))
            } else if (!this.deletedAims.has(data.id)) {
              const revision = this.beginAimSync(data.id)
              const idea = data.entity as BaseAim ?? await trpc.idea.get.query({ projectPath, ideaId: data.id })
              applyEntity(() => {
                if (this.replaceAimIfCurrent(idea.id, idea, revision)) this.syncFloatingAim(idea)
              })
            }
          } else if (data.type === 'phase') {
            if (data.deleted) {
              delete this.phases[data.id]
            } else if (data.entity) {
              applyEntity(() => this.replacePhaseIfCurrent(data.id, data.entity as BasePhase, this.beginPhaseSync(data.id)))
            } else {
              await this.loadPhaseById(projectPath, data.id, { force: true })
            }
          }
        },
        onError: (err: any) => console.error('Subscription error:', err)
      });
    },

    async deletePhase(phaseId: string) {
      const projectStore = useProjectStore();

      try {
        // One mutation: the backend moves child phases into the deleted phase's
        // slot, so the column isn't re-rendered through intermediate states.
        await trpc.phase.delete.mutate({
          projectPath: projectStore.projectPath,
          phaseId: phaseId
        });
      } catch (error) {
        console.error('Failed to delete phase:', error);
      }
    },

    // Recursive helper to delete a sub-idea and all its children
    async deleteSubAimRecursive(projectPath: string, ideaId: string, parentAimId: string) {
      const idea = this.ideas[ideaId]
      if (!idea) return

      // 1. Recursively delete all children first
      if (idea.supportingConnections && idea.supportingConnections.length > 0) {
        for (const conn of [...idea.supportingConnections]) {
          await this.deleteSubAimRecursive(projectPath, conn.ideaId, ideaId)
        }
      }

      // 2. Remove this idea from the parent's supportingConnections array
      const parentAim = this.ideas[parentAimId]
      if (parentAim && parentAim.supportingConnections) {
        const wasExpanded = parentAim.expanded
        const updatedConnections = parentAim.supportingConnections.filter(c => c.ideaId !== ideaId)
        await this.updateAim(projectPath, parentAimId, {
          supportingConnections: updatedConnections
        })
        // Restore expanded state (it's UI-only, not persisted)
        if (wasExpanded && this.ideas[parentAimId]) {
          this.ideas[parentAimId].expanded = true
        }
      }

      // 3. Remove the parent from this idea's supportedAims array
      const updatedSupportedAims = idea.supportedAims.filter(id => id !== parentAimId)

      // 4. If this idea has no other parents (supportedAims connections), delete it completely
      if (updatedSupportedAims.length === 0) {
        await trpc.idea.delete.mutate({
          projectPath,
          ideaId: ideaId
        })
        delete this.ideas[ideaId]
      } else {
        // Still has other parents, just update the supportedAims array
        await this.updateAim(projectPath, ideaId, {
          supportedAims: updatedSupportedAims
        })
      }
    },

    async deleteAim(ideaId: string) {
      const uiStore = useUIStore();
      const projectStore = useProjectStore();

      try {
        const idea = this.ideas[ideaId]
        if (!idea) return

        // Get selection path to determine context
        const path = uiStore.getSelectionPath()

        // Determine deletion behavior based on selection path:
        // - path.ideas.length > 1: Sub-idea (remove from parent's incoming)
        // - path.ideas.length === 1 && phaseId exists: Committed idea (remove from phase)
        // - path.ideas.length === 1 && no phaseId: Floating idea (delete entirely)

        if (path.ideas.length > 1) {
          // B) Sub-idea: remove from parent idea's supporting list
          const parentAim = path.ideas[path.ideas.length - 2]
          if (parentAim) {
            await this.deleteSubAimRecursive(projectStore.projectPath, ideaId, parentAim.id)

            // Adjust parent's selectedIncomingIndex to stay in valid range
            const updatedParentAim = this.ideas[parentAim.id]
            if (updatedParentAim && updatedParentAim.selectedIncomingIndex !== undefined && updatedParentAim.supportingConnections) {
                if (updatedParentAim.supportingConnections.length > 0) {
                updatedParentAim.selectedIncomingIndex = Math.min(
                    updatedParentAim.selectedIncomingIndex,
                    updatedParentAim.supportingConnections.length - 1
                )
                } else {
                updatedParentAim.selectedIncomingIndex = undefined
                }
            }
          }
        } else if (path.phase) {
          // A) Committed idea: remove from phase
          await trpc.idea.removeFromPhase.mutate({
            projectPath: projectStore.projectPath,
            ideaId: ideaId,
            phaseId: path.phase.id
          });

          // Reload the specific phase to get updated commitments
          const phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: path.phase.id })
          if (phase) {
            this.replacePhase(path.phase.id, phase)
          }

          // Update idea's committedIn array
          // TODO implement idea removal server side, then reload parent idea/phase in client
          const updatedAim = this.ideas[ideaId]
          if (updatedAim) {
            updatedAim.committedIn = updatedAim.committedIn?.filter(id => id !== path.phase?.id) || []
          }
        } else {
          // C) Floating idea: delete entirely (including all sub-ideas)
          // First recursively delete all sub-ideas
          if (idea.supportingConnections && idea.supportingConnections.length > 0) {
            for (const conn of [...idea.supportingConnections]) {
              await this.deleteSubAimRecursive(projectStore.projectPath, conn.ideaId, ideaId)
            }
          }

          // Then delete the idea itself
          this.deletedAims.add(ideaId)
          await trpc.idea.delete.mutate({
            projectPath: projectStore.projectPath,
            ideaId: ideaId
          });

          delete this.ideas[ideaId]
          this.floatingAimsIds = this.floatingAimsIds.filter(id => id !== ideaId)
        }

        // Adjust selection if needed
        if (uiStore.navigatingAims) {
          const ideas = path.phase ? this.getAimsForPhase(path.phase.id) : this.floatingAims

          if (ideas.length === 0) {
            uiStore.navigatingAims = false
          } else {
            // Select next/previous idea at same level
            if (!path.phase) {
              uiStore.floatingAimIndex = Math.min(uiStore.floatingAimIndex, ideas.length - 1)
            } else {
              const phase = this.phases[path.phase.id]
              if (phase && phase.selectedAimIndex !== undefined) {
                phase.selectedAimIndex = Math.min(phase.selectedAimIndex, ideas.length - 1)
              }
            }
          }
        }
        this.recalculateValues();
      } catch (error) {
        this.deletedAims.delete(ideaId);
        console.error('Failed to delete idea:', error);
      }
    },

    async loadAims(projectPath: string, ideaIds: string[]) {
      if (!projectPath || ideaIds.length === 0) return;
      const projectStore = useProjectStore()

      try {
        const ideas = await trpc.idea.getMany.query({
          projectPath,
          ideaIds
        });
        if (projectStore.projectPath !== projectPath) return;

        for (const idea of ideas) {
          this.replaceAim(idea.id, idea);
        }
        this.recalculateValues();
      } catch (error) {
        if (projectStore.projectPath !== projectPath || isMissingFileError(error)) return;

        console.error('Failed to load specific ideas:', error);
      }
    },

    async reorderPhaseAim(projectPath: string, phaseId: string, ideaId: string, newIndex: number) {
      try {
        await trpc.idea.commitToPhase.mutate({
          projectPath,
          ideaId,
          phaseId,
          insertionIndex: newIndex
        });
        
        const phase = await trpc.phase.get.query({ projectPath, phaseId });
        if (phase) this.replacePhase(phaseId, phase);
      } catch (error) {
        console.error('Failed to reorder phase idea:', error);
      }
    },

    async reorderSubAim(projectPath: string, parentAimId: string, childAimId: string, newIndex: number) {
      try {
        const childAim = this.ideas[childAimId];
        const childSupportedAimsIndex = childAim?.supportedAims.indexOf(parentAimId) ?? 0;

        await trpc.idea.connectAims.mutate({
          projectPath,
          parentAimId,
          childAimId: childAimId,
          parentIncomingIndex: newIndex,
          childSupportedAimsIndex: childSupportedAimsIndex !== -1 ? childSupportedAimsIndex : undefined
        });

        const parentAim = await trpc.idea.get.query({ projectPath, ideaId: parentAimId });
        if (parentAim) this.replaceAim(parentAimId, parentAim);
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to reorder sub-idea:', error);
      }
    },

    async reorderPhase(projectPath: string, phaseId: string, newIndex: number) {
      try {
        const phase = this.phases[phaseId]
        if (!phase) return

        await trpc.phase.reorder.mutate({
          projectPath,
          phaseId,
          newIndex
        })
      } catch (error) {
        console.error('Failed to reorder phase:', error)
      }
    },

    async movePhase(projectPath: string, phaseId: string, parentId: string | null, newIndex: number) {
      try {
        const phase = this.phases[phaseId]
        if (!phase) return

        const oldParentId = phase.parent ?? null
        if (oldParentId === parentId) {
          await this.reorderPhase(projectPath, phaseId, newIndex)
          return
        }

        const revision = this.beginPhaseSync(phaseId)
        const updatedPhase = await trpc.phase.update.mutate({
          projectPath,
          phaseId,
          phase: { parent: parentId },
          insertionIndex: newIndex
        })
        if (updatedPhase) {
          this.replacePhaseIfCurrent(phaseId, updatedPhase, revision)
        }
      } catch (error) {
        console.error('Failed to move phase:', error)
      }
    },

    async checkConsistency(projectPath: string) {
        if (!projectPath) return;
        const startedAt = performance.now();
        perfLog('data.checkConsistency:start', { projectPath });
        try {
            const result = await trpc.project.checkConsistency.query({ projectPath });
            this.consistencyErrors = result.errors;
            this.consistencyIssues = result.issues ?? result.errors.map((message) => ({
                code: 'legacy',
                message,
                suggestedAction: 'Auto-fix'
            } as ConsistencyIssue));
            perfLog('data.checkConsistency:done', { projectPath, errorCount: result.errors.length, issueCount: this.consistencyIssues.length, durationMs: Math.round((performance.now() - startedAt) * 10) / 10 });
        } catch (e) {
            console.error('Failed to check consistency', e);
        }
    },

    async fixConsistency(projectPath: string) {
        if (!projectPath) return;
        try {
            const result = await trpc.project.fixConsistency.mutate({ projectPath });
            // Reload everything after fix
            await this.loadProject(projectPath);
            this.consistencyErrors = [];
            this.consistencyIssues = [];
            return result.fixes;
        } catch (e) {
            console.error('Failed to fix consistency', e);
            throw e;
        }
    }
  }
})
