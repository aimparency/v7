#version 300 es
// Node Vertex Shader
// Renders circles using instanced quads

// Per-vertex attributes (static quad corners)
in vec2 a_corner; // (-1,-1), (1,-1), (-1,1), (1,1)

// Per-instance attributes (updated per node)
in vec2 a_position;  // Node center in world space
in float a_radius;   // Node radius
in vec3 a_color;     // RGB color
in float a_selected; // 0.0 or 1.0
in float a_moving;   // Movement flag for TAA (0.0 or 1.0)

// Uniforms (camera & viewport)
uniform mat3 u_viewMatrix;    // Camera transform (pan + zoom)
uniform vec2 u_viewportSize;  // Canvas size in pixels
uniform vec2 u_jitter;        // Sub-pixel jitter for TAA (-0.5 to 0.5)

// Output to fragment shader
out vec2 v_uv;        // Position within quad (-1 to 1)
out vec3 v_color;     // Node color
out float v_selected; // Selection state
flat out float v_moving;   // Movement flag (flat = no interpolation)

void main() {
  // Transform corner to world space
  vec2 worldPos = a_position + a_corner * a_radius;

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);

  // Convert to NDC (Normalized Device Coordinates)
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0; // Flip Y axis (canvas has Y-down, WebGL has Y-up)

  // Apply sub-pixel jitter for TAA (convert pixel offset to NDC)
  ndc += u_jitter * 2.0 / u_viewportSize;

  gl_Position = vec4(ndc, 0.0, 1.0);

  // Pass data to fragment shader
  v_uv = a_corner;
  v_color = a_color;
  v_selected = a_selected;
  v_moving = a_moving;
}
