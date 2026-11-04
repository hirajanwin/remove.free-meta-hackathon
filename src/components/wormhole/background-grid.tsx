import * as React from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

import { gridVertexShader, gridFragmentShader } from "@/lib/wormhole/grid-shader"
import type { GridSettings } from "@/lib/wormhole/presets"

/**
 * The enclosing grid cylinder.
 *
 * It follows the camera each frame, which is the reference's own trick and
 * worth keeping: the camera drifts with the pointer, and a fixed grid would
 * slide around behind the gallery as it did. Moving with the camera makes the
 * grid feel like the room rather than like a wall the room is parked in front
 * of.
 *
 * `renderOrder={-1}` and `depthWrite={false}` keep it behind the gallery
 * regardless of which is nearer the camera — the gallery's own quads sit inside
 * this cylinder, so depth alone would sort them correctly, but the gallery also
 * writes no depth, and two non-depth-writing transparent meshes are ordered by
 * render order and nothing else.
 */
export function BackgroundGrid({ grid }: { grid: GridSettings }) {
  const meshRef = React.useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const uniforms = React.useMemo(
    () => ({
      uGridSize: { value: grid.cellSize },
      uSubdivisions: { value: grid.subdivisions },
      uMajorLineWidth: { value: grid.majorLineWidth },
      uMinorLineWidth: { value: grid.minorLineWidth },
      uDotSize: { value: grid.dotSize },
      uMajorLineColor: { value: new THREE.Color(grid.lineColor) },
      uMinorLineColor: { value: new THREE.Color(grid.lineColor) },
      uDotColor: { value: new THREE.Color(grid.dotColor) },
      uMajorLineOpacity: { value: grid.majorLineOpacity },
      uMinorLineOpacity: { value: grid.minorLineOpacity },
      uDotOpacity: { value: grid.dotOpacity },
      uBgColor: { value: new THREE.Color(grid.bgColor) },
      uBgOpacity: { value: grid.bgOpacity },
      uTileX: { value: grid.tileX },
      uTileY: { value: grid.tileY },
      uHorizontalFade: { value: grid.horizontalFade },
      uHorizontalFadeSoftness: { value: grid.horizontalFadeSoftness },
    }),
    // Built once and mutated per frame, like the gallery's — rebuilding
    // recompiles the material and drops a frame on every control change.
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.position.copy(camera.position)

    const u = (mesh.material as THREE.ShaderMaterial).uniforms
    u.uGridSize.value = grid.cellSize
    u.uSubdivisions.value = grid.subdivisions
    u.uMajorLineWidth.value = grid.majorLineWidth
    u.uMinorLineWidth.value = grid.minorLineWidth
    u.uDotSize.value = grid.dotSize
    u.uMajorLineColor.value.set(grid.lineColor)
    u.uMinorLineColor.value.set(grid.lineColor)
    u.uDotColor.value.set(grid.dotColor)
    u.uMajorLineOpacity.value = grid.majorLineOpacity
    u.uMinorLineOpacity.value = grid.minorLineOpacity
    u.uDotOpacity.value = grid.dotOpacity
    u.uBgColor.value.set(grid.bgColor)
    u.uBgOpacity.value = grid.bgOpacity
    u.uTileX.value = grid.tileX
    u.uTileY.value = grid.tileY
    u.uHorizontalFade.value = grid.horizontalFade
    u.uHorizontalFadeSoftness.value = grid.horizontalFadeSoftness
  })

  return (
    <mesh ref={meshRef} renderOrder={-1} frustumCulled={false}>
      <cylinderGeometry args={[grid.radius, grid.radius, grid.height, 64, 1, true]} />
      <shaderMaterial
        vertexShader={gridVertexShader}
        fragmentShader={gridFragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        blending={THREE.CustomBlending}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
      />
    </mesh>
  )
}
