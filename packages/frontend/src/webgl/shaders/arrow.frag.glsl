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
flat in float v_selected;
flat in float v_pixelsPerWorld; // Camera zoom: screen pixels per world unit

// Animation
uniform float u_time; // Seconds; advances only while the camera is still

// MRT outputs
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMovement;

const float TWO_PI = 6.28318530718;

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

  // Anti-alias the band edge over ~1 screen pixel. distFromCenterline is in
  // units of centerRadius, and one centerRadius spans (centerRadius * zoom)
  // pixels, so this AA width scales correctly with the camera zoom.
  float ringEdge = taperFactor * v_normalizedHalfWidth;
  float aa = 1.0 / max(v_centerRadius * v_pixelsPerWorld, 1e-4);
  float ringCoverage = 1.0 - smoothstep(ringEdge - aa, ringEdge + aa, distFromCenterline);

  // Start bound: cross product with precomputed source direction
  float crossStart = v_sourceDir.x * fragDir.y - v_sourceDir.y * fragDir.x;
  bool pastStart = crossStart <= 0.0;

  // End bound: fragment should be outside target circle (world coords)
  vec2 toTarget = v_worldPos - v_targetCenter;
  bool beforeEnd = dot(toTarget, toTarget) >= v_targetRadiusSq;

  // Combined test
  if (ringCoverage > 0.0 && pastStart && beforeEnd) {
    vec3 color = v_color;
    float opacity = v_opacity;
    float moveFlag = v_moving;

    if (v_selected > 0.5) {
      // Angle swept from the source along the arc (reuses crossStart). Grows
      // from 0 at the source toward the head. dotStart is the only extra work.
      float dotStart = dot(v_sourceDir, fragDir);
      float arcAngle = abs(atan(crossStart, dotStart));

      // Stripe spacing proportional to the arrow's width, so v_centerRadius
      // cancels and the look is independent of zoom and arc size. Subtracting
      // time advances the pattern toward the head.
      float phase = arcAngle / (3.0 * v_normalizedHalfWidth) - u_time * 0.75;

      // 50% duty pulse (bright band == gap), with edges anti-aliased in screen
      // space via fwidth(phase). phase is continuous (no fract), so the
      // derivative is well-defined and the edges stay ~1px crisp at any zoom.
      float p = fract(phase);
      float aa = max(fwidth(phase), 1e-4);
      float stripe = smoothstep(0.0, aa, p) - smoothstep(0.5, 0.5 + aa, p);

      color = mix(v_color, vec3(1.0), stripe * 0.6);
      opacity = mix(v_opacity, 1.0, stripe * 0.5);
      moveFlag = 1.0; // bypass TAA accumulation so the stripes stay crisp
    }

    outColor = vec4(color, opacity * ringCoverage);
    outMovement = vec4(moveFlag, 0.0, 0.0, 1.0);
  } else {
    discard;
  }
}
