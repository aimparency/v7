import type { Aim } from '../data'

export type AimSearchAdditionalOption = {
  id: string
  label: string
  description?: string
  showWhenQueryEmptyOnly?: boolean
  actsAsEscape?: boolean
}

export type AimSearchPickPayload =
  | { type: 'aim'; data: Aim }
  | { type: 'option'; data: AimSearchAdditionalOption }

export type AimSearchModalOptions = {
  title: string
  placeholder: string
  showFilters: boolean
  additionalOptions: AimSearchAdditionalOption[]
}
