// Encoding cutouts for download.
//
// All the format logic lives here because the mime/quality mapping was
// previously duplicated across the download button, the clipboard copy and the
// size readout, which is how the two defects below went unnoticed.
//
// Measured on an 800x1283 cutout (Chrome, canvas.toBlob):
//
//   PNG                409.4 KB   lossless
//   WebP q0.95          86.9 KB   alpha bit-identical
//   WebP q0.99         106.3 KB   alpha bit-identical
//   WebP q1.00         442.0 KB   alpha bit-identical, but LARGER than PNG
//   JPEG q0.95          57.7 KB   alpha destroyed
//
// The important result: WebP's lossy mode compresses the alpha channel
// losslessly, so a round trip at q0.80 and q0.95 both returned mean and max
// alpha error of exactly 0. Only colour degrades — never the matte. That makes
// WebP the right default for a background remover: ~4.7x smaller than PNG with
// a pixel-identical cutout.
//
// Trimming fully transparent margins is deliberately NOT done for size: it
// removed 61% of the pixels of that cutout but only 5.4% of the PNG bytes,
// because uniform transparent regions already compress to almost nothing.

export type ExportFormat = "png" | "webp" | "jpeg"

export const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  webp: "image/webp",
  jpeg: "image/jpeg",
}

/**
 * WebP's encoder switches to a near-lossless mode at exactly q=1.0 that is ~4x
 * larger than q=0.99 and larger than PNG, for no benefit worth having. The
 * slider goes to 100, so clamp it.
 */
export const MAX_WEBP_QUALITY = 0.99

/** Matte colour used when flattening transparency for a format without alpha. */
export const JPEG_MATTE = "#ffffff"

export function effectiveQuality(format: ExportFormat, quality: number): number | undefined {
  if (format === "png") return undefined // PNG ignores the quality argument
  const q = Math.min(1, Math.max(0.1, quality / 100))
  return format === "webp" ? Math.min(q, MAX_WEBP_QUALITY) : q
}

/** True if any pixel is not fully opaque. Exits on the first hit. */
export function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return false
  const { width: w, height: h } = canvas
  const data = ctx.getImageData(0, 0, w, h).data
  // Corners first: a cutout is almost always transparent there, so this
  // usually returns immediately instead of walking megapixels.
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4]
  for (const c of corners) if (data[c + 3] !== 255) return true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true
  return false
}

/**
 * JPEG has no alpha channel. Chrome composites a transparent canvas onto
 * **black**, so choosing JPEG for a transparent cutout silently returns the
 * subject on a black background — destroyed, with no warning. Flatten onto
 * white instead, which is what a background remover should do.
 */
export function prepareForEncode(
  canvas: HTMLCanvasElement,
  format: ExportFormat
): HTMLCanvasElement {
  if (format !== "jpeg") return canvas
  if (!hasTransparency(canvas)) return canvas

  const flat = document.createElement("canvas")
  flat.width = canvas.width
  flat.height = canvas.height
  const ctx = flat.getContext("2d")!
  ctx.fillStyle = JPEG_MATTE
  ctx.fillRect(0, 0, flat.width, flat.height)
  ctx.drawImage(canvas, 0, 0)
  return flat
}

export function encode(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number
): Promise<Blob | null> {
  const source = prepareForEncode(canvas, format)
  return new Promise((resolve) =>
    source.toBlob(resolve, MIME[format], effectiveQuality(format, quality))
  )
}

export function extensionFor(format: ExportFormat): string {
  return format === "jpeg" ? "jpg" : format
}

export interface FormatSize {
  format: ExportFormat
  bytes: number | null
}

/**
 * Real encoded size of every format, so the export panel can present a choice
 * with facts rather than a single number for whichever format is selected.
 */
export async function measureAllFormats(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<FormatSize[]> {
  const formats: ExportFormat[] = ["png", "webp", "jpeg"]
  return Promise.all(
    formats.map(async (format) => {
      const blob = await encode(canvas, format, quality)
      return { format, bytes: blob ? blob.size : null }
    })
  )
}

/**
 * Which format to nudge the user towards.
 *
 * With transparency, WebP wins outright: the matte survives bit-identically and
 * the file is several times smaller than PNG. Without transparency there is no
 * matte to protect, so the smallest of the lossy options wins.
 */
export function recommendFormat(
  sizes: FormatSize[],
  transparent: boolean
): ExportFormat {
  const by = (f: ExportFormat) => sizes.find((s) => s.format === f)?.bytes ?? Infinity
  if (transparent) return by("webp") < by("png") ? "webp" : "png"
  return by("jpeg") <= by("webp") ? "jpeg" : "webp"
}
