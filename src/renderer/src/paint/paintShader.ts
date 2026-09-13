import * as THREE from 'three'
import {
  BRUSH_MASK_UNIFORMS_GLSL,
  BRUSH_MASK_GLSL,
  createBrushMaskUniforms,
  type BrushMaskUniforms
} from './brushMask'

const vertexShader = /* glsl */ `
  attribute vec3 aWorldPosition;
  attribute vec3 aWorldNormal;
  attribute vec3 aSurfaceTangent;
  attribute vec3 aSurfaceBitangent;
  attribute float aSelected;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSurfaceTangent;
  varying vec3 vSurfaceBitangent;
  varying vec2 vUv;
  varying float vSelected;

  void main() {
    vWorldPosition = aWorldPosition;
    vWorldNormal = aWorldNormal;
    vSurfaceTangent = aSurfaceTangent;
    vSurfaceBitangent = aSurfaceBitangent;
    vUv = uv;
    vSelected = aSelected;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uPrevTexture;
${BRUSH_MASK_UNIFORMS_GLSL}

  uniform vec4 uBrushColor;
  uniform float uBrushOpacity;
  uniform sampler2D uBrushTexture;
  uniform float uUseTexture;
  uniform float uTextureScale;
  uniform sampler2D uBrushTipTexture;
  uniform float uUseTipTexture;
  uniform float uStampMode;
  // Face selection (spec: select faces, paint/fill only within them).
  uniform float uRestrictFace;
  // Fill mode: paints uBrushColor / uBrushTexture at full uBrushOpacity everywhere the face
  // restriction allows, ignoring brush position/falloff/facing — used by
  // PaintEngine.fillFaces / fill for a bucket fill of the selected faces or whole model.
  uniform float uFillMode;
  uniform float uFillScale;
  // Face UV Projector: a shared offset/scale/rotation applied on top of the
  // mesh's own UV before the fill/region-crop stage, so a fill can place a
  // texture like TrenchBroom's face editor instead of always starting the
  // crop at the mesh's raw UV origin. Identity (0,0 / 1,1 / 0) is a no-op and
  // reduces exactly to the previous fillUv = vUv * uFillScale behavior.
  uniform vec2 uProjOffset;
  uniform vec2 uProjScale;
  uniform float uProjRotation;
  /**
   * Fit mode: 1 = stretch ONE copy of the crop across uFitRect (the UV
   * bounding box of the face selection) instead of tiling it across the mesh's
   * raw UV at uFillScale. This is what "put this image on this face" means —
   * the tiling scale, the crop's aspect correction and the repeat mode are all
   * bypassed, because a fitted copy by definition covers the selection exactly
   * once. uProjOffset/Scale/Rotation still nudge that copy around inside it.
   */
  uniform float uFillFit;
  uniform vec4 uFitRect;
  // 0 = Surface UV (straightforward), 1 = World Triplanar
  uniform float uTextureMapping;
  /**
   * Sub-rectangle of the source texture the brush draws from: xy = offset,
   * zw = size, both 0-1 in texture space. Default (0,0,1,1) is the whole image.
   * uTextureRegionRotation spins the crop about its own centre, so a diagonal
   * detail can be pulled square without re-authoring the file.
   */
  uniform vec4 uTextureRegion;
  uniform float uTextureRegionRotation;
  /** 0 = tile, 1 = mirror, 2 = once (no repetition). */
  uniform int uRepeatMode;
  // Camera-space occlusion (see occlusionDepth.ts): rejects fragments that
  // aren't actually visible from the paint camera — e.g. a face directly
  // behind the one under the brush — instead of only masking by facing.
  // Screen-space stencil (see stencil.ts): an image pinned to the viewport that
  // the brush paints *through*, so a photo or pattern projects undistorted onto
  // curved geometry instead of following the surface tangent like a Stamp.
  uniform sampler2D uStencilTex;
  uniform float uUseStencil;
  // Stencil rect in canvas pixels: xy = center, zw = size. Same numbers that
  // position the DOM overlay, so what the artist sees is exactly what paints.
  uniform vec4 uStencilRect;
  uniform float uStencilRotation;
  uniform float uStencilInvert;
  // 1 = project the stencil image's colors as a decal; see the stamp block below.
  uniform float uStencilStamp;
  // 1 = drive the stamp's shape from brightness and paint uBrushColor, for
  // black-and-white stencils that have no alpha channel.
  uniform float uStencilUseLuma;
  uniform vec2 uCanvasSize;

  // Which PBR channel this pass is writing (see channels.ts). One pass runs per
  // enabled channel, sharing every dab parameter — the projector footprint,
  // facing/visibility masks, tip alpha, stencil and face restriction are all
  // channel-agnostic, so only the payload written under the mask changes.
  //   0 = base color  — uBrushColor.rgb, tinted by the shelf texture (legacy behaviour)
  //   1 = scalar data — uBrushColor.rgb already holds the value in all three
  //                     components (roughness / metalness); the shelf texture
  //                     contributes its alpha as a mask only, never its color,
  //                     since tinting a roughness number by a photo is meaningless
  //   2 = normal      — the payload is computed from the dab's own height field
  uniform int uChannelMode;
  // Normal-channel bump strength; negative engraves instead of embossing.
  uniform float uNormalStrength;
  // The map supplying THIS channel's values, when painting with a material set
  // (see materialSets.ts) rather than a dialled-in number. Sampled with exactly
  // the same uv as the base-color texture, so every channel of a set lands in
  // register. The slider then scales what the map says (map x slider) rather
  // than replacing it, which is what keeps "this rock, a bit glossier" possible.
  uniform sampler2D uChannelMap;
  uniform float uUseChannelMap;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vSurfaceTangent;
  varying vec3 vSurfaceBitangent;
  varying vec2 vUv;
  varying float vSelected;

${BRUSH_MASK_GLSL}

  /**
   * The dab's height field, sampled in the brush's own tangent plane (the same
   * stampUv coordinates the tip/stamp use, 0-1 across 2 * radius). Whatever
   * shapes the stroke also shapes the bump: a custom tip's alpha, a stamped
   * image's alpha, or — with neither — the round dab's radial falloff.
   */
  float dabHeight(vec2 p) {
    if (uUseTipTexture > 0.5) {
      float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
      return texture2D(uBrushTipTexture, p).a * inside;
    }
    if (uUseTexture > 0.5 && uStampMode > 0.5) {
      float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
      return texture2D(uBrushTexture, p).a * inside;
    }
    float radial = length(p - 0.5) * 2.0 * uBrushRadius;
    return 1.0 - smoothstep(uBrushRadius * uBrushHardness, uBrushRadius, radial);
  }

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

    float falloff;
    float facingMask;
    float visibility;
    computeBrushMask(falloff, facingMask, visibility);

    // Tangent-space dab coordinates, needed below for the brush tip / stamp.
    vec3 rel = vWorldPosition - uBrushWorldPos;

    // Screen-space stencil gate. The texel is projected to the viewport and
    // tested against the stencil rect; anything outside it, or masked by the
    // stencil's own luminance/alpha, takes no paint.
    float stencilMask = 1.0;
    vec4 stencilColor = vec4(0.0);
    if (uUseStencil > 0.5 || uStencilStamp > 0.5) {
      stencilMask = 0.0;
      vec4 sClip = uCameraViewProjMatrix * vec4(vWorldPosition, 1.0);
      if (sClip.w > 0.0) {
        vec2 sNdc = sClip.xy / sClip.w;
        // NDC is y-up; the stencil rect is in CSS pixels, which are y-down.
        vec2 pix = vec2(
          (sNdc.x * 0.5 + 0.5) * uCanvasSize.x,
          (1.0 - (sNdc.y * 0.5 + 0.5)) * uCanvasSize.y
        );
        vec2 d = pix - uStencilRect.xy;
        float cs = cos(-uStencilRotation);
        float sn = sin(-uStencilRotation);
        vec2 local = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
        vec2 stencilUv = local / max(uStencilRect.zw, vec2(0.0001)) + 0.5;
        if (stencilUv.x >= 0.0 && stencilUv.x <= 1.0 && stencilUv.y >= 0.0 && stencilUv.y <= 1.0) {
          // Three uploads textures flipped (flipY), so v = 0 is the image's
          // bottom while the CSS rect's v = 0 is its top.
          vec4 stencilSample = texture2D(uStencilTex, vec2(stencilUv.x, 1.0 - stencilUv.y));
          stencilColor = stencilSample;
          // Luminance drives the mask so plain black-and-white artwork works
          // without an alpha channel; a cut-out PNG's alpha multiplies in too.
          float lum = dot(stencilSample.rgb, vec3(0.299, 0.587, 0.114));
          stencilMask = mix(lum, 1.0 - lum, uStencilInvert) * stencilSample.a;
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
    // In fit mode the selection's UV bounding box is remapped to 0-1 first, so
    // the projector transform (and everything downstream) works in "one copy
    // spans the selection" units rather than raw UV units.
    vec2 fitBase = (vUv - uFitRect.xy) / max(uFitRect.zw, vec2(0.0001));
    vec2 projected = mix(vUv, fitBase, uFillFit) - 0.5;
    if (uProjRotation != 0.0) {
      float pcr = cos(uProjRotation);
      float psr = sin(uProjRotation);
      projected = vec2(projected.x * pcr - projected.y * psr, projected.x * psr + projected.y * pcr);
    }
    projected = projected * uProjScale + 0.5 + uProjOffset;
    vec2 fillUv = projected * mix(max(uFillScale, 0.0001), 1.0, uFillFit);

    vec2 texUv = mix(strokeTexUv, fillUv, uFillMode);
    // Fit only ever describes a fill; a stroke's UV has no selection to fit to.
    float fitOn = uFillFit * uFillMode;

    /**
     * Repeat handling. Everything below works in "region space": 0-1 is ONE
     * copy of the selected crop, so whatever the artist framed in the region
     * picker is the unit that repeats — not an arbitrary window onto a pattern
     * whose phase came from somewhere else.
     */
    /**
     * Tiling is measured in copies of the REGION, not copies of the sheet. A
     * crop half as tall as it is wide has to cover half as much v per repeat or
     * every tile comes out stretched — which is what "the scale doesn't tile
     * right" looks like. Full-image regions are 1:1 and unaffected.
     */
    // ...except when fitting: there the crop is being stretched to the
    // selection on purpose, so correcting its aspect would letterbox it back
    // out of the box the artist asked it to fill.
    if (uStampMode < 0.5 && fitOn < 0.5) {
      texUv.y *= uTextureRegion.z / max(uTextureRegion.w, 0.0001);
    }

    vec2 regionUv;
    float insideOnce = 1.0;
    if (fitOn > 0.5) {
      // One copy, clipped outside: a fitted copy already spans the selection,
      // so wrapping could only reprint it over itself once offset/scale push
      // part of it past the edge.
      insideOnce = step(0.0, texUv.x) * step(texUv.x, 1.0) *
                   step(0.0, texUv.y) * step(texUv.y, 1.0);
      regionUv = clamp(texUv, 0.0, 1.0);
    } else if (uStampMode > 0.5) {
      // A stamp/tip decal's 0-1 range IS its extent; wrapping would reprint the
      // crop around its own edges.
      regionUv = clamp(texUv, 0.0, 1.0);
    } else if (uRepeatMode == 2) {
      // Once: a single copy, and nothing outside it. Clamping alone would smear
      // the border texels across the rest of the stroke, so the dab is masked
      // out there instead.
      insideOnce = step(0.0, texUv.x) * step(texUv.x, 1.0) *
                   step(0.0, texUv.y) * step(texUv.y, 1.0);
      regionUv = clamp(texUv, 0.0, 1.0);
    } else if (uRepeatMode == 1) {
      // Mirror: every other copy flips, so the crop's edges always meet their
      // own reflection and a non-tiling image has no visible seam.
      vec2 t = mod(texUv, 2.0);
      regionUv = 1.0 - abs(t - 1.0);
    } else {
      regionUv = fract(texUv);
    }

    if (uTextureRegionRotation != 0.0) {
      float cr = cos(uTextureRegionRotation);
      float sr = sin(uTextureRegionRotation);
      vec2 centred = regionUv - 0.5;
      regionUv = vec2(centred.x * cr - centred.y * sr, centred.x * sr + centred.y * cr) + 0.5;
    }
    texUv = uTextureRegion.xy + clamp(regionUv, 0.0, 1.0) * uTextureRegion.zw;

    vec4 texSample = texture2D(uBrushTexture, texUv);
    texSample.a *= insideOnce;

    // Paint color: shelf texture (tinted by uBrushColor) or just uBrushColor
    vec3 paintColor = mix(uBrushColor.rgb, texSample.rgb * uBrushColor.rgb, uUseTexture);
    if (uChannelMode == 1) {
      // A scalar channel takes the dialled-in number verbatim; the shelf
      // texture still masks the stroke (below) but must not tint the value.
      paintColor = uBrushColor.rgb;
      if (uUseChannelMap > 0.5) {
        // Grayscale data map: any channel carries the value (exporters write
        // all three equal), and red is the one that survives every packing.
        float mapValue = texture2D(uChannelMap, texUv).r;
        paintColor = vec3(clamp(mapValue * uBrushColor.r, 0.0, 1.0));
      }
    } else if (uChannelMode == 2 && uUseChannelMap > 0.5) {
      // Normal *map* from a material set, rather than relief derived from the
      // dab's shape. The map is tangent-space in whatever frame it is being
      // projected through: straight onto the mesh UVs (where it is already in
      // the right frame), or through the brush's own plane for a triplanar or
      // stamped projection — in which case it has to be rotated into the mesh
      // UV frame or the relief would light as though facing somewhere else.
      vec3 mapNormal = texture2D(uChannelMap, texUv).rgb * 2.0 - 1.0;
      mapNormal.xy *= uNormalStrength;
      mapNormal = normalize(length(mapNormal) > 0.0001 ? mapNormal : vec3(0.0, 0.0, 1.0));

      vec3 nWorld = normalize(vWorldNormal);
      bool meshUvProjection = uTextureMapping < 0.5 && uStampMode < 0.5;
      if (meshUvProjection) {
        paintColor = mapNormal * 0.5 + 0.5;
      } else {
        vec3 world = normalize(
          mapNormal.x * uBrushTangent + mapNormal.y * uBrushBitangent + mapNormal.z * nWorld
        );
        vec3 T = normalize(vSurfaceTangent);
        vec3 B = normalize(vSurfaceBitangent);
        vec3 tangentSpace = normalize(vec3(dot(world, T), dot(world, B), dot(world, nWorld)));
        tangentSpace.z = max(tangentSpace.z, 0.05);
        paintColor = normalize(tangentSpace) * 0.5 + 0.5;
      }
    } else if (uChannelMode == 2) {
      // Tangent-space normal from the slope of the dab's own height field.
      // The gradient is measured in the brush's plane — which follows the
      // cursor and rotates with the stroke — then the perturbed world normal
      // is re-expressed in the mesh's UV tangent frame (see uvMesh.ts), which
      // is the frame a tangent-space normal map is actually read in.
      float d = 1.0 / 64.0;
      float hx = dabHeight(stampUv + vec2(d, 0.0)) - dabHeight(stampUv - vec2(d, 0.0));
      float hy = dabHeight(stampUv + vec2(0.0, d)) - dabHeight(stampUv - vec2(0.0, d));
      // Finite differences are in stampUv units; convert to world units so the
      // slope means the same thing at any brush size.
      float worldStep = 2.0 * d * 2.0 * uBrushRadius;
      vec2 grad = vec2(hx, hy) / max(worldStep, 0.0001);

      vec3 nWorld = normalize(vWorldNormal);
      vec3 perturbed = normalize(
        nWorld - uNormalStrength * (grad.x * uBrushTangent + grad.y * uBrushBitangent)
      );
      vec3 T = normalize(vSurfaceTangent);
      vec3 B = normalize(vSurfaceBitangent);
      vec3 tangentSpace = normalize(vec3(dot(perturbed, T), dot(perturbed, B), dot(perturbed, nWorld)));
      // Z must stay positive: the perturbation is a surface detail, not a fold
      // back through the surface, and a negative Z would light as a hole.
      tangentSpace.z = max(tangentSpace.z, 0.05);
      paintColor = normalize(tangentSpace) * 0.5 + 0.5;
    }

    float faceMask = mix(1.0, vSelected, uRestrictFace);

    // Stroke falloff: if a custom tip or stamp is active, its alpha mask shapes the stroke;
    // otherwise, use spherical smoothstep falloff:
    float strokeFalloff = mix(falloff, facingMask, max(uStampMode, uUseTipTexture));

    // Decal mask in stamp tool mode
    float stampDecalMask = mix(1.0, inStamp, uStampMode * (1.0 - uFillMode));
    float texMask = mix(1.0, texSample.a * stampDecalMask, uUseTexture);

    float fillAlpha = uBrushOpacity * mix(1.0, texSample.a, uUseTexture);
    float strength = mix(strokeFalloff * uBrushOpacity * tipMask * texMask, fillAlpha, uFillMode) * faceMask * stencilMask;
    float targetAlpha = uBrushColor.a * mix(1.0, texSample.a, uUseTexture);

    // Stencil STAMP: project the stencil image itself onto every visible texel
    // inside its rect in one pass — a decal, not a brush. There is no dab
    // position, radius or falloff involved, so this replaces the brush terms
    // outright rather than multiplying into them; the visibility term is the only
    // thing kept, and it's what stops the projection wrapping onto back faces
    // and geometry hidden behind the model.
    if (uStencilStamp > 0.5) {
      // The image's own alpha carries the decal shape. uStencilUseLuma turns a
      // plain black-and-white stencil (opaque everywhere, shape encoded in
      // brightness) into a mask that paints uBrushColor instead.
      float lum = dot(stencilColor.rgb, vec3(0.299, 0.587, 0.114));
      float lumMask = mix(lum, 1.0 - lum, uStencilInvert);
      float shape = stencilColor.a * mix(1.0, lumMask, uStencilUseLuma);
      // The stencil image's own colors are the payload for base color only. A
      // data channel takes the value already computed above and uses the
      // stencil purely as the decal's shape — projecting a photo's RGB into a
      // roughness or normal map would be meaningless.
      if (uChannelMode == 0) {
        paintColor = mix(stencilColor.rgb * uBrushColor.rgb, uBrushColor.rgb, uStencilUseLuma);
      }
      strength = shape * uBrushOpacity * visibility * faceMask;
      targetAlpha = uBrushColor.a;
    }

    float outAlpha = mix(prev.a, targetAlpha, strength);
    vec3 outColor = mix(prev.rgb, paintColor, strength);
    gl_FragColor = vec4(outColor * outAlpha, outAlpha);
  }
`

export interface PaintUniforms extends BrushMaskUniforms {
  uPrevTexture: THREE.IUniform<THREE.Texture | null>
  uBrushColor: THREE.IUniform<THREE.Vector4>
  uBrushOpacity: THREE.IUniform<number>
  uBrushTexture: THREE.IUniform<THREE.Texture | null>
  uUseTexture: THREE.IUniform<number>
  uBrushTipTexture: THREE.IUniform<THREE.Texture | null>
  uUseTipTexture: THREE.IUniform<number>
  uTextureScale: THREE.IUniform<number>
  uStampMode: THREE.IUniform<number>
  uRestrictFace: THREE.IUniform<number>
  uFillMode: THREE.IUniform<number>
  uFillScale: THREE.IUniform<number>
  uFillFit: THREE.IUniform<number>
  uFitRect: THREE.IUniform<THREE.Vector4>
  uProjOffset: THREE.IUniform<THREE.Vector2>
  uProjScale: THREE.IUniform<THREE.Vector2>
  uProjRotation: THREE.IUniform<number>
  uTextureMapping: THREE.IUniform<number>
  uTextureRegion: THREE.IUniform<THREE.Vector4>
  uTextureRegionRotation: THREE.IUniform<number>
  uRepeatMode: THREE.IUniform<number>
  uStencilTex: THREE.IUniform<THREE.Texture | null>
  uUseStencil: THREE.IUniform<number>
  uStencilRect: THREE.IUniform<THREE.Vector4>
  uStencilRotation: THREE.IUniform<number>
  uStencilInvert: THREE.IUniform<number>
  uStencilStamp: THREE.IUniform<number>
  uStencilUseLuma: THREE.IUniform<number>
  uCanvasSize: THREE.IUniform<THREE.Vector2>
  uChannelMode: THREE.IUniform<number>
  uNormalStrength: THREE.IUniform<number>
  uChannelMap: THREE.IUniform<THREE.Texture | null>
  uUseChannelMap: THREE.IUniform<number>
}

export function createPaintMaterial(): THREE.ShaderMaterial & { uniforms: PaintUniforms } {
  const uniforms: PaintUniforms = {
    ...createBrushMaskUniforms(),
    uPrevTexture: { value: null },
    uBrushColor: { value: new THREE.Vector4(1, 1, 1, 1) },
    uBrushOpacity: { value: 1 },
    uBrushTexture: { value: null },
    uUseTexture: { value: 0 },
    uBrushTipTexture: { value: null },
    uUseTipTexture: { value: 0 },
    uTextureScale: { value: 1 },
    uStampMode: { value: 0 },
    uRestrictFace: { value: 0 },
    uFillMode: { value: 0 },
    uFillScale: { value: 1 },
    uFillFit: { value: 0 },
    uFitRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uProjOffset: { value: new THREE.Vector2(0, 0) },
    uProjScale: { value: new THREE.Vector2(1, 1) },
    uProjRotation: { value: 0 },
    uTextureMapping: { value: 0 },
    uTextureRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTextureRegionRotation: { value: 0 },
    uRepeatMode: { value: 0 },
    uStencilTex: { value: null },
    uUseStencil: { value: 0 },
    uStencilRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uStencilRotation: { value: 0 },
    uStencilInvert: { value: 0 },
    uStencilStamp: { value: 0 },
    uStencilUseLuma: { value: 0 },
    uCanvasSize: { value: new THREE.Vector2(1, 1) },
    uChannelMode: { value: 0 },
    uNormalStrength: { value: 1 },
    uChannelMap: { value: null },
    uUseChannelMap: { value: 0 }
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    // DoubleSide is mandatory for every pass that rasterizes the UV mesh.
    // Flattening a model into UV space keeps each triangle's winding, and glTF
    // exporters (Blender's included) flip V on export — which reverses that
    // winding. Under the default FrontSide every triangle of a glTF model is
    // then back-facing and the entire mesh is culled: no paint, no coverage
    // mask, no dilation, on a model whose UVs are perfectly fine.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: PaintUniforms }
}
