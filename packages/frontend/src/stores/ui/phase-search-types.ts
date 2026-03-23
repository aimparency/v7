import type { Phase } from 'shared'

export type PhaseSearchAdditionalOption = {
  id: string
  label: string
  description?: string
  showWhenQueryEmptyOnly?: boolean
  actsAsEscape?: boolean
}

export type PhaseSearchSelection =
  | { type: 'phase'; data: Phase }
  | { type: 'option'; data: PhaseSearchAdditionalOption }

export type PhaseSearchModalOptions = {
  title: string
  placeholder: string
  additionalOptions: PhaseSearchAdditionalOption[]
}
