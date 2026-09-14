import * as THREE from 'three'

/** Standard layer blend modes (Photoshop/Krita/GIMP-style naming). */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
  'linearBurn',
  'linearDodge',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity'
] as const

export type BlendMode = (typeof BLEND_MODES)[number]

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  colorDodge: 'Color Dodge',
  colorBurn: 'Color Burn',
  hardLight: 'Hard Light',
  softLight: 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  linearBurn: 'Linear Burn',
  linearDodge: 'Linear Dodge (Add)',
  subtract: 'Subtract',
  divide: 'Divide',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity'
}

const BLEND_MODE_INDEX: Record<BlendMode, number> = Object.fromEntries(
  BLEND_MODES.map((m, i) => [m, i])
) as Record<BlendMode, number>

export function blendModeIndex(mode: BlendMode | undefined): number {
  return BLEND_MODE_INDEX[mode ?? 'normal'] ?? 0
}

export interface BlendCompositeUniforms {
  tBackdrop: { value: THREE.Texture | null }
  tSource: { value: THREE.Texture | null }
  tMask: { value: THREE.Texture | null }
  uUseMask: { value: number }
  uMaskOpacity: { value: number }
  uOpacity: { value: number }
  uBlendMode: { value: number }
}

/**
 * Composites one layer's source texture over a backdrop texture with a
 * standard blend mode, per the W3C compositing-and-blending model: the blend
 * mode only affects the region where the backdrop actually has coverage
 * (Cs' = mix(Cs, B(Cb,Cs), alphaBackdrop)), then that result is alpha-
 * composited "over" the backdrop as usual. Both textures are expected in the
 * premultiplied-alpha storage convention used throughout paintShader.ts.
 */
export function createBlendCompositeMaterial(): THREE.ShaderMaterial & {
  uniforms: BlendCompositeUniforms
} {
  const uniforms: BlendCompositeUniforms = {
    tBackdrop: { value: null },
    tSource: { value: null },
    tMask: { value: null },
    uUseMask: { value: 0 },
    uMaskOpacity: { value: 1 },
    uOpacity: { value: 1 },
    uBlendMode: { value: 0 }
  }

  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tBackdrop;
      uniform sampler2D tSource;
      uniform sampler2D tMask;
      uniform float uUseMask;
      uniform float uMaskOpacity;
      uniform float uOpacity;
      uniform int uBlendMode;
      varying vec2 vUv;

      // --- Separable blend functions (per-channel, straight-alpha [0,1] input) ---
      float bMultiply(float b, float s) { return b * s; }
      float bScreen(float b, float s) { return 1.0 - (1.0 - b) * (1.0 - s); }
      float bDarken(float b, float s) { return min(b, s); }
      float bLighten(float b, float s) { return max(b, s); }
      float bHardLight(float b, float s) { return s <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); }
      float bOverlay(float b, float s) { return bHardLight(s, b); }
      float bColorDodge(float b, float s) {
        if (b <= 0.0) return 0.0;
        if (s >= 1.0) return 1.0;
        return min(1.0, b / (1.0 - s));
      }
      float bColorBurn(float b, float s) {
        if (b >= 1.0) return 1.0;
        if (s <= 0.0) return 0.0;
        return 1.0 - min(1.0, (1.0 - b) / s);
      }
      float bSoftLight(float b, float s) {
        float d = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
        return s <= 0.5 ? (b - (1.0 - 2.0 * s) * b * (1.0 - b)) : (b + (2.0 * s - 1.0) * (d - b));
      }
      float bDifference(float b, float s) { return abs(b - s); }
      float bExclusion(float b, float s) { return b + s - 2.0 * b * s; }
      float bLinearBurn(float b, float s) { return max(0.0, b + s - 1.0); }
      float bLinearDodge(float b, float s) { return min(1.0, b + s); }
      float bSubtract(float b, float s) { return max(0.0, b - s); }
      float bDivide(float b, float s) { return s <= 0.0 ? 1.0 : min(1.0, b / s); }

      vec3 blendSeparable(int mode, vec3 b, vec3 s) {
        if (mode == 1) return vec3(bMultiply(b.r, s.r), bMultiply(b.g, s.g), bMultiply(b.b, s.b));
        if (mode == 2) return vec3(bScreen(b.r, s.r), bScreen(b.g, s.g), bScreen(b.b, s.b));
        if (mode == 3) return vec3(bOverlay(b.r, s.r), bOverlay(b.g, s.g), bOverlay(b.b, s.b));
        if (mode == 4) return vec3(bDarken(b.r, s.r), bDarken(b.g, s.g), bDarken(b.b, s.b));
        if (mode == 5) return vec3(bLighten(b.r, s.r), bLighten(b.g, s.g), bLighten(b.b, s.b));
        if (mode == 6) return vec3(bColorDodge(b.r, s.r), bColorDodge(b.g, s.g), bColorDodge(b.b, s.b));
        if (mode == 7) return vec3(bColorBurn(b.r, s.r), bColorBurn(b.g, s.g), bColorBurn(b.b, s.b));
        if (mode == 8) return vec3(bHardLight(b.r, s.r), bHardLight(b.g, s.g), bHardLight(b.b, s.b));
        if (mode == 9) return vec3(bSoftLight(b.r, s.r), bSoftLight(b.g, s.g), bSoftLight(b.b, s.b));
        if (mode == 10) return vec3(bDifference(b.r, s.r), bDifference(b.g, s.g), bDifference(b.b, s.b));
        if (mode == 11) return vec3(bExclusion(b.r, s.r), bExclusion(b.g, s.g), bExclusion(b.b, s.b));
        if (mode == 12) return vec3(bLinearBurn(b.r, s.r), bLinearBurn(b.g, s.g), bLinearBurn(b.b, s.b));
        if (mode == 13) return vec3(bLinearDodge(b.r, s.r), bLinearDodge(b.g, s.g), bLinearDodge(b.b, s.b));
        if (mode == 14) return vec3(bSubtract(b.r, s.r), bSubtract(b.g, s.g), bSubtract(b.b, s.b));
        if (mode == 15) return vec3(bDivide(b.r, s.r), bDivide(b.g, s.g), bDivide(b.b, s.b));
        return s; // Normal
      }

      // --- Non-separable HSL blend modes (W3C compositing spec) ---
      float clr_lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
      vec3 clr_clip(vec3 c) {
        float l = clr_lum(c);
        float n = min(c.r, min(c.g, c.b));
        float x = max(c.r, max(c.g, c.b));
        if (n < 0.0) c = l + (c - l) * (l / max(l - n, 0.0001));
        if (x > 1.0) c = l + (c - l) * ((1.0 - l) / max(x - l, 0.0001));
        return c;
      }
      vec3 clr_setLum(vec3 c, float l) { return clr_clip(c + (l - clr_lum(c))); }
      float clr_sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
      vec3 clr_setSat(vec3 c, float s) {
        float cmin = min(c.r, min(c.g, c.b));
        float cmax = max(c.r, max(c.g, c.b));
        if (cmax > cmin) return (c - cmin) * s / (cmax - cmin);
        return vec3(0.0);
      }

      vec3 blendNonSeparable(int mode, vec3 cb, vec3 cs) {
        if (mode == 16) return clr_setLum(clr_setSat(cs, clr_sat(cb)), clr_lum(cb)); // Hue
        if (mode == 17) return clr_setLum(clr_setSat(cb, clr_sat(cs)), clr_lum(cb)); // Saturation
        if (mode == 18) return clr_setLum(cs, clr_lum(cb));                          // Color
        return clr_setLum(cb, clr_lum(cs));                                          // Luminosity
      }

      vec3 applyBlend(int mode, vec3 cb, vec3 cs) {
        if (mode >= 16) return blendNonSeparable(mode, cb, cs);
        return blendSeparable(mode, cb, cs);
      }

      void main() {
        vec4 backdropRaw = texture2D(tBackdrop, vUv);
        float ab = backdropRaw.a;
        vec3 cb = ab > 0.0001 ? backdropRaw.rgb / ab : backdropRaw.rgb;

        vec4 srcRaw = texture2D(tSource, vUv);
        float as = srcRaw.a;
        vec3 cs = as > 0.0001 ? srcRaw.rgb / as : srcRaw.rgb;

        if (uUseMask > 0.5) {
          as *= clamp(texture2D(tMask, vUv).r, 0.0, 1.0) * uMaskOpacity;
        }
        as *= uOpacity;

        vec3 blended = applyBlend(uBlendMode, cb, cs);
        // Blend mode only applies where the backdrop has coverage — over bare
        // canvas a blended layer just shows its own color, per the W3C model.
        vec3 csPrime = mix(cs, blended, ab);

        float ao = as + ab * (1.0 - as);
        vec3 co = as * csPrime + ab * cb * (1.0 - as);

        gl_FragColor = vec4(co, ao);
      }
    `,
    // The shader itself already computes the full backdrop+source composite
    // (that's the point of ping-ponging through two scratch buffers instead
    // of relying on GL blend funcs), so each pass must overwrite the target
    // outright — GL blending the shader's own already-blended output against
    // whatever was in the target would double up the compositing.
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: BlendCompositeUniforms }
}
