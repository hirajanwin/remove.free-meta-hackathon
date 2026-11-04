// The `.remove` file format, and the single source of truth for it.
//
// This schema is the one place a treatment is defined. It validates what comes
// in from a file or a share link, it supplies every default, it is what the
// studio's controls are generated from, and it is what the agent page documents.
// The rule that keeps it honest is Paperlab's: **if a setting cannot serialize
// into a recipe, it does not ship as a setting.**
//
// What a recipe is NOT is the image. A `.remove` file is a treatment — which
// model, what the subject is made of, what goes behind it, how the edge is
// finished, how it is exported. Point it at a different photograph and it
// applies the same treatment to that one. That is what makes it worth sending
// to someone: they get your recipe, not your picture.
//
// Two deliberate exclusions:
//
//   - **The source image.** Too big for a URL, and a recipe that carried one
//     would be a screenshot with extra steps.
//   - **Refine strokes.** They are coordinates on one specific photograph and
//     mean nothing on another. The vault stores them alongside a cutout (see
//     `history-store`), but they are not part of the portable format.

import { z } from "zod"

/** Bumped only when a change cannot be read by an older parser. */
export const RECIPE_VERSION = 1

export const FILE_EXTENSION = ".remove"
export const FILE_MIME = "application/vnd.removefree.recipe+json"

// ── Background ───────────────────────────────────────────

export const gradientNames = ["dark", "sunset", "ocean", "cyberpunk", "light"] as const

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb colour")

export const backgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transparent") }),
  z.object({ type: z.literal("color"), color: hexColor.default("#ffffff") }),
  z.object({ type: z.literal("gradient"), gradient: z.enum(gradientNames).default("dark") }),
  z.object({
    type: z.literal("blur"),
    /** Radius in pixels at the image's own scale. */
    amount: z.number().min(0).max(64).default(16),
    /**
     * Vary the radius with scene depth rather than applying one flat blur.
     * Costs an extra model download, so it stays opt-in.
     */
    depth: z.boolean().default(false),
  }),
  // An image backdrop is deliberately NOT part of the portable format: it would
  // embed someone's photograph in a share link. The studio still supports one;
  // a recipe carrying it degrades to transparent, which is stated in `parse`.
])

export type BackgroundConfig = z.infer<typeof backgroundSchema>

// ── Edge ─────────────────────────────────────────────────

export const materialIds = ["auto", "hair", "fur", "glass", "hard", "soft"] as const

export const edgeSchema = z.object({
  /** What the subject is made of. Drives the guided filter, snapping and unmixing. */
  material: z.enum(materialIds).default("auto"),
  /**
   * Scales the material's snap and unmix, 0 to 2. 1 is the material as defined.
   *
   * Exists because "hair" is a family rather than a setting — a studio portrait
   * on a sweep and a windblown shot against foliage both want the hair
   * treatment and not the same amount of it.
   */
  strength: z.number().min(0).max(2).default(1),
})

export type EdgeConfig = z.infer<typeof edgeSchema>

// ── Effects ──────────────────────────────────────────────

/**
 * What happens to the cutout after it is cut — composable, and each one a pure
 * function of the alpha channel plus its own options.
 *
 * Ordered as declared, so an outline under a shadow and a shadow under an
 * outline are both expressible.
 */
export const effectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("outline"),
    /** Width in pixels at the image's own scale. */
    width: z.number().min(1).max(64).default(8),
    color: hexColor.default("#ffffff"),
    /** 0 is a mitre-free round outline; 1 follows the silhouette exactly. */
    tightness: z.number().min(0).max(1).default(0),
  }),
  z.object({
    type: z.literal("shadow"),
    blur: z.number().min(0).max(128).default(24),
    /** Degrees, 0 = right, 90 = down. */
    angle: z.number().min(0).max(360).default(90),
    distance: z.number().min(0).max(128).default(16),
    color: hexColor.default("#000000"),
    opacity: z.number().min(0).max(1).default(0.35),
  }),
  z.object({
    type: z.literal("glow"),
    radius: z.number().min(1).max(128).default(32),
    color: hexColor.default("#6df4ce"),
    opacity: z.number().min(0).max(1).default(0.6),
  }),
])

export type EffectConfig = z.infer<typeof effectSchema>
export type EffectType = EffectConfig["type"]

// ── Export ───────────────────────────────────────────────

export const exportSchema = z.object({
  format: z.enum(["png", "webp", "jpeg"]).default("png"),
  /** 1-100. Ignored by png. */
  quality: z.number().min(1).max(100).default(95),
})

export type ExportConfig = z.infer<typeof exportSchema>

// ── The recipe ───────────────────────────────────────────

export const recipeSchema = z.object({
  /** Format version, not the app's. */
  version: z.number().int().default(RECIPE_VERSION),
  /** Free text, shown in the library. */
  name: z.string().max(80).default("Untitled"),
  /**
   * Matting model id, or null for "whatever this device defaults to".
   *
   * Null is the honest default for a shared recipe: the sender may have a GPU
   * and the receiver may not, and pinning BiRefNet onto a CPU visitor hands
   * them a 214 MiB download and a slow result to reproduce a look that MODNet
   * would have got close to. A recipe can still pin one deliberately.
   */
  model: z.string().nullable().default(null),
  edge: edgeSchema.default({ material: "auto", strength: 1 }),
  background: backgroundSchema.default({ type: "transparent" }),
  effects: z.array(effectSchema).max(8).default([]),
  export: exportSchema.default({ format: "png", quality: 95 }),
})

export type Recipe = z.infer<typeof recipeSchema>
export type RecipeInput = z.input<typeof recipeSchema>

/** Every default, resolved. The studio's initial state comes from here. */
export function defaultRecipe(): Recipe {
  return recipeSchema.parse({})
}

/**
 * Parse anything claiming to be a recipe.
 *
 * Returns the problems rather than throwing, because the two callers — a
 * dropped file and a pasted link — both want to say what was wrong with it
 * rather than disappear. A recipe from a newer version still parses if its
 * shape happens to fit; the version is advisory until it has to stop being.
 */
export function parseRecipe(
  input: unknown
): { ok: true; recipe: Recipe; warnings: string[] } | { ok: false; error: string } {
  const warnings: string[] = []

  if (input && typeof input === "object" && "version" in input) {
    const v = (input as { version: unknown }).version
    if (typeof v === "number" && v > RECIPE_VERSION) {
      warnings.push(
        `This recipe is version ${v} and this build reads version ${RECIPE_VERSION}. Anything newer has been dropped.`
      )
    }
  }

  const result = recipeSchema.safeParse(input)
  if (!result.success) {
    const first = result.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join(".") || "recipe"}: ${first.message}` : "Not a valid recipe",
    }
  }

  return { ok: true, recipe: result.data, warnings }
}

/**
 * Serialize, dropping anything equal to its default.
 *
 * A recipe that names only what was actually changed is the difference between
 * a share link that reads as a treatment and one that reads as a memory dump —
 * and it keeps links short, which is the practical constraint. Paperlab makes
 * the same point about lighting: overrides should serialize *as* overrides.
 */
export function toJSON(recipe: Recipe): RecipeInput {
  const base = defaultRecipe()
  const out: Record<string, unknown> = { version: recipe.version }

  if (recipe.name !== base.name) out.name = recipe.name
  if (recipe.model !== base.model) out.model = recipe.model
  if (recipe.edge.material !== base.edge.material || recipe.edge.strength !== base.edge.strength) {
    out.edge = recipe.edge
  }
  if (recipe.background.type !== base.background.type) out.background = recipe.background
  else if (JSON.stringify(recipe.background) !== JSON.stringify(base.background)) {
    out.background = recipe.background
  }
  if (recipe.effects.length > 0) out.effects = recipe.effects
  if (
    recipe.export.format !== base.export.format ||
    recipe.export.quality !== base.export.quality
  ) {
    out.export = recipe.export
  }

  return out as RecipeInput
}
