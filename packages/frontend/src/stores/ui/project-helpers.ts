import { AIMPARENCY_DIR_NAME } from 'shared'

export type ProjectHistoryEntry = {
  path: string
  lastOpened: number
  failedToLoad: boolean
}

export function normalizeProjectPath(path: string): string {
  const trimmedPath = path.replace(/\/+$/, '')
  const directoryNames = new Set(['.bowman'])
  if (AIMPARENCY_DIR_NAME) {
    directoryNames.add(AIMPARENCY_DIR_NAME)
  }

  for (const directoryName of directoryNames) {
    const suffix = `/${directoryName}`
    if (trimmedPath.endsWith(suffix)) {
      return trimmedPath.slice(0, -suffix.length)
    }
  }

  return trimmedPath
}

export function upsertProjectHistory(history: ProjectHistoryEntry[], path: string, now: number): ProjectHistoryEntry[] {
  const cleanPath = normalizeProjectPath(path)
  const withoutExisting = history.filter((entry) => entry.path !== cleanPath)
  return [
    {
      path: cleanPath,
      lastOpened: now,
      failedToLoad: false
    },
    ...withoutExisting
  ].slice(0, 30)
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
