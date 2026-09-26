import { gradient } from '../paint/gradient'
import { onMount, onCleanup, createEffect, untrack, Show, type JSX } from 'solid-js'
import * as THREE from 'three'
import { createScene } from './scene'
import { createDefaultTestModel } from './modelLoader'
import { brush, selectAllFaces, invertFaceSelection, setTextureScale } from '../paint/brush'
import { stencil, setStencilTransforming } from '../paint/stencil'
import { PBR_CHANNELS, type PaintChannel } from '../paint/channels'
import { renderTargetToPngDataUrl, packOrmDataUrl } from '../paint/exportTexture'
import { OcclusionDepthPass } from '../paint/occlusionDepth'
import { loadPaintTexture } from '../utils/textureLoad'
import { toAssetUrl } from '../utils/assetUrl'
import RadialPieMenu from '../components/RadialPieMenu'
import { createGizmo, createSymmetryGuide } from './gizmos'
import { createNavCube, type NavCubeHandle } from './navCube'
import { updateGizmo } from './gizmoUpdate'
import { ViewportRuntime } from './viewportRuntime'
import type { ViewportProps, ViewportHandle } from './viewportTypes'
import {
  activeMesh,
  occluderMeshes,
  applyPieceVisibility,
  applyViewMode,
  frameModel,
  setActivePiece,
  setWireframeVisible,
  setupLayers,
  setupWireframe,
  stackFor,
  updatePieceOutlines
} from './viewportPieces'
import {
  updateHighlight,
  updateProjectorPreview,
  updateProjectorPreviewUniforms
} from './viewportHighlight'
import { frameSelectionOrModel, loadDefaultModel, loadFromUrl, loadProject } from './viewportLoad'
import {
  uvHitAt,
  uvPointerDown,
  uvPointerMove,
  uvPointerUp,
  uvHover,
  renderUvTexture,
  uvEdges
} from './uvPaint'
import { raycastMeshes, screenToNdc } from './raycast'
import {
  fillActive,
  onDblClick,
  onKeyDown,
  onPointerDown,
  onWheel,
  stampStencilNow,
  type StampDiagnostics,
  buildGizmoCtx
} from './viewportPointer'

export type {
  InitialPbrTextures,
  InitialTexturePayload,
  ViewportHandle,
  ChannelViewMode,
  PieceInfo
} from './viewportTypes'

export default function Viewport(props: ViewportProps): JSX.Element {
  const rt = new ViewportRuntime(props)
  const gizmoCtx = buildGizmoCtx(rt)

  // Corner orbit gizmo: a small square in the top-right the artist can drag
  // directly (no Alt+click needed) to spin the camera around the current
  // focus point — whatever `controls.target` is, be that a selected piece's
  // center or the whole model's.
  let orbitGizmoDragging = false
  let orbitGizmoLastX = 0
  let orbitGizmoLastY = 0
  // Total travel of the current press — under a few pixels it's a click,
  // which snaps the view to the clicked face instead of orbiting.
  let orbitGizmoTravel = 0
  let navCubeCanvasRef: HTMLCanvasElement | undefined
  let navCubeHandle: NavCubeHandle | undefined

  const onOrbitGizmoPointerMove = (e: PointerEvent): void => {
    if (!orbitGizmoDragging || !rt.sceneHandle) {
      return
    }
    const dx = e.clientX - orbitGizmoLastX
    const dy = e.clientY - orbitGizmoLastY
    orbitGizmoLastX = e.clientX
    orbitGizmoLastY = e.clientY
    orbitGizmoTravel += Math.abs(dx) + Math.abs(dy)
    rt.sceneHandle.controls.orbitBy(dx, dy)
  }

  const onOrbitGizmoPointerUp = (e: PointerEvent): void => {
    if (orbitGizmoDragging && orbitGizmoTravel < 4 && rt.sceneHandle) {
      const direction = navCubeHandle?.pickFace(e.clientX, e.clientY)
      if (direction) {
        rt.sceneHandle.controls.snapToDirection(direction)
      }
    }
    orbitGizmoDragging = false
    window.removeEventListener('pointermove', onOrbitGizmoPointerMove)
    window.removeEventListener('pointerup', onOrbitGizmoPointerUp)
  }

  const onOrbitGizmoPointerDown = (e: PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    orbitGizmoDragging = true
    orbitGizmoTravel = 0
    orbitGizmoLastX = e.clientX
    orbitGizmoLastY = e.clientY
    window.addEventListener('pointermove', onOrbitGizmoPointerMove)
    window.addEventListener('pointerup', onOrbitGizmoPointerUp)
  }

  onCleanup(() => {
    window.removeEventListener('pointermove', onOrbitGizmoPointerMove)
    window.removeEventListener('pointerup', onOrbitGizmoPointerUp)
  })

  onMount(() => {
    if (!rt.canvasRef) {
      return
    }
    rt.sceneHandle = createScene(rt.canvasRef)

    if (navCubeCanvasRef) {
      navCubeHandle = createNavCube(navCubeCanvasRef, 108)
    }

    rt.gizmoHandle = createGizmo()
    rt.sceneHandle.scene.add(rt.gizmoHandle.group)
    rt.sceneHandle.scene.add(rt.gizmoHandle.mirrorGroup)

    const lineGuideGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3()
    ])
    rt.lineGuideMesh = new THREE.Line(
      lineGuideGeom,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        linewidth: 2
      })
    )
    rt.lineGuideMesh.renderOrder = 998
    rt.lineGuideMesh.visible = false
    rt.sceneHandle.scene.add(rt.lineGuideMesh)

    const testModel = createDefaultTestModel()
    rt.currentModel = testModel
    rt.sceneHandle.scene.add(testModel.root)
    frameModel(rt, testModel)
    setupLayers(rt, testModel)
    setupWireframe(rt, testModel)
    rt.symmetryGuide = createSymmetryGuide()
    testModel.root.add(rt.symmetryGuide.group)
    rt.symmetryGuide.update(brush.symmetryAxis(), testModel, activeMesh(rt))

    // Paint-bleed diagnostics, run from the DevTools console. Occlusion is one
    // of two independent ways paint reaches a face it shouldn't; the other is
    // overlapping UVs, which no visibility test can fix (see debugUvOverlap).
    ;(window as unknown as { slipDebug: unknown }).slipDebug = {
      /**
       * Prints the stack exactly as recomposite() walks it. A blend mode only
       * has a visible effect where the layers *below* it have coverage (the
       * W3C model: over bare canvas a blended layer just shows its own color),
       * so this also reports whether each layer actually has anything under it
       * to blend against.
       */
      blend: () => {
        if (!rt.layerStack) {
          return 'no layer stack'
        }
        const rows = rt.layerStack.layers.map((l, i) => ({
          index: i,
          id: l.id,
          name: l.name,
          visible: l.visible,
          isMask: !!l.isMask,
          opacity: l.opacity,
          blendMode: l.blendMode ?? 'normal',
          clippedToMaskId: l.clippedToMaskId ?? null,
          // Anything at index 0, or with only hidden/mask layers beneath it,
          // has no backdrop — its blend mode is a deliberate no-op.
          hasBackdrop: rt.layerStack!.layers.slice(0, i).some((u) => u.visible && !u.isMask)
        }))
        console.table(rows)
        return rows
      },
      /**
       * Import diagnostics: what each piece's material arrived with, and what
       * actually ended up in its background layer. A texture that loaded but
       * never landed shows as a map present with an empty composite; a texture
       * that never loaded shows as no map at all.
       */
      pieces: () => {
        if (!rt.sceneHandle || rt.pieces.length === 0) {
          return 'no model'
        }
        const rows = rt.pieces.map((piece, index) => {
          const embeddedNames = piece.embedded.map((slot, slotIndex) => {
            const maps = (Object.keys(slot.maps) as PaintChannel[]).map((c) => {
              const img = slot.maps[c]!.image as { width?: number; height?: number } | undefined
              return `${c}(${img?.width ?? '?'}x${img?.height ?? '?'})`
            })
            const where = slot.faces ? `${slot.faces.size}f` : 'all'
            return `#${slotIndex}[${where}] ${maps.join(' ') || 'no maps'}`
          })

          // Mean coverage and color of the composite, read back at low cost by
          // sampling a coarse grid rather than the whole sheet.
          const size = piece.stack.textureSize
          const step = Math.max(1, Math.floor(size / 64))
          const px = new Uint8Array(size * size * 4)
          rt.sceneHandle!.renderer.readRenderTargetPixels(
            piece.stack.compositeTarget,
            0,
            0,
            size,
            size,
            px
          )
          let n = 0
          let alpha = 0
          let r = 0
          let g = 0
          let b = 0
          const distinct = new Set<number>()
          for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
              const i = (y * size + x) * 4
              alpha += px[i + 3]
              r += px[i]
              g += px[i + 1]
              b += px[i + 2]
              distinct.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3))
              n++
            }
          }
          // Same measurement taken straight off the base LAYER's own buffer.
          // Layer full but composite empty means recomposite is the problem;
          // both empty means the fill never landed (or the targets are dead).
          const layerSnap = piece.stack.layers[0]?.engine.createCpuSnapshot()
          let layerAlpha = 0
          if (layerSnap) {
            let ln = 0
            for (let y = 0; y < layerSnap.size; y += step) {
              for (let x = 0; x < layerSnap.size; x += step) {
                layerAlpha += layerSnap.data[(y * layerSnap.size + x) * 4 + 3]
                ln++
              }
            }
            layerAlpha = +(layerAlpha / ln / 255).toFixed(3)
          }

          return {
            index,
            name: piece.name,
            size,
            layerAlpha,
            uvAttr: !!piece.mesh.geometry.attributes.uv,
            slots: piece.embedded.length,
            embedded: embeddedNames.join(' | ') || 'none',
            layers: piece.stack.layers.length,
            meanAlpha: +(alpha / n / 255).toFixed(3),
            meanRGB: `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`,
            // One colour across the whole sheet means nothing textured landed.
            distinctColors: distinct.size
          }
        })
        console.table(rows)

        // Context health. A 4096 canvas costs ~64MB per render target and a
        // piece holds several, so a multi-piece model at high resolution can
        // simply run out of GPU memory — at which point every target reads back
        // as zeroes, exactly like a stack that was never painted.
        const gl = rt.sceneHandle!.renderer.getContext()
        const info = rt.sceneHandle!.renderer.info
        console.log('[slip] renderer', {
          glError: gl.getError(),
          contextLost: gl.isContextLost(),
          textures: info.memory.textures,
          geometries: info.memory.geometries,
          pieces: rt.pieces.length,
          textureSize: rt.pieces[0]?.stack.textureSize,
          approxTargetVram: `${Math.round(rt.pieces.reduce((acc, p) => acc + p.stack.textureSize ** 2 * 4 * 5, 0) / 1e6)} MB`
        })
        return rows
      },
      uvOverlap: () => {
        const engine = rt.layerStack?.active?.engine
        if (!engine) {
          return 'no active layer'
        }
        const r = engine.debugUvOverlap()
        console.log(
          `[slip] UV overlap: ${(r.overlapRatio * 100).toFixed(1)}% of covered texels carry ` +
            `2+ triangles (${r.overlappedTexels} / ${r.coveredTexels}). ` +
            (r.overlapRatio > 0.02
              ? 'OVERLAPPING UVs — painting one face necessarily paints every other face ' +
                'sharing those texels. Occlusion cannot fix this; the model needs a ' +
                'non-overlapping unwrap.'
              : 'UV layout looks non-overlapping.')
        )
        return r
      },
      /**
       * Why a stencil stamp produced nothing. Runs a real stamp on the active
       * piece and reports every input it was decided from, plus how many texels
       * of the active layer actually changed — a `changedTexels` of 0 with a
       * healthy depth map means the mask rejected everything, not that the
       * stamp never ran.
       */
      stamp: () => {
        const engine = rt.layerStack?.active?.engine
        if (!engine || !rt.sceneHandle) {
          return 'no active layer'
        }
        const stack = rt.layerStack!
        const size = stack.textureSize
        const readComposite = (): Uint8Array => {
          const px = new Uint8Array(size * size * 4)
          rt.sceneHandle!.renderer.readRenderTargetPixels(
            stack.compositeTarget,
            0,
            0,
            size,
            size,
            px
          )
          return px
        }
        const compositeBefore = readComposite()
        const before = engine.createCpuSnapshot()
        const diag: StampDiagnostics = {}
        const ran = stampStencilNow(rt, diag)
        rt.layerStack?.recomposite()
        const after = engine.createCpuSnapshot()
        const compositeAfter = readComposite()

        // Did the change survive compositing? A layer that changed while the
        // composite did not is hidden, zero-opacity, a mask, or clipped — the
        // paint landed and simply never reaches the material.
        let compositeChanged = 0
        for (let i = 0; i < compositeBefore.length; i++) {
          if (compositeBefore[i] !== compositeAfter[i]) {
            compositeChanged++
          }
        }
        // Where in UV space the layer's change landed.
        let uMin = Infinity
        let uMax = -Infinity
        let vMin = Infinity
        let vMax = -Infinity
        for (let y = 0; y < before.size; y++) {
          for (let x = 0; x < before.size; x++) {
            const i = (y * before.size + x) * 4
            if (
              before.data[i] === after.data[i] &&
              before.data[i + 1] === after.data[i + 1] &&
              before.data[i + 2] === after.data[i + 2] &&
              before.data[i + 3] === after.data[i + 3]
            ) {
              continue
            }
            const u = x / before.size
            // Snapshots read bottom-up, same as the paint target.
            const v = y / before.size
            uMin = Math.min(uMin, u)
            uMax = Math.max(uMax, u)
            vMin = Math.min(vMin, v)
            vMax = Math.max(vMax, v)
          }
        }
        // Mean colour, to catch a decal that landed but is white-on-white.
        const meanRgb = (px: Uint8Array): string => {
          let r = 0
          let g = 0
          let b = 0
          const n = px.length / 4
          for (let i = 0; i < px.length; i += 4) {
            r += px[i]
            g += px[i + 1]
            b += px[i + 2]
          }
          return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`
        }

        /**
         * The change's footprint in UV space, as an image: red where the stamp
         * wrote, the composite underneath at half strength for orientation. A
         * decal-shaped blob means the projection is right and the problem is
         * elsewhere; a sheet-wide spray means it is writing every texel it can
         * reach.
         */
        const dumpDiff = (): string => {
          const cv = document.createElement('canvas')
          cv.width = size
          cv.height = size
          const ctx = cv.getContext('2d')!
          const img = ctx.createImageData(size, size)
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const src = (y * size + x) * 4
              // Canvas is top-down, the render target is bottom-up.
              const dst = ((size - 1 - y) * size + x) * 4
              const touched =
                compositeBefore[src] !== compositeAfter[src] ||
                compositeBefore[src + 1] !== compositeAfter[src + 1] ||
                compositeBefore[src + 2] !== compositeAfter[src + 2] ||
                compositeBefore[src + 3] !== compositeAfter[src + 3]
              img.data[dst] = touched ? 255 : compositeAfter[src] >> 1
              img.data[dst + 1] = touched ? 0 : compositeAfter[src + 1] >> 1
              img.data[dst + 2] = touched ? 0 : compositeAfter[src + 2] >> 1
              img.data[dst + 3] = 255
            }
          }
          ctx.putImageData(img, 0, 0)
          return cv.toDataURL('image/png')
        }

        const diffUrl = dumpDiff()
        console.log('[slip] stamp footprint (red = written):', diffUrl)
        ;(window as unknown as { slipStampDiff: string }).slipStampDiff = diffUrl

        const activeLayer = stack.active!
        const layerInfo = {
          index: stack.layers.indexOf(activeLayer),
          name: activeLayer.name,
          visible: activeLayer.visible,
          opacity: activeLayer.opacity,
          blendMode: activeLayer.blendMode ?? 'normal',
          isMask: !!activeLayer.isMask,
          clippedToMaskId: activeLayer.clippedToMaskId ?? null,
          layerCount: stack.layers.length
        }
        let changed = 0
        let alphaBefore = 0
        let alphaAfter = 0
        for (let i = 3; i < before.data.length; i += 4) {
          alphaBefore += before.data[i]
          alphaAfter += after.data[i]
        }
        for (let i = 0; i < before.data.length; i++) {
          if (before.data[i] !== after.data[i]) {
            changed++
          }
        }
        const texels = before.data.length / 4
        // Control captures, AFTER the stamp so they can't disturb the map it
        // sampled. An "empty" set that still covers the map means
        // hideEverythingElse is leaking geometry into the depth pass.
        const probes: Record<string, unknown> = {}
        if (rt.occlusionPass && rt.currentModel) {
          const { renderer, scene, camera } = rt.sceneHandle
          const statsFor = (meshes: readonly THREE.Object3D[]): unknown => {
            rt.occlusionPass!.invalidate()
            rt.occlusionPass!.capture(renderer, scene, camera, meshes)
            return rt.occlusionPass!.debugStats(renderer, camera.far)
          }
          probes.depthWithNoOccluders = statsFor([])
          probes.depthWithActivePieceOnly = statsFor(occluderMeshes(rt))
          probes.depthWithAllMeshes = statsFor(rt.currentModel.meshes)
          rt.occlusionPass.invalidate()

          // Where the active piece actually is on screen, in the same canvas
          // pixels the stencil rect is expressed in.
          const mesh = activeMesh(rt)
          const rect = rt.canvasRef!.getBoundingClientRect()
          if (mesh) {
            mesh.updateWorldMatrix(true, false)
            const box = new THREE.Box3().setFromObject(mesh)
            const v = new THREE.Vector3()
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            for (let i = 0; i < 8; i++) {
              v.set(
                i & 1 ? box.max.x : box.min.x,
                i & 2 ? box.max.y : box.min.y,
                i & 4 ? box.max.z : box.min.z
              ).project(camera)
              const px = (v.x * 0.5 + 0.5) * rect.width
              const py = (1 - (v.y * 0.5 + 0.5)) * rect.height
              minX = Math.min(minX, px)
              minY = Math.min(minY, py)
              maxX = Math.max(maxX, px)
              maxY = Math.max(maxY, py)
            }
            probes.pieceScreenBox = {
              minX: Math.round(minX),
              minY: Math.round(minY),
              maxX: Math.round(maxX),
              maxY: Math.round(maxY)
            }
            probes.pieceWorldBox = { min: box.min.toArray(), max: box.max.toArray() }
            probes.cameraPos = camera.getWorldPosition(new THREE.Vector3()).toArray()

            // Same ray the stamp uses for its normal sign, but told which
            // material side it hit: a front-side-only miss over a covered
            // pixel means the camera is looking at BACK faces.
            const r = stencil.stencilRect(rect.width, rect.height)
            const ndc = screenToNdc(rect.left + r.centerX, rect.top + r.centerY, rt.canvasRef!)
            const mat = mesh.material as THREE.Material
            const prevSide = mat.side
            probes.centerHitFrontSide = !!raycastMeshes(ndc.x, ndc.y, camera, [mesh])
            mat.side = THREE.DoubleSide
            const both = raycastMeshes(ndc.x, ndc.y, camera, [mesh])
            mat.side = prevSide
            probes.centerHitDoubleSide = !!both
            if (both) {
              const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(both.point).normalize()
              probes.centerNormalDotToCamera = +both.normal.dot(toCam).toFixed(3)
            }
            // Which piece is really under the stencil centre.
            const anyHit = raycastMeshes(
              ndc.x,
              ndc.y,
              camera,
              rt.pieces.map((pc) => pc.mesh)
            )
            probes.pieceUnderStencilCenter = anyHit?.mesh?.name ?? null
          }
        }

        const report = {
          ran,
          changedTexels: changed,
          meanAlphaBefore: +(alphaBefore / texels / 255).toFixed(4),
          meanAlphaAfter: +(alphaAfter / texels / 255).toFixed(4),
          compositeChangedBytes: compositeChanged,
          compositeMeanRgbBefore: meanRgb(compositeBefore),
          compositeMeanRgbAfter: meanRgb(compositeAfter),
          layerMeanRgbBefore: meanRgb(before.data),
          layerMeanRgbAfter: meanRgb(after.data),
          changedUvBox: Number.isFinite(uMin)
            ? {
                uMin: +uMin.toFixed(3),
                uMax: +uMax.toFixed(3),
                vMin: +vMin.toFixed(3),
                vMax: +vMax.toFixed(3)
              }
            : null,
          layer: layerInfo,
          viewMode: rt.viewMode,
          textureSize: size,
          ...diag,
          ...probes
        }
        console.log('[slip] stencil stamp', report)
        return report
      },
      occlusion: () => {
        if (!rt.sceneHandle || !rt.currentModel) {
          return 'no model'
        }
        if (!rt.occlusionPass) {
          rt.occlusionPass = new OcclusionDepthPass()
        }
        rt.occlusionPass.invalidate()
        rt.occlusionPass.capture(
          rt.sceneHandle.renderer,
          rt.sceneHandle.scene,
          rt.sceneHandle.camera,
          rt.currentModel.meshes
        )
        const r = rt.occlusionPass.debugStats(rt.sceneHandle.renderer, rt.sceneHandle.camera.far)
        console.log(
          `[slip] occlusion map ${r.width}x${r.height}, model covers ` +
            `${(r.coverage * 100).toFixed(1)}% of it, distances ${r.minDist?.toFixed(3)}..` +
            `${r.maxDist?.toFixed(3)} world units. ` +
            (r.coverage < 0.001
              ? 'EMPTY — the depth pass rendered nothing, so the occlusion test is a no-op.'
              : 'Depth pass is producing data.')
        )
        return r
      }
    }

    window.addEventListener('keydown', boundKeyDown)
    // With touch-action: none the browser shouldn't claim a pen drag for panning,
    // but it can still cancel a stroke (palm rejection, a system gesture). No
    // pointerup follows a cancel, so without this the stroke would stay live
    // and keep painting on hover. On window, since a pen that has left the
    // canvas is no longer targeting it.
    window.addEventListener('pointercancel', rt.boundPointerUp)
    rt.canvasRef.addEventListener('pointermove', rt.boundPointerMove)
    rt.canvasRef.addEventListener('pointerdown', boundPointerDownCapture, { capture: true })
    rt.canvasRef.addEventListener('dblclick', boundDblClick)
    rt.canvasRef.addEventListener('wheel', boundWheel, { passive: false })
    rt.canvasRef.addEventListener('pointerleave', onPointerLeave)

    const handle: ViewportHandle = {
      loadFromUrl: (url, extension, textureSize, initialTextures, options) =>
        loadFromUrl(rt, url, extension, textureSize, initialTextures, options),
      loadDefaultModel: (textureSize, primitive) => loadDefaultModel(rt, textureSize, primitive),
      loadProject: (project, snapshots, options) => loadProject(rt, project, snapshots, options),
      focusModel: () => frameSelectionOrModel(rt),
      pieces: () =>
        rt.pieces.map((piece, index) => ({
          index,
          name: piece.name,
          textureSize: piece.stack.textureSize,
          faceCount: piece.facePositions.length / 9
        })),
      activePieceIndex: () => rt.activePieceIndex,
      uvPanel: {
        pointerDown: (u, v, e, radiusPx) => uvPointerDown(rt, u, v, e, radiusPx),
        pointerMove: (u, v, e, radiusPx) => uvPointerMove(rt, u, v, e, radiusPx),
        pointerUp: () => uvPointerUp(rt),
        hover: (uv) => uvHover(rt, uv),
        covers: (u, v) => uvHitAt(rt, u, v) !== null,
        renderInto: (ctx, size) => renderUvTexture(rt, ctx, size),
        edges: () => uvEdges(rt)
      },
      setActivePiece: (index) => setActivePiece(rt, index),
      focusPiece: (index?: number) => {
        const mesh = rt.pieces[index ?? rt.activePieceIndex]?.mesh
        if (!mesh || !rt.sceneHandle) {
          return
        }
        const box = new THREE.Box3().setFromObject(mesh)
        if (box.isEmpty()) {
          return
        }
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        rt.sceneHandle.controls.focus(sphere.center, sphere.radius || 1)
      },
      getLayerStack: (pieceIndex?: number) => stackFor(rt, pieceIndex),
      exportBaseColorPng: (pieceIndex?: number) => {
        const stack = stackFor(rt, pieceIndex)
        if (!rt.sceneHandle || !stack) {
          return undefined
        }
        return renderTargetToPngDataUrl(rt.sceneHandle.renderer, stack.compositeTarget)
      },
      exportLayerPng: (layerId: number, channel: PaintChannel = 'baseColor', pieceIndex?) => {
        const stack = stackFor(rt, pieceIndex)
        const layer = stack?.layers.find((l) => l.id === layerId)
        const target = layer?.engine.targetFor(channel)
        if (!rt.sceneHandle || !target) {
          return undefined
        }
        return renderTargetToPngDataUrl(rt.sceneHandle.renderer, target)
      },
      exportChannelPng: (channel: PaintChannel, pieceIndex?: number) => {
        const stack = stackFor(rt, pieceIndex)
        if (!rt.sceneHandle || !stack) {
          return undefined
        }
        const target = stack.channelTarget(channel)
        if (!target) {
          return undefined
        }
        return renderTargetToPngDataUrl(rt.sceneHandle.renderer, target)
      },
      paintedChannels: (pieceIndex?: number) => stackFor(rt, pieceIndex)?.activeChannels() ?? [],
      exportCoverageMaskPng: (pieceIndex?: number) => {
        const stack = stackFor(rt, pieceIndex)
        const target = stack?.coverageTarget()
        if (!rt.sceneHandle || !target) {
          return undefined
        }
        return renderTargetToPngDataUrl(rt.sceneHandle.renderer, target)
      },
      exportOrmPng: (pieceIndex?: number) => {
        const stack = stackFor(rt, pieceIndex)
        if (!rt.sceneHandle || !stack) {
          return undefined
        }
        return packOrmDataUrl(
          rt.sceneHandle.renderer,
          stack.channelTarget('roughness'),
          stack.channelTarget('metalness'),
          stack.textureSize
        )
      },
      setViewMode: (mode) => {
        rt.viewMode = mode
        applyViewMode(rt)
      },
      getViewMode: () => rt.viewMode,
      setLightingMode: (mode) => rt.sceneHandle?.setLightingMode(mode),
      setWireframeVisible: (visible) => setWireframeVisible(rt, visible),
      setIsolateActivePiece: (isolate: boolean) => {
        rt.isolateActivePiece = isolate
        applyPieceVisibility(rt)
        updatePieceOutlines(rt)
        props.onIsolatePieceChanged?.(isolate)
      },
      getIsolateActivePiece: () => rt.isolateActivePiece,
      fillActive: () => fillActive(rt),
      selectAllFaces: () => {
        const total = rt.facePositions ? rt.facePositions.length / 9 : 0
        if (total > 0) {
          selectAllFaces(total)
        }
      },
      invertFaceSelection: () => {
        const total = rt.facePositions ? rt.facePositions.length / 9 : 0
        if (total > 0) {
          invertFaceSelection(total)
        }
      },
      getTotalFaces: () => (rt.facePositions ? rt.facePositions.length / 9 : 0),
      stampStencil: () => stampStencilNow(rt),
      previewEdgeWear: (options, asNewLayer = false, newLayerBackground = 'transparent') => {
        if (!rt.layerStack) {
          return
        }
        rt.layerStack.previewEdgeWear(options, asNewLayer, newLayerBackground)
        props.onLayersChanged?.()
      },
      cancelEdgeWearPreview: () => {
        if (!rt.layerStack) {
          return
        }
        rt.layerStack.cancelEdgeWearPreview()
        props.onLayersChanged?.()
      },
      commitEdgeWear: (options, asNewLayer = false, newLayerBackground = 'transparent') => {
        if (!rt.layerStack) {
          return
        }
        rt.layerStack.commitEdgeWear(options, asNewLayer, newLayerBackground)
        props.onLayersChanged?.()
      },
      undo: () => {
        if (!rt.layerStack) {
          return
        }
        rt.layerStack.history.undo()
        props.onLayersChanged?.()
      },
      redo: () => {
        if (!rt.layerStack) {
          return
        }
        rt.layerStack.history.redo()
        props.onLayersChanged?.()
      },
      canUndo: () => rt.layerStack?.history.canUndo() ?? false,
      canRedo: () => rt.layerStack?.history.canRedo() ?? false
    }

    props.onReady?.(handle)

    // Expose helpers on window for automation / test suite
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __viewportHandle: ViewportHandle
        __openPieMenu: (x?: number, y?: number) => void
        __closePieMenu: () => void
        __setWireframe: (v: boolean) => void
      }
      w.__viewportHandle = handle
      w.__openPieMenu = (x?: number, y?: number) => {
        rt.setPieMenu({ x: x ?? window.innerWidth * 0.48, y: y ?? window.innerHeight * 0.45 })
      }
      w.__closePieMenu = () => rt.setPieMenu(null)
      w.__setWireframe = (v: boolean) => setWireframeVisible(rt, v)
    }

    const animate = (): void => {
      rt.rafId = requestAnimationFrame(animate)
      if (rt.sceneHandle) {
        rt.sceneHandle.renderer.render(rt.sceneHandle.scene, rt.sceneHandle.camera)
        navCubeHandle?.render(rt.sceneHandle.camera)
      }
    }
    animate()
  })

  const boundKeyDown = (e: KeyboardEvent): void => onKeyDown(rt, e)
  const boundPointerDownCapture = (e: PointerEvent): void => onPointerDown(rt, e)
  const boundDblClick = (e: MouseEvent): void => onDblClick(rt, e)
  const boundWheel = (e: WheelEvent): void => onWheel(rt, e)
  const onPointerLeave = (): void => {
    updateGizmo(gizmoCtx, null)
    updatePieceOutlines(rt, null)
    rt.setEyedropperPreview((prev) => ({ ...prev, visible: false }))
  }

  createEffect(() => {
    // Hide gizmo, mirror, hoverFace, and preview when tool switches to prevent visual ghosts
    props.tool()
    if (rt.gizmoHandle) {
      rt.gizmoHandle.group.visible = false
      rt.gizmoHandle.mirrorGroup.visible = false
    }
    if (rt.hoverFaceMesh) {
      rt.hoverFaceMesh.visible = false
    }
    if (rt.hoverFillMesh) {
      rt.hoverFillMesh.visible = false
    }
    rt.setEyedropperPreview((prev) => ({ ...prev, visible: false }))
  })

  createEffect(() => {
    // keep gizmo scale live while hovering and adjusting radius via [ ] or drag
    const r = brush.radius()
    const gizmoHandle = rt.gizmoHandle
    if (gizmoHandle && gizmoHandle.group.visible) {
      if (gizmoHandle.brushRing.visible) {
        gizmoHandle.brushRing.scale.setScalar(r)
      }
      if (gizmoHandle.stampReticle.visible) {
        gizmoHandle.stampReticle.scale.setScalar(r)
      }
      if (gizmoHandle.brushTipMesh.visible) {
        gizmoHandle.brushTipMesh.scale.setScalar(r)
      }
      if (gizmoHandle.stampPreviewMesh.visible) {
        gizmoHandle.stampPreviewMesh.scale.setScalar(r)
      }
    }
    if (gizmoHandle && gizmoHandle.mirrorGroup.visible) {
      if (gizmoHandle.mirrorBrushRing.visible) {
        gizmoHandle.mirrorBrushRing.scale.setScalar(r)
      }
      if (gizmoHandle.mirrorBrushTipMesh.visible) {
        gizmoHandle.mirrorBrushTipMesh.scale.setScalar(r)
      }
      if (gizmoHandle.mirrorStampPreviewMesh.visible) {
        gizmoHandle.mirrorStampPreviewMesh.scale.setScalar(r)
      }
    }
  })

  createEffect(() => {
    brush.selectedFaces()
    const hidden = brush.selectionHighlightHidden()
    updateHighlight(rt)
    updateProjectorPreview(rt)
    // Hiding only affects what's drawn; painting stays confined to the selection.
    if (rt.highlightMesh) {
      rt.highlightMesh.visible = !hidden
    }
    if (hidden && rt.selectionFillMesh) {
      rt.selectionFillMesh.visible = false
    }
  })

  createEffect(() => {
    props.tool()
    updateProjectorPreview(rt)
  })

  // Selection is unaffected by these, so only the material needs refreshing —
  // rebuilding the geometry every slider tick would be wasted work.
  createEffect(() => {
    brush.textureRegion()
    brush.faceProjection()
    brush.textureRepeat()
    brush.textureScale()
    updateProjectorPreviewUniforms(rt)
  })

  // Nothing caches these loads, so every texture swap allocates a fresh GPU
  // texture. That is invisible for shelf browsing but not for the Text tool,
  // which regenerates on every keystroke — the old one has to be released.
  let previousBrushTexture: THREE.Texture | null = null
  const releasePreviousBrushTexture = (next: THREE.Texture | null): void => {
    if (previousBrushTexture && previousBrushTexture !== next) {
      previousBrushTexture.dispose()
    }
    previousBrushTexture = next
  }

  createEffect(() => {
    const path = brush.texturePath()
    if (!path) {
      releasePreviousBrushTexture(null)
      rt.brushTexture = null
      if (rt.currentHit) {
        updateGizmo(gizmoCtx, rt.currentHit)
      }
      updateProjectorPreview(rt)
      return
    }
    loadPaintTexture(rt.textureLoader, path, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      // TGALoader hands back a texture with no mipmaps configured the way the
      // image loader's does; regenerate so a tiled material doesn't shimmer.
      texture.needsUpdate = true
      releasePreviousBrushTexture(texture)
      rt.brushTexture = texture
      if (rt.currentHit) {
        updateGizmo(gizmoCtx, rt.currentHit)
      }
      updateProjectorPreview(rt)
    })
  })

  // A material set's data maps. Base color keeps travelling through
  // brushTexture (above), which already handles tint, tiling and masking; these
  // are the roughness / metalness / normal sources, loaded linear because they
  // carry numbers rather than something to look at.
  createEffect(() => {
    const set = brush.materialSet()
    rt.channelMaps = {}
    if (!set) {
      return
    }

    /**
     * "Scale" means different things per placement, so a freshly chosen set has
     * to be given the right kind of number:
     *
     *   World   — repeats per WORLD UNIT. Derived from the model's own size,
     *             because the default (8) packs a material into unreadable
     *             moiré on anything a metre across.
     *   Surface — repeats across the model's UV square. A world-derived value
     *             here is typically well under 1, which stretches a single copy
     *             over the whole unwrap and reads as "it isn't tiling at all".
     */
    // untrack the placement read too: this effect exists to react to a new
    // material set, not to re-run (and reset the scale) on every placement or
    // scale change the artist makes afterwards.
    if (untrack(brush.textureMapping) === 'triplanar') {
      if (rt.currentModel) {
        const box = new THREE.Box3().setFromObject(rt.currentModel.root)
        if (!box.isEmpty()) {
          const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1
          const REPEATS_ACROSS_MODEL = 3
          setTextureScale(REPEATS_ACROSS_MODEL / (radius * 2))
        }
      }
    } else {
      const REPEATS_ACROSS_UV = 4
      setTextureScale(REPEATS_ACROSS_UV)
    }
    for (const channel of PBR_CHANNELS) {
      const path = set.maps[channel]
      if (!path) {
        continue
      }
      loadPaintTexture(rt.textureLoader, path, (texture) => {
        texture.colorSpace = THREE.NoColorSpace
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.needsUpdate = true
        // The effect may have re-run for a different set while this decoded.
        if (brush.materialSet()?.id === set.id) {
          rt.channelMaps[channel] = texture
        }
      })
    }
  })

  /**
   * Measures a stencil image on a small canvas: whether any pixel is actually
   * transparent, and whether every visible pixel is gray (a brush-style
   * shape rather than a color decal).
   */
  function analyzeStencilImage(image: CanvasImageSource): {
    hasAlpha: boolean
    grayscale: boolean
  } {
    try {
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        return { hasAlpha: false, grayscale: false }
      }
      ctx.drawImage(image, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      let hasAlpha = false
      let grayscale = true
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]
        if (a < 250) {
          hasAlpha = true
        }
        if (
          a > 8 &&
          (Math.abs(data[i] - data[i + 1]) > 12 || Math.abs(data[i + 1] - data[i + 2]) > 12)
        ) {
          grayscale = false
        }
      }
      return { hasAlpha, grayscale }
    } catch {
      return { hasAlpha: false, grayscale: false }
    }
  }

  createEffect(() => {
    const path = stencil.texturePath()
    if (!path) {
      rt.stencilTexture = null
      return
    }
    rt.textureLoader.load(toAssetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      // Clamped, not repeating: the shader already rejects texels outside the
      // stencil rect, and wrapping would smear the edge pixels across the
      // whole viewport if that test were ever loosened.
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      rt.stencilTexture = texture
      const img = texture.image as { width?: number; height?: number } | undefined
      if (img?.width && img?.height) {
        stencil.setStencilImageAspect(img.width / img.height)
      }
      const traits = analyzeStencilImage(texture.image as CanvasImageSource)
      stencil.setStencilImageHasAlpha(traits.hasAlpha)
      // A grayscale cut-out is a brush shape, not a picture: stamping its own
      // (usually black) pixels is never what's wanted, so paint the brush color.
      if (traits.hasAlpha && traits.grayscale) {
        stencil.setStencilStampUseLuminance(true)
      }
    })
  })

  createEffect(() => {
    const path = brush.tipTexturePath()
    if (!path) {
      rt.brushTipTexture = null
      if (rt.currentHit) {
        updateGizmo(gizmoCtx, rt.currentHit)
      }
      return
    }
    rt.textureLoader.load(toAssetUrl(path), (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      rt.brushTipTexture = texture
      if (rt.currentHit) {
        updateGizmo(gizmoCtx, rt.currentHit)
      }
    })
  })

  onCleanup(() => {
    cancelAnimationFrame(rt.rafId)
    navCubeHandle?.dispose()
    rt.occlusionPass?.dispose()
    window.removeEventListener('keydown', boundKeyDown)
    window.removeEventListener('pointermove', rt.boundPointerMove)
    window.removeEventListener('pointerup', rt.boundPointerUp)
    window.removeEventListener('pointercancel', rt.boundPointerUp)
    rt.canvasRef?.removeEventListener('pointermove', rt.boundPointerMove)
    rt.canvasRef?.removeEventListener('pointerdown', boundPointerDownCapture, { capture: true })
    rt.canvasRef?.removeEventListener('dblclick', boundDblClick)
    rt.canvasRef?.removeEventListener('wheel', boundWheel)
    if (rt.lineGuideMesh) {
      rt.sceneHandle?.scene.remove(rt.lineGuideMesh)
      rt.lineGuideMesh.geometry.dispose()
      ;(rt.lineGuideMesh.material as THREE.Material).dispose()
      rt.lineGuideMesh = null
    }
    if (rt.gizmoHandle) {
      rt.sceneHandle?.scene.remove(rt.gizmoHandle.group)
      rt.sceneHandle?.scene.remove(rt.gizmoHandle.mirrorGroup)
    }
    rt.symmetryGuide?.dispose()
    for (const box of [rt.activePieceBox, rt.hoverPieceBox]) {
      if (!box) {
        continue
      }
      rt.sceneHandle?.scene.remove(box)
      box.geometry.dispose()
      ;(box.material as THREE.Material).dispose()
    }
    rt.activePieceBox = undefined
    rt.hoverPieceBox = undefined
    for (const piece of rt.pieces) {
      piece.stack.dispose()
      piece.channelViewMaterial?.dispose()
    }
    rt.pieces = []
    rt.layerStack = undefined
    rt.sceneHandle?.dispose()
  })

  createEffect(() => {
    const axis = brush.symmetryAxis()
    if (rt.symmetryGuide && rt.currentModel) {
      rt.symmetryGuide.update(axis, rt.currentModel, activeMesh(rt))
    }
  })

  createEffect(() => {
    const rotRad = (brush.brushRotation() * Math.PI) / 180
    if (rt.gizmoHandle) {
      rt.gizmoHandle.brushTipMesh.rotation.z = rotRad
      rt.gizmoHandle.mirrorBrushTipMesh.rotation.z = -rotRad
      rt.gizmoHandle.stampPreviewMesh.rotation.z = rotRad
      rt.gizmoHandle.mirrorStampPreviewMesh.rotation.z = -rotRad
    }
  })

  return (
    <>
      <canvas
        ref={(el) => {
          rt.canvasRef = el
        }}
        class={`absolute inset-0 w-full h-full block touch-none ${
          stencil.transforming() && stencil.stencilActive()
            ? 'stencil-transform-active'
            : `tool-${props.tool()}`
        }`}
      />
      {/* Gradient tool guide: the line being dragged, start and end handles. */}
      <Show when={gradient.drag()}>
        {(d) => (
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10">
            <line
              x1={d().x0}
              y1={d().y0}
              x2={d().x1}
              y2={d().y1}
              stroke="black"
              stroke-width="4"
              stroke-opacity="0.6"
            />
            <line x1={d().x0} y1={d().y0} x2={d().x1} y2={d().y1} stroke="white" stroke-width="2" />
            <Show when={gradient.shape() === 'radial'}>
              <circle
                cx={d().x0}
                cy={d().y0}
                r={Math.hypot(d().x1 - d().x0, d().y1 - d().y0)}
                fill="none"
                stroke="white"
                stroke-dasharray="6 4"
                stroke-opacity="0.8"
              />
            </Show>
            <circle cx={d().x0} cy={d().y0} r="6" fill="white" stroke="black" stroke-width="2" />
            <circle cx={d().x1} cy={d().y1} r="6" fill="black" stroke="white" stroke-width="2" />
          </svg>
        )}
      </Show>
      {/* Orbit nav cube: drag to spin the camera around the current pivot
          (selection center, or the whole model when nothing's selected). */}
      <canvas
        ref={(el) => {
          navCubeCanvasRef = el
        }}
        width={108}
        height={108}
        class="absolute top-3 right-3 z-20 w-[108px] h-[108px] cursor-grab active:cursor-grabbing select-none touch-none"
        title="Drag to orbit camera, click a face to snap to that view"
        onPointerDown={onOrbitGizmoPointerDown}
      />
      {/* Screen-space stencil sheet. Positioned from the exact same
          stencilRect() numbers the paint shader samples with, so what the
          artist lines up is what actually paints. pointer-events stay off even
          while transforming — the viewport's own handlers drive the drag, so
          the sheet never swallows a stroke. */}
      <Show when={stencil.stencilActive()}>
        <div
          class="absolute inset-0 overflow-hidden pointer-events-none z-10"
          style={{ opacity: `${stencil.displayOpacity()}` }}
        >
          <div
            class={`absolute max-w-none select-none transition-shadow ${
              stencil.transforming()
                ? 'outline-2 outline-dashed outline-blue-400/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]'
                : ''
            }`}
            style={{
              left: `${stencil.centerX() * 100}%`,
              top: `${stencil.centerY() * 100}%`,
              width: `${stencil.scale() * 100}%`,
              transform: `translate(-50%, -50%) rotate(${stencil.rotation()}deg)`
            }}
          >
            <img
              src={toAssetUrl(stencil.texturePath()!)}
              alt="Stencil"
              class="w-full h-auto block select-none pointer-events-none"
              style={{
                filter: stencil.invert() ? 'invert(1)' : 'none'
              }}
            />
            {/* Visual boundary handles & center marker when in transform mode */}
            <Show when={stencil.transforming()}>
              <div class="absolute -top-1 -left-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-blue-500 border border-white/90 rounded-xs shadow-xs" />
              <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 border border-white shadow-xs" />
            </Show>
          </div>
        </div>
      </Show>
      <Show when={stencil.transforming() && stencil.stencilActive()}>
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-zinc-900/95 border border-blue-500/60 text-zinc-100 text-xs shadow-xl shadow-black/50 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 select-none">
          <span class="flex items-center gap-1.5 text-blue-300 font-medium">
            <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Transform Stencil
          </span>
          <span class="text-zinc-600">|</span>
          <div class="flex items-center gap-2 text-[11px] text-zinc-300">
            <span>
              Drag <span class="text-zinc-400">Move</span>
            </span>
            <span class="text-zinc-600">·</span>
            <span>
              Wheel <span class="text-zinc-400">Scale</span>
            </span>
            <span class="text-zinc-600">·</span>
            <span>
              Shift+Wheel <span class="text-zinc-400">Rotate</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setStencilTransforming(false)}
            class="ml-1 px-2.5 py-0.5 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium text-[11px] transition-colors cursor-pointer shadow-xs"
          >
            Done (Esc)
          </button>
        </div>
      </Show>
      {/* Active-piece badge. Only appears for multi-piece models, where "which
          texture set am I painting?" has a real answer. */}
      <Show when={rt.pieceHud()}>
        <div class="absolute top-3 left-3 z-20 flex flex-col gap-1 select-none pointer-events-none">
          <div class="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-amber-500/50 text-[11px] text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-sm">
            <span class="w-2 h-2 rounded-sm bg-amber-400" />
            <span class="text-zinc-400">Painting</span>
            <span class="font-medium">{rt.pieceHud()!.active}</span>
          </div>
          <Show when={rt.pieceHud()!.hover}>
            <div class="flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-sky-500/50 text-[11px] text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-sm">
              <span class="w-2 h-2 rounded-sm bg-sky-400" />
              <span class="text-zinc-400">Double-click to select</span>
              <span class="font-medium">{rt.pieceHud()!.hover}</span>
            </div>
          </Show>
        </div>
      </Show>
      {/* Face UV Projector preview badge: the mesh renders at full color/light
          so it reads clearly, so this text badge is what marks it unbaked —
          the swatch itself no longer dims to signal "preview". */}
      <Show when={rt.projectorPreviewActive()}>
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-teal-500/50 text-[11px] text-zinc-100 shadow-lg shadow-black/50 backdrop-blur-sm select-none pointer-events-none">
          <span class="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <span class="font-medium">Preview — not applied yet</span>
        </div>
      </Show>
      <Show when={props.tool() === 'eyedropper' && rt.eyedropperPreview().visible}>
        <div
          class="fixed z-50 pointer-events-none flex items-center gap-2 px-2.5 py-1 bg-zinc-900/95 border border-zinc-700/80 rounded-lg shadow-xl shadow-black/60 backdrop-blur-sm select-none"
          style={{
            left: `${rt.eyedropperPreview().x}px`,
            top: `${rt.eyedropperPreview().y}px`
          }}
        >
          <div
            class="w-4 h-4 rounded border border-white/40 shadow-inner flex-shrink-0"
            style={{ 'background-color': rt.eyedropperPreview().color }}
          />
          <span class="font-mono text-xs text-zinc-200 tabular-nums">
            {rt.eyedropperPreview().color}
          </span>
        </div>
      </Show>
      <Show when={rt.pieMenu()}>
        <RadialPieMenu
          x={rt.pieMenu()!.x}
          y={rt.pieMenu()!.y}
          activeTool={props.tool()}
          availableTextures={props.textures}
          isMaskTarget={() => !!rt.layerStack?.active?.isMask}
          onSelectTool={(tool) => {
            props.onToolChange?.(tool)
            rt.setPieMenu(null)
          }}
          onClose={() => rt.setPieMenu(null)}
        />
      </Show>
    </>
  )
}
