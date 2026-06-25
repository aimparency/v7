#version 300 es
// Selection Spinner Vertex Shader
// Draws an enlarged quad around a selected node so the spinner's half-dots
// can render OUTSIDE the node outline. Rendered post-TAA, straight to screen.

// Per-vertex attribute (static quad corners): (-1,-1), (1,-1), (-1,1), (1,1)
in vec2 a_corner;

// Per-instance attributes
in vec2 a_position; // Node center in world space
in float a_radius;  // Node radius in world space

// Uniforms
uniform mat3 u_viewMatrix;   // Camera transform (pan + zoom)
uniform vec2 u_viewportSize; // Canvas size in pixels
uniform float u_quadScale;   // Quad half-size as a multiple of node radius (> 1)

// Output to fragment shader
out vec2 v_uv; // Position within quad in node-radius units (dist 1.0 = outline)
flat out float v_pixelsPerUv; // Screen pixels per node-radius unit (for AA width)

void main() {
  // Enlarge the quad so it extends beyond the node outline
  vec2 worldPos = a_position + a_corner * a_radius * u_quadScale;

  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0;

  gl_Position = vec4(ndc, 0.0, 1.0);

  // dist == 1.0 lands exactly on the node outline
  v_uv = a_corner * u_quadScale;

  // One uv unit (== node radius in world space) maps to a_radius * zoom pixels.
  // u_viewMatrix[0][0] is the uniform zoom factor of the camera transform.
  float zoom = u_viewMatrix[0][0];
  v_pixelsPerUv = a_radius * zoom;
}
