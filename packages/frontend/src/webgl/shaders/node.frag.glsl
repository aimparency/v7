#version 300 es
// Node Fragment Shader
// Renders circles with optional selection stroke
// Outputs to MRT: color + movement flag

precision highp float;

// Input from vertex shader
in vec2 v_uv;        // Position within quad (-1 to 1)
in vec3 v_color;     // Node color
in float v_selected; // Selection state (0.0 or 1.0)
flat in float v_moving;   // Movement flag for TAA

// MRT outputs
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMovement;

void main() {
  // Calculate distance from center
  float dist = length(v_uv);

  // Hard circle edge
  if (dist > 1.0) {
    discard;
  }

  // Selection stroke configuration
  float strokeWidth = 0.15;
  float strokeStart = 1.0 - strokeWidth;

  if (v_selected > 0.5 && dist > strokeStart) {
    // White stroke for selected nodes
    outColor = vec4(1.0, 1.0, 1.0, 1.0);
  } else {
    // Node fill color
    outColor = vec4(v_color, 1.0);
  }

  // Movement flag in red channel
  outMovement = vec4(v_moving, 0.0, 0.0, 1.0);
}
