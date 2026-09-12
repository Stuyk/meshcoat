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
  uniform sampler2D uBrushTipTexture;
  uniform float uUseTipTexture;
  uniform float uStampMode;
  uniform vec3 uBrushTangent;
  uniform vec3 uBrushBitangent;
  // Face selection (spec: select faces, paint/fill only within them).
  uniform float uRestrictFace;
  // Fill mode: paints uBrushColor / uBrushTexture at full uBrushOpacity everywhere the face
  // restriction allows, ignoring brush position/falloff/facing — used by
  // PaintEngine.fillFaces / fill for a bucket fill of the selected faces or whole model.
  uniform float uFillMode;
  uniform float uFillScale;
  // 0 = Surface UV (straightforward), 1 = World Triplanar
  uniform float uTextureMapping;
  // Camera-space occlusion (see occlusionDepth.ts): rejects fragments that
  // aren't actually visible from the paint camera — e.g. a face directly
  // behind the one under the brush — instead of only masking by facing.
  uniform sampler2D uOcclusionDepthTex;
  uniform mat4 uCameraViewProjMatrix;
  uniform mat4 uCameraViewMatrix;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uUseOcclusion;

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
    // Fade out (instead of a hard cutoff) as a surface turns away from the
    // brush normal, so a stroke near a sharp edge (e.g. a cube corner)
    // doesn't paint an adjacent perpendicular face at full strength right up
    // to the seam — only near-facing surfaces get meaningfully painted.
    float facingMask = smoothstep(0.0, 0.5, facing);

    // Reject fragments occluded (from the paint camera) by other geometry —
    // e.g. a face directly behind the one under the brush — instead of only
    // masking by facing direction. Comparing raw NDC/window depth here would
    // be almost useless: with a wide near/far range (see scene.ts) depth
    // precision is compressed brutally at typical painting distance, so a
    // world-space gap of centimeters collapses to a NDC-depth difference far
    // smaller than any bias that also has to avoid self-occlusion z-fighting.
    // Un-projecting to linear view-space distance (world units) makes the
    // bias mean the same thing regardless of camera distance/near/far.
    if (uUseOcclusion > 0.5) {
      vec4 clip = uCameraViewProjMatrix * vec4(vWorldPosition, 1.0);
      if (clip.w > 0.0) {
        vec3 ndc = clip.xyz / clip.w;
        vec2 screenUv = ndc.xy * 0.5 + 0.5;
        if (screenUv.x >= 0.0 && screenUv.x <= 1.0 && screenUv.y >= 0.0 && screenUv.y <= 1.0) {
          float sceneDepthRaw = texture2D(uOcclusionDepthTex, screenUv).r;
          float sceneNdcZ = sceneDepthRaw * 2.0 - 1.0;
          float sceneViewZ = (2.0 * uCameraNear * uCameraFar) /
            (uCameraFar + uCameraNear - sceneNdcZ * (uCameraFar - uCameraNear));
          float fragViewZ = -(uCameraViewMatrix * vec4(vWorldPosition, 1.0)).z;
          // A couple centimeters of slack absorbs float error without letting
          // genuinely separate surfaces (a wall's near/far side, etc) through.
          if (fragViewZ > sceneViewZ + 0.02) {
            facingMask = 0.0;
          }
        }
      }
    }
    falloff *= facingMask;

    // 1. Local tangent stamp coordinates for brush tip or stamp tool
    float lu = dot(rel, uBrushTangent) / uBrushRadius * 0.5 + 0.5;
    float lv = dot(rel, uBrushBitangent) / uBrushRadius * 0.5 + 0.5;
    vec2 stampUv = vec2(lu, lv);
    float inStamp = step(0.0, stampUv.x) * step(stampUv.x, 1.0) * step(0.0, stampUv.y) * step(stampUv.y, 1.0);

    // Tip mask: alpha of the custom ABR or preset brush tip
    vec4 tipSample = texture2D(uBrushTipTexture, stampUv);
    float tipAlpha = tipSample.a * inStamp;
    float tipMask = mix(1.0, tipAlpha, uUseTipTexture * (1.0 - uFillMode));

    // 2. Texture Shelf / Material Pattern:
    // Triplanar or Surface UV projection
    vec3 n = abs(normalize(vWorldNormal));
    vec2 uvX = vWorldPosition.zy * max(uTextureScale, 0.0001);
    vec2 uvY = vWorldPosition.xz * max(uTextureScale, 0.0001);
    vec2 uvZ = vWorldPosition.xy * max(uTextureScale, 0.0001);
    vec2 triUv = n.x >= n.y && n.x >= n.z ? uvX : (n.y >= n.z ? uvY : uvZ);
    vec2 surfaceUv = vUv * max(uTextureScale, 0.0001);

    // Shelf texture projection: 0 = surface UV, 1 = triplanar
    vec2 patUv = uTextureMapping > 0.5 ? triUv : surfaceUv;
    // In Stamp tool mode, project the shelf texture decal directly flat on the stamp tangent plane
    vec2 strokeTexUv = mix(patUv, stampUv, uStampMode);

    // Fill UV — same raw-UV tiling convention as the brush's surfaceUv above,
    // so "scale" means the same thing whether filling the whole model or a
    // face selection (previously this normalized to the selection's UV
    // bounding box, which stretched the same scale value differently
    // depending on how large the selection was).
    vec2 fillUv = vUv * max(uFillScale, 0.0001);

    vec2 texUv = mix(strokeTexUv, fillUv, uFillMode);
    vec4 texSample = texture2D(uBrushTexture, texUv);

    // Paint color: shelf texture (tinted by uBrushColor) or just uBrushColor
    vec3 paintColor = mix(uBrushColor.rgb, texSample.rgb * uBrushColor.rgb, uUseTexture);

    float faceMask = mix(1.0, vSelected, uRestrictFace);

    // Stroke falloff: if a custom tip or stamp is active, its alpha mask shapes the stroke;
    // otherwise, use spherical smoothstep falloff:
    float strokeFalloff = mix(falloff, facingMask, max(uStampMode, uUseTipTexture));

    // Decal mask in stamp tool mode
    float stampDecalMask = mix(1.0, inStamp, uStampMode * (1.0 - uFillMode));
    float texMask = mix(1.0, texSample.a * stampDecalMask, uUseTexture);

    float fillAlpha = uBrushOpacity * mix(1.0, texSample.a, uUseTexture);
    float strength = mix(strokeFalloff * uBrushOpacity * tipMask * texMask, fillAlpha, uFillMode) * faceMask;

    float targetAlpha = uBrushColor.a * mix(1.0, texSample.a, uUseTexture);
    float outAlpha = mix(prev.a, targetAlpha, strength);
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
  uBrushTipTexture: THREE.IUniform<THREE.Texture | null>
  uUseTipTexture: THREE.IUniform<number>
  uTextureScale: THREE.IUniform<number>
  uStampMode: THREE.IUniform<number>
  uBrushTangent: THREE.IUniform<THREE.Vector3>
  uBrushBitangent: THREE.IUniform<THREE.Vector3>
  uRestrictFace: THREE.IUniform<number>
  uFillMode: THREE.IUniform<number>
  uFillScale: THREE.IUniform<number>
  uTextureMapping: THREE.IUniform<number>
  uOcclusionDepthTex: THREE.IUniform<THREE.Texture | null>
  uCameraViewProjMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraViewMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraNear: THREE.IUniform<number>
  uCameraFar: THREE.IUniform<number>
  uUseOcclusion: THREE.IUniform<number>
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
    uBrushTipTexture: { value: null },
    uUseTipTexture: { value: 0 },
    uTextureScale: { value: 1 },
    uStampMode: { value: 0 },
    uBrushTangent: { value: new THREE.Vector3(1, 0, 0) },
    uBrushBitangent: { value: new THREE.Vector3(0, 1, 0) },
    uRestrictFace: { value: 0 },
    uFillMode: { value: 0 },
    uFillScale: { value: 1 },
    uTextureMapping: { value: 0 },
    uOcclusionDepthTex: { value: null },
    uCameraViewProjMatrix: { value: new THREE.Matrix4() },
    uCameraViewMatrix: { value: new THREE.Matrix4() },
    uCameraNear: { value: 0.01 },
    uCameraFar: { value: 1000 },
    uUseOcclusion: { value: 0 }
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: PaintUniforms }
}
