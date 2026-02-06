// Node Fragment Shader
// Renders circles with optional selection stroke

#ifdef GL_ES
precision highp float;
#endif

// Input from vertex shader
varying vec2 v_uv;       // Position within quad (-1 to 1)
varying vec3 v_color;    // Node color
varying float v_selected; // Selection state (0.0 or 1.0)
varying float v_aaWidth; // Anti-aliasing width in UV space

void main() {
  // Calculate distance from center
  float dist = length(v_uv);

  // Anti-aliased circle edge
  float alpha = 1.0 - smoothstep(1.0 - v_aaWidth, 1.0, dist);

  // Discard fully transparent fragments
  if (alpha < 0.01) {
    discard;
  }

  // Selection stroke configuration
  float strokeWidth = 0.15;
  float strokeStart = 1.0 - strokeWidth;

  if (v_selected > 0.5) {
    // Smooth inner edge of stroke (fill -> white transition)
    float strokeMix = smoothstep(strokeStart - v_aaWidth, strokeStart + v_aaWidth, dist);
    vec3 finalColor = mix(v_color, vec3(1.0), strokeMix);
    gl_FragColor = vec4(finalColor, alpha);
  } else {
    // Node fill color with AA
    gl_FragColor = vec4(v_color, alpha);
  }
}
