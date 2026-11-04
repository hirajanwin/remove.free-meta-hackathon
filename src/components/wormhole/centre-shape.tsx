import * as React from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

import { MOTION, type ShapeKind, type ShapeSettings } from "@/lib/wormhole/presets"
import type { VirtualScroll } from "@/lib/wormhole/virtual-scroll"

/**
 * The wireframe object at the centre of the ring.
 *
 * From the reference's WireframeTorus. It shares the gallery's rotation logic
 * on purpose — same auto-rotate, same scroll contribution, same clamp and
 * smoothing — so the shape and the ring turn as one object rather than two
 * things that happen to be spinning.
 *
 * Its scale contracts as you scroll, which is the detail that sells it: the
 * ring pinches at the centre under speed and the shape shrinks with it.
 *
 * The reference also offers a "Brain" mesh loaded from `/glb/brain-low.glb`.
 * That is a binary asset this project does not have, and shipping a GLB loader
 * plus a model to draw one wireframe would cost more than the three primitives
 * below are worth — so the option is absent rather than broken.
 */
function useGeometry(kind: ShapeKind) {
  return React.useMemo(() => {
    switch (kind) {
      case "torus":
        return new THREE.TorusGeometry(1, 0.35, 16, 32)
      case "torusKnot":
        return new THREE.TorusKnotGeometry(0.8, 0.25, 50, 16)
      case "cube":
        return new THREE.BoxGeometry(1.6, 1.6, 1.6)
      default:
        return null
    }
  }, [kind])
}

export function CentreShape({
  scroll,
  shape,
  reducedMotion,
}: {
  scroll: VirtualScroll
  shape: ShapeSettings
  reducedMotion: boolean
}) {
  const meshRef = React.useRef<THREE.Mesh>(null)
  const rotationY = React.useRef(0)
  const rotationSpeed = React.useRef(0)
  const lastDirection = React.useRef(1)
  const smoothScale = React.useRef(shape.scale)

  const geometry = useGeometry(shape.kind)

  // A geometry is a GPU buffer. Switching shapes leaks one per switch without
  // this, on a page the user can sit on and cycle through them.
  React.useEffect(() => () => geometry?.dispose(), [geometry])

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    const velocity = scroll.velocity.current
    if (Math.abs(velocity) > 0.001) {
      lastDirection.current = velocity > 0 ? 1 : -1
    }

    const idle = reducedMotion ? 0 : MOTION.autoRotateSpeed * 2 * lastDirection.current
    const target = THREE.MathUtils.clamp(
      idle + velocity * MOTION.scrollRotateForce,
      -MOTION.maxRotationSpeed,
      MOTION.maxRotationSpeed
    )
    rotationSpeed.current += (target - rotationSpeed.current) * MOTION.rotationSmoothing
    rotationY.current += rotationSpeed.current * delta * 60

    mesh.rotation.x = shape.tiltX
    mesh.rotation.y = rotationY.current
    mesh.rotation.z = shape.tiltZ

    const targetScale = shape.scale - Math.abs(velocity) * shape.scaleReact * 10
    smoothScale.current += (targetScale - smoothScale.current) * shape.scaleSmoothing
    mesh.scale.setScalar(Math.max(0.05, smoothScale.current))
  })

  if (!geometry) return null

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        color={shape.color}
        wireframe
        transparent
        opacity={shape.opacity}
        // Front side only by default: a wireframe drawn double-sided shows the
        // back half of its own mesh through the front, which on a torus is a
        // second overlapping ring rather than more detail.
        side={shape.singleSide ? THREE.FrontSide : THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
