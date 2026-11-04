// Pack the gallery's images into one texture.
//
// One atlas means one bound texture and one draw call for the whole wormhole,
// which is the reference implementation's central trick and the reason twenty
// images cost what one costs.
//
// Two differences from the reference. It loads from URLs through
// `useLoader(TextureLoader)`, which suspends; the images here are data URLs
// already in memory from IndexedDB, so they decode directly and there is
// nothing to suspend on. And its tiles are drawn with `drawImage(img, x, y, w,
// h)` at the first texture's dimensions, which stretches every subsequent
// image to the aspect ratio of the first — fine for a set of identically
// cropped photographs, wrong for a vault of cutouts that are whatever shape
// the user's photos were. These are letterboxed into their tile instead.

const MAX_ATLAS_DIMENSION = 4096
const TILE_PADDING = 2

export interface Atlas {
  canvas: HTMLCanvasElement
  cols: number
  rows: number
  /** Tile index for each entry of the original `sources` array. */
  indexMap: number[]
  uniqueCount: number
  tileWidth: number
  tileHeight: number
}

async function decode(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Data URLs need no CORS, but a sample served from /samples does, and an
    // atlas built from a tainted canvas cannot be read back by WebGL.
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    // A single unreachable image must not take the whole wormhole down; the
    // tile is simply left empty.
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Tile size, chosen so the atlas fits inside a texture the GPU will accept.
 *
 * A 4096 cap is the conservative floor for WebGL2 `MAX_TEXTURE_SIZE`. Exceeding
 * it does not error — it silently fails to upload and the gallery renders
 * black, which is a much worse failure than slightly softer tiles.
 */
function tileSizeFor(count: number, aspect: number): { w: number; h: number } {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const maxW = Math.floor(MAX_ATLAS_DIMENSION / cols) - TILE_PADDING
  const maxH = Math.floor(MAX_ATLAS_DIMENSION / rows) - TILE_PADDING
  const w = Math.max(64, Math.min(512, maxW))
  const h = Math.max(64, Math.min(Math.round(512 / aspect), maxH))
  return { w, h }
}

export async function buildAtlas(
  sources: string[],
  aspect: number
): Promise<Atlas | null> {
  const unique = Array.from(new Set(sources))
  if (unique.length === 0) return null

  const indexMap = sources.map((s) => unique.indexOf(s))
  const images = await Promise.all(unique.map(decode))

  const cols = Math.ceil(Math.sqrt(unique.length))
  const rows = Math.ceil(unique.length / cols)
  const { w: tileWidth, h: tileHeight } = tileSizeFor(unique.length, aspect)

  const canvas = document.createElement("canvas")
  canvas.width = cols * (tileWidth + TILE_PADDING)
  canvas.height = rows * (tileHeight + TILE_PADDING)

  // Not `alpha: false`. The cutouts' transparency is the whole subject of this
  // page, and an opaque 2d context composites every tile onto black.
  const ctx = canvas.getContext("2d", { alpha: true })
  if (!ctx) return null

  ctx.imageSmoothingQuality = "high"

  for (let i = 0; i < unique.length; i++) {
    const img = images[i]
    if (!img) continue

    const col = i % cols
    const row = Math.floor(i / cols)
    const originX = col * (tileWidth + TILE_PADDING)
    const originY = row * (tileHeight + TILE_PADDING)

    // Fit rather than fill: a cutout cropped to fill its tile loses the top of
    // someone's head, and there is no background to crop into instead.
    const scale = Math.min(tileWidth / img.width, tileHeight / img.height)
    const drawW = img.width * scale
    const drawH = img.height * scale

    ctx.drawImage(
      img,
      originX + (tileWidth - drawW) / 2,
      originY + (tileHeight - drawH) / 2,
      drawW,
      drawH
    )
  }

  return {
    canvas,
    cols,
    rows,
    indexMap,
    uniqueCount: unique.length,
    tileWidth,
    tileHeight,
  }
}
