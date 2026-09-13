import * as THREE from 'three'

/**
 * Live 3D preview of what a fill (with the Face UV Projector transform and/or
 * the shelf texture's crop region) will actually bake onto the selected
 * faces. The math here mirrors the `fillUv` branch of paintShader.ts exactly
 * — projector offset/scale/rotation, then the crop-region tile/mirror/once
 * logic — so what the artist sees before clicking Apply is what lands in the
 * atlas after. Keep the two in sync if either changes.
 *
 * It is a MeshStandardMaterial rather than a raw ShaderMaterial so the preview
 * picks up the scene's lights, environment map and tone mapping exactly as the
 * model does: an unlit swatch sitting on a lit model read as a dark patch,
 * because everything around it is shaded and it wasn't. The projector UV math
 * is injected into the stock <map_fragment> chunk, which leaves the rest of
 * three's PBR pipeline untouched.
 */
const projectorUniformDecl = /* glsl */ `
  uniform vec4 uColor;
  uniform vec2 uProjOffset;
  uniform vec2 uProjScale;
  uniform float uProjRotation;
  uniform float uFillScale;
  uniform vec4 uTextureRegion;
  uniform float uTextureRegionRotation;
  uniform int uRepeatMode;
  uniform float uUseTexture;
  uniform float uFillFit;
  uniform vec4 uFitRect;
`

const projectorMapFragment = /* glsl */ `
  vec2 fitBase = (vMapUv - uFitRect.xy) / max(uFitRect.zw, vec2(0.0001));
  vec2 projected = mix(vMapUv, fitBase, uFillFit) - 0.5;
  if (uProjRotation != 0.0) {
    float cr = cos(uProjRotation);
    float sr = sin(uProjRotation);
    projected = vec2(projected.x * cr - projected.y * sr, projected.x * sr + projected.y * cr);
  }
  projected = projected * uProjScale + 0.5 + uProjOffset;
  vec2 texUv = projected * mix(max(uFillScale, 0.0001), 1.0, uFillFit);

  if (uFillFit < 0.5) {
    texUv.y *= uTextureRegion.z / max(uTextureRegion.w, 0.0001);
  }

  vec2 regionUv;
  float insideOnce = 1.0;
  if (uFillFit > 0.5) {
    insideOnce = step(0.0, texUv.x) * step(texUv.x, 1.0) * step(0.0, texUv.y) * step(texUv.y, 1.0);
    regionUv = clamp(texUv, 0.0, 1.0);
  } else if (uRepeatMode == 2) {
    insideOnce = step(0.0, texUv.x) * step(texUv.x, 1.0) * step(0.0, texUv.y) * step(texUv.y, 1.0);
    regionUv = clamp(texUv, 0.0, 1.0);
  } else if (uRepeatMode == 1) {
    vec2 t = mod(texUv, 2.0);
    regionUv = 1.0 - abs(t - 1.0);
  } else {
    regionUv = fract(texUv);
  }

  if (uTextureRegionRotation != 0.0) {
    float cr2 = cos(uTextureRegionRotation);
    float sr2 = sin(uTextureRegionRotation);
    vec2 centred = regionUv - 0.5;
    regionUv = vec2(centred.x * cr2 - centred.y * sr2, centred.x * sr2 + centred.y * cr2) + 0.5;
  }
  vec2 finalUv = uTextureRegion.xy + clamp(regionUv, 0.0, 1.0) * uTextureRegion.zw;

  vec4 texSample = texture2D(map, finalUv);
  texSample = mix(vec4(1.0), texSample, uUseTexture);
  diffuseColor.rgb *= mix(uColor.rgb, texSample.rgb * uColor.rgb, uUseTexture);
  diffuseColor.a *= uColor.a * texSample.a * insideOnce;
`

export interface FacePreviewUniforms {
  uUseTexture: THREE.IUniform<number>
  uColor: THREE.IUniform<THREE.Vector4>
  uProjOffset: THREE.IUniform<THREE.Vector2>
  uProjScale: THREE.IUniform<THREE.Vector2>
  uProjRotation: THREE.IUniform<number>
  uFillScale: THREE.IUniform<number>
  uTextureRegion: THREE.IUniform<THREE.Vector4>
  uTextureRegionRotation: THREE.IUniform<number>
  uRepeatMode: THREE.IUniform<number>
  uFillFit: THREE.IUniform<number>
  uFitRect: THREE.IUniform<THREE.Vector4>
}

export type FacePreviewMaterial = THREE.MeshStandardMaterial & {
  uniforms: FacePreviewUniforms
  /**
   * Assign the shelf texture here instead of `.map`: `map` always stays bound
   * (to this 1x1 white fallback when there is no texture) so USE_MAP — and
   * with it `vMapUv` — is compiled in unconditionally and the material never
   * has to recompile mid-drag.
   */
  setPreviewTexture: (texture: THREE.Texture | null) => void
}

function createWhitePixel(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  tex.needsUpdate = true
  return tex
}

export function createFacePreviewMaterial(): FacePreviewMaterial {
  const uniforms: FacePreviewUniforms = {
    uUseTexture: { value: 0 },
    // Full opacity: blending in even a little of the surface underneath read as
    // "the preview is washed out" — the top-bar "Preview — not applied" badge
    // is what marks this as unbaked, not a dimmed render.
    uColor: { value: new THREE.Vector4(1, 1, 1, 1) },
    uProjOffset: { value: new THREE.Vector2(0, 0) },
    uProjScale: { value: new THREE.Vector2(1, 1) },
    uProjRotation: { value: 0 },
    uFillScale: { value: 1 },
    uTextureRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTextureRegionRotation: { value: 0 },
    uRepeatMode: { value: 0 },
    uFillFit: { value: 0 },
    uFitRect: { value: new THREE.Vector4(0, 0, 1, 1) }
  }

  const fallback = createWhitePixel()

  const material = new THREE.MeshStandardMaterial({
    map: fallback,
    // Matches the default look of an untextured imported surface; the caller
    // overwrites both from the piece's real material so the preview shades
    // like the faces it covers.
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    // This mesh shares exact vertex positions with the real mesh underneath
    // (same local coords, see updateProjectorPreview in Viewport.tsx) — with
    // depthTest on, that coincident geometry z-fights against the model's own
    // depth values pixel-by-pixel, which is what read as "nearly pitch
    // black": roughly half the texels were losing the depth test and showing
    // the surface beneath instead of the preview texture. The highlight
    // outline mesh already sidesteps this the same way.
    depthTest: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2.5,
    polygonOffsetUnits: -2.5
  }) as FacePreviewMaterial

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${projectorUniformDecl}\nvoid main() {`)
      .replace('#include <map_fragment>', projectorMapFragment)
  }
  // Distinguishes this program from a plain MeshStandardMaterial in three's
  // shader cache, which keys on the material's defines/params and would
  // otherwise hand back a build without the injected chunk.
  material.customProgramCacheKey = () => 'facePreviewProjector'

  material.uniforms = uniforms
  material.setPreviewTexture = (texture) => {
    const next = texture ?? fallback
    if (material.map !== next) {
      material.map = next
      material.needsUpdate = true
    }
    uniforms.uUseTexture.value = texture ? 1 : 0
  }

  return material
}
