import * as React from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

import { vertexShader, fragmentShader } from "@/lib/wormhole/shader"
import {
  LAYOUT,
  MOTION,
  textureIndexFor,
  type WormholePreset,
} from "@/lib/wormhole/presets"
import type { Atlas } from "@/lib/wormhole/atlas"
import type { VirtualScroll } from "@/lib/wormhole/virtual-scroll"

interface GalleryProps {
  atlas: Atlas
  scroll: VirtualScroll
  preset: WormholePreset
  instanceCount: number
  /** Multiplies the whole ring's speed. 0 stops it. */
  speed: number
  /** Slot size, so a sparse vault can be made to read as full. */
  imageScale: number
  reducedMotion: boolean
  /** 0 off, 1 per-instance colours, 2 depth fade, 3 flat. */
  debugMode: number
}

/**
 * The ring. One instanced mesh, one texture, one draw call.
 *
 * Everything about where an image sits happens in the vertex shader from three
 * per-instance attributes, so the CPU never touches a matrix per frame — which
 * is what the reference implementation buys with its identity instance
 * matrices, and worth keeping.
 */
export function Gallery({
  atlas,
  scroll,
  preset,
  instanceCount,
  speed,
  imageScale,
  reducedMotion,
  debugMode,
}: GalleryProps) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const rotation = React.useRef(0)
  const rotationSpeed = React.useRef(0)
  const smoothSqueeze = React.useRef(0)
  const lastDirection = React.useRef(1)

  const texture = React.useMemo(() => {
    const t = new THREE.CanvasTexture(atlas.canvas)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    // The atlas canvas holds straight (unpremultiplied) alpha, which is what
    // the 2d context produces. Saying so keeps three from double-applying it
    // and darkening every soft matte edge.
    t.premultiplyAlpha = false
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  }, [atlas])

  // A CanvasTexture holds a GPU allocation. This page can be entered and left
  // repeatedly while the app also holds several hundred MB of model weights on
  // the same device, so it has to be given back.
  React.useEffect(() => () => texture.dispose(), [texture])

  const totalHeight = instanceCount * LAYOUT.spiralStep

  const { angleOffsets, positionYs, textureIndices, slotIndices } = React.useMemo(() => {
    const angleOffsets = new Float32Array(instanceCount)
    const positionYs = new Float32Array(instanceCount)
    const textureIndices = new Float32Array(instanceCount)
    const slotIndices = new Float32Array(instanceCount)
    const startY = -(totalHeight / 2)

    for (let i = 0; i < instanceCount; i++) {
      angleOffsets[i] = i * ((Math.PI * 2) / LAYOUT.imagesPerTurn)
      positionYs[i] = startY + i * LAYOUT.spiralStep
      // Column-major, so a repeated image never lands twice in the same
      // angular column. See textureIndexFor.
      textureIndices[i] = textureIndexFor(i, instanceCount, atlas.uniqueCount)
      slotIndices[i] = i
    }
    return { angleOffsets, positionYs, textureIndices, slotIndices }
  }, [instanceCount, totalHeight, atlas])

  const uniforms = React.useMemo(
    () => ({
      uRadius: { value: LAYOUT.radius },
      uScrollOffset: { value: 0 },
      uTotalHeight: { value: totalHeight },
      uTime: { value: 0 },
      uScale: { value: imageScale },
      uCurvature: { value: LAYOUT.curvature },
      uRotation: { value: 0 },
      uSqueezeAmount: { value: 0 },
      uSqueezeWidth: { value: preset.squeezeWidth },
      uAtlas: { value: texture },
      uAtlasCols: { value: atlas.cols },
      uAtlasRows: { value: atlas.rows },
      uChromaticAberration: { value: 0 },
      uOpacity: { value: 1 },
      uSaturation: { value: 1 },
      uBrightness: { value: 1 },
      uEmission: { value: 0 },
      uScanLines: { value: 0 },
      uScanLineSpeed: { value: 0 },
      uScanLineDensity: { value: 25 },
      uDistanceFadeStart: { value: 3 },
      uDistanceFadeEnd: { value: 8 },
      uFlickerIntensity: { value: 0 },
      uFlickerSpeed: { value: 0 },
      uBorderWidth: { value: 0 },
      uBorderColor: { value: new THREE.Color("#ffffff") },
      uBorderEmission: { value: 0 },
      uCornerSize: { value: 0 },
      uCornerWidth: { value: 0.01 },
      uCornerOffset: { value: 0.03 },
      uDitherEnabled: { value: 0 },
      uDitherCellSize: { value: 7 },
      uDitherGap: { value: 2.75 },
      uDitherContrast: { value: 0 },
      uDitherBaseScale: { value: 0.8 },
      uDitherMode: { value: 2 },
      uDitherIntensity: { value: 2.61 },
      uDitherShape: { value: 0 },
      uDebugMode: { value: 0 },
      uDitherUseColor: { value: 1 },
      uDitherFgColor: { value: new THREE.Color("#ffffff") },
      uDitherAspect: { value: LAYOUT.planeWidth / LAYOUT.planeHeight },
    }),
    // Deliberately not depending on `preset`: the uniforms object is created
    // once and mutated per frame below. Rebuilding it on a preset change
    // recompiles the material and drops a frame on every tab press.
    [atlas, texture, totalHeight] // eslint-disable-line react-hooks/exhaustive-deps
  )

  React.useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const identity = new THREE.Matrix4()
    for (let i = 0; i < instanceCount; i++) mesh.setMatrixAt(i, identity)
    mesh.instanceMatrix.needsUpdate = true
  }, [instanceCount])

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    scroll.friction.current = MOTION.momentum
    scroll.update()

    const u = (mesh.material as THREE.ShaderMaterial).uniforms
    const velocity = scroll.velocity.current

    u.uTime.value = state.clock.elapsedTime
    u.uScale.value = imageScale
    u.uScrollOffset.value = scroll.offset.current * MOTION.scrollAdvanceSpeed * speed

    if (Math.abs(velocity) > 0.001) {
      lastDirection.current = velocity > 0 ? 1 : -1
    }

    // With reduced motion the ring holds still unless the user is scrolling
    // it. Idle rotation is unrequested, indefinite movement — precisely what
    // the preference is asking us not to do — but a response to their own
    // scroll is not.
    const idle = reducedMotion ? 0 : MOTION.autoRotateSpeed * lastDirection.current
    const target = THREE.MathUtils.clamp(
      (idle + velocity * MOTION.scrollRotateForce) * speed,
      -MOTION.maxRotationSpeed,
      MOTION.maxRotationSpeed
    )
    rotationSpeed.current += (target - rotationSpeed.current) * MOTION.rotationSmoothing
    // delta * 60 normalises to a 60Hz frame, so a 120Hz display does not spin
    // the ring twice as fast.
    rotation.current += rotationSpeed.current * delta * 60
    // Wrapped, so it never grows without bound.
    //
    // It used to accumulate forever, and the shader feeds it to sin and cos,
    // whose accuracy on a GPU degrades with magnitude: measured 1.9e-4 error
    // under one revolution against 3.5e-4 at 4000 radians, which is where a few
    // minutes of idle turning gets to. Wrapping keeps every frame in the
    // accurate band. Found while building the parity gate, though it is not
    // what that gate was failing on.
    rotation.current %= Math.PI * 2
    u.uRotation.value = rotation.current

    const targetSqueeze = Math.min(Math.abs(velocity) * 3, 1) * preset.squeezeMax
    smoothSqueeze.current += (targetSqueeze - smoothSqueeze.current) * 0.08
    u.uSqueezeAmount.value = smoothSqueeze.current
    u.uSqueezeWidth.value = preset.squeezeWidth

    u.uChromaticAberration.value = preset.chromaticAberration
    u.uSaturation.value = preset.saturation
    u.uBrightness.value = preset.brightness
    u.uEmission.value = preset.emission
    u.uDistanceFadeStart.value = preset.distanceFadeStart
    u.uDistanceFadeEnd.value = preset.distanceFadeEnd

    // Scan lines and flicker are both perpetual animation with no end state.
    u.uScanLines.value = reducedMotion ? 0 : preset.scanLines
    u.uScanLineSpeed.value = reducedMotion ? 0 : preset.scanLineSpeed
    u.uScanLineDensity.value = preset.scanLineDensity
    u.uFlickerIntensity.value = reducedMotion ? 0 : preset.flickerIntensity
    u.uFlickerSpeed.value = reducedMotion ? 0 : preset.flickerSpeed

    u.uBorderWidth.value = preset.borderWidth
    u.uBorderColor.value.set(preset.borderColor)
    u.uBorderEmission.value = preset.borderEmission
    u.uCornerSize.value = preset.cornerSize
    u.uCornerWidth.value = preset.cornerWidth
    u.uCornerOffset.value = preset.cornerOffset

    u.uDitherEnabled.value = preset.ditherEnabled ? 1 : 0
    u.uDitherCellSize.value = preset.ditherCellSize
    u.uDitherGap.value = preset.ditherGap
    u.uDitherContrast.value = preset.ditherContrast
    u.uDitherBaseScale.value = preset.ditherBaseScale
    u.uDitherMode.value = preset.ditherMode
    u.uDitherIntensity.value = preset.ditherIntensity
    u.uDitherShape.value = preset.ditherShape
    u.uDebugMode.value = debugMode
    u.uDitherUseColor.value = preset.ditherUseColor ? 1 : 0
    u.uDitherFgColor.value.set(preset.ditherFgColor)
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, instanceCount]}
      // The ring wraps around the camera, so a slot's bounding sphere is often
      // behind it while its geometry is not. Culling on that basis pops slots
      // out of existence mid-turn.
      frustumCulled={false}
    >
      <planeGeometry
        args={[LAYOUT.planeWidth, LAYOUT.planeHeight, LAYOUT.segmentsX, LAYOUT.segmentsY]}
      >
        <instancedBufferAttribute attach="attributes-aAngleOffset" args={[angleOffsets, 1]} />
        <instancedBufferAttribute attach="attributes-aPositionY" args={[positionYs, 1]} />
        <instancedBufferAttribute attach="attributes-aTextureIndex" args={[textureIndices, 1]} />
        {/* Only the Colours debug view reads this, and it is one float per
            instance — cheaper than the branch needed to avoid uploading it. */}
        <instancedBufferAttribute attach="attributes-aSlotIndex" args={[slotIndices, 1]} />
      </planeGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        transparent
        // The shader outputs premultiplied alpha (see its final line), so the
        // blend has to be told that. Left on the default the soft edges of
        // every matte gain a dark halo.
        blending={THREE.CustomBlending}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
        depthWrite={false}
      />
    </instancedMesh>
  )
}
