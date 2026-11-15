<script setup lang="ts">
import { ADMIN_SHELL_WARNING } from 'shared'

// The server-wide rights of an account, or of the accounts an invitation makes.
// Making someone server admin hands out a shell on the server: asked every time.
// Afterwards the boxes show `rights` again, also when declined or refused.
export type Rights = { serverAdmin: boolean, canCreateGraphs: boolean }
type Right = keyof Rights

const props = defineProps<{
  rights: Rights
  /** Whom the confirmation names: an account, or "whoever uses this invitation". */
  who: string
  apply: (change: Partial<Rights>) => unknown
  /** Why server admin cannot be given here; the box is disabled then. */
  adminUnavailable?: string
}>()

const toggle = async (right: Right, box: HTMLInputElement) => {
  const value = box.checked
  const confirmed = right !== 'serverAdmin' || !value
    || window.confirm(`Make ${props.who} server admin?\n\n${ADMIN_SHELL_WARNING}`)
  if (confirmed) await props.apply({ [right]: value })
  box.checked = props.rights[right]
}
</script>

<template>
  <span class="account-rights">
    <label><input type="checkbox" :checked="rights.canCreateGraphs" @change="toggle('canCreateGraphs', $event.target as HTMLInputElement)" /> creates graphs</label>
    <label :title="adminUnavailable"><input type="checkbox" :checked="rights.serverAdmin" :disabled="!!adminUnavailable" @change="toggle('serverAdmin', $event.target as HTMLInputElement)" /> server admin</label>
  </span>
</template>

<style scoped>
.account-rights {
  display: flex;
  gap: 0.375rem;
  align-items: center;

  label {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    white-space: nowrap;
  }

  input {
    width: auto;
  }
}
</style>
