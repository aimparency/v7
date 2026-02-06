// Arrow Vertex Shader (Triangle-based Arc Rendering)
// Uses 3 vertices: M (arc center), V1 (towards source S), V2 (towards tip on T)

// Per-vertex attribute (0, 1, or 2 for triangle vertex index)
attribute float a_vertexIndex;

// Per-instance attributes
attribute vec2 a_arcCenter;            // M - arc center (vertex 0)
attribute vec2 a_triangleV1;           // Extended towards S (vertex 1)
attribute vec2 a_triangleV2;           // Extended towards tip (vertex 2)
attribute float a_centerRadius;        // Distance from M to arc centerline
attribute float a_normalizedHalfWidth; // halfWidth / centerRadius (precomputed)
attribute float a_trunkLength;         // Where trunk ends (precomputed, 0-1)
attribute vec2 a_sourceDir;            // Normalized direction from M to S (precomputed)
attribute vec2 a_targetCenter;         // T - for end bound
attribute float a_targetRadiusSq;      // target radius squared
attribute vec3 a_color;
attribute float a_opacity;

// Uniforms
uniform mat3 u_viewMatrix;
uniform vec2 u_viewportSize;

// Varyings - pass precomputed values to fragment shader
varying vec2 v_worldPos;
varying vec2 v_arcCenter;
varying float v_centerRadius;
varying float v_normalizedHalfWidth;
varying float v_trunkLength;
varying vec2 v_sourceDir;
varying vec2 v_targetCenter;
varying float v_targetRadiusSq;
varying vec3 v_color;
varying float v_opacity;
varying float v_tip;        // 0 at V1 (source side), 0.5 at M, 1 at V2 (tip side)
varying float v_distFromM;  // 0 at M, 1 at V1 and V2 - for radial correction

void main() {
  // Select vertex position based on index
  vec2 worldPos;
  float tip;
  float distFromM;

  if (a_vertexIndex < 0.5) {
    // Vertex 0: M (arc center)
    worldPos = a_arcCenter;
    tip = 0.5;
    distFromM = 0.0;
  } else if (a_vertexIndex < 1.5) {
    // Vertex 1: towards source S
    worldPos = a_triangleV1;
    tip = 0.0;
    distFromM = 1.0;
  } else {
    // Vertex 2: towards tip on T
    worldPos = a_triangleV2;
    tip = 1.0;
    distFromM = 1.0;
  }

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);

  // Convert to NDC
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0;

  gl_Position = vec4(ndc, 0.0, 1.0);

  // Pass to fragment shader
  v_worldPos = worldPos;
  v_arcCenter = a_arcCenter;
  v_centerRadius = a_centerRadius;
  v_normalizedHalfWidth = a_normalizedHalfWidth;
  v_trunkLength = a_trunkLength;
  v_sourceDir = a_sourceDir;
  v_targetCenter = a_targetCenter;
  v_targetRadiusSq = a_targetRadiusSq;
  v_color = a_color;
  v_opacity = a_opacity;
  v_tip = tip;
  v_distFromM = distFromM;
}
