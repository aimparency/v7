import type { Idea } from '../data'

export type IdeaSearchAdditionalOption = {
  id: string
  label: string
  description?: string
  showWhenQueryEmptyOnly?: boolean
  actsAsEscape?: boolean
}

export type IdeaSearchPickPayload =
  | { type: 'idea'; data: Idea; keepOpen?: boolean }
  | { type: 'option'; data: IdeaSearchAdditionalOption; keepOpen?: boolean }

export type IdeaSearchModalOptions = {
  title: string
  placeholder: string
  showFilters: boolean
  additionalOptions: IdeaSearchAdditionalOption[]
}
