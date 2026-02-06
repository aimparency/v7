#version 300 es
// TAA Blend Vertex Shader
// Simple fullscreen quad

in vec2 a_position;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);

  // Convert from NDC (-1 to 1) to texture coords (0 to 1)
  v_texCoord = (a_position + 1.0) * 0.5;
}
