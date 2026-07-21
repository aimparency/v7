import { ref, onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useUIModalStore } from '../stores/ui/modal-store'
import { useGraphUIStore } from '../stores/ui/graph-store'
import { useProjectStore } from '../stores/project-store'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import * as vec2 from '../utils/vec2'
import { trpc } from '../trpc'
import { type GraphNode, type GraphLink, useGraphSimulation } from './useGraphSimulation'

export function useGraphInteraction(
    elementRef: Ref<HTMLElement | SVGSVGElement | undefined>,
    width: Ref<number>,
    height: Ref<number>,
    simulation: ReturnType<typeof useGraphSimulation>
) {
    // Alias for backwards compatibility
    const svgRef = elementRef
    const dataStore = useDataStore()
    const uiStore = useUIStore()
    const modalStore = useUIModalStore()
    const projectStore = useProjectStore()
    const graphUIStore = useGraphUIStore()
    const mapStore = useMapStore()

    const { nodes, links, nodeMap, freezings, onTick } = simulation

    // State for layouting handle
    const layoutingHandlePos = vec2.create()
    let connectionHandled = false
    
    // Zoom state
    const isZooming = ref(false)
    let zoomTimeout: number | undefined

    // --- Helpers ---
    const updateHalfSide = () => {
        if (!svgRef.value) return
        let w = svgRef.value.clientWidth
        let h = svgRef.value.clientHeight

        // Guard: don't set halfSide to 0 (causes NaN in coordinate transforms)
        if (w === 0 || h === 0) return

        width.value = w
        height.value = h
        if(w > h) {
            mapStore.clientOffset = [ (w - h) / 2, 0 ]
            mapStore.halfSide = h / 2
            mapStore.xratio = w/h
            mapStore.yratio = 1
        } else {
            mapStore.clientOffset = [ 0, (h - w) / 2 ]
            mapStore.halfSide = w / 2
            mapStore.xratio = 1
            mapStore.yratio = h/w
        }
    }

    const getLocalPos = (clientX: number, clientY: number) => {
        if (!svgRef.value) return vec2.fromValues(0, 0)
        const rect = svgRef.value.getBoundingClientRect()
        return vec2.fromValues(clientX - rect.left, clientY - rect.top)
    }

    // --- Interaction Logic ---
    const updatePan = (d: vec2.T) => {
        const pb = mapStore.panBeginning; 
        if(pb !== undefined) {
            const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
            const scaledD = vec2.crScale(d, s)
            
            const offset = vec2.clone(pb.offset)
            vec2.sub(offset, offset, scaledD)
            mapStore.offset = offset  
        }
    }

    const updateDrag = (d: vec2.T) => {
        const db = mapStore.dragBeginning;
        const node = mapStore.dragCandidate as GraphNode; 
        if(db && node) {
            const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
            const scaledD = vec2.crScale(d, s)
            
            const pos = vec2.clone(db.pos)
            vec2.sub(pos, pos, scaledD) 
            node.pos = pos
        }
    }

    const updateLayout = (d: vec2.T) => {
        const lc = mapStore.layoutCandidate
        if(lc) {
            const s = LOGICAL_HALF_SIDE / (mapStore.halfSide * mapStore.scale)
            const scaledD = vec2.crScale(d, s)
            vec2.sub(layoutingHandlePos, lc.start, scaledD)
        }
    }

    const updateRelativeDeltaWhileLayouting = () => {
        const lc = mapStore.layoutCandidate
        if (mapStore.layouting && lc) {
            const copyLink = lc.link as GraphLink
            // Find the real link in simulation
            const realLink = links.value.find(l => l.source.id === copyLink.source.id && l.target.id === copyLink.target.id)
            
            if (realLink) {
                const M = vec2.crMix(
                    realLink.source.pos, 
                    realLink.target.pos, 
                    lc.fromWeight
                )
                const arm = vec2.crSub(layoutingHandlePos, M) 
                
                // Update REAL link
                const newRel = vec2.create()
                vec2.scale(newRel, arm, lc.dScale)
                realLink.relativePosition = newRel
                
                // Update COPY as well (so handle stays synced if it uses copy)
                copyLink.relativePosition = newRel

                // Force visual update
                simulation.trigger.value++
            }
        }
    }

    // Register tick callback
    onTick(() => {
        if (mapStore.layouting) {
            updateRelativeDeltaWhileLayouting()
        }
    })

    const beginWhatever = (mouse: vec2.T) => {
        mapStore.isTracking = false
        mapStore.updateMouse(mouse) 
        mapStore.mousePhysBegin = vec2.clone(mouse)
        
        if(mapStore.dragCandidate) {
            mapStore.dragBeginning = {
                pos: vec2.clone(mapStore.dragCandidate.pos) 
            }
        } else if (mapStore.layoutCandidate) {
            updateLayout(vec2.create())
        } else if (mapStore.connectFrom) {
            // connecting
        } else {
            mapStore.panBeginning = {
                offset: vec2.clone(mapStore.offset)
            }
        } 
    }

    const endWhatever = () => {
        if(mapStore.panBeginning) {
            mapStore.panBeginning = undefined
        } else if (mapStore.dragBeginning) {
            // Update relative positions for links
            const node = mapStore.dragCandidate as GraphNode
            if (node && links.value) {
                links.value.forEach(link => {
                    if (link.target === node) {
                        const child = link.source
                        const parent = node
                        const deltaX = child.pos[0] - parent.pos[0]
                        const deltaY = child.pos[1] - parent.pos[1]
                        const rSum = parent.r + child.r 
                        const relX = deltaX / rSum
                        const relY = deltaY / rSum
                        
                        ;(dataStore as any).updateConnectionPosition(
                            projectStore.projectPath,
                            parent.id,
                            child.id,
                            [relX, relY]
                        )
                        link.relativePosition = [relX, relY]
                    } else if (link.source === node) {
                        const child = node
                        const parent = link.target
                        const deltaX = child.pos[0] - parent.pos[0]
                        const deltaY = child.pos[1] - parent.pos[1]
                        const rSum = parent.r + child.r 
                        const relX = deltaX / rSum
                        const relY = deltaY / rSum
                        
                        ;(dataStore as any).updateConnectionPosition(
                            projectStore.projectPath,
                            parent.id,
                            child.id,
                            [relX, relY]
                        )
                        link.relativePosition = [relX, relY]
                    }
                })
            }
            
            mapStore.dragBeginning = undefined
            mapStore.dragCandidate = undefined
            
            if (node) {
                freezings.set(node.id, Date.now())
            }
        } else if (mapStore.layouting) {
            const lc = mapStore.layoutCandidate
            if (lc) {
                const link = lc.link as GraphLink
                ;(dataStore as any).updateConnectionPosition(
                    projectStore.projectPath,
                    link.target.id,
                    link.source.id,
                    [link.relativePosition[0], link.relativePosition[1]]
                )
            }
            mapStore.layouting = false
            mapStore.layoutCandidate = undefined
        } else if (mapStore.connecting) {
            if (!connectionHandled && mapStore.connectFrom && mapStore.cursorMoved) {
                const parentNode = mapStore.connectFrom
                const dropPosLogical = mapStore.mouse.logical  // Use already-computed logical coords
                
                modalStore.aimCreationCallback = async (newAimId, onConnectionConfirmed) => {
                     // Wait for node to exist in the graph
                     const checkNode = () => {
                         const newNode = nodeMap.get(newAimId)
                         if (newNode) {
                             // Validate drop position
                             const x = dropPosLogical[0] ?? 0
                             const y = dropPosLogical[1] ?? 0

                             // 1. Position the new node
                             newNode.pos[0] = x
                             newNode.pos[1] = y
                             newNode.renderPos[0] = x
                             newNode.renderPos[1] = y
                             newNode.shift = [0, 0]

                             // 2. Connect parent -> newAim
                             const parentX = parentNode.pos[0] ?? 0
                             const parentY = parentNode.pos[1] ?? 0
                             const parentR = parentNode.r ?? 25
                             const childR = newNode.r ?? 25

                             const deltaX = x - parentX
                             const deltaY = y - parentY
                             const rSum = parentR + childR
                             const relPos: [number, number] = [deltaX/rSum, deltaY/rSum]

                             trpc.aim.connectAims.mutate({
                                projectPath: projectStore.projectPath,
                                parentAimId: parentNode.id,
                                childAimId: newAimId,
                                relativePosition: relPos as [number, number]
                             }).then(async () => {
                                 // Reload both aims to get updated incoming/outgoing arrays
                                 await dataStore.loadAims(projectStore.projectPath, [parentNode.id, newAimId])
                                 // Let Vue's watcher flush so updateGraphData runs and newNode.r reflects
                                 // the actual post-connection value (not the zero-value initial radius).
                                 await nextTick()
                                 const updatedChildR = newNode.r ?? 25
                                 const correctedRelPos: [number, number] = [deltaX / (parentR + updatedChildR), deltaY / (parentR + updatedChildR)]
                                 // Snap node back to the exact drop position
                                 newNode.pos[0] = x
                                 newNode.pos[1] = y
                                 newNode.renderPos[0] = x
                                 newNode.renderPos[1] = y
                                 newNode.shift = [0, 0]
                                 // Update the link so the flow force uses the corrected relPos immediately
                                 const correctedLink = links.value.find(l => l.source.id === newAimId && l.target.id === parentNode.id)
                                 if (correctedLink) correctedLink.relativePosition = correctedRelPos
                                 // Persist the corrected relative position
                                 await (dataStore as any).updateConnectionPosition(projectStore.projectPath, parentNode.id, newAimId, correctedRelPos)
                                 // Offer contribution % + explanation for the new connection.
                                 modalStore.openConnectionDetailsModal(parentNode.id, newAimId, onConnectionConfirmed)
                             }).catch(err => {
                                 console.error('Graph: Connection failed', err)
                             })
                         } else {
                             setTimeout(checkNode, 50)
                         }
                     }
                     checkNode()
                }
                modalStore.openAimModal('graph')
            }
            mapStore.connecting = false
            mapStore.connectFrom = undefined
        }
        
        setTimeout(() => { mapStore.cursorMoved = false })
    }

    const updateWhatever = (mouse: vec2.T) => {
        mapStore.updateMouse(mouse)
        const d = vec2.crSub(mapStore.mousePhysBegin, mouse)
        
        if(vec2.len2(d) > 25 || mapStore.cursorMoved) {
            let actionOngoing = true
            if(mapStore.panBeginning) {
                updatePan(d); 
            } else if (mapStore.dragBeginning) {
                updateDrag(d); 
            } else if (mapStore.layouting) {
                updateLayout(d);
            } else if (mapStore.layoutCandidate) {
                mapStore.layouting = true
                updateLayout(d);
            } else if (mapStore.connecting) {
                // Keep actionOngoing true
            } else {
                actionOngoing = false
            }
            if(actionOngoing) {
                mapStore.cursorMoved = true
                mapStore.stopAnim()
            }
        }
    }

    // --- Event Handlers ---
    const onMouseMove = (e: MouseEvent) => {
        updateWhatever(getLocalPos(e.clientX, e.clientY))
    }
    const onMouseDown = (e: MouseEvent) => {
        const mouse = getLocalPos(e.clientX, e.clientY)
        beginWhatever(mouse)
    }
    const onMouseUp = () => endWhatever()
    const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        mapStore.isTracking = false
        const mouse = getLocalPos(e.clientX, e.clientY)
        const f = Math.pow(1.1, -e.deltaY / 150)
        mapStore.zoom(f, mouse)
        
        // Handle isZooming state
        isZooming.value = true
        if (zoomTimeout) window.clearTimeout(zoomTimeout)
        zoomTimeout = window.setTimeout(() => {
            isZooming.value = false
        }, 200)
    }

    // Touch Handling (Ported)
    let touchState = { currentCount: 0, dragFingerId: 0 }
    let nodeLongPressTimer: number | undefined
    let longPressedNodeId: string | null = null
    let pinchBeginning: undefined | {
        first: number, 
        second: number, 
        mLogical: vec2.T, 
        distancePage: number, 
        offset: vec2.T, 
        scale: number, 
    };

    // Begin a 2-finger pinch/zoom from the current two touches. Also used when a
    // second finger is added mid-pan (pan -> zoom).
    const beginPinch = (t1: Touch, t2: Touch) => {
        mapStore.connectFrom = undefined
        const firstPage = getLocalPos(t1.clientX, t1.clientY)
        const secondPage = getLocalPos(t2.clientX, t2.clientY)
        const mPhysical = vec2.clone(firstPage)
        vec2.add(mPhysical, mPhysical, secondPage)
        vec2.scale(mPhysical, mPhysical, 0.5)
        const mLogical = mapStore.physicalToLogicalCoord(mPhysical)
        pinchBeginning = {
            first: t1.identifier,
            second: t2.identifier,
            mLogical,
            distancePage: vec2.dist(firstPage, secondPage),
            offset: vec2.clone(mapStore.offset),
            scale: mapStore.scale
        }
        isZooming.value = true
    }

    // Begin a 1-finger pan from the given touch. Also used when one finger is
    // lifted from a pinch, so the remaining finger continues as a pan (zoom -> pan).
    const beginPan = (t: Touch) => {
        touchState.dragFingerId = t.identifier
        beginWhatever(getLocalPos(t.clientX, t.clientY))
    }

    // Tear down whichever gesture matches the current finger count.
    const endActiveGesture = () => {
        if (touchState.currentCount > 1) {
            pinchBeginning = undefined
            isZooming.value = false
        } else if (touchState.currentCount === 1) {
            endWhatever()
        }
    }

    // Re-derive the active gesture from the live touch list. Called on every finger
    // add/remove so pinch<->pan transitions re-baseline instead of jumping: lifting
    // one finger of a pinch continues as a pan; adding a finger to a pan promotes it
    // to a pinch.
    const resyncTouchGesture = (e: TouchEvent) => {
        const n = e.touches.length
        if (n === touchState.currentCount) return
        endActiveGesture()
        if (n >= 2) {
            beginPinch(e.touches[0]!, e.touches[1]!)
            touchState.currentCount = 2
        } else if (n === 1) {
            beginPan(e.touches[0]!)
            touchState.currentCount = 1
        } else {
            touchState.currentCount = 0
        }
    }

    const onTouchStart = (e: TouchEvent) => {
        resyncTouchGesture(e)
    }

    const onTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        if(touchState.currentCount == 1) {
            if (e.touches.length > 0) {
                const t = e.touches[0]!
                let mouse = getLocalPos(t.clientX, t.clientY)
                updateWhatever(mouse)
                if (mapStore.cursorMoved && nodeLongPressTimer !== undefined) {
                    window.clearTimeout(nodeLongPressTimer)
                    nodeLongPressTimer = undefined
                }
            }
        } else if (touchState.currentCount > 1) {
            if(pinchBeginning && e.touches.length > 1) {
                const t1 = e.touches[0]!
                const t2 = e.touches[1]!
                let firstPage = getLocalPos(t1.clientX, t1.clientY)
                let secondPage = getLocalPos(t2.clientX, t2.clientY)
                let distancePage = vec2.dist(firstPage, secondPage)
                let mPhysical = vec2.clone(firstPage) 
                vec2.add(mPhysical, mPhysical, secondPage) 
                vec2.scale(mPhysical, mPhysical, 0.5) 
                let mLogical = mapStore.physicalToLogicalCoord(mPhysical) 
                let scaleChange = distancePage / pinchBeginning.distancePage 
                mapStore.scale = pinchBeginning.scale * scaleChange
                vec2.sub(mLogical, mLogical, pinchBeginning.mLogical) 
                vec2.add(mapStore.offset, mapStore.offset, mLogical) 
            }
        }
    }

    const onTouchEnd = (e: TouchEvent) => {
        // e.touches is the remaining touches: 1 left -> hand off to pan, 0 -> end.
        resyncTouchGesture(e)
    }

    // Node Events
    const onNodeDown = (e: MouseEvent | TouchEvent, nodeCopy: GraphNode) => {
        const node = nodeMap.get(nodeCopy.id)
        if (!node) return
        if (e instanceof TouchEvent) {
            if (nodeLongPressTimer !== undefined) window.clearTimeout(nodeLongPressTimer)
            longPressedNodeId = null
            nodeLongPressTimer = window.setTimeout(() => {
                nodeLongPressTimer = undefined
                if (mapStore.cursorMoved) return
                if (node.isRepo) return
                if (uiStore.multiSelectMode && uiStore.isMultiSelected(node.id)) {
                    modalStore.openAimEditModal(node.id, [...uiStore.multiSelectedAimIds])
                    longPressedNodeId = node.id
                    return
                }
                if (uiStore.multiSelectMode) {
                    uiStore.toggleMultiSelect(node.id)
                } else {
                    uiStore.enterMultiSelect(node.id)
                }
                graphUIStore.setGraphSelection(node.id)
                graphUIStore.deselectLink()
                longPressedNodeId = node.id
            }, 450)
        }
        // Black-box repo nodes are read-only: you can reposition them, but never
        // start a connection FROM them (a repo is always a supporter/child and
        // never declares that it needs another aim).
        if (node.isRepo) {
            mapStore.startDragging(node)
            return
        }
        const selectedId = graphUIStore.graphSelectedAimId
        if (selectedId && selectedId === node.id) {
            mapStore.startConnecting(node)
            connectionHandled = false
        } else {
            mapStore.startDragging(node)
        }
    }

    const onNodeUp = async (node: GraphNode) => {
        if (nodeLongPressTimer !== undefined) {
            window.clearTimeout(nodeLongPressTimer)
            nodeLongPressTimer = undefined
        }
        if (mapStore.connecting && mapStore.connectFrom) {
            if (mapStore.connectFrom.id === node.id) {
                // Released on same node where connection started - cancel
                connectionHandled = true
                return
            }
            connectionHandled = true
            const parent = mapStore.connectFrom as GraphNode
            const child = node

            // Can't form a normal aim→aim connection onto a black-box repo node.
            // Repo links are created through the dedicated 'link a whole repo' UX,
            // not by dragging a connection onto the repo node.
            if (parent.isRepo || child.isRepo) {
                return
            }

            // Validate positions and radii
            const parentX = parent.pos?.[0] ?? 0
            const parentY = parent.pos?.[1] ?? 0
            const childX = child.pos?.[0] ?? 0
            const childY = child.pos?.[1] ?? 0
            const parentR = parent.r ?? 25
            const childR = child.r ?? 25

            const deltaX = childX - parentX
            const deltaY = childY - parentY
            const rSum = parentR + childR
            const relativePosition: [number, number] = [deltaX / rSum, deltaY / rSum]

            try {
                await trpc.aim.connectAims.mutate({
                    projectPath: projectStore.projectPath,
                    parentAimId: parent.id,
                    childAimId: child.id,
                    relativePosition,
                })
                // Reload both aims to get updated incoming/outgoing arrays
                await dataStore.loadAims(projectStore.projectPath, [parent.id, child.id])
                // Offer contribution % + explanation for the new connection.
                modalStore.openConnectionDetailsModal(parent.id, child.id)
            } catch (e) {
                console.error('Failed to connect aims:', e)
            }
        }
    }

    const onNodeClick = async (node: GraphNode, event?: MouseEvent) => {
        if (longPressedNodeId === node.id) {
            longPressedNodeId = null
            return
        }
        // In spin-off preview, a click toggles the aim as a root (multi-select)
        // and recolors the graph — no selection / detail panel.
        if (graphUIStore.graphColorMode === 'spin-off') {
            if (!mapStore.cursorMoved) graphUIStore.toggleSpinOffRoot(node.id)
            return
        }
        // A black-box repo node has no aim detail to select/track — it's an
        // opaque modular boundary. Clicking it is a no-op for now (open/focus the
        // linked repo is a later refinement); never select it as an aim.
        if (node.isRepo) return

        const isCtrl = event && (event.ctrlKey || event.metaKey)
        const isShift = event && event.shiftKey

        if (isShift) {
            // Shift = range/add to multi (for graph, just add since no linear order; could extend to bbox/path later)
            uiStore.addToMultiSelect(node.id)
            if (!mapStore.cursorMoved) {
                graphUIStore.setGraphSelection(node.id)
                graphUIStore.deselectLink()
            }
            uiStore.setMultiAnchor(node.id)
            return
        }
        if (isCtrl || uiStore.multiSelectMode) {
            // Ctrl = toggle
            uiStore.toggleMultiSelect(node.id)
            if (!mapStore.cursorMoved) {
                graphUIStore.setGraphSelection(node.id)
                graphUIStore.deselectLink()
            }
            return
        }

        if (!mapStore.cursorMoved) {
            uiStore.clearMultiSelect()
            if (graphUIStore.graphSelectedAimId === node.id) {
                // Already selected -> Start tracking
                mapStore.isTracking = true
            } else {
                // New selection -> Select only (clear multi? optional; keep for now like list)
                graphUIStore.setGraphSelection(node.id)
                graphUIStore.deselectLink()
                mapStore.isTracking = false
            }
        }
    }

    const onBackgroundClick = () => {
        if (!mapStore.cursorMoved && !mapStore.connecting) {
            uiStore.clearMultiSelect()
            graphUIStore.deselectLink()
            graphUIStore.setGraphSelection(null)
        }
    }

    const onDblClick = async (e: MouseEvent) => {
        // Only handle double click on background (not if we hit a node, though this listener is on SVG so it bubbles)
        // But onNodeClick handles single clicks. Double click on node might mean something else (expand?).
        // For now, let's implement "Create Aim" on empty space.
        
        // Check if we are hovering a node? 
        // We can do a hit test or just assume if target is not a node class.
        // But the SVG structure is complex. 
        // Simple heuristic: if we are not "tracking" a node interaction.
        // But dblclick happens after two clicks.
        
        // Let's rely on the fact that if we double click a node, we might want to do something else (like open details).
        // But user asked for "double click in graph to create a free floating aim".
        
        // If we hit a node, e.target would be the circle or text.
        // We can check if e.target is the svg itself or a background group.
        // Or simpler: mapStore has no hover state exposed here easily.
        
        // Let's proceed: if mapStore.hoveredNode is null? (not available here)
        // Let's use a hit test with the simulation nodes?
        const mouse = getLocalPos(e.clientX, e.clientY)
        const logicalMouse = mapStore.physicalToLogicalCoord(mouse)
        
        // Simple hit test
        let hitNode = false
        for (const node of nodes.value) {
            const dx = node.pos[0] - logicalMouse[0]
            const dy = node.pos[1] - logicalMouse[1]
            if (dx*dx + dy*dy < node.r * node.r) {
                hitNode = true
                break
            }
        }
        
        if (!hitNode) {
            // Deselect to ensure creating floating aim
            graphUIStore.setGraphSelection(null)
            uiStore.deselectAim()
            uiStore.setActiveColumn(-1)

            modalStore.aimCreationCallback = (id) => {
                 const node = nodeMap.get(id)
                 const x = logicalMouse[0] ?? 0
                 const y = logicalMouse[1] ?? 0
                 if (node) {
                    node.pos[0] = x
                    node.pos[1] = y
                    node.renderPos[0] = x
                    node.renderPos[1] = y
                    node.shift[0] = 0
                    node.shift[1] = 0
                 } else {
                    setTimeout(() => {
                         const n = nodeMap.get(id)
                         if (n) {
                            n.pos[0] = x
                            n.pos[1] = y
                            n.renderPos[0] = x
                            n.renderPos[1] = y
                            n.shift[0] = 0
                            n.shift[1] = 0
                         }
                    }, 50)
                 }
            }
            
            modalStore.openAimModal('graph')
        }
    }

    // Initialize Listeners
    let resizeObserver: ResizeObserver | undefined
    const onMouseMoveListener: EventListener = (event) => {
        if (event instanceof MouseEvent) onMouseMove(event)
    }
    const onMouseDownListener: EventListener = (event) => {
        if (event instanceof MouseEvent) onMouseDown(event)
    }
    const onMouseUpListener: EventListener = (event) => {
        if (event instanceof MouseEvent) onMouseUp()
    }
    const onDblClickListener: EventListener = (event) => {
        if (event instanceof MouseEvent) void onDblClick(event)
    }
    const onWheelListener: EventListener = (event) => {
        if (event instanceof WheelEvent) onWheel(event)
    }
    const onTouchStartListener: EventListener = (event) => {
        if (event instanceof TouchEvent) onTouchStart(event)
    }
    const onTouchMoveListener: EventListener = (event) => {
        if (event instanceof TouchEvent) onTouchMove(event)
    }
    const onTouchEndListener: EventListener = (event) => {
        if (event instanceof TouchEvent) onTouchEnd(event)
    }

    const initListeners = () => {
        if (svgRef.value) {
            svgRef.value.addEventListener("mousemove", onMouseMoveListener)
            svgRef.value.addEventListener("mousedown", onMouseDownListener)
            svgRef.value.addEventListener("mouseup", onMouseUpListener)
            svgRef.value.addEventListener("dblclick", onDblClickListener)
            svgRef.value.addEventListener("wheel", onWheelListener, { passive: false })
            svgRef.value.addEventListener("touchstart", onTouchStartListener, { passive: false })
            svgRef.value.addEventListener("touchmove", onTouchMoveListener, { passive: false })
            svgRef.value.addEventListener("touchend", onTouchEndListener)
            svgRef.value.addEventListener("touchcancel", onTouchEndListener)

            resizeObserver = new ResizeObserver(() => {
                updateHalfSide()
            })
            resizeObserver.observe(svgRef.value)
        }
        window.addEventListener('resize', updateHalfSide)
        updateHalfSide()
    }

    const cleanupListeners = () => {
        if (nodeLongPressTimer !== undefined) {
            window.clearTimeout(nodeLongPressTimer)
            nodeLongPressTimer = undefined
        }
        if (svgRef.value) {
            svgRef.value.removeEventListener("mousemove", onMouseMoveListener)
            svgRef.value.removeEventListener("mousedown", onMouseDownListener)
            svgRef.value.removeEventListener("mouseup", onMouseUpListener)
            svgRef.value.removeEventListener("dblclick", onDblClickListener)
            svgRef.value.removeEventListener("wheel", onWheelListener)
            svgRef.value.removeEventListener("touchstart", onTouchStartListener)
            svgRef.value.removeEventListener("touchmove", onTouchMoveListener)
            svgRef.value.removeEventListener("touchend", onTouchEndListener)
            svgRef.value.removeEventListener("touchcancel", onTouchEndListener)
        }
        if (resizeObserver) {
            resizeObserver.disconnect()
            resizeObserver = undefined
        }
        window.removeEventListener('resize', updateHalfSide)
    }

    return {
        initListeners,
        cleanupListeners,
        onNodeDown,
        onNodeUp,
        onNodeClick,
        onBackgroundClick,
        onMouseDown,
        onMouseMove,
        onMouseUp,
        isZooming
    }
}
