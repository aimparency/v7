# Arc-Based Arrow Rendering Specification

## Overview

Arrows are rendered as **annulus segments** (arc slices) using a single arc center M and two radii. This approach requires only per-fragment distance calculations, making it GPU-efficient.

## Core Geometry

### Arc Center Placement

Given:
- **S** = Supporting aim center (source/parent)
- **T** = Supported aim center (target/child)
- **dist** = |T - S| (distance between centers)

The arc center **M** is positioned:
1. On the **perpendicular bisector** of the S→T line
2. At distance `dist * curvature` from the midpoint
3. `curvature` is a tunable parameter (default 0.5)

```
M = midpoint(S, T) + perpendicular(S→T) * dist * curvature
```

Where `perpendicular` rotates 90° clockwise for consistent curve direction.

### Radii (Single Center, Two Radii)

Both the inner and outer edges of the arrow are arcs from the **same center M**:
- **centerRadius** = distance from M to S (equals distance from M to T by symmetry)
- **radiusOuter** (r1) = centerRadius + width/2
- **radiusInner** (r2) = centerRadius - width/2
- **Arrow width** = r1 - r2

### Width Calculation

Matching the SVG implementation:
```
width = widthFactor * targetRadius * share
```
Where:
- `widthFactor` = 1.2 (tunable)
- `targetRadius` = radius of the supported aim
- `share` = contribution share (0-1)

## Fragment Test

A fragment is part of the arrow if:
```glsl
// Annulus test: inside outer, outside inner
bool inRing = distSq >= radiusInnerSq && distSq <= radiusOuterSq;

// Start bound: on the short arc side (towards target, not away)
bool pastStart = cross(M→S, M→fragment) <= 0;

// End bound: outside target circle
bool beforeEnd = distToTargetSq >= targetRadiusSq;

bool isArrow = inRing && pastStart && beforeEnd;
```

## Triangle Rendering (Optimized)

Instead of a quad, we use a **triangle** that precisely covers the arc segment:

### Triangle Vertices

1. **Vertex 0**: Arc center **M**
2. **Vertex 1**: Extended along M→S direction
3. **Vertex 2**: Extended along M→(target circumference point) direction

### Extension Calculation

To ensure the triangle covers the full arc width:
- The triangle edges from M must extend beyond `radiusOuter`
- Calculate the **sagitta** (height of circular segment) to determine extension

For a circular segment with:
- Chord from S to target tip
- Arc center M at distance `centerRadius`

The sagitta h = centerRadius - distance(M to chord midpoint)

Extension factor ensures coverage:
```
extend = radiusOuter / cos(halfAngle)
```
Where `halfAngle` is half the arc's angular span.

### Phase Interpolation

Pass a **phase** value (0 to 1) to each vertex:
- Phase 0 = at supporting aim center (S)
- Phase 1 = at supported aim circumference (tip)

This phase is linearly interpolated across the triangle and used in the fragment shader to:
1. **Taper the trunk**: radii modulated [1.0 → 0.5] along phase
2. **Form the arrow head**: radii modulated [1.0 → 0.0] for the tip portion

### Vertex Data

Per-instance attributes:
- `arcCenter` (vec2): M position
- `radiusOuterSq` (float): r1²
- `radiusInnerSq` (float): r2²
- `sourceCenter` (vec2): S position
- `targetCenter` (vec2): T position
- `targetRadiusSq` (float): for end bound
- `vertex0`, `vertex1`, `vertex2` (vec2 each): triangle corners with phase encoded
- `color` (vec3), `opacity` (float)

Or compute triangle vertices in vertex shader from the above.

## Arrow Shape (Future)

Using the interpolated phase:

### Trunk Tapering
```glsl
// Phase 0→0.8: trunk tapers from full width to half
float trunkPhase = clamp(phase / 0.8, 0.0, 1.0);
float taperFactor = mix(1.0, 0.5, trunkPhase);
float r1_tapered = centerRadius + (width/2) * taperFactor;
float r2_tapered = centerRadius - (width/2) * taperFactor;
```

### Arrow Head
```glsl
// Phase 0.8→1.0: head tapers to point
float headPhase = clamp((phase - 0.8) / 0.2, 0.0, 1.0);
float headTaper = 1.0 - headPhase;  // 1→0
float r1_head = centerRadius + (width/2) * 0.5 * headTaper;
float r2_head = centerRadius - (width/2) * 0.5 * headTaper;
```

## Coordinate System

- Arrow starts at **center** of supporting aim (S)
- Arrow ends at **circumference** of supported aim (tip touches the circle)
- Inner/outer edges at start lie on a **radial line through S from M**

## Performance Benefits

- Single draw call for all arrows (instanced rendering)
- Only distance calculations in fragment shader (no curve evaluation)
- Triangle covers exact needed area (minimal overdraw vs quad)
- Precomputed squared values avoid sqrt in shader
