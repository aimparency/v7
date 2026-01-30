# WebGL Text Rendering Research & Implementation Plan

## Executive Summary

For high-performance, resolution-independent text rendering in WebGL graph visualization, **MSDF (Multi-channel Signed Distance Field)** is the recommended approach. It provides sharp text at any zoom level with minimal GPU overhead.

## Research Findings (January 2026)

### MSDF vs SDF Comparison

**MSDF (Multi-channel Signed Distance Field)**
- ✅ Retains sharp corners even at high zoom levels (5x+)
- ✅ Superior quality-to-space ratio
- ✅ Better for UI text and labels
- ✅ Recommended for modern WebGL applications

**SDF (Signed Distance Field)**
- ⚠️ Produces rounded corners, even at 1x zoom
- ⚠️ Adequate for body text but not ideal for sharp UI elements
- ✅ Simpler to implement
- ✅ Smaller shader code

**Conclusion**: Use MSDF for graph labels where sharp, scalable text is critical.

## Implementation Approaches

### Option 1: MSDF with Pre-generated Atlas (Recommended)

**Workflow**:
1. Generate MSDF font atlas at build time using `msdf-bmfont-web`
2. Load atlas texture and glyph metrics at runtime
3. Tessellate text to quads (one per character)
4. Render with MSDF fragment shader

**Pros**:
- Best quality
- Predictable performance
- No runtime font generation overhead
- Works offline

**Cons**:
- Requires build step
- Limited to pre-generated character sets
- Larger initial bundle size

**Tools**:
- [msdf-bmfont-web](https://github.com/donmccurdy/msdf-bmfont-web) - Browser-based generator
- [msdf-bmfont-xml](https://soimy.github.io/msdf-bmfont-xml/) - CLI tool for build pipeline

### Option 2: Runtime SDF Generation

**Workflow**:
1. Render glyphs to canvas at runtime
2. Generate SDF on GPU using compute shader or fragment shader
3. Cache generated textures

**Pros**:
- Dynamic font support
- No build step
- Smaller initial bundle

**Cons**:
- Complex implementation
- Startup performance cost
- Requires GPU compute capabilities

**Note**: Modern research (2026) shows GPU-based SDF generation has significant performance advantages over CPU/canvas-based approaches.

### Option 3: Canvas-to-Texture Fallback

**Workflow**:
1. Render text to 2D canvas
2. Upload canvas as WebGL texture
3. Re-render when zoom crosses threshold

**Pros**:
- Simple implementation
- Browser handles font rendering
- Full Unicode support

**Cons**:
- Poor zoom quality
- Texture updates on zoom changes
- Memory intensive for many labels
- Not resolution-independent

**Use case**: Fallback for older browsers or very complex text (emojis, RTL, ligatures)

## Recommended Implementation Plan

### Phase 1: MSDF Atlas Generation (1-2 days)

1. **Setup build tool**:
   ```bash
   npm install --save-dev msdf-bmfont-xml
   ```

2. **Generate font atlases**:
   ```bash
   # Generate MSDF atlas for primary UI font
   msdf-bmfont-xml \
     --font-size 42 \
     --field-type msdf \
     --output-type json \
     --filename-font fonts/roboto-msdf \
     Roboto-Regular.ttf
   ```

3. **Output files**:
   - `roboto-msdf.png` - MSDF texture atlas
   - `roboto-msdf.json` - Glyph metrics and UV coordinates

### Phase 2: MSDF Shader Implementation (1 day)

**Vertex Shader** (`text.vert.glsl`):
```glsl
attribute vec2 a_corner;     // Quad corner
attribute vec2 a_position;   // Character position (instanced)
attribute vec2 a_uvOffset;   // UV offset for this character (instanced)
attribute vec2 a_uvSize;     // UV size for this character (instanced)
attribute float a_scale;     // Character scale (instanced)

uniform mat3 u_viewMatrix;
uniform vec2 u_viewportSize;

varying vec2 v_uv;

void main() {
  // Scale quad to character size
  vec2 worldPos = a_position + a_corner * a_scale;

  // Apply camera transform
  vec3 viewPos = u_viewMatrix * vec3(worldPos, 1.0);
  vec2 ndc = (viewPos.xy / u_viewportSize) * 2.0 - 1.0;
  ndc.y *= -1.0;

  gl_Position = vec4(ndc, 0.0, 1.0);

  // Calculate UV coordinates
  v_uv = a_uvOffset + (a_corner + 1.0) * 0.5 * a_uvSize;
}
```

**Fragment Shader** (`text.frag.glsl`):
```glsl
precision mediump float;

uniform sampler2D u_msdfTexture;
uniform vec3 u_textColor;
uniform float u_pxRange;  // Pixel range from atlas generation

varying vec2 v_uv;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

void main() {
  // Sample MSDF texture (RGB channels encode distance)
  vec3 msdf = texture2D(u_msdfTexture, v_uv).rgb;

  // Calculate signed distance
  float sd = median(msdf.r, msdf.g, msdf.b);

  // Convert to screen space distance
  float screenPxDistance = u_pxRange * (sd - 0.5);

  // Calculate alpha with antialiasing
  float alpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);

  // Discard transparent pixels
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(u_textColor, alpha);
}
```

### Phase 3: Text Layout Engine (2-3 days)

**TypeScript** (`TextRenderer.ts`):
```typescript
interface GlyphMetrics {
  id: number           // Character code
  x: number            // Atlas X position
  y: number            // Atlas Y position
  width: number        // Glyph width in atlas
  height: number       // Glyph height in atlas
  xoffset: number      // Horizontal offset
  yoffset: number      // Vertical offset
  xadvance: number     // Advance to next character
}

class TextRenderer {
  private glyphs: Map<number, GlyphMetrics>
  private kerning: Map<string, number>
  private atlasTexture: WebGLTexture

  // Tessellate text string to character quads
  layoutText(text: string, x: number, y: number, size: number): QuadData[] {
    const quads: QuadData[] = []
    let cursorX = x

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      const glyph = this.glyphs.get(charCode)
      if (!glyph) continue

      // Apply kerning with previous character
      if (i > 0) {
        const prevCode = text.charCodeAt(i - 1)
        const kerningKey = `${prevCode},${charCode}`
        const kerning = this.kerning.get(kerningKey) || 0
        cursorX += kerning
      }

      // Calculate quad position and UV coordinates
      quads.push({
        position: [
          cursorX + glyph.xoffset,
          y + glyph.yoffset
        ],
        uvOffset: [glyph.x / atlasWidth, glyph.y / atlasHeight],
        uvSize: [glyph.width / atlasWidth, glyph.height / atlasHeight],
        scale: size
      })

      cursorX += glyph.xadvance
    }

    return quads
  }
}
```

### Phase 4: Integration & Optimization (1-2 days)

1. **Atlas Loading**: Load JSON metrics and PNG texture asynchronously
2. **Text Culling**: Only render visible labels (use spatial tree)
3. **LOD (Level of Detail)**: Hide labels below certain zoom threshold
4. **Batching**: Render all text in single draw call using instancing
5. **Texture Filtering**: Use `GL_LINEAR` (NOT `GL_NEAREST`) for smooth scaling
6. **Texture Compression**: Avoid compression - causes artifacts

## Performance Considerations

### Best Practices (from 2026 research)

1. **GPU-side SDF generation**: If generating at runtime, do it on GPU not canvas
2. **Minimize texture switches**: Use texture atlas, batch similar text
3. **Lazy loading**: Load fonts/textures only when needed
4. **No compression**: Avoid texture compression (causes artifacts)
5. **Linear filtering**: Always use `GL_LINEAR` texture filtering

### Expected Performance

With MSDF:
- 1,000 labels: 60 FPS
- 5,000 labels: 60 FPS (with culling)
- 10,000 labels: 45+ FPS (with aggressive culling + LOD)

## Alternative: WebGPU Considerations

**Note**: WebGPU (2026) does not support variable point size - all points appear as 1 pixel. This limits some rendering techniques. Stick with WebGL for maximum compatibility and feature support in graph visualization.

## Resources & References

### Tools
- [msdf-bmfont-web](https://github.com/donmccurdy/msdf-bmfont-web) - Browser-based MSDF atlas generator
- [msdf-bmfont-xml](https://soimy.github.io/msdf-bmfont-xml/) - CLI tool for build pipeline
- [msdfgen](https://github.com/Chlumsky/msdfgen) - Core MSDF generation library

### Tutorials & Articles
- [Techniques for Rendering Text with WebGL](https://css-tricks.com/techniques-for-rendering-text-with-webgl/) - Comprehensive overview
- [MSDF Text Rendering with WebGL](https://levelup.gitconnected.com/msdf-font-rendering-in-webgl-91ce192d2bec) - Implementation tutorial
- [Implementing MSDF Text in Three.js](https://medium.com/@brianbawuah/from-bitmap-to-vector-implementing-msdf-text-in-three-js-d63b1d6ef6d9) - Three.js specific
- [Signed Distance Field Fonts - Basics](https://www.redblobgames.com/x/2403-distance-field-fonts/) - Interactive visual explanation
- [Implementing MSDF Font in OpenGL](https://medium.com/@calebfaith/implementing-msdf-font-in-opengl-ea09a9ab7e00) - OpenGL implementation guide

### Advanced Topics
- [Overcoming WebGL Typography Challenges](https://infinitejs.com/posts/overcoming-webgl-webassembly-typography-challenges/) - Complex text rendering
- [WebGPU MSDF Text Rendering](https://webgpu.github.io/webgpu-samples/?sample=textRenderingMsdf) - WebGPU reference
- [WebGPU Gommage Effect](https://tympanus.net/codrops/2026/01/28/webgpu-gommage-effect-dissolving-msdf-text-into-dust-and-petals-with-three-js-tsl/) - Advanced visual effects (2026)

## Decision Matrix

| Approach | Quality | Performance | Complexity | Recommended |
|----------|---------|-------------|------------|-------------|
| MSDF (pre-generated) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ Yes |
| SDF (pre-generated) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⚠️ If MSDF unavailable |
| Runtime SDF | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ Too complex |
| Canvas-to-texture | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⚠️ Fallback only |

## Next Steps

1. ✅ Research complete
2. ⬜ Generate MSDF atlas for project font
3. ⬜ Implement MSDF shaders
4. ⬜ Create TextRenderer class
5. ⬜ Integrate with WebGLGraphRenderer
6. ⬜ Add text culling and LOD
7. ⬜ Performance testing and optimization

## Estimated Timeline

- **Total**: 5-8 days
- **MVP** (basic MSDF rendering): 3-4 days
- **Production-ready** (with culling, LOD, optimization): 5-8 days
