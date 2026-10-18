// A rating session as the generator embeds it in the viewer page.
import type { LayoutSettings } from '../../../packages/shared/src/types.ts'

export interface SessionProject {
  name: string
  radius: number[] // per idea
  labels: string[]
  states: string[]
  statuses: { key: string; color: string }[]
  links: [child: number, parent: number, attributionShare: number][] // idea indices
}

export interface SessionSide {
  settings: LayoutSettings
  layouts: number[][] // per project: x0, y0, x1, y1, … rounded
}

export interface SessionComparison {
  change: string // what differs between the sides; in the report, not shown while rating
  sides: [left: SessionSide, right: SessionSide]
}

export interface SessionData {
  id: string
  projects: SessionProject[]
  comparisons: SessionComparison[]
}

export type Choice = 'left' | 'same' | 'right'

export interface SessionRating {
  projects: Record<string, Choice> // project name → the nicer side
  overall?: Choice
  why: string
}
