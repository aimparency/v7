// Arrow Fragment Shader (Trunk)
// Renders arc-based arrow trunk using square distance checks

#ifdef GL_ES
precision mediump float;
#endif

// Input from vertex shader
varying vec2 v_worldPos;      // Fragment position in world space
varying vec2 v_startPos;      // Arrow start position
varying vec2 v_endPos;        // Arrow end position
varying vec2 v_arcCenter1;    // Inner arc center (M1)
varying vec2 v_arcCenter2;    // Outer arc center (M2)
varying float v_radiusInnerSq;   // Inner radius squared at base (r1s)
varying float v_radiusOuterSq;   // Outer radius squared at base (r2s)
varying float v_radiusCenterSq;  // Center radius squared
varying float v_taperFactor;     // Tapering factor
varying vec3 v_color;         // Arrow color
varying float v_opacity;      // Arrow opacity

void main() {
  // Calculate phase (position along arrow from start to end)
  // Project fragment position onto arrow direction vector
  vec2 arrowDir = v_endPos - v_startPos;
  float arrowLength = length(arrowDir);
  vec2 arrowDirNorm = arrowDir / arrowLength;

  vec2 toFragment = v_worldPos - v_startPos;
  float projectionLength = dot(toFragment, arrowDirNorm);
  float phase = clamp(projectionLength / arrowLength, 0.0, 1.0);

  // Apply phase-based width tapering
  // Formula: f * (r1s - rCenterSquared) + rCenterSquared
  // Where f goes from 0.0 (full width at base) to taperFactor (tapered at tip)
  float f = phase * v_taperFactor;

  float r1s_tapered = f * (v_radiusCenterSq - v_radiusInnerSq) + v_radiusInnerSq;
  float r2s_tapered = f * (v_radiusCenterSq - v_radiusOuterSq) + v_radiusOuterSq;

  // Compute square distances to arc centers
  vec2 diff1 = v_worldPos - v_arcCenter1;
  float d1s = dot(diff1, diff1); // Square distance to inner arc center

  vec2 diff2 = v_worldPos - v_arcCenter2;
  float d2s = dot(diff2, diff2); // Square distance to outer arc center

  // Discard fragments outside the tapered arc region
  // Keep fragments where:
  // - Distance to inner center is within tapered inner radius: d1s <= r1s_tapered
  // - Distance to outer center is outside tapered outer radius: d2s >= r2s_tapered
  if (d1s > r1s_tapered || d2s < r2s_tapered) {
    discard;
  }

  // Apply color and opacity
  gl_FragColor = vec4(v_color, v_opacity);
}
