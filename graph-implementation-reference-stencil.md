# Graph Implementation Reference Stencil

This document outlines the plan to align the current `GraphView` implementation with the reference `Map.vue` logic, incorporating specific user feedback.

## 1. Interaction Logic
- [ ] **State Machine**: Implement explicit `connecting`, `dragging` (relative), and `layouting` states in `mapStore`.
- [ ] **Connect vs. Select**: 
    - Click/Touch on unselected aim -> Select.
    - Drag on unselected aim -> Pan map? (User said "aims should not be able to be moved directly"). Wait, reference allows dragging to update relative position? 
    - User Clarification: "aims should not be able to be moved directly. we only position relatively".
    - Implication: Dragging an aim updates the `relativePosition` of the link from its parent(s), NOT the aim's absolute position directly (physics engine handles absolute pos).
- [ ] **Drag-to-Connect**:
    - Drag on *selected* aim -> Start `connecting` mode.
    - Show visual arrow/connector to mouse cursor.
    - Release on another aim -> Create connection (Flow).

## 2. Positioning & Physics
- [ ] **Scale**: Change `LOGICAL_HALF_SIDE` to **1000** (was 100).
    - Update all force constants and thresholds to match this scale.
    - This handles browser SVG precision issues.
- [ ] **Relative Positioning Logic**:
    - Port the logic where "dragging" an aim calculates the new `relativePosition` (vector from parent to child normalized by radii sum) and updates the data store.
    - Physics engine then relaxes the graph based on these constraints.
- [ ] **Jitter Fix**: 
    - Investigate "major jitter". Check `deltaTime` units (ms vs s) in force calculations.
    - Ensure forces are normalized to the new 1000 scale.
    - Implement the "deadzone" (`minShift`) from reference to stop micro-movements.

## 3. Visuals
- [ ] **Connector**: Implement `<Connector>` component (dynamic arrow following mouse).
- [ ] **Flows**: Port `FlowSVG.vue` logic for beautiful curved arrows (using `make-circular-path` utils).
- [ ] **Node Visuals**: 
    - Radius Formula: `r = NODE_RADIUS_BASE + Math.sqrt(aimValue + 0.1 * avgAimValue)`.
    - `avgAimValue` = Total Intrinsic Value / Aim Count.
    - System maintains value conservation (Total Value = Total Intrinsic).
    - Ensure scaling works with `LOGICAL_HALF_SIDE = 1000`.

## 4. Camera & Controls
- [ ] **Smooth Pan**: Keep current Lerp logic (`pan += (target - pan) * dt * 0.1`).
- [ ] **Detach on Pan**: If user manually pans/zooms, stop the auto-tracking of the selected aim immediately.
- [ ] **Touch**: Port pinch-to-zoom logic (2-finger handling) from reference.

## 5. Exclusions
- [x] No Summit Background pattern needed.
