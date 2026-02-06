#version 300 es
// Arrow Fragment Shader (Normalized Arc-Based)
// All distance checks use normalized coordinates (relative to centerRadius)
// Outputs to MRT: color + movement flag

precision highp float;

// Input from vertex shader
in vec2 v_worldPos;
in vec2 v_arcCenter;
in float v_centerRadius;
in float v_normalizedHalfWidth;  // Precomputed: halfWidth / centerRadius
in float v_trunkLength;          // Precomputed: where trunk ends (0-1)
in vec2 v_sourceDir;             // Precomputed: normalized direction M→S
in vec2 v_targetCenter;
in float v_targetRadiusSq;
in vec3 v_color;
in float v_opacity;
in float v_tip;        // 0 at V1, 0.5 at M, 1 at V2 (linear interpolation)
in float v_distFromM;  // 0 at M, 1 at V1 and V2
flat in float v_moving;

// MRT outputs
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMovement;

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
  bool inRing = distFromCenterline <= taperFactor * v_normalizedHalfWidth;

  // Start bound: cross product with precomputed source direction
  float crossStart = v_sourceDir.x * fragDir.y - v_sourceDir.y * fragDir.x;
  bool pastStart = crossStart <= 0.0;

  // End bound: fragment should be outside target circle (world coords)
  vec2 toTarget = v_worldPos - v_targetCenter;
  bool beforeEnd = dot(toTarget, toTarget) >= v_targetRadiusSq;

  // Combined test
  if (inRing && pastStart && beforeEnd) {
    outColor = vec4(v_color, v_opacity);
    outMovement = vec4(v_moving, 0.0, 0.0, 1.0);
  } else {
    discard;
  }
}
