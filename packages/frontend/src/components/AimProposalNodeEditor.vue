<script setup lang="ts">
import type { ProposedAim } from 'shared'

const props = withDefaults(defineProps<{
  node: ProposedAim
  readonly?: boolean
  root?: boolean
}>(), {
  readonly: false,
  root: false
})

const emit = defineEmits<{
  remove: []
}>()

let localId = 0
const addChild = () => {
  localId += 1
  props.node.children.push({
    weight: 1,
    child: {
      proposalId: `draft-${Date.now()}-${localId}`,
      text: '',
      children: []
    }
  })
}

const removeChild = (child: ProposedAim) => {
  const index = props.node.children.findIndex(connection => connection.child === child)
  if (index >= 0) props.node.children.splice(index, 1)
}
</script>

<template>
  <section class="proposal-node">
    <div class="node-heading">
      <strong>{{ root ? 'Proposed root aim' : 'Supporting aim' }}</strong>
      <button
        v-if="!root && !readonly"
        type="button"
        class="danger subtle"
        aria-label="Remove proposed aim"
        @click="emit('remove')"
      >
        Remove
      </button>
    </div>

    <label>
      Aim
      <input v-model="node.text" :readonly="readonly" required maxlength="500">
    </label>
    <label>
      Description
      <textarea v-model="node.description" :readonly="readonly" rows="2" maxlength="5000" />
    </label>

    <div class="estimate-row">
      <label>
        Estimated value
        <input v-model.number="node.intrinsicValue" :readonly="readonly" type="number" min="0" step="any">
      </label>
      <label>
        Estimated cost
        <input v-model.number="node.cost" :readonly="readonly" type="number" min="0" step="any">
      </label>
      <label>
        Status
        <select v-model="node.status" :disabled="readonly">
          <option value="">Open</option>
          <option value="open">Open</option>
          <option value="unclear">Unclear</option>
          <option value="human-dependent">Human-dependent</option>
        </select>
      </label>
    </div>

    <div v-if="node.children.length" class="children">
      <div
        v-for="connection in node.children"
        :key="connection.child.proposalId"
        class="child"
      >
        <div class="connection-fields">
          <label>
            Contribution weight
            <input v-model.number="connection.weight" :readonly="readonly" type="number" min="0.000001" step="any">
          </label>
          <label>
            Why it contributes
            <input v-model="connection.explanation" :readonly="readonly" maxlength="1000">
          </label>
        </div>
        <AimProposalNodeEditor
          :node="connection.child"
          :readonly="readonly"
          @remove="removeChild(connection.child)"
        />
      </div>
    </div>

    <button v-if="!readonly" type="button" class="subtle add-child" @click="addChild">
      Add supporting aim
    </button>
  </section>
</template>

<style scoped>
.proposal-node {
  border: 1px solid #555;
  border-radius: 0.35rem;
  padding: 0.75rem;
  display: grid;
  gap: 0.65rem;
  background: rgba(255, 255, 255, 0.025);
}

.node-heading,
.estimate-row,
.connection-fields {
  display: flex;
  align-items: end;
  gap: 0.65rem;
}

.node-heading {
  justify-content: space-between;
  align-items: center;
}

label {
  display: grid;
  gap: 0.25rem;
  color: #bbb;
  font-size: 0.78rem;
  flex: 1;
}

input,
textarea,
select {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #555;
  border-radius: 0.25rem;
  padding: 0.45rem;
  color: #eee;
  background: #222;
  font: inherit;
}

input[readonly],
textarea[readonly],
select:disabled {
  border-color: transparent;
  background: #292929;
}

.children {
  display: grid;
  gap: 0.75rem;
  padding-left: 0.8rem;
  border-left: 2px solid #4c6f8f;
}

.child,
.connection-fields {
  display: grid;
  gap: 0.5rem;
}

button {
  border: 1px solid #666;
  border-radius: 0.25rem;
  padding: 0.4rem 0.65rem;
  color: #ddd;
  background: #383838;
  cursor: pointer;
}

.danger {
  color: #ffabab;
}

.add-child {
  justify-self: start;
}
</style>
