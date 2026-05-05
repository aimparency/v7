import type { Aim } from '../data'

export type AimSearchAdditionalOption = {
  id: string
  label: string
  description?: string
  showWhenQueryEmptyOnly?: boolean
  actsAsEscape?: boolean
}

export type AimSearchPickPayload =
  | { type: 'aim'; data: Aim; keepOpen?: boolean }
  | { type: 'option'; data: AimSearchAdditionalOption; keepOpen?: boolean }

export type AimSearchModalOptions = {
  title: string
  placeholder: string
  showFilters: boolean
  additionalOptions: AimSearchAdditionalOption[]
}
