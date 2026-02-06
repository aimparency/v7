// Arrow Fragment Shader (Normalized Arc-Based)
// All distance checks use normalized coordinates (relative to centerRadius)

#ifdef GL_ES
precision highp float;
#endif

// Varyings from vertex shader
varying vec2 v_worldPos;
varying vec2 v_arcCenter;
varying float v_centerRadius;
varying float v_normalizedHalfWidth;  // Precomputed: halfWidth / centerRadius
varying float v_trunkLength;          // Precomputed: where trunk ends (0-1)
varying vec2 v_sourceDir;             // Precomputed: normalized direction M→S
varying vec2 v_targetCenter;
varying float v_targetRadiusSq;
varying vec3 v_color;
varying float v_opacity;
varying float v_tip;        // 0 at V1, 0.5 at M, 1 at V2 (linear interpolation)
varying float v_distFromM;  // 0 at M, 1 at V1 and V2

void main() {
  // Correct tip from linear to radial interpolation
  // Linear: tip = 0.5*b0 + 0*b1 + 1*b2, distFromM = b1 + b2
  // Radial: correctedTip = b2 / (b1 + b2)
  float correctedTip = (v_tip - 0.5 + 0.5 * v_distFromM) / max(v_distFromM, 0.001);

  // Calculate taper factor based on correctedTip (all precomputed values from CPU)
  // trunk: [0, trunkLength] => taper [1.0, 0.5]
  // head:  [trunkLength, 1] => taper [1.0, 0.0] (restarts at full width)
  float taperFactor;
  if (correctedTip < v_trunkLength) {
    taperFactor = mix(1.0, 0.5, correctedTip / v_trunkLength);
  } else {
    taperFactor = mix(1.0, 0.0, (correctedTip - v_trunkLength) / (1.0 - v_trunkLength));
  }

  // Normalized distance from fragment to arc center M
  vec2 toCenter = v_worldPos - v_arcCenter;
  float dist = length(toCenter);
  float normalizedDist = dist / v_centerRadius;

  // Normalized direction from M to fragment (for cross product)
  vec2 fragDir = toCenter / max(dist, 0.001);

  // Annulus test in normalized space: |normalizedDist - 1| <= taperFactor * normalizedHalfWidth
  float distFromCenterline = abs(normalizedDist - 1.0);
  bool inOriginalRing = distFromCenterline <= v_normalizedHalfWidth;
  bool inTaperedRing = distFromCenterline <= taperFactor * v_normalizedHalfWidth;

  // Start bound: cross product with precomputed source direction
  float crossStart = v_sourceDir.x * fragDir.y - v_sourceDir.y * fragDir.x;
  bool pastStart = crossStart <= 0.0;

  // End bound: fragment should be outside target circle (world coords)
  vec2 toTarget = v_worldPos - v_targetCenter;
  bool beforeEnd = dot(toTarget, toTarget) >= v_targetRadiusSq;

  // Combined tests
  bool isOriginalArrow = inOriginalRing && pastStart && beforeEnd;
  bool isTaperedArrow = inTaperedRing && pastStart && beforeEnd;

  // Debug rendering: r=original ring segment, g=tapered shape, b=correctedTip
  float debugR = isOriginalArrow ? 1.0 : 0.0;
  float debugG = isTaperedArrow ? 1.0 : 0.0;
  gl_FragColor = vec4(debugR, debugG, correctedTip, 0.1);
}
