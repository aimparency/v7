// Arrow Fragment Shader (Simplified Arc-Based)
// Renders annulus segment with bounds checking

#ifdef GL_ES
precision highp float;
#endif

// Varyings from vertex shader
varying vec2 v_worldPos;
varying vec2 v_arcCenter;
varying float v_radiusOuterSq;
varying float v_radiusInnerSq;
varying vec2 v_sourceCenter;
varying vec2 v_targetCenter;
varying float v_targetRadiusSq;
varying vec3 v_color;
varying float v_opacity;
varying float v_phase;  // 0 at source, 1 at tip (for future tapering)

void main() {
  // Distance squared from fragment to arc center M
  vec2 toCenter = v_worldPos - v_arcCenter;
  float distSq = dot(toCenter, toCenter);

  // Annulus test: r2² <= dist² <= r1²
  bool inRing = distSq >= v_radiusInnerSq && distSq <= v_radiusOuterSq;

  // Start bound: fragment should be on the "arrow side" of the radial through S
  // Use cross product to check which side of the M→S line we're on
  // We want the SHORT side of the arc (between S and T, not the long way around)
  vec2 toSource = v_sourceCenter - v_arcCenter;
  vec2 toFrag = v_worldPos - v_arcCenter;
  float crossStart = toSource.x * toFrag.y - toSource.y * toFrag.x;
  bool pastStart = crossStart <= 0.0;  // Flipped: short side of arc

  // End bound: fragment should be outside target circle
  vec2 toTarget = v_worldPos - v_targetCenter;
  float distToTargetSq = dot(toTarget, toTarget);
  bool beforeEnd = distToTargetSq >= v_targetRadiusSq;

  // Combined test
  bool isArrow = inRing && pastStart && beforeEnd;

  if (isArrow) {
    gl_FragColor = vec4(v_color, v_opacity);
  } else {
    // Debug: magenta background for quad
    gl_FragColor = vec4(1.0, 0.0, 1.0, 0.3);
  }
}
