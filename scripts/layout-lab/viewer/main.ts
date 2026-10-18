// The rating page: each comparison's two layouts of every project, drawn
// with the graph view's own WebGL renderer (nodes, arrows, temporal
// antialiasing) and labels, so they look as in the app.
import { WebGLGraphRenderer, type NodeData } from '../../../packages/frontend/src/webgl/WebGLGraphRenderer'
import { ArrowRenderer, type EdgeData } from '../../../packages/frontend/src/webgl/ArrowRenderer'
import { TAAPass } from '../../../packages/frontend/src/webgl/TAAPass'
import { calculateArrowGeometry, connectionArrowWidth } from '../../../packages/frontend/src/webgl/utils/arrow-geometry'
import { statusToColor } from '../../../packages/frontend/src/webgl/status-colors'
import type { Choice, SessionData, SessionProject, SessionRating } from './session-data'

const session = JSON.parse(document.getElementById('session')!.textContent!) as SessionData
const STORAGE_KEY = `layout-rating:${session.id}`
const TAA_FRAMES = 24 // frames to render after a change, until the antialiasing has settled
const LABEL_MIN_RADIUS = 20 // screen pixels, as GraphView
const CHOICES: { choice: Choice; label: string; key: string }[] = [{ choice: 'left', label: 'Left', key: 'h' }, { choice: 'same', label: 'Same', key: 'j' }, { choice: 'right', label: 'Right', key: 'l' }]
const FIT_ROOM = 1.5 // breathing room around the fitted core

const ratings: SessionRating[] = load() ?? session.comparisons.map(() => ({ projects: {}, notes: {}, why: '' }))
let current = Math.max(0, ratings.findIndex(rating => !rating.overall))

// Both panes of a project share zoom and pan, but each centres its own
// layout: screen = (world − pane centre) · zoom + pane middle + (x, y), in CSS pixels.
interface Camera { x: number; y: number; zoom: number }

class Pane {
  readonly element = document.createElement('div')
  private readonly canvas = document.createElement('canvas')
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private renderer = new WebGLGraphRenderer(this.canvas)
  private arrows: ArrowRenderer | null = null
  private taa: TAAPass | null = null
  private nodes: NodeData[] = []
  private labels: string[] = []
  private center = { x: 0, y: 0, width: 1, height: 1 } // the nearest 90% of ideas: middle and extent

  constructor(side: string) {
    this.element.className = 'pane'
    const tag = document.createElement('span')
    tag.className = 'side'
    tag.textContent = side
    this.element.append(this.canvas, this.svg, tag)
  }

  async init() {
    await this.renderer.init()
    const gl = this.canvas.getContext('webgl2')!
    this.arrows = new ArrowRenderer(gl, this.canvas)
    await this.arrows.init()
    this.taa = new TAAPass(gl, this.canvas)
    await this.taa.init()
  }

  show(project: SessionProject, layout: number[]) {
    this.labels = project.labels
    this.nodes = project.radius.map((r, index) => ({
      id: String(index), x: layout[index * 2]!, y: layout[index * 2 + 1]!, r,
      color: statusToColor(project.states[index]!, project.statuses), selected: false, loadable: false, moving: false
    }))
    // As GraphView: an arrow runs from the supporting idea (child) to the
    // parent, as wide as the child's value share it carries, in the child's
    // color lifted toward white.
    const edges: EdgeData[] = project.links.map(([child, parent, attributionShare]) => {
      const source = this.nodes[child]!
      const target = this.nodes[parent]!
      const lift = (channel: number) => 1 - (1 - channel) * 0.95
      return {
        id: `${child}->${parent}`, sourceId: source.id, targetId: target.id,
        color: [lift(source.color[0]), lift(source.color[1]), lift(source.color[2])], opacity: 0.4,
        geometry: calculateArrowGeometry(source, target, connectionArrowWidth({ source, attributionShare })),
        moving: false, selected: false
      }
    })
    this.renderer.updateNodes(this.nodes)
    this.arrows!.updateEdges(edges)
    this.center = core(this.nodes)
  }

  // The zoom at which this layout's core fits, with room around it.
  fittingZoom() {
    return Math.min(this.element.clientWidth / this.center.width, this.element.clientHeight / this.center.height) / FIT_ROOM
  }

  // Where the world origin lands on screen.
  private origin(camera: Camera) {
    return {
      x: this.element.clientWidth / 2 + camera.x - this.center.x * camera.zoom,
      y: this.element.clientHeight / 2 + camera.y - this.center.y * camera.zoom
    }
  }

  draw(camera: Camera, moving: boolean) {
    const ratio = this.renderer.resizeToDisplaySize()
    const origin = this.origin(camera)
    const [x, y, zoom] = [origin.x * ratio, origin.y * ratio, camera.zoom * ratio]
    this.renderer.setCamera(x, y, zoom)
    this.arrows!.setCamera(new Float32Array([zoom, 0, 0, 0, zoom, 0, x, y, 1]))
    const jitterX = moving ? 0 : Math.random() - 0.5
    const jitterY = moving ? 0 : Math.random() - 0.5
    this.taa!.begin()
    this.arrows!.render(jitterX, jitterY, 0)
    this.renderer.render(jitterX, jitterY)
    this.taa!.setCameraMoving(moving)
    this.taa!.end()
  }

  // Titles as GraphView draws them: for ideas large enough on screen.
  drawLabels(camera: Camera, visible: boolean) {
    this.svg.classList.toggle('hidden', !visible)
    if (!visible) return
    const { clientWidth: width, clientHeight: height } = this.element
    const origin = this.origin(camera)
    const parts: string[] = []
    this.nodes.forEach((node, index) => {
      if (node.r * camera.zoom <= LABEL_MIN_RADIUS) return
      const [x, y] = [node.x * camera.zoom + origin.x, node.y * camera.zoom + origin.y]
      const r = node.r * camera.zoom
      if (x + r < 0 || x - r > width || y + r < 0 || y - r > height) return
      const lines = titleLines(this.labels[index]!)
      const spans = lines.map((line, at) => `<tspan x="0" dy="${at === 0 ? -(lines.length - 1) * 0.6 : 1.2}em">${escape(line)}</tspan>`).join('')
      parts.push(`<g transform="translate(${node.x},${node.y}) scale(${node.r})"><text dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="0.25">${spans}</text></g>`)
    })
    this.svg.innerHTML = `<g transform="translate(${origin.x},${origin.y}) scale(${camera.zoom})">${parts.join('')}</g>`
  }
}

class Row {
  readonly element = document.createElement('section')
  readonly panes = [new Pane('Left'), new Pane('Right')] as const
  readonly choice = choiceControl(choice => {
    ratings[current]!.projects[this.project.name] = choice
    save()
    this.update()
  })
  private readonly note = document.createElement('textarea')
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private frames = 0
  private moving = false
  private settle: ReturnType<typeof setTimeout> | undefined
  private project!: SessionProject

  constructor() {
    this.element.className = 'project'
    const bar = document.createElement('div')
    bar.className = 'bar'
    const name = document.createElement('span')
    name.className = 'name'
    const enlarge = button('Enlarge', () => {
      this.element.classList.toggle('expanded')
      enlarge.textContent = this.element.classList.contains('expanded') ? 'Shrink' : 'Enlarge'
      requestAnimationFrame(() => this.fit())
    })
    enlarge.tabIndex = -1
    bar.append(name, enlarge)
    const panes = document.createElement('div')
    panes.className = 'panes'
    panes.append(...this.panes.map(pane => pane.element))
    this.note.rows = 2
    this.note.placeholder = 'Why? (optional)'
    this.note.addEventListener('input', () => {
      ratings[current]!.notes[this.project.name] = this.note.value
      save()
    })
    const rating = document.createElement('div')
    rating.className = 'rating'
    rating.append(this.choice.element, this.note)
    this.element.append(bar, panes, rating)
    // Rating a project shows it whole: its name, both layouts and the controls.
    this.choice.element.addEventListener('focus', () => this.element.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    for (const pane of this.panes) this.interact(pane.element)
    new ResizeObserver(() => this.redraw()).observe(panes)
  }

  async init() {
    for (const pane of this.panes) await pane.init()
  }

  show(project: SessionProject, layouts: [number[], number[]]) {
    this.project = project
    this.element.querySelector('.name')!.textContent = `${project.name} · ${project.radius.length} ideas, ${project.links.length} connections`
    this.panes.forEach((pane, side) => pane.show(project, layouts[side]!))
    this.fit()
    this.update()
  }

  update() {
    this.choice.set(ratings[current]!.projects[this.project.name])
    this.note.value = ratings[current]!.notes[this.project.name] ?? ''
    renderDots()
  }

  // Each layout centred in its pane, both at the scale that fits the larger.
  fit() {
    this.camera = { x: 0, y: 0, zoom: Math.min(...this.panes.map(pane => pane.fittingZoom())) }
    this.redraw()
  }

  redraw() {
    this.frames = TAA_FRAMES
    for (const pane of this.panes) pane.drawLabels(this.camera, !this.moving)
  }

  tick() {
    if (this.frames <= 0) return
    this.frames--
    for (const pane of this.panes) pane.draw(this.camera, this.moving)
  }

  private move() {
    this.moving = true
    clearTimeout(this.settle)
    this.settle = setTimeout(() => {
      this.moving = false
      this.redraw()
    }, 150)
    this.redraw()
  }

  private interact(element: HTMLElement) {
    let drag: { x: number; y: number } | null = null
    element.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId)
    })
    element.addEventListener('pointermove', event => {
      if (!drag) return
      this.camera.x += event.clientX - drag.x
      this.camera.y += event.clientY - drag.y
      drag = { x: event.clientX, y: event.clientY }
      this.move()
    })
    element.addEventListener('pointerup', () => { drag = null })
    element.addEventListener('wheel', event => {
      event.preventDefault()
      // Zoom about the cursor: the pane middle plus pan scales away from it.
      const bounds = element.getBoundingClientRect()
      const [px, py] = [event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2]
      const factor = Math.exp(-event.deltaY * 0.0015)
      this.camera = { zoom: this.camera.zoom * factor, x: px - (px - this.camera.x) * factor, y: py - (py - this.camera.y) * factor }
      this.move()
    }, { passive: false })
    element.addEventListener('dblclick', () => this.fit())
  }
}

const rows = session.projects.map(() => new Row())
document.getElementById('projects')!.append(...rows.map(row => row.element))

const overall = choiceControl(choice => {
  ratings[current]!.overall = choice
  save()
  overall.set(choice)
  renderDots()
})
document.getElementById('overall')!.append(overall.element)
const why = document.getElementById('why') as HTMLTextAreaElement
why.addEventListener('input', () => {
  ratings[current]!.why = why.value
  save()
})
const nextComparison = document.getElementById('next-comparison') as HTMLButtonElement
nextComparison.addEventListener('click', () => current + 1 < session.comparisons.length ? go(current + 1) : showReport())
document.getElementById('previous')!.addEventListener('click', () => go(current - 1))
document.getElementById('next')!.addEventListener('click', () => go(current + 1))
const dialog = document.getElementById('report-dialog') as HTMLDialogElement
const reportText = document.getElementById('report-text') as HTMLTextAreaElement
document.getElementById('report')!.addEventListener('click', showReport)
document.getElementById('copy')!.addEventListener('click', () => {
  reportText.select()
  void navigator.clipboard?.writeText(reportText.value)
})
document.getElementById('close')!.addEventListener('click', () => dialog.close())
// The header is for the mouse: Tab walks the ratings only.
for (const element of document.querySelectorAll<HTMLElement>('header button')) element.tabIndex = -1

function showReport() {
  reportText.value = report()
  dialog.showModal()
}

function go(index: number) {
  if (index < 0 || index >= session.comparisons.length) return
  current = index
  render()
  window.scrollTo({ top: 0 })
  rows[0]?.choice.element.focus({ preventScroll: true })
}

let shown = -1
function render() {
  const comparison = session.comparisons[current]!
  if (shown !== current) {
    rows.forEach((row, project) => row.show(session.projects[project]!, [comparison.sides[0].layouts[project]!, comparison.sides[1].layouts[project]!]))
    shown = current
  }
  overall.set(ratings[current]!.overall)
  why.value = ratings[current]!.why
  nextComparison.textContent = current + 1 < session.comparisons.length ? 'Next comparison →' : 'Show report'
  document.getElementById('position')!.textContent = `comparison ${current + 1} of ${session.comparisons.length}`
  renderDots()
}

function renderDots() {
  const dots = session.comparisons.map((_, index) => {
    const dot = button(String(index + 1), () => go(index))
    dot.classList.add('dot')
    dot.tabIndex = -1
    dot.classList.toggle('done', !!ratings[index]!.overall)
    dot.classList.toggle('current', index === current)
    return dot
  })
  document.getElementById('dots')!.replaceChildren(...dots)
}

// One tab stop with three options: h left, j or k same, l right (or the arrow keys).
function choiceControl(onChoose: (choice: Choice) => void) {
  const element = document.createElement('div')
  element.className = 'choice'
  element.tabIndex = 0
  element.setAttribute('role', 'radiogroup')
  const buttons = CHOICES.map(({ choice, label, key }) => {
    const option = button(`${label} (${key})`, () => onChoose(choice))
    option.tabIndex = -1
    option.setAttribute('role', 'radio')
    return option
  })
  element.append(...buttons)
  const keys: Record<string, Choice> = { h: 'left', ArrowLeft: 'left', j: 'same', k: 'same', ArrowDown: 'same', l: 'right', ArrowRight: 'right' }
  element.addEventListener('keydown', event => {
    const choice = keys[event.key]
    if (!choice || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    onChoose(choice)
  })
  return {
    element,
    set(chosen: Choice | undefined) {
      buttons.forEach((option, index) => {
        option.classList.toggle('chosen', CHOICES[index]!.choice === chosen)
        option.setAttribute('aria-checked', String(CHOICES[index]!.choice === chosen))
      })
    }
  }
}

function report() {
  return `Layout rating report ${session.id}\n` + JSON.stringify(session.comparisons.map((comparison, index) => ({
    comparison: index + 1,
    hypothesis: comparison.hypothesis,
    left: { ...comparison.sides[0].settings, ...comparison.sides[0].mechanics },
    right: { ...comparison.sides[1].settings, ...comparison.sides[1].mechanics },
    ...ratings[index]
  })), null, 1)
}

function loop() {
  for (const row of rows) row.tick()
  requestAnimationFrame(loop)
}

function load(): SessionRating[] | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SessionRating[] | null
    return stored?.length === session.comparisons.length ? stored : null
  } catch {
    return null
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings))
  } catch {
    // Without storage the ratings last until the page closes.
  }
}

function button(label: string, onClick: () => void) {
  const element = document.createElement('button')
  element.textContent = label
  element.addEventListener('click', onClick)
  return element
}

// GraphView's getNodeTitleLines: words wrapped at 12 characters, at most four lines.
function titleLines(text: string) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = words[0] ?? ''
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length <= 12) line += (line.length > 0 ? ' ' : '') + word
    else {
      lines.push(line)
      line = word
    }
  }
  lines.push(line)
  if (lines.length > 4) {
    lines.length = 3
    lines[2] += '...'
  }
  return lines
}

// The nearest 90% of ideas around the median, as the graph's recenter button:
// far unconnected ideas would otherwise shrink everything.
function core(nodes: NodeData[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
  const [cx, cy] = [median(nodes.map(node => node.x)), median(nodes.map(node => node.y))]
  const nearest = [...nodes].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, Math.ceil(nodes.length * 0.9))
  const left = Math.min(...nearest.map(node => node.x - node.r))
  const right = Math.max(...nearest.map(node => node.x + node.r))
  const top = Math.min(...nearest.map(node => node.y - node.r))
  const bottom = Math.max(...nearest.map(node => node.y + node.r))
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top }
}

function escape(text: string) {
  return text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!)
}

void Promise.all(rows.map(row => row.init())).then(() => {
  render()
  loop()
})
