// Node Fragment Shader
// Renders circles with optional selection stroke

#ifdef GL_ES
precision mediump float;
#endif

// Input from vertex shader
varying vec2 v_uv;       // Position within quad (-1 to 1)
varying vec3 v_color;    // Node color
varying float v_selected; // Selection state (0.0 or 1.0)

void main() {
  // Calculate distance from center
  float dist = length(v_uv);

  // Discard fragments outside circle
  if (dist > 1.0) {
    discard;
  }

  // Selection stroke configuration
  float strokeWidth = 0.15;
  float strokeStart = 1.0 - strokeWidth;

  // Determine if we're in stroke area
  bool inStroke = v_selected > 0.5 && dist > strokeStart;

  if (inStroke) {
    // White selection stroke with smooth edge
    float alpha = smoothstep(1.0, strokeStart, dist);
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
  } else {
    // Node fill color
    gl_FragColor = vec4(v_color, 1.0);
  }
}
