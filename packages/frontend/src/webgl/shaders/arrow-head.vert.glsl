// Arrow Head Vertex Shader
// Renders arrow head with linear radius decay to a point

// Per-vertex attributes (static quad corners)
attribute vec2 a_corner; // (-1,-1), (1,-1), (-1,1), (1,1)

// Per-instance attributes (updated per arrow)
attribute vec2 a_tailPos;       // Head tail position (connection to trunk)
attribute vec2 a_pointPos;      // Head point position (tip of arrow)
attribute vec2 a_arcCenter1;    // Inner arc center (M1)
attribute vec2 a_arcCenter2;    // Outer arc center (M2)
attribute float a_radiusInner;     // Inner radius at tail (r1)
attribute float a_radiusOuter;     // Outer radius at tail (r2)
attribute float a_radiusCenter;    // Center radius
attribute vec3 a_color;         // Arrow color
attribute float a_opacity;      // Arrow opacity

// Uniforms (camera & viewport)
uniform mat3 u_viewMatrix;    // Camera transform (pan + zoom)
uniform vec2 u_viewportSize;  // Canvas size in pixels

// Varying (passed to fragment shader)
varying vec2 v_worldPos;      // Fragment position in world space
varying vec2 v_tailPos;       // Head tail position
varying vec2 v_pointPos;      // Head point position
varying vec2 v_arcCenter1;    // Inner arc center
varying vec2 v_arcCenter2;    // Outer arc center
varying float v_radiusInner;
varying float v_radiusOuter;
varying float v_radiusCenter;
varying vec3 v_color;
varying float v_opacity;

void main() {
  // Calculate bounding box for the arrow head quad
  vec2 minCorner = min(a_tailPos, a_pointPos) - vec2(max(a_radiusInner, a_radiusOuter));
  vec2 maxCorner = max(a_tailPos, a_pointPos) + vec2(max(a_radiusInner, a_radiusOuter));

  // Include arc centers in bounding box
  minCorner = min(minCorner, min(a_arcCenter1, a_arcCenter2) - vec2(max(a_radiusInner, a_radiusOuter)));
  maxCorner = max(maxCorner, max(a_arcCenter1, a_arcCenter2) + vec2(max(a_radiusInner, a_radiusOuter)));

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
  v_tailPos = a_tailPos;
  v_pointPos = a_pointPos;
  v_arcCenter1 = a_arcCenter1;
  v_arcCenter2 = a_arcCenter2;
  v_radiusInner = a_radiusInner;
  v_radiusOuter = a_radiusOuter;
  v_radiusCenter = a_radiusCenter;
  v_color = a_color;
  v_opacity = a_opacity;
}
