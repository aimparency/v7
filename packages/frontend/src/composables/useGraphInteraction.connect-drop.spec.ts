import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const { linkRepo, connectIdeas } = vi.hoisted(() => ({ linkRepo: vi.fn(async (_input: unknown) => ({})), connectIdeas: vi.fn(async () => ({})) }))
vi.mock('../trpc', () => ({ trpc: { idea: { linkRepo: { mutate: linkRepo }, connectIdeas: { mutate: connectIdeas } } } }))
vi.mock('../utils/perf-log', () => ({ perfLog: vi.fn() }))

import { useGraphInteraction } from './useGraphInteraction'
import { useMapStore } from '../stores/map'
import { useDataStore } from '../stores/data'
import type { GraphNode } from './useGraphSimulation'

const REPO_ID = '11111111-1111-4111-8111-111111111111'
// With halfSide 400 and scale 1, the client point (400, 400) is the logical origin
// and one client pixel is 2.5 logical units.
const client = (x: number, y: number) => ({ clientX: 400 + x / 2.5, clientY: 400 + y / 2.5 }) as MouseEvent

const node = (id: string, x: number, extra: Partial<GraphNode> = {}) =>
  ({ id, text: id, status: 'open', r: 40, value: 1, pos: [x, 0], renderPos: [x, 0], shift: [0, 0], freezeFactor: 0, freezeCounter: 0, ...extra }) as GraphNode

function setup() {
  const host = node('host', 0)
  const repo = node(REPO_ID, 600, { isRepo: true })
  const remote = node(`${REPO_ID}:x`, 800, { linked: true })
  const nodes = ref([host, repo, remote])
  const simulation = { nodes, links: ref([]), nodeMap: new Map(nodes.value.map(n => [n.id, n])), freezings: new Map(), onTick: () => {}, trigger: ref(0) }
  const element = ref({ getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as HTMLElement)
  // The outline of the opened space reaches from x = 500 to x = 1000.
  const spaceAt = (pos: readonly number[]) => (pos[0]! > 500 && pos[0]! < 1000 ? REPO_ID : undefined)
  const interaction = useGraphInteraction(element, ref(800), ref(800), simulation as any, spaceAt)
  const mapStore = useMapStore()
  mapStore.halfSide = 400
  mapStore.startConnecting(host)
  interaction.onMouseDown(client(0, 0))
  return { interaction, mapStore }
}

describe('dragging a connection from an idea toward a linked space', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    linkRepo.mockClear()
    useDataStore().ideas = { host: { id: 'host', supportingRepos: [] } } as any
    useDataStore().loadIdeas = vi.fn(async () => {}) as any
  })

  it('links the graph to the idea when released inside its outline', async () => {
    const { interaction, mapStore } = setup()
    interaction.onMouseMove(client(900, 300))
    expect(mapStore.connectDrop).toEqual({ kind: 'space', repoId: REPO_ID })
    interaction.onMouseUp()
    await vi.waitFor(() => expect(linkRepo).toHaveBeenCalledWith(expect.objectContaining({ ideaId: 'host', repoId: REPO_ID })))
    expect(mapStore.connectDrop).toEqual({ kind: 'new' })
  })

  it('turns blocked over an idea of the linked space, and releasing there links nothing', async () => {
    const { interaction, mapStore } = setup()
    interaction.onMouseMove(client(800, 10))
    expect(mapStore.connectDrop).toEqual({ kind: 'blocked' })
    interaction.onMouseUp()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(linkRepo).not.toHaveBeenCalled()
  })
})
