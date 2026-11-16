<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { connectToServer, LoginRefusedError } from '../utils/server-logins'
import FormModalShell from './FormModalShell.vue'

// Something is about to change in a space of another server, opened in place
// here, and this page holds no login there. One click opens that server's own
// page, where the person allows this page to act as them there; the space
// then opens again, editable as far as their account there may.
const props = defineProps<{ host: string; spaceName?: string }>()
const emit = defineEmits<{ close: [] }>()

const dataStore = useDataStore()
const busy = ref(false)
const error = ref('')
const origin = computed(() => new URL(props.host).origin)
const serverHost = computed(() => new URL(props.host).host)

async function connect() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await connectToServer(origin.value)
    await dataStore.reopenSpacesAt(origin.value)
    emit('close')
  } catch (caught) {
    error.value = caught instanceof LoginRefusedError ? `No login at ${serverHost.value}: the space stays read-only here.` : caught instanceof Error ? caught.message : String(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FormModalShell show :title="`Log in at ${serverHost}`" width="min(92vw, 30rem)" @request-close="emit('close')">
    <div class="stack">
      <p>
        {{ spaceName ? `“${spaceName}”` : 'This space' }} lives on <strong>{{ serverHost }}</strong>.
        To change it here, log in there: a tab of {{ serverHost }} opens, you allow this page, and you are back.
      </p>
      <p class="hint">The login stays in this browser. This page's server never sees it.</p>
      <p v-if="busy" class="hint">Waiting for {{ serverHost }}…</p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-secondary" @click="emit('close')">Cancel</button>
      <button class="btn-primary" :disabled="busy" @click="connect">Log in at {{ serverHost }}</button>
    </template>
  </FormModalShell>
</template>
