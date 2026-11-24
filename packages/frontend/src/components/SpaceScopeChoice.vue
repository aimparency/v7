<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { trpc } from '../trpc'

// What an MCP client may reach: all spaces of the account (null), or the ones
// ticked here, out of those the account writes.
const scope = defineModel<string[] | null>({ required: true })

const spaces = ref<Awaited<ReturnType<typeof trpc.spaces.list.query>>>([])
const mine = computed(() => spaces.value.filter(space => space.right !== 'read'))
onMounted(async () => { spaces.value = await trpc.spaces.list.query().catch(() => []) })

const toggle = (slug: string, chosen: boolean) => {
  scope.value = chosen ? [...(scope.value ?? []), slug] : (scope.value ?? []).filter(other => other !== slug)
}
</script>

<template>
  <div class="space-scope">
    <label><input type="radio" :checked="scope === null" @change="scope = null" /> all my spaces, also future ones</label>
    <label><input type="radio" :checked="scope !== null" @change="scope = []" /> only these spaces</label>
    <div v-if="scope !== null" class="spaces">
      <label v-for="space in mine" :key="space.slug">
        <input type="checkbox" :checked="scope.includes(space.slug)" @change="toggle(space.slug, ($event.target as HTMLInputElement).checked)" /> {{ space.name }}
      </label>
      <p v-if="mine.length === 0">You write no space on this server yet.</p>
    </div>
  </div>
</template>

<style scoped>
.space-scope {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .spaces {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-left: 1.5rem;

    p {
      margin: 0;
      color: #888;
    }
  }
}
</style>
