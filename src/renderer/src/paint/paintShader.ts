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
  // 0 = Surface UV (straightforward), 1 = World Triplanar
  uniform float uTextureMapping;
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


  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  varying float vSelected;

${BRUSH_MASK_GLSL}

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
      paintColor = mix(stencilColor.rgb * uBrushColor.rgb, uBrushColor.rgb, uStencilUseLuma);
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
  uTextureMapping: THREE.IUniform<number>
  uStencilTex: THREE.IUniform<THREE.Texture | null>
  uUseStencil: THREE.IUniform<number>
  uStencilRect: THREE.IUniform<THREE.Vector4>
  uStencilRotation: THREE.IUniform<number>
  uStencilInvert: THREE.IUniform<number>
  uStencilStamp: THREE.IUniform<number>
  uStencilUseLuma: THREE.IUniform<number>
  uCanvasSize: THREE.IUniform<THREE.Vector2>
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
    uTextureMapping: { value: 0 },
    uStencilTex: { value: null },
    uUseStencil: { value: 0 },
    uStencilRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uStencilRotation: { value: 0 },
    uStencilInvert: { value: 0 },
    uStencilStamp: { value: 0 },
    uStencilUseLuma: { value: 0 },
    uCanvasSize: { value: new THREE.Vector2(1, 1) }
  }

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: uniforms as unknown as { [key: string]: THREE.IUniform },
    depthTest: false,
    depthWrite: false
  }) as THREE.ShaderMaterial & { uniforms: PaintUniforms }
}
