#version 300 es
// Selection Spinner Fragment Shader
// A row of round dots whose centers sit on the node outline. Only the half
// outside the node is kept (interior is discarded), so half-dots orbit the
// rim. Drawn post-TAA at a fixed 50% opacity — no temporal smearing.

precision highp float;

const float PI = 3.14159265359;

in vec2 v_uv; // dist 1.0 == node outline
flat in float v_pixelsPerUv; // Screen pixels per node-radius unit

uniform float u_time;     // Seconds, advances only while the camera is still
uniform float u_dotRadius; // Dot radius in node-radius units

out vec4 outColor;

void main() {
  float dist = length(v_uv);

  // AA width of the aim-circumference cut, in node-radius (uv) units: one uv
  // unit spans v_pixelsPerUv pixels, so this is ~1px and scales with both the
  // aim radius and the camera zoom.
  float cutAA = 1.0 / max(v_pixelsPerUv, 1e-4);

  // Cheap reject well inside the aim, but keep a feather band below the
  // outline so the cut itself can be anti-aliased rather than hard-clipped.
  if (dist < 1.0 - cutAA) {
    discard;
  }

  float dotRadius = u_dotRadius;
  float ringRadius = 1.0; // dot centers on the outline

  // 1 rotation per 30s
  float rotation = u_time * (2.0 * PI / 30.0);

  // Pack dots with a one-diameter gap: center spacing = 4 * dotRadius
  float dotCount = floor(2.0 * PI * ringRadius / (4.0 * dotRadius) + 0.5);
  float slot = 2.0 * PI / dotCount;

  // Angular distance (radians) to the nearest dot center, converted to
  // uv-space distance at the ring so dots stay round.
  float angle = atan(v_uv.y, v_uv.x) + rotation;
  float angularOffset = mod(angle, slot) - slot * 0.5;
  float a = (angularOffset * ringRadius) / dotRadius;
  float b = (dist - ringRadius) / dotRadius;

  // Distance from the dot center in dot-radius units (1.0 == dot edge).
  float dotDist = sqrt(a * a + b * b);

  // Anti-alias the round dot edge over ~1 screen pixel. One dot-radius unit
  // spans (pixelsPerUv * dotRadius) pixels, so this scales with radius & zoom.
  float dotAA = 1.0 / max(v_pixelsPerUv * dotRadius, 1e-4);
  float roundCoverage = 1.0 - smoothstep(1.0 - dotAA, 1.0 + dotAA, dotDist);

  // Anti-alias the cut where the dot meets the aim circumference (uv units),
  // so the inner edge feathers into the TAA'd aim instead of stair-stepping.
  float cutCoverage = smoothstep(1.0 - cutAA, 1.0 + cutAA, dist);

  float coverage = roundCoverage * cutCoverage;
  if (coverage <= 0.0) {
    discard;
  }

  // White at 50% opacity, blended over the already-resolved scene
  outColor = vec4(1.0, 1.0, 1.0, 0.5 * coverage);
}
