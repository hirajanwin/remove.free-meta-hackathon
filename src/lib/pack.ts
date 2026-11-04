import { drawBadge } from "./bg-removal"

// Marketplace pack rendering.
//
// Sellers do not want a transparent PNG; they want the exact squares their
// marketplace demands, subject centred with breathing room, on white. This
// renders those from a cutout locally — no upload, no per-photo fee.

export interface PackSpec {
  id: string
  label: string
  size: number
  /** Fraction of the frame the subject may occupy (rest is margin). */
  fill: number
  background: string
}

export const PACK_SPECS: PackSpec[] = [
  { id: "amazon", label: "Amazon 2000×2000 white", size: 2000, fill: 0.85, background: "#ffffff" },
  { id: "shopify", label: "Shopify 2048×2048 white", size: 2048, fill: 0.8, background: "#ffffff" },
]

/** Bounding box of non-transparent pixels, or null for an empty cutout. */
export function alphaBounds(
  alpha: Uint8Array,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] <= 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Per-row template values from a CSV: what changes between renders. */
export interface PackTemplate {
  background?: string
  caption?: string
  badge?: string
}

/** Render one marketplace image: subject trimmed, centred, on the spec's ground. */
export function renderPackImage(
  cutout: HTMLCanvasElement,
  spec: PackSpec,
  template?: PackTemplate
): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = spec.size
  out.height = spec.size
  const ctx = out.getContext("2d")!
  ctx.fillStyle = template?.background ?? spec.background
  ctx.fillRect(0, 0, spec.size, spec.size)

  const srcCtx = cutout.getContext("2d", { willReadFrequently: true })!
  const data = srcCtx.getImageData(0, 0, cutout.width, cutout.height).data
  const alpha = new Uint8Array(cutout.width * cutout.height)
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = data[j]

  const bounds = alphaBounds(alpha, cutout.width, cutout.height)
  if (!bounds) return out

  const target = spec.size * spec.fill
  const scale = Math.min(target / bounds.w, target / bounds.h)
  const dw = bounds.w * scale
  const dh = bounds.h * scale
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(
    cutout,
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h,
    (spec.size - dw) / 2,
    (spec.size - dh) / 2,
    dw,
    dh
  )

  if (template?.caption) {
    const size = Math.round(spec.size * 0.045)
    ctx.save()
    ctx.font = `700 ${size}px system-ui, sans-serif`
    ctx.textAlign = "center"
    ctx.shadowColor = "rgba(0,0,0,0.55)"
    ctx.shadowBlur = size * 0.3
    ctx.shadowOffsetY = 2
    ctx.fillStyle = "#ffffff"
    ctx.fillText(template.caption, spec.size / 2, spec.size - size * 0.8, spec.size * 0.92)
    ctx.restore()
  }

  if (template?.badge) {
    drawBadge(ctx, spec.size, spec.size, template.badge)
  }
  return out
}

export function canvasBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg" = "image/png",
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode pack image"))),
      type,
      quality
    )
  )
}
