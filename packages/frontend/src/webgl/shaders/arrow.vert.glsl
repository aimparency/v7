// Arrow Vertex Shader
// Renders arc-based arrows using instanced quads

// Per-vertex attributes (static quad corners)
attribute vec2 a_corner; // (-1,-1), (1,-1), (-1,1), (1,1)

// Per-instance attributes (updated per arrow)
attribute vec2 a_startPos;      // Start position (supporting aim center)
attribute vec2 a_endPos;        // End position (supported aim edge)
attribute vec2 a_arcCenter1;    // Inner arc center (M1)
attribute vec2 a_arcCenter2;    // Outer arc center (M2)
attribute float a_radiusInnerSq;   // Inner radius squared at base (r1s)
attribute float a_radiusOuterSq;   // Outer radius squared at base (r2s)
attribute float a_radiusCenterSq;  // Center radius squared (for tapering)
attribute float a_taperFactor;     // How much to taper (0.0 = no taper, 1.0 = full taper)
attribute vec3 a_color;         // Arrow color
attribute float a_opacity;      // Arrow opacity

// Uniforms (camera & viewport)
uniform mat3 u_viewMatrix;    // Camera transform (pan + zoom)
uniform vec2 u_viewportSize;  // Canvas size in pixels

// Varying (passed to fragment shader)
varying vec2 v_worldPos;      // Fragment position in world space
varying vec2 v_startPos;      // Arrow start position
varying vec2 v_endPos;        // Arrow end position
varying vec2 v_arcCenter1;    // Inner arc center
varying vec2 v_arcCenter2;    // Outer arc center
varying float v_radiusInnerSq;
varying float v_radiusOuterSq;
varying float v_radiusCenterSq;
varying float v_taperFactor;
varying vec3 v_color;
varying float v_opacity;

void main() {
  // Calculate bounding box for the arrow quad
  // Use arc centers and radii to determine quad size
  vec2 minCorner = min(a_arcCenter1, a_arcCenter2) - vec2(sqrt(max(a_radiusInnerSq, a_radiusOuterSq)));
  vec2 maxCorner = max(a_arcCenter1, a_arcCenter2) + vec2(sqrt(max(a_radiusInnerSq, a_radiusOuterSq)));

  // Expand to include start and end positions
  minCorner = min(minCorner, min(a_startPos, a_endPos));
  maxCorner = max(maxCorner, max(a_startPos, a_endPos));

  // Map corner to world space within bounding box
  vec2 worldPos = mix(minCorner, maxCorner, (a_corner + 1.0) * 0.5);

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);

  // Convert to NDC (Normalized Device Coordinates)
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0; // Flip Y axis (canvas has Y-down, WebGL has Y-up)

  gl_Position = vec4(ndc, 0.0, 1.0);

  // Pass data to fragment shader
  v_worldPos = worldPos;
  v_startPos = a_startPos;
  v_endPos = a_endPos;
  v_arcCenter1 = a_arcCenter1;
  v_arcCenter2 = a_arcCenter2;
  v_radiusInnerSq = a_radiusInnerSq;
  v_radiusOuterSq = a_radiusOuterSq;
  v_radiusCenterSq = a_radiusCenterSq;
  v_taperFactor = a_taperFactor;
  v_color = a_color;
  v_opacity = a_opacity;
}
