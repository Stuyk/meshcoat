import * as THREE from 'three'

export interface EdgeWearUniforms {
  tSource: { value: THREE.Texture | null }
  uColor: { value: THREE.Color }
  uOpacity: { value: number }
  uWearWidth: { value: number }
  uThreshold: { value: number }
  uNoiseScale: { value: number }
  uRoughness: { value: number }
  uAmount: { value: number }
  uContrast: { value: number }
  uSeed: { value: number }
  tWearTexture: { value: THREE.Texture | null }
  uUseWearTexture: { value: number }
  uTextureScale: { value: number }
  uTextureMapping: { value: number }
  /** 0 = convex edge wear (chips on ridges), 1 = concave cavity dirt (grime in folds). */
  uCurvatureMode: { value: number }
  /** 0 = noisy/chipped break-up, 1 = smooth uniform gradient (ambient-occlusion look). */
  uSmoothness: { value: number }
}

export function createEdgeWearMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tSource: { value: null },
      uColor: { value: new THREE.Color(0xd1d5db) },
      uOpacity: { value: 1.0 },
      uWearWidth: { value: 0.05 },
      uThreshold: { value: 0.15 },
      uNoiseScale: { value: 20.0 },
      uRoughness: { value: 0.6 },
      uAmount: { value: 0.7 },
      uContrast: { value: 0.5 },
      uSeed: { value: 0.0 },
      tWearTexture: { value: null },
      uUseWearTexture: { value: 0 },
      uTextureScale: { value: 1.0 },
      uTextureMapping: { value: 0 },
      uCurvatureMode: { value: 0 },
      uSmoothness: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute vec3 aWorldPosition;
      attribute vec3 aWorldNormal;
      attribute vec3 aEdgeDist;
      attribute vec3 aEdgeCurvature;
      attribute vec3 aEdgeConcavity;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vEdgeDist;
      varying vec3 vEdgeCurvature;
      varying vec3 vEdgeConcavity;
      varying vec2 vUv;

      void main() {
        vWorldPos = aWorldPosition;
        vNormal = aWorldNormal;
        vEdgeDist = aEdgeDist;
        vEdgeCurvature = aEdgeCurvature;
        vEdgeConcavity = aEdgeConcavity;
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uWearWidth;
      uniform float uThreshold;
      uniform float uNoiseScale;
      uniform float uRoughness;
      uniform float uAmount;
      uniform float uContrast;
      uniform float uSeed;
      uniform sampler2D tWearTexture;
      uniform float uUseWearTexture;
      uniform float uTextureScale;
      uniform float uTextureMapping;
      uniform float uCurvatureMode;
      uniform float uSmoothness;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vEdgeDist;
      varying vec3 vEdgeCurvature;
      varying vec3 vEdgeConcavity;
      varying vec2 vUv;

      // --- Ashima Arts / Stefan Gustavson Simplex 3D Noise ---
      vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);

        vec3 x1 = x0 - i1 + 1.0 * C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(
                   i.z + vec4(0.0, i1.z, i2.z, 1.0))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0));

        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);

        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);

        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
      }

      // 2-Octave Fractal Simplex Noise (fBm) for realistic grunge / chips
      float fbm(vec3 p) {
        float total = snoise(p);
        float amplitude = uRoughness * 0.5;
        total += snoise(p * 2.2 + vec3(4.3, 1.7, 8.2)) * amplitude;
        return total * 0.5 + 0.5; // Map from [-1, 1] to [0, 1]
      }

      void main() {
        vec4 baseColor = texture2D(tSource, vUv);

        // Convex ridges (wear) and concave folds (dirt) are disjoint populations
        // of the same edges — see computeEdgeCurvature. Picking the attribute
        // here is the whole difference between chipping an exposed corner and
        // settling grime into an interior crease.
        vec3 curvature = mix(vEdgeCurvature, vEdgeConcavity, step(0.5, uCurvatureMode));

        // Falloff from all 3 edges of the triangle.
        float safeWidth = max(uWearWidth, 0.0001);
        // Dirt fades into the surface gradually the way occlusion does; a chip
        // has a harder boundary. Squaring the ramp gives the cavity mode that
        // softer, deeper-in-the-corner gradient without a separate falloff path.
        float gamma = mix(1.0, 2.0, uSmoothness);
        float e0 = curvature.x >= uThreshold ? pow(clamp(1.0 - vEdgeDist.x / safeWidth, 0.0, 1.0), gamma) * curvature.x : 0.0;
        float e1 = curvature.y >= uThreshold ? pow(clamp(1.0 - vEdgeDist.y / safeWidth, 0.0, 1.0), gamma) * curvature.y : 0.0;
        float e2 = curvature.z >= uThreshold ? pow(clamp(1.0 - vEdgeDist.z / safeWidth, 0.0, 1.0), gamma) * curvature.z : 0.0;

        float edgeFactor = max(e0, max(e1, e2));
        if (edgeFactor <= 0.001) {
          gl_FragColor = baseColor;
          return;
        }

        // Evaluate continuous 3D noise at world position
        vec3 noisePos = (vWorldPos + vec3(uSeed * 17.1, uSeed * 31.7, uSeed * 53.3)) * uNoiseScale;
        float noise = fbm(noisePos);
        // At full smoothness the noise drops out entirely, leaving a clean
        // curvature gradient — an ambient-occlusion pass rather than grunge.
        noise = mix(noise, 1.0, uSmoothness);

        // Combine edge proximity with noise to create chips/scratches
        // Raw wear intensity
        float rawWear = edgeFactor * noise;

        // Apply Amount and Contrast
        // Contrast defines the width of smoothstep transition
        float softness = max(0.02, (1.0 - uContrast) * 0.4);
        float cutoff = 1.0 - uAmount;
        float wearMask = smoothstep(cutoff - softness, cutoff + softness, rawWear);

        // Sample wear texture or fallback to solid color
        vec3 wearBaseColor = uColor;
        float wearTexAlpha = 1.0;
        if (uUseWearTexture > 0.5) {
          vec4 texSample;
          if (uTextureMapping > 0.5) {
            vec3 blendWeights = pow(abs(vNormal) + 0.0001, vec3(4.0));
            blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);
            float s = max(uTextureScale, 0.001);
            vec4 colX = texture2D(tWearTexture, vWorldPos.yz * s);
            vec4 colY = texture2D(tWearTexture, vWorldPos.xz * s);
            vec4 colZ = texture2D(tWearTexture, vWorldPos.xy * s);
            texSample = colX * blendWeights.x + colY * blendWeights.y + colZ * blendWeights.z;
          } else {
            texSample = texture2D(tWearTexture, vUv * max(uTextureScale, 0.001));
          }
          wearBaseColor = texSample.rgb * uColor;
          wearTexAlpha = texSample.a;
        }

        float finalAlpha = wearMask * uOpacity * wearTexAlpha;
        if (finalAlpha <= 0.001) {
          gl_FragColor = baseColor;
          return;
        }

        // Premultiplied alpha composite (source-over blending):
        // result = srcRGB * srcA + dstRGB * (1.0 - srcA)
        vec3 srcPremult = wearBaseColor * finalAlpha;
        vec3 dstPremult = baseColor.rgb;
        vec3 outRgb = srcPremult + dstPremult * (1.0 - finalAlpha);
        float outA = finalAlpha + baseColor.a * (1.0 - finalAlpha);

        gl_FragColor = vec4(outRgb, outA);
      }
    `,
    // DoubleSide is mandatory for every pass that rasterizes the UV mesh.
    // Flattening a model into UV space keeps each triangle's winding, and glTF
    // exporters (Blender's included) flip V on export — which reverses that
    // winding. Under the default FrontSide every triangle of a glTF model is
    // then back-facing and the entire mesh is culled: no paint, no coverage
    // mask, no dilation, on a model whose UVs are perfectly fine.
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  })
}
