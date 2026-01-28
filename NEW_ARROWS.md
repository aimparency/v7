# Arc-Based Arrow Rendering Specification

## Overview

Instead of Bezier curves, we use arc-based rendering with inner and outer radii. This approach is computationally cheaper as it only requires per-fragment distance calculations (multiplications and comparisons) rather than curve evaluation.

## Geometry Approach

### Arrow Trunk (Main Body)

The arrow trunk is rendered using a quad with a fragment shader that:

1. **Computes square distances** to two arc centers:
   - `d1s` = square distance to center M1 (inner arc center)
   - `d2s` = square distance to center M2 (outer arc center)

2. **Fragments are discarded** if:
   ```glsl
   d1s > r1s || d2s < r2s
   ```
   Where:
   - `r1s` = square of inner radius
   - `r2s` = square of outer radius

3. **Positioning**:
   - The arrow trunk centerline passes through the center of the supporting aim
   - The trunk starts at the center of the supporting aim (parent/source)
   - The arrow point touches the circle around the supported aim (child/target)

4. **Width tapering**: The trunk gets slimmer toward the arrow head using phase-based interpolation:
   ```glsl
   f * (r1s - rCenterSquared) + rCenterSquared
   ```
   Where `f` is a phase factor (0.0 to 1.0) that varies along the arrow length.

### Arrow Head

The arrow head is rendered using a separate quad with its own shader:

1. **Vertex shader** computes a vector from "tail to point" of the arrow head

2. **Radius decay**: The inner/outer radii decay linearly from the trunk width to a point:
   ```glsl
   f * (r1 - rCenter) + rCenter
   ```
   Where:
   - `f` decays from 2.0 at the trunk to 0.0 at the point
   - `(r1 - rCenter)` can be precomputed and passed as uniform
   - This phase uses actual radii instead of squared values for smoother decay

3. **Integration**: The arrow head seamlessly connects to the trunk at the appropriate phase point

## Implementation Strategy

### Unified Shader Approach

We could potentially use the same shader for both trunk and head by:
- Including a "phase" parameter that indicates position along arrow
- Linearly interpolating the square distances based on phase
- Adjusting radius calculations based on whether rendering trunk or head

### Performance Benefits

Compared to Bezier curves:
- **Cheaper computation**: Only distance checks per fragment (multiplications + comparisons)
- **No curve evaluation**: No polynomial or recursive subdivision needed
- **GPU-friendly**: All operations are simple arithmetic
- **Scalable**: Performance stays consistent with large numbers of arrows

## Mathematical Details

### Square Distance Calculation
For a point P and center M:
```glsl
vec2 diff = P - M;
float distSquared = dot(diff, diff); // d1s or d2s
```

### Phase-Based Width Variation
Along the arrow length (t from 0.0 to 1.0):
```glsl
// For trunk (squared values)
float r1s_at_t = mix(r1s_base, r1s_tip, t);
float r2s_at_t = mix(r2s_base, r2s_tip, t);

// For head (linear radii for smoother decay)
float r1_at_t = mix(r1_trunk, 0.0, t);
float r2_at_t = mix(r2_trunk, 0.0, t);
```

### Weight Visualization
Arrow width can be controlled by scaling r1 and r2 based on edge weight:
```glsl
float widthScale = mix(minWidth, maxWidth, normalizedWeight);
float r1s = baseR1s * widthScale * widthScale;
float r2s = baseR2s * widthScale * widthScale;
```

## Precomputation Opportunities

To maximize performance:
1. **Precompute** `(r1 - rCenter)` and `(r1s - rCenterSquared)` on CPU
2. **Pass as uniforms** or vertex attributes
3. **Compute arrow geometry** (start point, end point, tangent vectors) on CPU
4. **Upload** only necessary data to GPU (4 vertices per arrow: 2 for trunk quad, 2 for head quad)

## Visual Quality

- Smooth circular arcs provide clean, professional appearance
- Linear interpolation might create interesting visual effect
- Width tapering creates clear directional flow
- Compatible with various arc curvatures by adjusting center positions

## Next Steps

1. Implement basic arc rendering shader for proof-of-concept
2. Test performance with 10,000+ arrows
3. Add arrow head shader
4. Integrate with spatial tree for culling
5. Add weight-based width variation
