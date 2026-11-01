import { describe, expect, it } from 'vitest'
import { backendConnection, connectionCallbacks, reconnectDelayMs } from '../backend-connection'

describe('reconnectDelayMs', () => {
  it('retries at once, then quickly, never waiting more than 2 s', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(reconnectDelayMs)).toEqual([0, 250, 500, 1000, 2000, 2000, 2000])
  })
})

describe('connectionCallbacks', () => {
  it('reports drops and reconnects, not the first connection', () => {
    const events: string[] = []
    backendConnection.onDrop = () => events.push('drop')
    backendConnection.onReconnect = () => events.push('reconnect')
    const callbacks = connectionCallbacks()

    callbacks.onOpen()
    callbacks.onClose()
    callbacks.onOpen()

    expect(events).toEqual(['drop', 'reconnect'])
  })
})
