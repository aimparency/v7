<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { trpc } from '../trpc'
import FormModalShell from './FormModalShell.vue'

// Admins manage who may write. The git account that commits the graph answers
// for everyone it lets in here.
defineProps<{ me: string | null }>()
const emit = defineEmits<{ close: [] }>()

const ROLES = ['read', 'write', 'admin'] as const
type Role = typeof ROLES[number]

const users = ref<Array<{ name: string, role: Role }>>([])
const name = ref('')
const role = ref<Role>('write')
const password = ref('')
const error = ref('')

const run = async (action: () => Promise<unknown>) => {
  error.value = ''
  try {
    await action()
    users.value = await trpc.auth.listUsers.query()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

const add = () => run(async () => {
  await trpc.auth.createUser.mutate({ name: name.value, role: role.value, password: password.value })
  name.value = password.value = ''
})

const setRole = (user: string, next: string) => run(() => trpc.auth.setRole.mutate({ name: user, role: next as Role }))
const remove = (user: string) => run(() => trpc.auth.removeUser.mutate({ name: user }))

const resetPassword = (user: string) => {
  const next = window.prompt(`New password for ${user} (8+ characters)`)
  if (next) void run(() => trpc.auth.setPassword.mutate({ name: user, password: next }))
}

onMounted(() => run(async () => undefined))
</script>

<template>
  <FormModalShell show title="Accounts" width="min(90vw, 32rem)" @request-close="emit('close')">
    <div class="accounts">
      <div v-for="user in users" :key="user.name" class="row">
        <span class="name">{{ user.name }}{{ user.name === me ? ' (you)' : '' }}</span>
        <select :value="user.role" @change="setRole(user.name, ($event.target as HTMLSelectElement).value)">
          <option v-for="option in ROLES" :key="option" :value="option">{{ option }}</option>
        </select>
        <button class="btn-secondary" @click="resetPassword(user.name)">Password</button>
        <button class="btn-secondary" :disabled="user.name === me" @click="remove(user.name)">Remove</button>
      </div>

      <form class="row" @submit.prevent="add">
        <input v-model="name" class="name" placeholder="Name" />
        <select v-model="role">
          <option v-for="option in ROLES" :key="option" :value="option">{{ option }}</option>
        </select>
        <input v-model="password" type="password" placeholder="Password" autocomplete="new-password" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="hint">read: sees what anyone sees · write: edits ideas and phases · admin: also accounts, settings and commits</p>
    </div>
  </FormModalShell>
</template>

<style scoped>
.accounts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .row {
    display: flex;
    gap: 0.375rem;
    align-items: center;

    .name {
      flex: 1;
    }
  }

  .error {
    color: #e57373;
    margin: 0;
  }

  .hint {
    color: #888;
    margin: 0;
  }
}
</style>
