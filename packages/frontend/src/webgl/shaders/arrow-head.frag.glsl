// Arrow Head Fragment Shader
// Renders arrow head with linear radius decay to a point

#ifdef GL_ES
precision mediump float;
#endif

// Input from vertex shader
varying vec2 v_worldPos;      // Fragment position in world space
varying vec2 v_tailPos;       // Head tail position
varying vec2 v_pointPos;      // Head point position
varying vec2 v_arcCenter1;    // Inner arc center (M1)
varying vec2 v_arcCenter2;    // Outer arc center (M2)
varying float v_radiusInner;     // Inner radius at tail (r1)
varying float v_radiusOuter;     // Outer radius at tail (r2)
varying float v_radiusCenter;    // Center radius
varying vec3 v_color;         // Arrow color
varying float v_opacity;      // Arrow opacity

void main() {
  // Calculate phase (position along head from tail to point)
  // Project fragment position onto head direction vector
  vec2 headDir = v_pointPos - v_tailPos;
  float headLength = length(headDir);
  vec2 headDirNorm = headDir / headLength;

  vec2 toFragment = v_worldPos - v_tailPos;
  float projectionLength = dot(toFragment, headDirNorm);
  float phase = clamp(projectionLength / headLength, 0.0, 1.0);

  // Linear radius decay from tail to point
  // f decays from 1.0 at tail to 0.0 at point
  // Formula: f * (r1 - rCenter) + rCenter
  // At tail (f=1.0): radius = r1
  // At point (f=0.0): radius = rCenter
  float f = 1.0 - phase; // Invert phase so it decays toward point

  float r1 = f * (v_radiusInner - v_radiusCenter) + v_radiusCenter;
  float r2 = f * (v_radiusOuter - v_radiusCenter) + v_radiusCenter;

  // Compute distances to arc centers (using actual radii, not squared)
  vec2 diff1 = v_worldPos - v_arcCenter1;
  float d1 = length(diff1);

  vec2 diff2 = v_worldPos - v_arcCenter2;
  float d2 = length(diff2);

  // Discard fragments outside the tapered arc region
  // Keep fragments where:
  // - Distance to inner center is within tapered inner radius: d1 <= r1
  // - Distance to outer center is outside tapered outer radius: d2 >= r2
  if (d1 > r1 || d2 < r2) {
    discard;
  }

  // Apply color and opacity
  gl_FragColor = vec4(v_color, v_opacity);
}
