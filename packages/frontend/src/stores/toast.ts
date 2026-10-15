import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  count: number
}

// Errors stay until dismissed: a failed save must not pass unnoticed.
const AUTO_DISMISS_MS: Record<ToastKind, number | null> = { info: 4000, warning: 8000, error: null }
const MAX_TOASTS = 5

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const useToastStore = defineStore('toast', {
  state: () => ({ toasts: [] as Toast[] }),
  actions: {
    show(kind: ToastKind, message: string) {
      // A repeated failure bumps its count instead of flooding the stack.
      const existing = this.toasts.find(toast => toast.kind === kind && toast.message === message)
      const toast = existing ?? { id: nextId++, kind, message, count: 0 }
      toast.count++
      if (!existing) this.toasts = [...this.toasts, toast].slice(-MAX_TOASTS)
      this.scheduleDismiss(toast)
    },
    info(message: string) { this.show('info', message) },
    warning(message: string) { this.show('warning', message) },
    error(context: string, error?: unknown) {
      if (error !== undefined) console.error(context, error)
      this.show('error', error === undefined ? context : `${context}: ${errorMessage(error)}`)
    },
    dismiss(id: number) {
      clearTimeout(timers.get(id))
      timers.delete(id)
      this.toasts = this.toasts.filter(toast => toast.id !== id)
    },
    scheduleDismiss(toast: Toast) {
      const delay = AUTO_DISMISS_MS[toast.kind]
      if (delay === null) return
      clearTimeout(timers.get(toast.id))
      timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), delay))
    }
  }
})
