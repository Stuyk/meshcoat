import * as THREE from 'three'

/**
 * The brush's world-space footprint, shared verbatim by every tool that puts a
 * dab on the surface — the paint brush (paintShader.ts) and the effect brush
 * (effectShader.ts).
 *
 * This lives in one place on purpose. The projector bounds and the camera
 * visibility test are the two pieces of this app that have been got wrong the
 * most times, and a second copy of them in a second shader would drift from
 * this one the first time either is tuned. Both shaders declare the same
 * uniform names, so one TypeScript helper fills them for both.
 */

/** Uniform declarations. Paste into a fragment shader before BRUSH_MASK_GLSL. */
export const BRUSH_MASK_UNIFORMS_GLSL = /* glsl */ `
  uniform vec3 uBrushWorldPos;
  uniform vec3 uBrushNormal;
  uniform vec3 uBrushTangent;
  uniform vec3 uBrushBitangent;
  uniform float uBrushRadius;
  uniform float uBrushHardness;
  // Projector reach along the brush normal, as a fraction of uBrushRadius.
  uniform float uProjectorDepth;
  // Widest surface-vs-brush normal angle (degrees) that still takes paint.
  uniform float uMaxAngle;

  // Camera-space occlusion (see occlusionDepth.ts).
  uniform sampler2D uOcclusionDepthTex;
  uniform vec2 uOcclusionTexel;
  uniform mat4 uCameraViewProjMatrix;
  uniform mat4 uCameraViewMatrix;
  uniform vec3 uCameraPosition;
  uniform float uNormalSign;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uUseOcclusion;

  // Texture-space dab (the 2D paint panel): a circle of uDabUvRadius around
  // uDabUv, measured on the sheet itself rather than projected through space.
  uniform float uUvDab;
  uniform vec2 uDabUv;
  uniform float uDabUvRadius;
  uniform float uDabUvAngle;
`

/**
 * Requires `vWorldPosition` and `vWorldNormal` varyings from the host shader.
 *
 * Outputs:
 *  - `falloff`    the round dab's radial shape, 1 at the center
 *  - `facingMask` angle culling × projector depth × visibility, i.e. everything
 *                 except the radial shape
 *  - `visibility` the camera test alone, for passes with no dab geometry at all
 *                 (the stencil stamp) that still must not reach hidden faces
 */
export const BRUSH_MASK_GLSL = /* glsl */ `
  /**
   * Position inside the dab in units of its radius (-1..1 across it), rotated
   * with the brush — what tips and stamps are sampled with. Texture-space
   * dabs measure it on the sheet; surface dabs on the brush's tangent plane.
   */
  vec2 brushLocalXY(vec3 rel) {
    if (uUvDab > 0.5) {
      vec2 d = vUv - uDabUv;
      float c = cos(uDabUvAngle);
      float s = sin(uDabUvAngle);
      return vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / max(uDabUvRadius, 1e-6);
    }
    return vec2(dot(rel, uBrushTangent), dot(rel, uBrushBitangent)) / uBrushRadius;
  }

  void computeBrushMask(out float falloff, out float facingMask, out float visibility) {
    // Texture-space dab: WYSIWYG on the flat sheet. No projector, facing or
    // camera terms — nothing is being projected and there is no camera.
    if (uUvDab > 0.5) {
      float radialUv = length(vUv - uDabUv);
      falloff = 1.0 - smoothstep(uDabUvRadius * uBrushHardness, uDabUvRadius, radialUv);
      facingMask = 1.0;
      visibility = 1.0;
      return;
    }
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
    // of radius r reaches r in *every* direction, so it unavoidably catches the
    // far side of any shell thinner than r, the inside of any tube narrower
    // than r, and the neighbouring fold of any crease — no visibility test can
    // undo that, because from the brush's point of view those texels genuinely
    // are within r. Bounding penetration separately from radius decouples "how
    // wide is my dab" from "how deep does it cut", which is what lets a fat
    // brush work on a thin wall.
    vec3 local = vec3(dot(rel, uBrushTangent), dot(rel, uBrushBitangent), dot(rel, brushNormal));
    float radial = length(local.xy);
    float reach = uBrushRadius * max(uProjectorDepth, 0.0001);

    // Radial shape, and a matching soft ramp on the depth slab so a texel
    // sliding out the back of the projector fades rather than clipping.
    falloff = 1.0 - smoothstep(uBrushRadius * uBrushHardness, uBrushRadius, radial);
    float depthMask = 1.0 - smoothstep(reach * 0.75, reach, abs(local.z));

    // Angle culling, ramped over the last stretch before the cutoff so a
    // stroke across curvature doesn't show a hard ring where it ends.
    float facing = dot(texelNormal, brushNormal);
    float cosMax = cos(radians(clamp(uMaxAngle, 1.0, 180.0)));
    facingMask = clamp((facing - cosMax) / max(1.0 - cosMax, 0.0001), 0.0, 1.0);
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
    //      cases, and an over-tight bias here would eat legitimate work on
    //      grazing surfaces.
    visibility = 1.0;
    if (uUseOcclusion > 0.5) {
      vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
      // uNormalSign is -1 when the mesh's normals are inverted (the face the
      // user is demonstrably looking at reports a normal pointing away). Without
      // it, an inverted import would fail this test everywhere and do nothing.
      float camFacing = dot(texelNormal * uNormalSign, toCamera);
      // Feathered rather than a hard cutoff so silhouettes don't get a
      // stair-stepped edge where the stroke stops.
      visibility *= smoothstep(0.0, 0.25, camFacing);

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
            visibility = 0.0;
          }
        }
      }
    }

    facingMask *= visibility;
  }
`

export interface BrushMaskUniforms {
  uBrushWorldPos: THREE.IUniform<THREE.Vector3>
  uBrushNormal: THREE.IUniform<THREE.Vector3>
  uBrushTangent: THREE.IUniform<THREE.Vector3>
  uBrushBitangent: THREE.IUniform<THREE.Vector3>
  uBrushRadius: THREE.IUniform<number>
  uBrushHardness: THREE.IUniform<number>
  uProjectorDepth: THREE.IUniform<number>
  uMaxAngle: THREE.IUniform<number>
  uOcclusionDepthTex: THREE.IUniform<THREE.Texture | null>
  uOcclusionTexel: THREE.IUniform<THREE.Vector2>
  uCameraViewProjMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraViewMatrix: THREE.IUniform<THREE.Matrix4>
  uCameraPosition: THREE.IUniform<THREE.Vector3>
  uNormalSign: THREE.IUniform<number>
  uCameraNear: THREE.IUniform<number>
  uCameraFar: THREE.IUniform<number>
  uUseOcclusion: THREE.IUniform<number>
  uUvDab: THREE.IUniform<number>
  uDabUv: THREE.IUniform<THREE.Vector2>
  uDabUvRadius: THREE.IUniform<number>
  uDabUvAngle: THREE.IUniform<number>
}

/** A dab placed directly on the texture: UV center, radius in UV units (1 = sheet width). */
export interface UvDab {
  uv: THREE.Vector2
  radius: number
}

/** Sets (or clears, for null) the texture-space dab uniforms shared by both brush shaders. */
export function applyUvDab(u: BrushMaskUniforms, dab: UvDab | null | undefined, angle = 0): void {
  u.uUvDab.value = dab ? 1 : 0
  if (dab) {
    u.uDabUv.value.copy(dab.uv)
    u.uDabUvRadius.value = dab.radius
    u.uDabUvAngle.value = angle
  }
}

export function createBrushMaskUniforms(): BrushMaskUniforms {
  return {
    uBrushWorldPos: { value: new THREE.Vector3() },
    uBrushNormal: { value: new THREE.Vector3(0, 0, 1) },
    uBrushTangent: { value: new THREE.Vector3(1, 0, 0) },
    uBrushBitangent: { value: new THREE.Vector3(0, 1, 0) },
    uBrushRadius: { value: 0.2 },
    uBrushHardness: { value: 0.6 },
    uProjectorDepth: { value: 0.35 },
    uMaxAngle: { value: 85 },
    uOcclusionDepthTex: { value: null },
    uOcclusionTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uCameraViewProjMatrix: { value: new THREE.Matrix4() },
    uCameraViewMatrix: { value: new THREE.Matrix4() },
    uCameraPosition: { value: new THREE.Vector3() },
    uNormalSign: { value: 1 },
    uCameraNear: { value: 0.01 },
    uCameraFar: { value: 1000 },
    uUseOcclusion: { value: 0 },
    uUvDab: { value: 0 },
    uDabUv: { value: new THREE.Vector2() },
    uDabUvRadius: { value: 0.01 },
    uDabUvAngle: { value: 0 }
  }
}
