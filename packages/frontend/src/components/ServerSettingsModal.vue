<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { trpc } from '../trpc'
import { useViewerStore } from '../stores/viewer'
import FormModalShell from './FormModalShell.vue'

// What a server admin changes about the whole server. server.json holds it,
// with the rest (port, address, agents, limits), which stays a matter of the file.
const emit = defineEmits<{ close: [] }>()
const viewer = useViewerStore()

const settings = reactive({
  publicUrl: '',
  graphCreation: 'everyone' as 'everyone' | 'selected',
  signUp: { open: false, browserKey: false, wallet: false },
  notes: 'everyone' as 'everyone' | 'selected' | 'nobody',
  read: 'everyone' as 'everyone' | 'accounts' | 'selected'
})
const loadedUrl = ref('')
const error = ref('')
const saved = ref(false)
const busy = ref(false)

onMounted(async () => {
  try {
    const current = await trpc.auth.getServerSettings.query()
    Object.assign(settings, { ...current, publicUrl: current.publicUrl ?? '' })
    loadedUrl.value = settings.publicUrl
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
})

const save = async () => {
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    await trpc.auth.setServerSettings.mutate({ ...settings, publicUrl: settings.publicUrl.trim() })
    await viewer.load()
    saved.value = true
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FormModalShell show title="Server settings" width="min(92vw, 36rem)" @request-close="emit('close')">
    <form id="server-settings-form" class="stack" @submit.prevent="save">
      <label class="stack field">
        <span>Public address</span>
        <input v-model="settings.publicUrl" placeholder="https://graphs.example.org" />
        <span class="hint">Where people open this server. With it, coding agents connect by logging in themselves (no link to copy), and wallets can log in.</span>
        <span v-if="settings.publicUrl.trim() !== loadedUrl" class="hint warning">Agents use a changed address after the server restarts.</span>
      </label>

      <div class="stack field">
        <span>Accounts</span>
        <label class="check"><input v-model="settings.signUp.open" type="checkbox" /> anyone may sign up with a name and a password</label>
        <label class="check"><input v-model="settings.signUp.browserKey" type="checkbox" /> visitors get an account automatically, held by their browser</label>
        <label class="check"><input v-model="settings.signUp.wallet" type="checkbox" :disabled="!settings.publicUrl.trim()" /> log in with a crypto wallet (needs the public address)</label>
        <span class="hint">Invitations work either way (Accounts).</span>
      </div>

      <label class="stack field">
        <span>Who creates spaces</span>
        <select v-model="settings.graphCreation">
          <option value="everyone">every account</option>
          <option value="selected">accounts marked "creates spaces"</option>
        </select>
      </label>

      <label class="stack field">
        <span>Who reads spaces (unless a space sets it; owners and writers always do)</span>
        <select v-model="settings.read">
          <option value="everyone">everyone, without logging in</option>
          <option value="accounts">every logged-in account</option>
          <option value="selected">accounts the space's owner selected</option>
        </select>
        <span v-if="settings.read !== 'everyone' && settings.signUp.browserKey" class="hint warning">Visitors who get an account automatically count as logged in, so they read these spaces too.</span>
        <span v-else-if="settings.read === 'accounts' && settings.signUp.open" class="hint">Anyone who signs up reads these spaces.</span>
      </label>

      <label class="stack field">
        <span>Who leaves notes on spaces they cannot change (unless a space sets it)</span>
        <select v-model="settings.notes">
          <option value="everyone">every account</option>
          <option value="selected">accounts the space's owner selected</option>
          <option value="nobody">nobody</option>
        </select>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="saved" class="hint">Saved.</p>
    </form>
    <template #footer>
      <button class="btn-primary" form="server-settings-form" type="submit" :disabled="busy">Save</button>
    </template>
  </FormModalShell>
</template>

<style scoped>
.field {
  gap: var(--gap-s);
}
</style>
