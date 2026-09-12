import * as THREE from 'three'
import {
  BRUSH_MASK_UNIFORMS_GLSL,
  BRUSH_MASK_GLSL,
  createBrushMaskUniforms,
  type BrushMaskUniforms
} from './brushMask'

/** Which filter the effect brush applies under the dab. */
export type EffectMode = 'blur' | 'sharpen' | 'smudge' | 'pixelate'

export const EFFECT_MODES: EffectMode[] = ['blur', 'sharpen', 'smudge', 'pixelate']

export const EFFECT_MODE_LABELS: Record<EffectMode, string> = {
  blur: 'Blur',
  sharpen: 'Sharpen',
  smudge: 'Smudge',
  pixelate: 'Pixelate'
}

export const EFFECT_MODE_INDEX: Record<EffectMode, number> = {
  blur: 0,
  sharpen: 1,
  smudge: 2,
  pixelate: 3
}

const vertexShader = /* glsl */ `
  attribute vec3 aWorldPosition;
  attribute vec3 aWorldNormal;
  attribute float aSelected;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vSelected;

  void main() {
    vWorldPosition = aWorldPosition;
    vWorldNormal = aWorldNormal;
    vUv = uv;
    vSelected = aSelected;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * The effect brush reworks texels that are already there instead of laying down
 * new color, so it reads the layer it is writing (via the ping-pong read
 * target) and mixes the filtered result back under the same projector footprint
 * the paint brush uses.
 *
 * Everything here operates on PREMULTIPLIED rgba, which is what these targets
 * store. That is not merely convenient — premultiplied is the only space in
 * which averaging neighbouring texels is correct. Filtering straight-alpha
 * color drags the RGB of fully transparent texels (which is meaningless data)
 * into the result and produces dark halos at every stroke and island edge.
 */
const fragmentShader = /* glsl */ `
  uniform sampler2D uPrevTexture;
${BRUSH_MASK_UNIFORMS_GLSL}

  uniform float uEffectMode;
  uniform float uEffectStrength;
  /** Filter kernel radius, in texels of the layer being edited. */
  uniform float uEffectRadius;
  /** Pixelate block size, in texels. */
  uniform float uPixelSize;
  /** Stroke direction in UV space, already scaled by the smudge length. */
  uniform vec2 uSmudgeDir;
  uniform vec2 uTexelSize;
  uniform float uBrushOpacity;
  uniform float uRestrictFace;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vSelected;

${BRUSH_MASK_GLSL}

  /**
   * Box blur over a (2n+1)² kernel. Fixed loop bounds because GLSL ES 1.0 will
   * not unroll a loop with a dynamic limit; the radius scales the step instead,
   * so a wide blur costs the same as a narrow one and stays artifact-free by
   * spreading the same number of taps further apart.
   */
  vec4 boxBlur(vec2 uv, float radius) {
    vec4 sum = vec4(0.0);
    float count = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(float(x), float(y)) * uTexelSize * (radius * 0.5);
        sum += texture2D(uPrevTexture, uv + offset);
        count += 1.0;
      }
    }
    return sum / count;
  }

  void main() {
    vec4 original = texture2D(uPrevTexture, vUv);

    float falloff;
    float facingMask;
    float visibility;
    computeBrushMask(falloff, facingMask, visibility);

    float faceMask = mix(1.0, vSelected, uRestrictFace);
    float strength = falloff * facingMask * faceMask * uBrushOpacity * uEffectStrength;

    if (strength <= 0.001) {
      gl_FragColor = original;
      return;
    }

    vec4 filtered = original;
    int mode = int(uEffectMode + 0.5);

    if (mode == 0) {
      filtered = boxBlur(vUv, uEffectRadius);
    } else if (mode == 1) {
      // Unsharp mask: push the texel away from its blurred neighbourhood.
      vec4 blurred = boxBlur(vUv, uEffectRadius);
      filtered = original + (original - blurred);
      // Premultiplied rgb must stay within its own alpha, and a sharpen can
      // overshoot in both directions — clamp rather than let it wrap.
      filtered.a = clamp(filtered.a, 0.0, 1.0);
      filtered.rgb = clamp(filtered.rgb, vec3(0.0), vec3(filtered.a));
    } else if (mode == 2) {
      // Smudge drags color from behind the stroke. uSmudgeDir is the stroke's
      // own direction in UV space (computed from consecutive hit UVs, which is
      // valid because the UV map is locally affine across a single dab), so the
      // pull follows the hand rather than some fixed axis.
      filtered = texture2D(uPrevTexture, vUv - uSmudgeDir);
    } else {
      // Snap to a block grid, sampling each block's center so the result is
      // stable as the brush moves over it instead of shimmering.
      vec2 block = uTexelSize * max(uPixelSize, 1.0);
      vec2 snapped = (floor(vUv / block) + 0.5) * block;
      filtered = texture2D(uPrevTexture, snapped);
    }

    gl_FragColor = mix(original, filtered, strength);
  }
`

export interface EffectUniforms extends BrushMaskUniforms {
  uPrevTexture: THREE.IUniform<THREE.Texture | null>
  uEffectMode: THREE.IUniform<number>
  uEffectStrength: THREE.IUniform<number>
  uEffectRadius: THREE.IUniform<number>
  uPixelSize: THREE.IUniform<number>
  uSmudgeDir: THREE.IUniform<THREE.Vector2>
  uTexelSize: THREE.IUniform<THREE.Vector2>
  uBrushOpacity: THREE.IUniform<number>
  uRestrictFace: THREE.IUniform<number>
}

export function createEffectMaterial(
  textureSize: number
): THREE.ShaderMaterial & { uniforms: EffectUniforms } {
  const uniforms: EffectUniforms = {
    ...createBrushMaskUniforms(),
    uPrevTexture: { value: null },
    uEffectMode: { value: 0 },
    uEffectStrength: { value: 0.6 },
    uEffectRadius: { value: 3 },
    uPixelSize: { value: 16 },
    uSmudgeDir: { value: new THREE.Vector2() },
    uTexelSize: { value: new THREE.Vector2(1 / textureSize, 1 / textureSize) },
    uBrushOpacity: { value: 1 },
    uRestrictFace: { value: 0 }
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: EffectUniforms }
}
