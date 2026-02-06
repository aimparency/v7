// Arrow Fragment Shader (Simplified Arc-Based)
// Renders annulus segment with bounds checking

#ifdef GL_ES
precision highp float;
#endif

// Varyings from vertex shader
varying vec2 v_worldPos;
varying vec2 v_arcCenter;
varying float v_radiusOuterSq;
varying float v_radiusInnerSq;
varying vec2 v_sourceCenter;
varying vec2 v_targetCenter;
varying float v_targetRadiusSq;
varying vec3 v_color;
varying float v_opacity;
varying float v_tip;        // 0 at V1, 0.5 at M, 1 at V2 (linear interpolation)
varying float v_distFromM;  // 0 at M, 1 at V1 and V2

void main() {
  // Correct tip from linear to radial interpolation
  // Linear: tip = 0.5*b0 + 0*b1 + 1*b2, distFromM = b1 + b2
  // Radial: correctedTip = b2 / (b1 + b2)
  float correctedTip = (v_tip - 0.5 + 0.5 * v_distFromM) / max(v_distFromM, 0.001);

  // Calculate base radii
  float r1 = sqrt(v_radiusOuterSq);
  float r2 = sqrt(v_radiusInnerSq);
  float centerRadius = (r1 + r2) / 2.0;
  float halfWidth = (r1 - r2) / 2.0;

  // Calculate trunkLength based on arrow width
  // Head length (in world units) ≈ 2 * halfWidth, convert to tip-space
  float headLengthFactor = 2.0 * halfWidth / centerRadius;
  float trunkLength = 1.0 - clamp(headLengthFactor, 0.1, 0.5);

  // Calculate taper factor based on correctedTip
  // trunk: [0, trunkLength] => taper [1.0, 0.5]
  // head:  [trunkLength, 1] => taper [1.0, 0.0] (restarts at full width!)
  float taperFactor;
  if (correctedTip < trunkLength) {
    // Trunk: taper from 1.0 to 0.5
    taperFactor = mix(1.0, 0.5, correctedTip / trunkLength);
  } else {
    // Head: taper from 1.0 to 0.0
    taperFactor = mix(1.0, 0.0, (correctedTip - trunkLength) / (1.0 - trunkLength));
  }
  float tapered_r1 = centerRadius + halfWidth * taperFactor;
  float tapered_r2 = centerRadius - halfWidth * taperFactor;

  // Distance squared from fragment to arc center M
  vec2 toCenter = v_worldPos - v_arcCenter;
  float distSq = dot(toCenter, toCenter);
  float dist = sqrt(distSq);

  // Annulus tests
  bool inOriginalRing = distSq >= v_radiusInnerSq && distSq <= v_radiusOuterSq;
  bool inTaperedRing = dist >= tapered_r2 && dist <= tapered_r1;

  // Start bound: fragment should be on the "arrow side" of the radial through S
  // Use cross product to check which side of the M→S line we're on
  // We want the SHORT side of the arc (between S and T, not the long way around)
  vec2 toSource = v_sourceCenter - v_arcCenter;
  vec2 toFrag = v_worldPos - v_arcCenter;
  float crossStart = toSource.x * toFrag.y - toSource.y * toFrag.x;
  bool pastStart = crossStart <= 0.0;  // Flipped: short side of arc

  // End bound: fragment should be outside target circle
  vec2 toTarget = v_worldPos - v_targetCenter;
  float distToTargetSq = dot(toTarget, toTarget);
  bool beforeEnd = distToTargetSq >= v_targetRadiusSq;

  // Combined tests
  bool isOriginalArrow = inOriginalRing && pastStart && beforeEnd;
  bool isTaperedArrow = inTaperedRing && pastStart && beforeEnd;

  // Debug rendering: r=original ring segment, g=tapered shape, b=correctedTip
  float debugR = (inOriginalRing && pastStart && beforeEnd) ? 1.0 : 0.0;
  float debugG = (inTaperedRing && pastStart && beforeEnd) ? 1.0 : 0.0;
  gl_FragColor = vec4(debugR, debugG, correctedTip, 0.1);
}
