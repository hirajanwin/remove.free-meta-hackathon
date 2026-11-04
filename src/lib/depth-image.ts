import type { DepthMap } from "./depth"
import { DEFAULT_TONE, renderDepth, type DepthView } from "./depth-render"

/** A depth map as a canvas under a colour ramp, for views and PNG export. */
export function depthToCanvas(depth: DepthMap, view: DepthView = "turbo"): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = depth.width
  canvas.height = depth.height
  const ctx = canvas.getContext("2d")!
  const rgba = renderDepth(depth.data, depth.width, depth.height, view, DEFAULT_TONE)
  ctx.putImageData(new ImageData(rgba, depth.width, depth.height), 0, 0)
  return canvas
}

/** Save a depth map as a PNG, greyscale so it drops straight into other tools. */
export function downloadDepthPng(depth: DepthMap, name: string) {
  depthToCanvas(depth, "grey").toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${name}-depth.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, "image/png")
}
