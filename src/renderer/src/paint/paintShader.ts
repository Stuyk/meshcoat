import * as THREE from 'three'

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

const fragmentShader = /* glsl */ `
  uniform sampler2D uPrevTexture;
  uniform vec3 uBrushWorldPos;
  uniform vec3 uBrushNormal;
  uniform float uBrushRadius;
  uniform float uBrushHardness;
  uniform vec4 uBrushColor;
  uniform float uBrushOpacity;
  uniform sampler2D uBrushTexture;
  uniform float uUseTexture;
  uniform float uTextureScale;
  uniform float uStampMode;
  uniform vec3 uBrushTangent;
  uniform vec3 uBrushBitangent;
  // Face selection (spec: select faces, paint/fill only within them).
  uniform float uRestrictFace;
  // Fill mode: paints uBrushColor at full uBrushOpacity everywhere the face
  // restriction allows, ignoring brush position/falloff/facing — used by
  // PaintEngine.fillFaces for a flat bucket fill of the selected faces.
  uniform float uFillMode;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vSelected;

  void main() {
    // The render target stores premultiplied color (rgb already scaled by
    // alpha) so bilinear sampling at painted/unpainted boundaries blends
    // correctly instead of pulling in black from fully-transparent texels —
    // straight (non-premultiplied) storage is what causes the classic dark
    // fringing at stroke and UV-island edges. Un-premultiply before doing
    // math in normal straight-alpha space, then re-premultiply on output.
    vec4 prevRaw = texture2D(uPrevTexture, vUv);
    vec3 prevColor = prevRaw.a > 0.0001 ? prevRaw.rgb / prevRaw.a : prevRaw.rgb;
    vec4 prev = vec4(prevColor, prevRaw.a);

    vec3 rel = vWorldPosition - uBrushWorldPos;
    float dist = length(rel);
    float facing = dot(normalize(vWorldNormal), normalize(uBrushNormal));

    float edge0 = uBrushRadius * uBrushHardness;
    float falloff = 1.0 - smoothstep(edge0, uBrushRadius, dist);
    falloff *= step(0.0, facing);

    // Texture Brush: triplanar world-space projection so the material tiles
    // seamlessly and stays anchored to the surface regardless of stroke path.
    vec3 n = abs(normalize(vWorldNormal));
    vec2 uvX = vWorldPosition.zy / uTextureScale;
    vec2 uvY = vWorldPosition.xz / uTextureScale;
    vec2 uvZ = vWorldPosition.xy / uTextureScale;
    vec2 triUv = n.x >= n.y && n.x >= n.z ? uvX : (n.y >= n.z ? uvY : uvZ);

    // Stamp tool: the whole image projected flat onto the brush's own local
    // tangent plane, centered and sized to the brush radius, like pressing a
    // rubber stamp onto the surface rather than tiling a material.
    float lu = dot(rel, uBrushTangent) / uBrushRadius * 0.5 + 0.5;
    float lv = dot(rel, uBrushBitangent) / uBrushRadius * 0.5 + 0.5;
    vec2 stampUv = vec2(lu, lv);
    float inStamp = step(0.0, stampUv.x) * step(stampUv.x, 1.0) * step(0.0, stampUv.y) * step(stampUv.y, 1.0);

    vec2 texUv = mix(triUv, stampUv, uStampMode);
    vec4 texSample = texture2D(uBrushTexture, texUv);
    float texMask = mix(1.0, texSample.a, uUseTexture);
    // A pure stamp only paints inside its own square, not the whole falloff circle.
    texMask = mix(texMask, texMask * inStamp, uStampMode * uUseTexture);
    vec3 paintColor = mix(uBrushColor.rgb, texSample.rgb * uBrushColor.rgb, uUseTexture);

    float faceMask = mix(1.0, vSelected, uRestrictFace);

    float strength = mix(falloff * uBrushOpacity * texMask, uBrushOpacity, uFillMode) * faceMask;
    float outAlpha = mix(prev.a, uBrushColor.a, strength);
    vec3 outColor = mix(prev.rgb, paintColor, strength);
    gl_FragColor = vec4(outColor * outAlpha, outAlpha);
  }
`

export interface PaintUniforms {
  uPrevTexture: THREE.IUniform<THREE.Texture | null>
  uBrushWorldPos: THREE.IUniform<THREE.Vector3>
  uBrushNormal: THREE.IUniform<THREE.Vector3>
  uBrushRadius: THREE.IUniform<number>
  uBrushHardness: THREE.IUniform<number>
  uBrushColor: THREE.IUniform<THREE.Vector4>
  uBrushOpacity: THREE.IUniform<number>
  uBrushTexture: THREE.IUniform<THREE.Texture | null>
  uUseTexture: THREE.IUniform<number>
  uTextureScale: THREE.IUniform<number>
  uStampMode: THREE.IUniform<number>
  uBrushTangent: THREE.IUniform<THREE.Vector3>
  uBrushBitangent: THREE.IUniform<THREE.Vector3>
  uRestrictFace: THREE.IUniform<number>
  uFillMode: THREE.IUniform<number>
}

export function createPaintMaterial(): THREE.ShaderMaterial & { uniforms: PaintUniforms } {
  const uniforms: PaintUniforms = {
    uPrevTexture: { value: null },
    uBrushWorldPos: { value: new THREE.Vector3() },
    uBrushNormal: { value: new THREE.Vector3(0, 0, 1) },
    uBrushRadius: { value: 0.2 },
    uBrushHardness: { value: 0.6 },
    uBrushColor: { value: new THREE.Vector4(1, 1, 1, 1) },
    uBrushOpacity: { value: 1 },
    uBrushTexture: { value: null },
    uUseTexture: { value: 0 },
    uTextureScale: { value: 1 },
    uStampMode: { value: 0 },
    uBrushTangent: { value: new THREE.Vector3(1, 0, 0) },
    uBrushBitangent: { value: new THREE.Vector3(0, 1, 0) },
    uRestrictFace: { value: 0 },
    uFillMode: { value: 0 }
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: PaintUniforms }
}
