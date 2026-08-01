import test from 'node:test'
import assert from 'node:assert/strict'
import { choice, exploring, working, wrappingUp } from './state-machine-definition'

test('choice contract requests human authorization without terminal input', () => {
  const contract = JSON.stringify(choice)
  assert.match(contract, /stops automation/i)
  assert.match(contract, /human authorization/i)
  assert.match(contract, /never typed into the terminal/i)
  assert.doesNotMatch(contract, /Always allow|Allow for this session|"choice":"[123]"/i)
})

test('every interactive state forbids autonomous option selection', () => {
  for (const state of [exploring, working, wrappingUp]) {
    assert.match(state.instructions, /request human authorization/i)
    assert.match(state.instructions, /never (?:grant a permission or )?select an option yourself/i)
    assert.doesNotMatch(state.instructions, /durable allow|Always allow|Allow for this session/i)
  }
})
