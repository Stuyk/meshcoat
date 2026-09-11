import * as THREE from 'three'

export interface MaskCompositeUniforms {
  tSource: { value: THREE.Texture | null }
  tMask: { value: THREE.Texture | null }
  uOpacity: { value: number }
}

export function createMaskCompositeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tSource: { value: null },
      tMask: { value: null },
      uOpacity: { value: 1.0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform sampler2D tMask;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec4 src = texture2D(tSource, vUv);
        vec4 mask = texture2D(tMask, vUv);
        // Mask red channel defines transmission (1.0 = reveal, 0.0 = hide)
        float m = clamp(mask.r, 0.0, 1.0);
        float alpha = src.a * m * uOpacity;
        vec3 rgb = src.rgb * m * uOpacity;
        gl_FragColor = vec4(rgb, alpha);
      }
    `,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false
  })
}
