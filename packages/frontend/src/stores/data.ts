import { defineStore } from 'pinia'
import type { Phase as BasePhase, Aim as BaseAim } from 'shared'
import { calculateAimValues, AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared'
import { trpc } from '../trpc'
import { useUIStore } from './ui'
import { useMapStore } from './map'
import { useProjectStore } from './project-store'
import { loadAllAimsCache, saveAims } from '../utils/db'

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

// Extend Aim type with UI-only properties
export type Aim = BaseAim & {
  expanded?: boolean
  selectedIncomingIndex?: number
}

// Type for creating new aims (omits server-generated fields)
// Connections can be partial since backend provides defaults
export type AimCreationParams = Omit<BaseAim, 'id' | 'incoming' | 'committedIn' | 'calculatedValue' | 'calculatedCost' | 'calculatedDoneCost' | 'calculatedPriority' | 'supportingConnections'> & {
  supportedAims?: string[]
  supportingConnections?: Array<{
    aimId: string
    weight?: number
    relativePosition?: [number, number]
    explanation?: string
  }>
}

function getSortedPhasesByParentId(state: { childrenByParentId: Record<string, string[]>, phases: Record<string, Phase> }, parentId: string | null): Phase[] {
  const key = parentId ?? 'null'
  const childIds = state.childrenByParentId[key] || []
  return childIds
    .map(id => state.phases[id])
    .filter((p): p is Phase => !!p)
}

function getActualPhasesForColumn(state: { childrenByParentId: Record<string, string[]>, phases: Record<string, Phase> }, columnIndex: number): Phase[] {
  if (columnIndex === 0) {
    return getSortedPhasesByParentId(state, null)
  }

  const parentColumnPhases = getActualPhasesForColumn(state, columnIndex - 1)
  const phases: Phase[] = []

  for (const parentPhase of parentColumnPhases) {
    phases.push(...getSortedPhasesByParentId(state, parentPhase.id))
  }

  return phases
}

function buildColumnEntries(state: { childrenByParentId: Record<string, string[]>, phases: Record<string, Phase> }, columnIndex: number): PhaseLevelEntry[] {
  if (columnIndex === 0) {
    return getActualPhasesForColumn(state, 0).map((phase, index) => ({
      type: 'phase' as const,
      key: `phase:${phase.id}`,
      phase,
      parentPhaseId: null,
      childIndex: index
    }))
  }

  const parentColumnPhases = getActualPhasesForColumn(state, columnIndex - 1)
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
      entries.push({
        type: 'phase',
        key: `phase:${phase.id}`,
        phase,
        parentPhaseId: parentPhase.id,
        childIndex
      })
    })
  })

  return entries
}

export const useDataStore = defineStore('data', {
  state: () => ({
    phases: {} as Record<string, Phase>,
    aims: {} as Record<string, Aim>,
    childrenByParentId: {} as Record<string, string[]>,
    loadedPhaseChildrenByParentId: {} as Record<string, boolean>,
    phaseChildrenLoadPromises: {} as Record<string, Promise<Phase[]>>,
    loading: false,
    error: null as string | null,
    migrated: false, // Track if we've run the migration
    subscription: null as { unsubscribe: () => void } | null,
    
    // Floating aims
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

    // Value Recalculation Debounce
    recalculateTimeout: null as any,

    // Consistency
    consistencyErrors: [] as string[],

    // Project Meta
    meta: null as BaseAim['status'] | any | null, // ProjectMeta
  }),

  getters: {
    getPhasesByParentId: (state) => (parentId: string | null): Phase[] => {
      return getSortedPhasesByParentId(state, parentId)
    },
    getColumnEntries: (state) => (level: number): PhaseLevelEntry[] => {
      return buildColumnEntries(state, level)
    },
    getSelectableColumnEntries: (state) => (level: number): Array<PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry> => {
      return buildColumnEntries(state, level).filter((entry): entry is PhaseLevelPhaseEntry | PhaseLevelPlaceholderEntry => entry.type !== 'separator')
    },
    getActualPhasesForColumn: (state) => (level: number): Phase[] => {
      return getActualPhasesForColumn(state, level)
    },
    floatingAims(state): Aim[] {
      return state.floatingAimsIds.map(id => state.aims[id]).filter((a): a is Aim => !!a);
    }, 
    getFloatingAimByIndex() { 
      return (index: number) => this.floatingAims[index]
    }, 
    getAimsForPhase: (state) => (phaseId: string): Aim[] => {
      const phase = state.phases[phaseId]
      if (!phase) return []
      return phase.commitments.map(aimId => state.aims[aimId]).filter((a): a is Aim => !!a)
    },

    getAimValue: (state) => (aimId: string): number => {
      const normalized = state.calculatedValues.get(aimId) || 0
      return normalized * state.totalIntrinsicValue
    },

    getAimCost: (state) => (aimId: string): number => {
      return state.calculatedCosts.get(aimId) || 0
    },

    getAimPriority: (state) => (aimId: string): number => {
      return state.calculatedPriorities.get(aimId) || 0
    },

    getAimProgress: (state) => (aimId: string): number => {
      const total = state.calculatedCosts.get(aimId) || 0
      if (total === 0) return 0 // should never happen
      const done = state.calculatedDoneCosts.get(aimId) || 0
      return done / total * 100
    },

    getStatuses: (state) => {
      return state.meta?.statuses || INITIAL_STATES
    },

    graphData(state) {
      const aims = Object.values(state.aims)
      const depthMap = new Map<string, number>()
      
      // Calculate depths (BFS)
      const queue: { id: string, depth: number }[] = []
      
      // Find roots (no parents)
      aims.forEach(aim => {
        if (!aim.supportedAims || aim.supportedAims.length === 0) {
          depthMap.set(aim.id, 0)
          queue.push({ id: aim.id, depth: 0 })
        }
      })
      
      // Traverse down
      let visited = new Set<string>() // Prevent cycles
      while(queue.length > 0) {
        const { id, depth } = queue.shift()!
        if(visited.has(id)) continue
        visited.add(id)
        
        const aim = state.aims[id]
        if (aim) {
          const incoming = aim.incoming || []
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

      const nodes = aims.map(aim => ({
        id: aim.id,
        text: aim.text,
        status: aim.status.state,
        depth: depthMap.get(aim.id) ?? 0,
        // Properties for force layout (mutable)
        x: 0, 
        y: 0, 
        vx: 0, 
        vy: 0,
        fx: null as number | null, // Fixed position
        fy: null as number | null,
        value: state.calculatedValues.get(aim.id) || 0 // Add value here for graph
      }))

      const links: { source: string, target: string, type: 'hierarchy', relativePosition: [number, number], weight: number, share: number, flowValue: number }[] = []

      aims.forEach(aim => {
        // Draw links from Parent (aim) to Child (supportingConnections)
        if (aim.supportingConnections) {
            aim.supportingConnections.forEach(conn => {
            const childId = conn.aimId
            // Verify child exists to avoid broken links
            if (state.aims[childId]) {
                const share = state.flowShares.get(`${aim.id}->${childId}`) || 0
                const flowValue = state.flowValues.get(`${aim.id}->${childId}`) || 0
                links.push({ 
                  source: childId, 
                  target: aim.id, 
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

      return { nodes, links }
    }
  },

  actions: {
    getPhaseChildrenCacheKey(parentId: string | null) {
      return parentId ?? 'null'
    },

    invalidatePhaseChildren(parentId: string | null) {
      const key = this.getPhaseChildrenCacheKey(parentId)
      delete this.loadedPhaseChildrenByParentId[key]
      delete this.phaseChildrenLoadPromises[key]
    },

    recalculateValues() {
        if (this.recalculateTimeout) clearTimeout(this.recalculateTimeout)
        
        this.recalculateTimeout = setTimeout(() => {
            const allAims = Object.values(this.aims) as Aim[];
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

    async loadFloatingAims(projectPath: string) {
      if (!projectPath) return;
      
      // Only load if not loaded? Or always reload to be fresh?
      // Let's reload to be safe, but we can check if we have them.
      // For now, simple reload of all floating aims.
      
      this.loading = true;
      try {
        const aims = await trpc.aim.list.query({
          projectPath,
          floating: true
        });

        this.floatingAimsIds = [];
        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
          this.floatingAimsIds.push(aim.id);
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to load floating aims:', error);
      } finally {
        this.loading = false;
      }
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
      
      const { id: newPhaseId } = await trpc.phase.create.mutate({ projectPath, phase: phaseData });

      await this.loadPhases(projectPath, phaseData.parent, { force: true });

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

    // Helper to replace aim while preserving UI-only properties
    replaceAim(aimId: string, newAim: BaseAim) {
      const oldAim = this.aims[aimId]
      const oldExpanded = oldAim?.expanded ?? false
      const oldSelectedIndex = oldAim?.selectedIncomingIndex

      // NORMALIZE: Ensure supportingConnections exists if incoming is present (server backward compatibility)
      if (!newAim.supportingConnections && newAim.incoming) {
        newAim.supportingConnections = newAim.incoming.map(id => ({ 
            aimId: id, 
            weight: 1, 
            relativePosition: [0, 0] as [number, number] 
        }))
      }

      // Replace with new data
      this.aims[aimId] = Object.assign({
        expanded: false,
        selectedIncomingIndex: undefined
      }, newAim) as Aim

      // Restore validated UI state
      this.aims[aimId].expanded = oldExpanded

      // Initialize calculated values from backend injection (Optimistic Display)
      if (newAim.calculatedValue !== undefined) {
        this.calculatedValues.set(aimId, newAim.calculatedValue)
      }
      if (newAim.calculatedCost !== undefined) {
        this.calculatedCosts.set(aimId, newAim.calculatedCost)
      }
      if (newAim.calculatedDoneCost !== undefined) {
        this.calculatedDoneCosts.set(aimId, newAim.calculatedDoneCost)
      }
      if (newAim.calculatedPriority !== undefined) {
        this.calculatedPriorities.set(aimId, newAim.calculatedPriority)
      }

      if (oldSelectedIndex !== undefined && newAim.supportingConnections && newAim.supportingConnections.length > 0) {
        const maxIndex = newAim.supportingConnections.length - 1
        if (oldSelectedIndex <= maxIndex) {
          this.aims[aimId].selectedIncomingIndex = oldSelectedIndex
        } else {
          // Index out of bounds - clamp to last valid index
          console.warn(`Selection index ${oldSelectedIndex} out of bounds (max ${maxIndex}) for aim ${aimId}, clamping to ${maxIndex}`)
          this.aims[aimId].selectedIncomingIndex = maxIndex
        }
      }
    },

    async createFloatingAim(projectPath: string, aim: AimCreationParams): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createFloatingAim.mutate({
          projectPath,
          aim
        })

        this.aims[newAim.id] = newAim
        
        // Add to floating list if it matches criteria (it should)
        // Add to START of list (if sorted by date desc?) or END? 
        // list-aims default sort is probably filesystem order or date? 
        // Let's prepend for now as "newest".
        if (!this.floatingAimsIds.includes(newAim.id)) {
          this.floatingAimsIds.unshift(newAim.id);
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create aim:', error)
        throw error
      }
    },

    async createSubAim(projectPath: string, parentAimId: string, aim: AimCreationParams, positionInParent?: number, weight: number = 1): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createSubAim.mutate({
          projectPath,
          parentAimId,
          aim,
          positionInParent,
          weight
        })

        // Reload parent aim to get updated connections
        const parentAim = await trpc.aim.get.query({ projectPath, aimId: parentAimId })
        if (parentAim) {
          this.replaceAim(parentAimId, parentAim)
        }

        // Reload child aim to get updated supportedAims array
        // This ensures it doesn't appear in floating aims
        const updatedChildAim = await trpc.aim.get.query({ projectPath, aimId: newAim.id })
        if (updatedChildAim) {
          this.replaceAim(newAim.id, updatedChildAim)
        }
        
        this.recalculateValues();

        return newAim // Returns { id: string }
      } catch (error) {
        console.error('Failed to create sub-aim:', error)
        throw error
      }
    }, 

    async createCommittedAim(projectPath: string, phaseId: string, aim: AimCreationParams, insertionIndex?: number): Promise<{id: string}> {
      try {
        const newAim = await trpc.aim.createAimInPhase.mutate({
          projectPath,
          phaseId,
          aim,
          insertionIndex
        })

        this.aims[newAim.id] = newAim

        // Reload the specific phase to get updated commitments
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        if (phase) {
          this.replacePhase(phaseId, phase)
        }
        
        this.recalculateValues();

        return newAim
      } catch (error) {
        console.error('Failed to create aim in phase:', error)
        throw error
      }
    },

    async updateAim(projectPath: string, aimId: string, updates: Partial<Omit<Aim, 'id'>>): Promise<void> {
      try {
        const updatedAim = await trpc.aim.update.mutate({
          projectPath,
          aimId,
          aim: updates
        })

        // Update local state
        this.replaceAim(aimId, updatedAim)
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to update aim:', error)
        throw error
      }
    },

    async updateConnectionPosition(projectPath: string, parentId: string, childAimId: string, newRelativePosition: [number, number]) {
      const parent = this.aims[parentId]
      if (!parent) return

      const connections = parent.supportingConnections || []
      const connectionIndex = connections.findIndex(c => c.aimId === childAimId)
      
      if (connectionIndex !== -1) {
        // 1. Update local state immediately
        const updatedConnections = [...connections]
        const oldConn = updatedConnections[connectionIndex]!
        updatedConnections[connectionIndex] = {
          aimId: oldConn.aimId,
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
        await Promise.all(updates.map(aimId => {
          const aim = this.aims[aimId]
          if (!aim) return Promise.resolve()
          return this.updateAim(projectPath, aimId, {
            supportingConnections: aim.supportingConnections
          })
        }))
      } catch (e) {
        console.error("Failed to flush updates", e)
      }
    },
    
    async commitAimToPhase(projectPath: string, aimId: string, phaseId: string, insertionIndex?: number) {
      try {
        // Use the new backend endpoint that maintains bidirectional relationship
        await trpc.aim.commitToPhase.mutate({
          projectPath,
          aimId,
          phaseId,
          insertionIndex
        })

        // Update local state - reload the specific phase to get updated commitments
        const phase = await trpc.phase.get.query({ projectPath, phaseId })
        if (phase) {
          this.replacePhase(phaseId, phase)
        }

        // Reload the aim to get updated committedIn field
        const aim = await trpc.aim.get.query({ projectPath, aimId })
        if (aim) {
          this.replaceAim(aimId, aim)
        }
        
        // Remove from floating aims if present
        const index = this.floatingAimsIds.indexOf(aimId)
        if (index !== -1) {
            this.floatingAimsIds.splice(index, 1)
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to commit aim to phase:', error)
        throw error
      }
    },
    
    async deleteAimFromStore(projectPath: string, aimId: string) {
      try {
        await trpc.aim.delete.mutate({
          projectPath,
          aimId
        })
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to delete aim:', error)
        throw error
      }
    },
    
    async removeAimFromPhase(projectPath: string, aimId: string, phaseId: string) {
      try {
        await trpc.aim.removeFromPhase.mutate({
          projectPath,
          aimId,
          phaseId
        })

        // Update local state - reload data to ensure consistency
        await this.loadAllAims(projectPath);
        await this.loadPhases(projectPath, null);

        // Check if it needs to be added to floating
        const aim = await trpc.aim.get.query({ projectPath, aimId })
        if (aim) {
            this.replaceAim(aimId, aim)
            const isFloating = (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0);
            if (isFloating && !this.floatingAimsIds.includes(aimId)) {
                this.floatingAimsIds.unshift(aimId)
            }
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to remove aim from phase:', error)
        throw error
      }
    },

    async loadPhases(projectPath: string, parentId: string | null, options: { force?: boolean } = {}): Promise<Phase[]> {
      if (!projectPath) return [];
      const key = this.getPhaseChildrenCacheKey(parentId)
      const force = options.force === true

      if (!force && this.loadedPhaseChildrenByParentId[key]) {
        const childIds = this.childrenByParentId[key] || []
        return childIds.map((id) => this.phases[id]).filter((phase): phase is Phase => !!phase)
      }

      if (!force && this.phaseChildrenLoadPromises[key]) {
        return await this.phaseChildrenLoadPromises[key]
      }

      this.loading = true;
      const loadPromise = (async () => {
      try {
        const phases = await trpc.phase.list.query({ projectPath, parentPhaseId: parentId });
        const childIds: string[] = [];
        for (const phase of phases) {
          this.replacePhase(phase.id, phase);
          childIds.push(phase.id);
        }
        this.childrenByParentId[key] = childIds;
        this.loadedPhaseChildrenByParentId[key] = true;
        return phases;
      } catch (error) {
        this.error = 'Failed to load phases';
        console.error(this.error, error);
        return [];
      } finally {
        delete this.phaseChildrenLoadPromises[key]
        this.loading = false;
      }
      })()

      this.phaseChildrenLoadPromises[key] = loadPromise
      return await loadPromise
    },

    async loadAllAims(projectPath: string) {
      if (!projectPath) return;
      this.loading = true;
      try {
        // 1. Try cache first
        const cachedAims = await loadAllAimsCache(projectPath);
        if (cachedAims && cachedAims.length > 0) {
            console.log(`[DataStore] Loaded ${cachedAims.length} aims from cache`);
            for (const aim of cachedAims) {
                this.replaceAim(aim.id, aim);
            }
            this.recalculateValues();
        }

        // 2. Fetch from server
        const aims = await trpc.aim.list.query({ projectPath });
        console.log(`[DataStore] Fetched ${aims.length} aims from server`);
        
        const serverAimIds = new Set(aims.map(a => a.id));
        
        // Remove stale aims
        for (const id in this.aims) {
            if (!serverAimIds.has(id)) {
                delete this.aims[id];
            }
        }

        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
        }
        this.recalculateValues();
        
        // 3. Update cache
        saveAims(projectPath, aims);
        
      } catch (error) {
        console.error('Failed to load all aims:', error);
      } finally {
        this.loading = false;
      }
    },

    async loadProject(projectPath: string) {
      const uiStore = useUIStore();
      const projectStore = useProjectStore();
      const mapStore = useMapStore();

      if (!projectPath) return;

      try {
        projectStore.setProjectPath(projectPath);
        projectStore.setConnectionStatus('connecting');
        this.childrenByParentId = {}
        this.loadedPhaseChildrenByParentId = {}
        this.phaseChildrenLoadPromises = {}

        // Reset view state when switching projects
        uiStore.resetViewState();
        mapStore.resetView();

        // Repair project state (clean up invalid commitments)
        const [meta] = await Promise.all([
          trpc.project.getMeta.query({ projectPath }),
          trpc.project.repair.mutate({ projectPath })
        ]);

        this.meta = meta;

        // Start subscription
        this.subscribeToUpdates(projectPath);

        // Load initial data
        await this.loadFloatingAims(projectPath);
        await this.loadPhases(projectPath, null); // Load root phases

        // Check consistency
        this.checkConsistency(projectPath);

        projectStore.setConnectionStatus('connected');
        projectStore.addProjectToHistory(projectPath);
        projectStore.clearProjectFailure(projectPath);
      } catch (error) {
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
        onData: async (data: { type: string, id: string, projectPath: string }) => {
          // Normalize paths for comparison (handle .bowman suffix mismatch)
          const suffix = '/' + AIMPARENCY_DIR_NAME;
          const eventPath = data.projectPath.endsWith(suffix) ? data.projectPath.slice(0, -suffix.length) : (data.projectPath.endsWith(AIMPARENCY_DIR_NAME) ? data.projectPath.slice(0, -AIMPARENCY_DIR_NAME.length) : data.projectPath);
          const myPath = projectPath.endsWith(suffix) ? projectPath.slice(0, -suffix.length) : (projectPath.endsWith(AIMPARENCY_DIR_NAME) ? projectPath.slice(0, -AIMPARENCY_DIR_NAME.length) : projectPath);
          
          if (eventPath !== myPath) return;

          console.log('Received update:', data);
          if (data.type === 'aim') {
             if (this.deletedAims.has(data.id)) return;
             try {
               const aim = await trpc.aim.get.query({ projectPath, aimId: data.id });
               this.replaceAim(aim.id, aim);

               // Logic to update floating aims list
               // A floating aim has no commitments AND no outgoing connections (is not a parent)
               // Note: 'outgoing' contains IDs of aims that depend on this aim (children? no, depends on definition)
               // In aimparency: outgoing = children (sub-aims). Wait, let's verify.
               // connectAimsInternal: parent.incoming.push(child), child.outgoing.push(parent).
               // So outgoing = PARENTS. incoming = CHILDREN.
               // So a root aim has NO PARENTS (no outgoing). Correct.
               const isFloating = (!aim.committedIn || aim.committedIn.length === 0) && (!aim.supportedAims || aim.supportedAims.length === 0);
               
               if (isFloating) {
                 if (!this.floatingAimsIds.includes(aim.id)) {
                   this.floatingAimsIds.unshift(aim.id);
                 }
               } else {
                 const index = this.floatingAimsIds.indexOf(aim.id);
                 if (index !== -1) {
                   this.floatingAimsIds.splice(index, 1);
                 }
               }
               this.recalculateValues();
             } catch (e) {
               if (this.aims[data.id]) delete this.aims[data.id];
               
               // Also remove from floating list if deleted/error
               const index = this.floatingAimsIds.indexOf(data.id);
               if (index !== -1) {
                 this.floatingAimsIds.splice(index, 1);
               }
               this.recalculateValues();
             }
          } else if (data.type === 'phase') {
             try {
               const previousPhase = this.phases[data.id]
               const phase = await trpc.phase.get.query({ projectPath, phaseId: data.id });
               this.replacePhase(phase.id, phase);

               // Ensure all committed aims are loaded
               const missingAimIds = phase.commitments.filter(id => !this.aims[id]);
               if (missingAimIds.length > 0) {
                 await this.loadAims(projectPath, missingAimIds);
               }

               this.invalidatePhaseChildren(previousPhase?.parent ?? null)
               this.invalidatePhaseChildren(phase.parent ?? null)
               this.invalidatePhaseChildren(phase.id)

               const parentId = phase.parent ?? 'null';
               const current = this.childrenByParentId[parentId] || [];
               if (!current.includes(phase.id)) {
                 this.childrenByParentId[parentId] = [...current, phase.id];
               }
             } catch (e) {
               const previousPhase = this.phases[data.id]
               if (this.phases[data.id]) delete this.phases[data.id];
               this.invalidatePhaseChildren(previousPhase?.parent ?? null)
               this.invalidatePhaseChildren(data.id)
             }
          }
        },
        onError: (err: any) => console.error('Subscription error:', err)
      });
    },

    async deletePhase(phaseId: string, parentPhaseId: string | null) {
      const projectStore = useProjectStore();

      try {
        // Get child phases and update their parent
        const childPhases = await trpc.phase.list.query({
          projectPath: projectStore.projectPath,
          parentPhaseId: phaseId
        });

        for (const child of childPhases) {
          await trpc.phase.update.mutate({
            projectPath: projectStore.projectPath,
            phaseId: child.id,
            phase: { parent: parentPhaseId }
          });
        }

        // Delete the phase
        await trpc.phase.delete.mutate({
          projectPath: projectStore.projectPath,
          phaseId: phaseId
        });

        this.invalidatePhaseChildren(parentPhaseId)
        this.invalidatePhaseChildren(phaseId)
      } catch (error) {
        console.error('Failed to delete phase:', error);
      }
    },

    // Recursive helper to delete a sub-aim and all its children
    async deleteSubAimRecursive(projectPath: string, aimId: string, parentAimId: string) {
      const aim = this.aims[aimId]
      if (!aim) return

      // 1. Recursively delete all children first
      if (aim.supportingConnections && aim.supportingConnections.length > 0) {
        for (const conn of [...aim.supportingConnections]) {
          await this.deleteSubAimRecursive(projectPath, conn.aimId, aimId)
        }
      }

      // 2. Remove this aim from the parent's supportingConnections array
      const parentAim = this.aims[parentAimId]
      if (parentAim && parentAim.supportingConnections) {
        const wasExpanded = parentAim.expanded
        const updatedConnections = parentAim.supportingConnections.filter(c => c.aimId !== aimId)
        await this.updateAim(projectPath, parentAimId, {
          supportingConnections: updatedConnections
        })
        // Restore expanded state (it's UI-only, not persisted)
        if (wasExpanded && this.aims[parentAimId]) {
          this.aims[parentAimId].expanded = true
        }
      }

      // 3. Remove the parent from this aim's supportedAims array
      const updatedSupportedAims = aim.supportedAims.filter(id => id !== parentAimId)

      // 4. If this aim has no other parents (supportedAims connections), delete it completely
      if (updatedSupportedAims.length === 0) {
        await trpc.aim.delete.mutate({
          projectPath,
          aimId: aimId
        })
        delete this.aims[aimId]
      } else {
        // Still has other parents, just update the supportedAims array
        await this.updateAim(projectPath, aimId, {
          supportedAims: updatedSupportedAims
        })
      }
    },

    async deleteAim(aimId: string) {
      const uiStore = useUIStore();
      const projectStore = useProjectStore();

      try {
        const aim = this.aims[aimId]
        if (!aim) return

        // Get selection path to determine context
        const path = uiStore.getSelectionPath()

        // Determine deletion behavior based on selection path:
        // - path.aims.length > 1: Sub-aim (remove from parent's incoming)
        // - path.aims.length === 1 && phaseId exists: Committed aim (remove from phase)
        // - path.aims.length === 1 && no phaseId: Floating aim (delete entirely)

        if (path.aims.length > 1) {
          // B) Sub-aim: remove from parent aim's supporting list
          const parentAim = path.aims[path.aims.length - 2]
          if (parentAim) {
            await this.deleteSubAimRecursive(projectStore.projectPath, aimId, parentAim.id)

            // Adjust parent's selectedIncomingIndex to stay in valid range
            const updatedParentAim = this.aims[parentAim.id]
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
          // A) Committed aim: remove from phase
          await trpc.aim.removeFromPhase.mutate({
            projectPath: projectStore.projectPath,
            aimId: aimId,
            phaseId: path.phase.id
          });

          // Reload the specific phase to get updated commitments
          const phase = await trpc.phase.get.query({ projectPath: projectStore.projectPath, phaseId: path.phase.id })
          if (phase) {
            this.replacePhase(path.phase.id, phase)
          }

          // Update aim's committedIn array
          // TODO implement aim removal server side, then reload parent aim/phase in client
          const updatedAim = this.aims[aimId]
          if (updatedAim) {
            updatedAim.committedIn = updatedAim.committedIn?.filter(id => id !== path.phase?.id) || []
          }
        } else {
          // C) Floating aim: delete entirely (including all sub-aims)
          // First recursively delete all sub-aims
          if (aim.supportingConnections && aim.supportingConnections.length > 0) {
            for (const conn of [...aim.supportingConnections]) {
              await this.deleteSubAimRecursive(projectStore.projectPath, conn.aimId, aimId)
            }
          }

          // Then delete the aim itself
          this.deletedAims.add(aimId)
          await trpc.aim.delete.mutate({
            projectPath: projectStore.projectPath,
            aimId: aimId
          });

          delete this.aims[aimId]
          this.floatingAimsIds = this.floatingAimsIds.filter(id => id !== aimId)
        }

        // Adjust selection if needed
        if (uiStore.navigatingAims) {
          const aims = path.phase ? this.getAimsForPhase(path.phase.id) : this.floatingAims

          if (aims.length === 0) {
            uiStore.navigatingAims = false
          } else {
            // Select next/previous aim at same level
            if (!path.phase) {
              uiStore.floatingAimIndex = Math.min(uiStore.floatingAimIndex, aims.length - 1)
            } else {
              const phase = this.phases[path.phase.id]
              if (phase && phase.selectedAimIndex !== undefined) {
                phase.selectedAimIndex = Math.min(phase.selectedAimIndex, aims.length - 1)
              }
            }
          }
        }
        this.recalculateValues();
      } catch (error) {
        this.deletedAims.delete(aimId);
        console.error('Failed to delete aim:', error);
      }
    },

    async loadPhaseAims(projectPath: string, phaseId: string) {
      if (!projectPath) return;

      try {
        if (phaseId === 'null') {
          // Root aims should use loadFloatingAims, this branch might be unused now but kept for safety
          await this.loadFloatingAims(projectPath);
        } else {
          // Phase aims - load the specific phase to get commitments
          const phase = await trpc.phase.get.query({ projectPath, phaseId });
          if (phase) {
            this.replacePhase(phaseId, phase);
            
            // NEW: Actually fetch the aims content for this phase!
            // We can fetch specifically aims committed to this phase
            const phaseAims = await trpc.aim.list.query({ 
              projectPath, 
              phaseId: phaseId 
            });
            
            for (const aim of phaseAims) {
              this.replaceAim(aim.id, aim);
            }
            this.recalculateValues();
          }
        }
      } catch (error) {
        console.error('Failed to load phase aims:', error);
      }
    },

    async loadAims(projectPath: string, aimIds: string[]) {
      if (!projectPath || aimIds.length === 0) return;
      
      // Always reload to ensure freshness, especially for deep path expansion
      // where we need the latest 'incoming' arrays.

      try {
        const aims = await trpc.aim.list.query({
          projectPath,
          ids: aimIds
        });

        for (const aim of aims) {
          this.replaceAim(aim.id, aim);
        }
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to load specific aims:', error);
      }
    },

    async reorderPhaseAim(projectPath: string, phaseId: string, aimId: string, newIndex: number) {
      try {
        await trpc.aim.commitToPhase.mutate({
          projectPath,
          aimId,
          phaseId,
          insertionIndex: newIndex
        });
        
        const phase = await trpc.phase.get.query({ projectPath, phaseId });
        if (phase) this.replacePhase(phaseId, phase);
      } catch (error) {
        console.error('Failed to reorder phase aim:', error);
      }
    },

    async reorderSubAim(projectPath: string, parentAimId: string, childAimId: string, newIndex: number) {
      try {
        const childAim = this.aims[childAimId];
        const childSupportedAimsIndex = childAim?.supportedAims.indexOf(parentAimId) ?? 0;

        await trpc.aim.connectAims.mutate({
          projectPath,
          parentAimId,
          childAimId: childAimId,
          parentIncomingIndex: newIndex,
          childSupportedAimsIndex: childSupportedAimsIndex !== -1 ? childSupportedAimsIndex : undefined
        });

        const parentAim = await trpc.aim.get.query({ projectPath, aimId: parentAimId });
        if (parentAim) this.replaceAim(parentAimId, parentAim);
        this.recalculateValues();
      } catch (error) {
        console.error('Failed to reorder sub-aim:', error);
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

        await this.loadPhases(projectPath, phase.parent ?? null, { force: true })
      } catch (error) {
        console.error('Failed to reorder phase:', error)
      }
    },

    async checkConsistency(projectPath: string) {
        if (!projectPath) return;
        try {
            // @ts-ignore - checkConsistency is in project router
            const result = await trpc.project.checkConsistency.query({ projectPath });
            this.consistencyErrors = result.errors;
        } catch (e) {
            console.error('Failed to check consistency', e);
        }
    },

    async fixConsistency(projectPath: string) {
        if (!projectPath) return;
        try {
            // @ts-ignore - fixConsistency is in project router
            const result = await trpc.project.fixConsistency.mutate({ projectPath });
            // Reload everything after fix
            await this.loadProject(projectPath);
            this.consistencyErrors = [];
            return result.fixes;
        } catch (e) {
            console.error('Failed to fix consistency', e);
            throw e;
        }
    }
  }
})
