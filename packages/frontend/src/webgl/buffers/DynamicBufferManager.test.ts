import { describe, it, expect } from 'vitest'
import { DynamicBufferManager } from './DynamicBufferManager'

type BufferToken = { id: number }

type MockGL = WebGLRenderingContext & {
  calls: Array<{ fn: string; args: unknown[]; boundBufferId: number | null }>
}

function createMockGL(): MockGL {
  let nextId = 1
  let bound: BufferToken | null = null
  const calls: Array<{ fn: string; args: unknown[]; boundBufferId: number | null }> = []

  const gl = {
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    createBuffer: () => ({ id: nextId++ }) as BufferToken,
    deleteBuffer: (_buffer: BufferToken) => {},
    bindBuffer: (_target: number, buffer: BufferToken | null) => {
      bound = buffer
      calls.push({ fn: 'bindBuffer', args: [_target, buffer], boundBufferId: bound?.id ?? null })
    },
    bufferData: (_target: number, dataOrSize: number | ArrayBufferView, usage: number) => {
      calls.push({ fn: 'bufferData', args: [_target, dataOrSize, usage], boundBufferId: bound?.id ?? null })
    },
    bufferSubData: (_target: number, offset: number, data: ArrayBufferView) => {
      calls.push({ fn: 'bufferSubData', args: [_target, offset, data], boundBufferId: bound?.id ?? null })
    },
    calls
  } as unknown as MockGL

  return gl
}

describe('DynamicBufferManager', () => {
  it('uses full upload on first static update', () => {
    const gl = createMockGL()
    const manager = new DynamicBufferManager(gl, { maxItems: 4, stride: 2 })

    manager.updateBuffer(new Float32Array([1, 2, 3, 4]))

    const subDataCalls = gl.calls.filter(c => c.fn === 'bufferSubData')
    expect(subDataCalls).toHaveLength(1)
    expect(subDataCalls[0]?.args[1]).toBe(0)
  })

  it('uses partial static updates for changed items only', () => {
    const gl = createMockGL()
    const manager = new DynamicBufferManager(gl, { maxItems: 8, stride: 2 })

    manager.updateBuffer(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]))
    gl.calls.length = 0

    // 1 of 4 items changed -> 25% (below 30% threshold), so partial update expected
    manager.updateBuffer(new Float32Array([1, 2, 3, 4, 5, 6, 70, 8]))

    const subDataCalls = gl.calls.filter(c => c.fn === 'bufferSubData')
    expect(subDataCalls).toHaveLength(1)
    // item index 3 with stride 2 => float offset 6 => byte offset 24
    expect(subDataCalls[0]?.args[1]).toBe(24)
  })

  it('falls back to full static update when many items changed', () => {
    const gl = createMockGL()
    const manager = new DynamicBufferManager(gl, { maxItems: 8, stride: 2 })

    manager.updateBuffer(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]))
    gl.calls.length = 0

    // 2/4 items changed (50%) -> above 30% threshold => full update
    manager.updateBuffer(new Float32Array([10, 2, 3, 4, 50, 6, 7, 8]))

    const subDataCalls = gl.calls.filter(c => c.fn === 'bufferSubData')
    expect(subDataCalls).toHaveLength(1)
    expect(subDataCalls[0]?.args[1]).toBe(0)
  })

  it('writes to back buffer and swaps in animation mode', () => {
    const gl = createMockGL()
    const manager = new DynamicBufferManager(gl, { maxItems: 4, stride: 2 })

    const singleRender = manager.getRenderBuffer() as BufferToken
    manager.startAnimation()
    expect(manager.isInAnimationMode()).toBe(true)

    const initialFront = manager.getRenderBuffer() as BufferToken
    expect(initialFront.id).not.toBe(singleRender.id)

    manager.updateBuffer(new Float32Array([1, 2, 3, 4]))

    const subDataCall = [...gl.calls].reverse().find((c) => c.fn === 'bufferSubData')
    expect(subDataCall?.args[1]).toBe(0)
    // Must upload to a double buffer, not single static buffer
    expect(subDataCall?.boundBufferId).not.toBe(singleRender.id)

    const swappedFront = manager.getRenderBuffer() as BufferToken
    expect(swappedFront.id).not.toBe(initialFront.id)
  })

  it('destroys double buffers when leaving animation mode', () => {
    const gl = createMockGL()
    const manager = new DynamicBufferManager(gl, { maxItems: 4, stride: 2 })

    manager.startAnimation()
    manager.stopAnimation()

    expect(manager.isInAnimationMode()).toBe(false)
    // Static updates still work after mode transition
    manager.updateBuffer(new Float32Array([1, 2, 3, 4]))
    const subDataCalls = gl.calls.filter(c => c.fn === 'bufferSubData')
    expect(subDataCalls.length).toBeGreaterThan(0)
  })
})
