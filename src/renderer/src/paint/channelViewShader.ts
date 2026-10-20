import * as THREE from 'three'

/**
 * Isolated channel view: shows one texture map on the model exactly as it is
 * stored, unlit and untone-mapped, the way every texture painter's channel
 * inspector does. Lighting a roughness map would be actively misleading — the
 * artist is reading numbers off the surface, not judging how it shades.
 */
export function createChannelViewMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: null },
      // 1 = the map is a tangent-space normal, shown as its familiar
      // lilac-blue encoding rather than as three unrelated grey ramps.
      uIsNormal: { value: 0 },
      // 1 = the map carries premultiplied alpha (the base-color composite
      // does; the flattened data channels do not).
      uPremultiplied: { value: 0 },
      // -1 = show RGB; 1 / 2 = show only G / B as gray (a packed ORM map,
      // which carries roughness in G and metalness in B).
      uComponent: { value: -1 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      uniform int uIsNormal;
      uniform int uPremultiplied;
      uniform int uComponent;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tMap, vUv);
        vec3 value = texel.rgb;
        if (uPremultiplied == 1 && texel.a > 0.0001) value /= texel.a;
        if (uComponent == 1) value = vec3(texel.g);
        else if (uComponent == 2) value = vec3(texel.b);
        gl_FragColor = vec4(value, 1.0);
        // The renderer re-encodes to the output color space on write; these are
        // raw stored values, so opt out of tone mapping only — a filmic curve
        // over a roughness map would show the wrong number.
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false
  })
}
