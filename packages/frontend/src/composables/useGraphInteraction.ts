import { ref, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUIStore } from '../stores/ui'
import { useMapStore, LOGICAL_HALF_SIDE } from '../stores/map'
import * as vec2 from '../utils/vec2'
import { trpc } from '../trpc'
import { type GraphNode, type GraphLink, useGraphSimulation } from './useGraphSimulation'

export function useGraphInteraction(
    svgRef: Ref<SVGSVGElement | undefined>,
    width: Ref<number>,
    height: Ref<number>,
    simulation: ReturnType<typeof useGraphSimulation>
) {
    const dataStore = useDataStore()
    const uiStore = useUIStore()
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
                            uiStore.projectPath,
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
                            uiStore.projectPath,
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
                    uiStore.projectPath,
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
                
                uiStore.aimCreationCallback = async (newAimId) => {
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
                                projectPath: uiStore.projectPath,
                                parentAimId: parentNode.id,
                                childAimId: newAimId,
                                relativePosition: relPos as [number, number]
                             }).then(async () => {
                                 // Reload both aims to get updated incoming/outgoing arrays
                                 await dataStore.loadAims(uiStore.projectPath, [parentNode.id, newAimId])
                             }).catch(err => {
                                 console.error('Graph: Connection failed', err)
                             })
                         } else {
                             setTimeout(checkNode, 50)
                         }
                     }
                     checkNode()
                }
                uiStore.openAimModal()
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
    let pinchBeginning: undefined | {
        first: number, 
        second: number, 
        mLogical: vec2.T, 
        distancePage: number, 
        offset: vec2.T, 
        scale: number, 
    };

    const onTouchStart = (e: TouchEvent) => {
        if(e.touches.length > 0) {
            if(e.touches.length > 1) {
                if(touchState.currentCount < 2) {
                    mapStore.connectFrom = undefined
                    touchState.currentCount = 2
                    const t1 = e.touches[0]!
                    const t2 = e.touches[1]!
                    let firstPage = getLocalPos(t1.clientX, t1.clientY)
                    let secondPage = getLocalPos(t2.clientX, t2.clientY)
                    let mPhysical = vec2.clone(firstPage) 
                    vec2.add(mPhysical, mPhysical, secondPage) 
                    vec2.scale(mPhysical, mPhysical, 0.5) 
                    let mLogical = mapStore.physicalToLogicalCoord(mPhysical) 
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
            } else {
                if(touchState.currentCount == 0) {
                    touchState.currentCount = 1
                    const t = e.touches[0]!
                    touchState.dragFingerId = t.identifier
                    let mouse = getLocalPos(t.clientX, t.clientY)
                    beginWhatever(mouse)
                } else if (touchState.currentCount > 1) {
                    pinchBeginning = undefined
                }
            }
        }
    }

    const onTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        if(touchState.currentCount == 1) {
            if (e.touches.length > 0) {
                const t = e.touches[0]!
                let mouse = getLocalPos(t.clientX, t.clientY)
                updateWhatever(mouse)
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
        if(touchState.currentCount > 1) {
            pinchBeginning = undefined
            isZooming.value = false
        }
        if(touchState.currentCount > 0) endWhatever()
        touchState.currentCount = 0
    }

    // Node Events
    const onNodeDown = (e: MouseEvent | TouchEvent, nodeCopy: GraphNode) => {
        const node = nodeMap.get(nodeCopy.id)
        if (!node) return
        const selectedId = uiStore.graphSelectedAimId
        if (selectedId && selectedId === node.id) {
            mapStore.startConnecting(node)
            connectionHandled = false
        } else {
            mapStore.startDragging(node)
        }
    }

    const onNodeUp = async (node: GraphNode) => {
        if (mapStore.connecting && mapStore.connectFrom) {
            if (mapStore.connectFrom.id !== node.id) {
                connectionHandled = true
                const parent = mapStore.connectFrom as GraphNode
                const child = node

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
                        projectPath: uiStore.projectPath,
                        parentAimId: parent.id,
                        childAimId: child.id,
                        relativePosition,
                    })
                    // Reload both aims to get updated incoming/outgoing arrays
                    await dataStore.loadAims(uiStore.projectPath, [parent.id, child.id])
                } catch (e) {
                    console.error('Failed to connect aims:', e)
                }
            }
        }
    }

    const onNodeClick = async (node: GraphNode) => {
        if (!mapStore.cursorMoved) {
            if (uiStore.graphSelectedAimId === node.id) {
                // Already selected -> Start tracking
                mapStore.isTracking = true
            } else {
                // New selection -> Select only
                uiStore.setGraphSelection(node.id)
                uiStore.deselectLink()
                mapStore.isTracking = false
            }
        }
    }

    const onBackgroundClick = () => {
        if (!mapStore.cursorMoved && !mapStore.connecting) {
            uiStore.deselectLink()
            uiStore.setGraphSelection(null)
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
            uiStore.setGraphSelection(null)
            uiStore.deselectAim()
            uiStore.setFocusedColumn(-1)

            uiStore.aimCreationCallback = (id) => {
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
            
            uiStore.openAimModal()
        }
    }

    // Initialize Listeners
    let resizeObserver: ResizeObserver | undefined

    const initListeners = () => {
        if (svgRef.value) {
            svgRef.value.addEventListener("mousemove", onMouseMove)
            svgRef.value.addEventListener("mousedown", onMouseDown)
            svgRef.value.addEventListener("mouseup", onMouseUp)
            svgRef.value.addEventListener("dblclick", onDblClick)
            svgRef.value.addEventListener("wheel", onWheel, { passive: false })
            svgRef.value.addEventListener("touchstart", onTouchStart, { passive: false })
            svgRef.value.addEventListener("touchmove", onTouchMove, { passive: false })
            svgRef.value.addEventListener("touchend", onTouchEnd)
            svgRef.value.addEventListener("touchcancel", onTouchEnd)

            resizeObserver = new ResizeObserver(() => {
                updateHalfSide()
            })
            resizeObserver.observe(svgRef.value)
        }
        window.addEventListener('resize', updateHalfSide)
        updateHalfSide()
    }

    const cleanupListeners = () => {
        if (svgRef.value) {
            svgRef.value.removeEventListener("mousemove", onMouseMove)
            svgRef.value.removeEventListener("mousedown", onMouseDown)
            svgRef.value.removeEventListener("mouseup", onMouseUp)
            svgRef.value.removeEventListener("dblclick", onDblClick)
            svgRef.value.removeEventListener("wheel", onWheel)
            svgRef.value.removeEventListener("touchstart", onTouchStart)
            svgRef.value.removeEventListener("touchmove", onTouchMove)
            svgRef.value.removeEventListener("touchend", onTouchEnd)
            svgRef.value.removeEventListener("touchcancel", onTouchEnd)
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
        isZooming
    }
}