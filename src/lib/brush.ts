// Manual cutout refinement.
//
// Automatic matting gets most of an image right and some of it wrong, so every
// competitor ships erase/restore brushes. This is the data model behind them.
//
// The AI mask is never mutated. Instead a parallel edit mask records what the
// user overrode, and the effective alpha is derived from both:
//
//   UNTOUCHED -> whatever the model decided
//   ERASED    -> fully transparent
//   RESTORED  -> fully opaque
//
// Keeping the two separate means switching models, re-running inference, or
// resetting the edits never has to reconstruct anything, and a stroke can be
// undone by restoring just the rectangle it touched rather than snapshotting a
// whole megapixel alpha channel per step.

export const UNTOUCHED = 0
export const ERASED = 1
export const RESTORED = 2

export type BrushMode = "erase" | "restore"

export interface Stroke {
  mode: BrushMode
  /** Radius in image pixels. */
  radius: number
  /** Feather as a fraction of the radius, 0 = hard edge. */
  softness: number
}

/** A rectangle of the edit mask as it was before a stroke, for undo. */
export interface UndoPatch {
  x: number
  y: number
  w: number
  h: number
  before: Uint8Array
}

/** Maximum undo depth. Patches are stroke-sized, so this stays cheap. */
export const UNDO_LIMIT = 24

export function createEditMask(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height) // zero-filled == UNTOUCHED
}

/**
 * Effective alpha for one pixel, given the model's value and any user override.
 * Kept inline-able rather than called per pixel in hot loops.
 */
export function resolveAlpha(base: number, edit: number): number {
  if (edit === ERASED) return 0
  if (edit === RESTORED) return 255
  return base
}

/**
 * Rectangle a stroke would touch, without painting it.
 *
 * Undo has to record the edit mask as it was *before* a stroke mutates it, so
 * the bounds must be computable up front.
 */
export function strokeBounds(
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number
): { x: number; y: number; w: number; h: number } | null {
  const r = Math.max(1, radius)
  const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - r))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + r))
  const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - r))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + r))
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Paint a capsule (a circle swept between two points) into the edit mask.
 *
 * Strokes arrive as discrete pointer samples that can be far apart on a fast
 * drag, so painting a circle per sample would leave gaps. Sweeping between the
 * previous and current point gives a continuous stroke.
 *
 * Returns the affected rectangle, or null if nothing was touched.
 */
export function paintStroke(
  editMask: Uint8Array,
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: Stroke
): { x: number; y: number; w: number; h: number } | null {
  const value = stroke.mode === "erase" ? ERASED : RESTORED
  const r = Math.max(1, stroke.radius)

  // Bounding box of the swept capsule, clamped to the image.
  const minX = Math.max(0, Math.floor(Math.min(from.x, to.x) - r))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + r))
  const minY = Math.max(0, Math.floor(Math.min(from.y, to.y) - r))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + r))
  if (maxX < minX || maxY < minY) return null

  const dx = to.x - from.x
  const dy = to.y - from.y
  const lenSq = dx * dx + dy * dy
  const rSq = r * r

  for (let y = minY; y <= maxY; y++) {
    const row = y * width
    for (let x = minX; x <= maxX; x++) {
      // Distance from the pixel to the segment from->to.
      let t = 0
      if (lenSq > 0) {
        t = ((x - from.x) * dx + (y - from.y) * dy) / lenSq
        t = t < 0 ? 0 : t > 1 ? 1 : t
      }
      const px = from.x + t * dx - x
      const py = from.y + t * dy - y
      if (px * px + py * py <= rSq) {
        editMask[row + x] = value
      }
    }
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Copy a rectangle out of the edit mask so a stroke can be undone. */
export function capturePatch(
  editMask: Uint8Array,
  width: number,
  rect: { x: number; y: number; w: number; h: number }
): UndoPatch {
  const before = new Uint8Array(rect.w * rect.h)
  for (let row = 0; row < rect.h; row++) {
    const src = (rect.y + row) * width + rect.x
    before.set(editMask.subarray(src, src + rect.w), row * rect.w)
  }
  return { ...rect, before }
}

export function applyPatch(
  editMask: Uint8Array,
  width: number,
  patch: UndoPatch
): void {
  for (let row = 0; row < patch.h; row++) {
    const dst = (patch.y + row) * width + patch.x
    editMask.set(patch.before.subarray(row * patch.w, (row + 1) * patch.w), dst)
  }
}

/**
 * Rebuild a cutout canvas from the untouched source pixels, the model's alpha
 * and the user's edits.
 *
 * Compositing from `source` every time rather than mutating in place is what
 * makes a restore stroke able to bring back pixels an erase stroke removed —
 * the colour data is never destroyed.
 */
export function composeCutout(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  baseAlpha: Uint8Array,
  editMask: Uint8Array | null
): void {
  const { width, height } = source
  target.width = width
  target.height = height

  const srcCtx = source.getContext("2d", { willReadFrequently: true })!
  const image = srcCtx.getImageData(0, 0, width, height)
  const data = image.data

  if (editMask) {
    for (let i = 0, j = 3; i < baseAlpha.length; i++, j += 4) {
      const edit = editMask[i]
      data[j] = edit === ERASED ? 0 : edit === RESTORED ? 255 : baseAlpha[i]
    }
  } else {
    for (let i = 0, j = 3; i < baseAlpha.length; i++, j += 4) {
      data[j] = baseAlpha[i]
    }
  }

  target.getContext("2d")!.putImageData(image, 0, 0)
}

/** True if the user has overridden anything. */
export function hasEdits(editMask: Uint8Array): boolean {
  for (let i = 0; i < editMask.length; i++) if (editMask[i] !== UNTOUCHED) return true
  return false
}

/**
 * Write a SAM selection into the edit mask.
 *
 * The selection is a binary region at possibly different dimensions to the
 * image, so it is sampled nearest-neighbour. `mode` decides whether the clicked
 * object is kept or removed, which lets one click fix what the matting model got
 * wrong — and because it lands in the same edit mask the brush uses, it is
 * undoable and paintable over by exactly the same machinery.
 */
export function applySelection(
  editMask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  selection: { mask: Uint8Array; width: number; height: number },
  mode: BrushMode
): { x: number; y: number; w: number; h: number } | null {
  const value = mode === "erase" ? ERASED : RESTORED
  const { mask, width: sw, height: sh } = selection

  let minX = imageWidth
  let minY = imageHeight
  let maxX = -1
  let maxY = -1

  const sameSize = sw === imageWidth && sh === imageHeight

  for (let y = 0; y < imageHeight; y++) {
    const sy = sameSize ? y : Math.min(sh - 1, ((y * sh) / imageHeight) | 0)
    const srcRow = sy * sw
    const dstRow = y * imageWidth
    for (let x = 0; x < imageWidth; x++) {
      const sx = sameSize ? x : Math.min(sw - 1, ((x * sw) / imageWidth) | 0)
      if (!mask[srcRow + sx]) continue
      editMask[dstRow + x] = value
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Tints for the edit overlay. Green keeps, red removes, brighter = pending. */
export const OVERLAY_COLORS = {
  restore: [52, 211, 153] as const,
  erase: [248, 113, 113] as const,
}

/**
 * Paint the edit state as a colour overlay.
 *
 * Marking regions destructively and only seeing the result made it hard to tell
 * what had been changed and where. Tinting committed edits — and showing a
 * proposed selection more strongly before it is applied — makes the gesture
 * legible: green is being kept, red is being removed, and the bright band is
 * what the next Apply will do.
 */
export function paintOverlay(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  editMask: Uint8Array | null,
  pending: { mask: Uint8Array; width: number; height: number } | null,
  pendingMode: BrushMode,
  strength: number,
  /** Prompt points to mark, so the clicks driving a selection are visible. */
  points: Array<{ x: number; y: number; label: 0 | 1 }> = [],
  /**
   * Per-object layer tints (SAM multi-object results). When present these
   * replace the single pending tint, so each object reads in its own hue —
   * matching the coloured chips in the panel.
   */
  layers?: Array<{ mask: Uint8Array; width: number; height: number; color: string }>
): void {
  target.width = width
  target.height = height
  const ctx = target.getContext("2d")
  if (!ctx) return

  const image = ctx.createImageData(width, height)
  const data = image.data

  const committed = Math.round(255 * Math.min(1, Math.max(0, strength)) * 0.55)
  const proposed = Math.round(255 * Math.min(1, Math.max(0, strength)))

  if (editMask) {
    for (let i = 0, j = 0; i < editMask.length; i++, j += 4) {
      const edit = editMask[i]
      if (edit === UNTOUCHED) continue
      const [r, g, b] = edit === ERASED ? OVERLAY_COLORS.erase : OVERLAY_COLORS.restore
      data[j] = r
      data[j + 1] = g
      data[j + 2] = b
      data[j + 3] = committed
    }
  }

  if (layers && layers.length > 0) {
    for (const layer of layers) {
      const r = parseInt(layer.color.slice(1, 3), 16)
      const g = parseInt(layer.color.slice(3, 5), 16)
      const b = parseInt(layer.color.slice(5, 7), 16)
      const { mask, width: sw, height: sh } = layer
      const sameSize = sw === width && sh === height
      for (let y = 0; y < height; y++) {
        const sy = sameSize ? y : Math.min(sh - 1, ((y * sh) / height) | 0)
        const srcRow = sy * sw
        const dstRow = y * width
        for (let x = 0; x < width; x++) {
          const sx = sameSize ? x : Math.min(sw - 1, ((x * sw) / width) | 0)
          if (!mask[srcRow + sx]) continue
          const j = (dstRow + x) * 4
          data[j] = r
          data[j + 1] = g
          data[j + 2] = b
          data[j + 3] = proposed
        }
      }
    }
  } else if (pending) {
    const [r, g, b] = OVERLAY_COLORS[pendingMode]
    const { mask, width: sw, height: sh } = pending
    const sameSize = sw === width && sh === height
    for (let y = 0; y < height; y++) {
      const sy = sameSize ? y : Math.min(sh - 1, ((y * sh) / height) | 0)
      const srcRow = sy * sw
      const dstRow = y * width
      for (let x = 0; x < width; x++) {
        const sx = sameSize ? x : Math.min(sw - 1, ((x * sw) / width) | 0)
        if (!mask[srcRow + sx]) continue
        const j = (dstRow + x) * 4
        data[j] = r
        data[j + 1] = g
        data[j + 2] = b
        data[j + 3] = proposed
      }
    }
  }

  ctx.putImageData(image, 0, 0)

  // Prompt markers last, drawn over the tint: filled = include, hollow = exclude.
  if (points.length) {
    const r = Math.max(5, Math.round(Math.min(width, height) / 110))
    for (const p of points) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.lineWidth = Math.max(2, r / 3)
      ctx.strokeStyle = "rgba(0,0,0,0.75)"
      ctx.stroke()
      ctx.fillStyle = p.label === 1 ? "rgba(52,211,153,0.95)" : "rgba(248,113,113,0.95)"
      if (p.label === 1) {
        ctx.fill()
      } else {
        ctx.lineWidth = Math.max(2, r / 3)
        ctx.strokeStyle = "rgba(248,113,113,0.95)"
        ctx.stroke()
      }
    }
  }
}
