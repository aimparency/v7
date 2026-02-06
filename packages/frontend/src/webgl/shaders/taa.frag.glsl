#version 300 es
// TAA Blend Fragment Shader
// Samples current color, current movement, and history
// Movement signal propagates through history alpha for 2-frame override

precision highp float;

uniform sampler2D u_currentColor;
uniform sampler2D u_currentMovement;
uniform sampler2D u_historyColor;
uniform vec2 u_resolution;
uniform float u_blendAmount; // Base blend for static pixels
uniform float u_cameraMoving; // 1.0 when camera panning/zooming, 0.0 otherwise

in vec2 v_texCoord;

out vec4 fragColor;

void main() {
  vec4 current = texture(u_currentColor, v_texCoord);
  vec4 movement = texture(u_currentMovement, v_texCoord);
  vec4 history = texture(u_historyColor, v_texCoord);

  // Movement signal: current from movement texture, previous from history alpha
  // Taking max gives 2 frames of override after movement stops
  float currentMovement = movement.r;  // Movement flag in red channel
  float historyMovement = history.a;   // Previous movement stored in alpha
  float movementSignal = max(currentMovement, historyMovement);

  // Blend: full override when camera moving or element moving, gradual accumulation when static
  // Camera movement affects all pixels (including background)
  float blend = max(u_blendAmount, max(u_cameraMoving, movementSignal));

  vec3 color = mix(history.rgb, current.rgb, blend);

  // DEBUG: Show movement flag in red channel
  // color.r = currentMovement;

  // Store current movement in alpha for next frame
  fragColor = vec4(color, currentMovement);
}
