import type { Idea } from '../data'

export type IdeaSearchAdditionalOption = {
  id: string
  label: string
  description?: string
  showWhenQueryEmptyOnly?: boolean
  actsAsEscape?: boolean
  // Listed after the results while a query is typed, as `Create new: "<query>"`;
  // the picked option carries the query.
  createFromQuery?: boolean
  query?: string
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
