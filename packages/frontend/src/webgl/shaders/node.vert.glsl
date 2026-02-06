// Node Vertex Shader
// Renders circles using instanced quads

// Per-vertex attributes (static quad corners)
attribute vec2 a_corner; // (-1,-1), (1,-1), (-1,1), (1,1)

// Per-instance attributes (updated per node)
attribute vec2 a_position;  // Node center in world space
attribute float a_radius;   // Node radius
attribute vec3 a_color;     // RGB color
attribute float a_selected; // 0.0 or 1.0

// Uniforms (camera & viewport)
uniform mat3 u_viewMatrix;    // Camera transform (pan + zoom)
uniform vec2 u_viewportSize;  // Canvas size in pixels

// Varying (passed to fragment shader)
varying vec2 v_uv;       // Position within quad (-1 to 1)
varying vec3 v_color;    // Node color
varying float v_selected; // Selection state
varying float v_aaWidth; // Anti-aliasing width in UV space

void main() {
  // Transform corner to world space
  vec2 worldPos = a_position + a_corner * a_radius;

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);

  // Convert to NDC (Normalized Device Coordinates)
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0; // Flip Y axis (canvas has Y-down, WebGL has Y-up)

  gl_Position = vec4(ndc, 0.0, 1.0);

  // Calculate pixel radius for AA
  // zoom is stored in viewMatrix[0][0]
  float zoom = u_viewMatrix[0][0];
  float pixelRadius = a_radius * zoom;
  // AA width in UV space: ~1.5 pixels / pixel radius
  // Min clamp prevents division issues, max clamp prevents over-blur on tiny nodes
  float aaPixels = 1.5;
  v_aaWidth = clamp(aaPixels / pixelRadius, 0.002, 0.5);

  // Pass data to fragment shader
  v_uv = a_corner;
  v_color = a_color;
  v_selected = a_selected;
}
