// Arrow Vertex Shader (Triangle-based Arc Rendering)
// Uses 3 vertices: M (arc center), and two points on tangent line at tip

// Per-vertex attribute (0, 1, or 2 for triangle vertex index)
attribute float a_vertexIndex;

// Per-instance attributes
attribute vec2 a_arcCenter;       // M - arc center (vertex 0)
attribute vec2 a_triangleV1;      // Tangent point 1 (vertex 1)
attribute vec2 a_triangleV2;      // Tangent point 2 (vertex 2)
attribute float a_radiusOuterSq;  // r1²
attribute float a_radiusInnerSq;  // r2²
attribute vec2 a_sourceCenter;    // S - for start bound
attribute vec2 a_targetCenter;    // T - for end bound
attribute float a_targetRadiusSq; // target radius squared
attribute vec3 a_color;
attribute float a_opacity;

// Uniforms
uniform mat3 u_viewMatrix;
uniform vec2 u_viewportSize;

// Varyings
varying vec2 v_worldPos;
varying vec2 v_arcCenter;
varying float v_radiusOuterSq;
varying float v_radiusInnerSq;
varying vec2 v_sourceCenter;
varying vec2 v_targetCenter;
varying float v_targetRadiusSq;
varying vec3 v_color;
varying float v_opacity;
varying float v_phase;  // 0 at source, 1 at tip

void main() {
  // Select vertex position based on index
  vec2 worldPos;
  float phase;

  if (a_vertexIndex < 0.5) {
    // Vertex 0: M (arc center)
    worldPos = a_arcCenter;
    phase = 0.0;  // At/before source
  } else if (a_vertexIndex < 1.5) {
    // Vertex 1: tangent point 1
    worldPos = a_triangleV1;
    phase = 1.0;  // At tip
  } else {
    // Vertex 2: tangent point 2
    worldPos = a_triangleV2;
    phase = 1.0;  // At tip
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
  v_radiusOuterSq = a_radiusOuterSq;
  v_radiusInnerSq = a_radiusInnerSq;
  v_sourceCenter = a_sourceCenter;
  v_targetCenter = a_targetCenter;
  v_targetRadiusSq = a_targetRadiusSq;
  v_color = a_color;
  v_opacity = a_opacity;
  v_phase = phase;
}
