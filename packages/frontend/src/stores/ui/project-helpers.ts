import { toProjectRoot } from 'shared'

export type ProjectHistoryEntry = {
  path: string
  lastOpened: number
  failedToLoad: boolean
  /** The space's id and name (meta.json), to find it again when its folder moves. */
  repoId?: string
  name?: string
}

export type SpaceIdentity = Pick<ProjectHistoryEntry, 'repoId' | 'name'>

// The project root, whatever form the path came in (see shared/project-path).
export function normalizeProjectPath(path: string): string {
  return toProjectRoot(path)
}

const known = (identity: SpaceIdentity): SpaceIdentity =>
  Object.fromEntries(Object.entries(identity).filter(([, value]) => value)) as SpaceIdentity

export function upsertProjectHistory(history: ProjectHistoryEntry[], path: string, now: number, identity: SpaceIdentity = {}): ProjectHistoryEntry[] {
  const cleanPath = normalizeProjectPath(path)
  const existing = history.find((entry) => entry.path === cleanPath)
  const withoutExisting = history.filter((entry) => entry.path !== cleanPath)
  return [
    {
      ...known({ repoId: existing?.repoId, name: existing?.name }),
      ...known(identity),
      path: cleanPath,
      lastOpened: now,
      failedToLoad: false
    },
    ...withoutExisting
  ].slice(0, 30)
}

// A space found at another path: its entry moves there and keeps its place.
export function relocateProjectInHistory(history: ProjectHistoryEntry[], from: string, to: string, identity: SpaceIdentity = {}): ProjectHistoryEntry[] {
  const source = normalizeProjectPath(from)
  const target = normalizeProjectPath(to)
  return history
    .filter((entry) => entry.path !== target || target === source)
    .map((entry) => entry.path === source ? { ...entry, ...known(identity), path: target, failedToLoad: false } : entry)
}

export function removeProjectFromHistoryEntries(history: ProjectHistoryEntry[], path: string): ProjectHistoryEntry[] {
  const cleanPath = normalizeProjectPath(path)
  return history.filter((entry) => entry.path !== cleanPath)
}

export function setProjectFailureState(history: ProjectHistoryEntry[], path: string, failedToLoad: boolean): ProjectHistoryEntry[] {
  const cleanPath = normalizeProjectPath(path)
  return history.map((entry) => {
    if (entry.path !== cleanPath) {
      return entry
    }

    return {
      ...entry,
      failedToLoad
    }
  })
}
