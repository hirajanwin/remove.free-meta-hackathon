// Between the studio's controls and a `.remove` recipe.
//
// These are two shapes of the same information and they stay separate on
// purpose. The controls carry live UI state a recipe has no business in — which
// refine tool is armed, how strong the edit overlay is, whether a backdrop image
// is loaded — and the recipe carries the portable subset. Collapsing them into
// one object would mean either a share link full of transient state or a schema
// that cannot describe the editor.
//
// The schema is still the source of truth: everything here either reads from it
// or is validated by it.

import type { StudioControlsState } from "@/components/studio/studio-context"
import { defaultRecipe, type Recipe } from "./schema"

/** What the studio is currently set to, as a portable recipe. */
export function recipeFromControls(
  controls: StudioControlsState,
  modelId: string | null,
  name = "Untitled"
): Recipe {
  const base = defaultRecipe()

  const background: Recipe["background"] =
    controls.mode === "color"
      ? { type: "color", color: controls.color }
      : controls.mode === "gradient"
        ? { type: "gradient", gradient: controls.gradient }
        : controls.mode === "blur"
          ? { type: "blur", amount: controls.blurRadius, depth: controls.depthBokeh }
          : // `image` has no portable form — it would mean embedding someone's
            // photograph in a link — so it degrades to transparent. The studio
            // keeps the backdrop; the recipe does not carry it.
            { type: "transparent" }

  return {
    ...base,
    name,
    model: modelId,
    edge: controls.edge,
    background,
    effects: controls.effects,
    export: { format: controls.exportFormat, quality: controls.exportQuality },
  }
}

/**
 * Apply a recipe to the studio's controls.
 *
 * Returns a patch rather than a whole state so the caller merges it, which
 * keeps the transient half — refine tool, overlay strength, a loaded backdrop —
 * exactly where it was. Receiving a recipe should change the treatment, not
 * reset the session.
 */
export function controlsFromRecipe(recipe: Recipe): Partial<StudioControlsState> {
  const patch: Partial<StudioControlsState> = {
    edge: recipe.edge,
    effects: recipe.effects,
    exportFormat: recipe.export.format,
    exportQuality: recipe.export.quality,
  }

  switch (recipe.background.type) {
    case "color":
      patch.mode = "color"
      patch.color = recipe.background.color
      break
    case "gradient":
      patch.mode = "gradient"
      patch.gradient = recipe.background.gradient
      break
    case "blur":
      patch.mode = "blur"
      patch.blurRadius = recipe.background.amount
      patch.depthBokeh = recipe.background.depth
      break
    default:
      patch.mode = "transparent"
  }

  return patch
}
