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
  // Projector reach along the brush normal, as a fraction of uBrushRadius.
  uniform float uProjectorDepth;
  // Widest surface-vs-brush normal angle (degrees) that still takes paint.
  uniform float uMaxAngle;
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
  uniform vec2 uOcclusionTexel;
  uniform mat4 uCameraViewProjMatrix;
  uniform mat4 uCameraViewMatrix;
  uniform vec3 uCameraPosition;
  uniform float uNormalSign;
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
    vec3 brushNormal = normalize(uBrushNormal);
    vec3 texelNormal = normalize(vWorldNormal);

    // The brush is a PROJECTOR, not a sphere. Transform the texel into the
    // brush's local frame — X/Y span the tangent plane at the hit point, Z runs
    // along the surface normal — and bound it as a box:
    //
    //   |local.xy| <= radius      (the round dab, via radial distance below)
    //   |local.z|  <= reach       (how far it penetrates along the normal)
    //
    // The Z bound is the whole reason this doesn't bleed. A spherical falloff
    // of radius r reaches r in *every* direction, so it unavoidably paints the
    // far side of any shell thinner than r, the inside of any tube narrower
    // than r, and the neighbouring fold of any crease — no visibility test can
    // undo that, because from the brush's point of view those texels genuinely
    // are within r. Bounding penetration separately from radius decouples "how
    // wide is my dab" from "how deep does it cut", which is what lets a fat
    // brush paint a thin wall.
    vec3 local = vec3(dot(rel, uBrushTangent), dot(rel, uBrushBitangent), dot(rel, brushNormal));
    float radial = length(local.xy);
    float reach = uBrushRadius * max(uProjectorDepth, 0.0001);

    // Radial shape, and a matching soft ramp on the depth slab so a texel
    // sliding out the back of the projector fades rather than clipping.
    float falloff = 1.0 - smoothstep(uBrushRadius * uBrushHardness, uBrushRadius, radial);
    float depthMask = 1.0 - smoothstep(reach * 0.75, reach, abs(local.z));

    // Angle culling, ramped over the last stretch before the cutoff so a
    // stroke across curvature doesn't show a hard ring where it ends.
    float facing = dot(texelNormal, brushNormal);
    float cosMax = cos(radians(clamp(uMaxAngle, 1.0, 180.0)));
    float facingMask = clamp((facing - cosMax) / max(1.0 - cosMax, 0.0001), 0.0, 1.0);
    facingMask *= depthMask;

    // Reject texels that aren't actually visible from the paint camera — the
    // far wall of a thin shell, or a face hidden behind another part of the
    // model — rather than only masking by how the surface faces the brush.
    //
    // Two independent tests, because neither alone is enough:
    //
    //  (a) Camera facing. A surface whose normal points away from the camera
    //      cannot be the one under the cursor. This is what actually kills
    //      back-of-a-thin-wall bleed, and it needs no depth bias at all — so
    //      wall thickness can be arbitrarily small without breaking it.
    //  (b) Linear depth. A front-facing surface can still be hidden behind
    //      another part of the model; occlusionDepth.ts stores camera-space
    //      distance / far (not window depth), so this comparison and its bias
    //      are in world units and mean the same thing at any camera distance.
    //      The bias can therefore be generous: (a) already covers the tight
    //      cases, and an over-tight bias here would eat legitimate paint on
    //      grazing surfaces.
    if (uUseOcclusion > 0.5) {
      vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
      // uNormalSign is -1 when the mesh's normals are inverted (the face the
      // user is demonstrably looking at reports a normal pointing away). Without
      // it, an inverted import would fail this test everywhere and paint nothing.
      float camFacing = dot(normalize(vWorldNormal) * uNormalSign, toCamera);
      // Feathered rather than a hard cutoff so silhouettes don't get a
      // stair-stepped edge where the stroke stops.
      facingMask *= smoothstep(0.0, 0.25, camFacing);

      float fragViewZ = -(uCameraViewMatrix * vec4(vWorldPosition, 1.0)).z;
      vec4 clip = uCameraViewProjMatrix * vec4(vWorldPosition, 1.0);
      if (clip.w > 0.0) {
        vec3 ndc = clip.xyz / clip.w;
        vec2 screenUv = ndc.xy * 0.5 + 0.5;
        if (screenUv.x >= 0.0 && screenUv.x <= 1.0 && screenUv.y >= 0.0 && screenUv.y <= 1.0) {
          // Farthest of a 3x3 neighbourhood: one texel of the depth map covers
          // a wide span of surface at grazing angles, and a texel straddling a
          // silhouette holds the near surface. Taking the max makes the test
          // conservative — it can miss occlusion by a texel, but it never
          // punches speckled holes in a legitimate stroke.
          float sceneViewZ = 0.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 uvOff = screenUv + vec2(float(x), float(y)) * uOcclusionTexel;
              sceneViewZ = max(sceneViewZ, texture2D(uOcclusionDepthTex, uvOff).r);
            }
          }
          sceneViewZ *= uCameraFar;

          // Scales with viewing distance (perspective foreshortening) and with
          // brush radius (a fat brush reaches further across curvature).
          float depthBias = max(fragViewZ * 0.02, uBrushRadius * 0.5);
          if (fragViewZ > sceneViewZ + depthBias) {
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
  uProjectorDepth: THREE.IUniform<number>
  uMaxAngle: THREE.IUniform<number>
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
  uOcclusionTexel: THREE.IUniform<THREE.Vector2>
  uCameraViewProjMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraViewMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraPosition: THREE.IUniform<THREE.Vector3>
  uNormalSign: THREE.IUniform<number>
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
    uProjectorDepth: { value: 0.35 },
    uMaxAngle: { value: 85 },
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
    uOcclusionTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uCameraViewProjMatrix: { value: new THREE.Matrix4() },
    uCameraViewMatrix: { value: new THREE.Matrix4() },
    uCameraPosition: { value: new THREE.Vector3() },
    uNormalSign: { value: 1 },
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
