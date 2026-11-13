<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { trpc } from '../trpc'

// What an MCP client may reach: all graphs of the account (null), or the ones
// ticked here, out of those the account writes.
const scope = defineModel<string[] | null>({ required: true })

const graphs = ref<Awaited<ReturnType<typeof trpc.graphs.list.query>>>([])
const mine = computed(() => graphs.value.filter(graph => graph.right !== 'read'))
onMounted(async () => { graphs.value = await trpc.graphs.list.query().catch(() => []) })

const toggle = (slug: string, chosen: boolean) => {
  scope.value = chosen ? [...(scope.value ?? []), slug] : (scope.value ?? []).filter(other => other !== slug)
}
</script>

<template>
  <div class="graph-scope">
    <label><input type="radio" :checked="scope === null" @change="scope = null" /> all my graphs, also future ones</label>
    <label><input type="radio" :checked="scope !== null" @change="scope = []" /> only these graphs</label>
    <div v-if="scope !== null" class="graphs">
      <label v-for="graph in mine" :key="graph.slug">
        <input type="checkbox" :checked="scope.includes(graph.slug)" @change="toggle(graph.slug, ($event.target as HTMLInputElement).checked)" /> {{ graph.name }}
      </label>
      <p v-if="mine.length === 0">You write no graph on this server yet.</p>
    </div>
  </div>
</template>

<style scoped>
.graph-scope {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .graphs {
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
