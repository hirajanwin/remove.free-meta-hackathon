// Smart Resize, local edition (the Orshot idea, minus the server).
//
// One finished composite rendered at every platform size that matters.
// The source is contain-fitted so nothing is ever cropped away; the
// letterbox takes the chosen ground colour.

export interface SocialSize {
  id: string
  label: string
  width: number
  height: number
}

export const SOCIAL_SIZES: SocialSize[] = [
  { id: "ig-post", label: "Instagram Post", width: 1080, height: 1080 },
  { id: "ig-story", label: "Instagram Story", width: 1080, height: 1920 },
  { id: "x-post", label: "X Post", width: 1600, height: 900 },
  { id: "yt-thumb", label: "YouTube Thumbnail", width: 1280, height: 720 },
  { id: "pin", label: "Pinterest Pin", width: 1000, height: 1500 },
]

/** Contain-fit rectangle for src inside dst, centred. Pure; tested. */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h }
}

export function renderSocialSize(
  source: HTMLCanvasElement,
  size: SocialSize,
  background: string
): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = size.width
  out.height = size.height
  const ctx = out.getContext("2d")!
  ctx.fillStyle = background
  ctx.fillRect(0, 0, size.width, size.height)
  const rect = fitRect(source.width, source.height, size.width, size.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h)
  return out
}
