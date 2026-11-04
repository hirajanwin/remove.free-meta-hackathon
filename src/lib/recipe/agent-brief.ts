// A brief a coding agent can act on, and then check its own work against.
//
// The existing agent page hands out a snippet. A snippet tells an agent what to
// type; it does not tell it what "done" looks like, so the agent finishes, says
// it finished, and nobody — including the agent — knows whether it worked.
//
// Paperlab's "Copy for AI" is the better shape: install line, the call, the
// contract around it, and **a verification step the agent can run itself**.
// That last part is the whole difference, and it is nearly free to provide
// because the thing being verified is observable from the page.

import { toJSON, type Recipe } from "./schema"
import { materialById } from "./materials"

export interface BriefOptions {
  recipe: Recipe
  /** Where this instance is served from, for the automation endpoints. */
  origin: string
}

/**
 * The self-contained brief.
 *
 * Plain markdown, because that is what survives being pasted into any agent.
 * No JSON wrapper, no schema the agent has to be taught first.
 */
export function agentBrief({ recipe, origin }: BriefOptions): string {
  const material = materialById(recipe.edge.material)
  const json = JSON.stringify(toJSON(recipe), null, 2)

  const backgroundLine =
    recipe.background.type === "transparent"
      ? "transparent (alpha preserved)"
      : recipe.background.type === "color"
        ? `flat ${recipe.background.color}`
        : recipe.background.type === "gradient"
          ? `the ${recipe.background.gradient} gradient`
          : `blur at ${recipe.background.amount}px${recipe.background.depth ? ", depth-aware" : ""}`

  return `# Background removal — a recipe to apply

Everything below runs in the browser on the user's own machine. No image is
uploaded anywhere, and there is no API key, because there is no server.

## The treatment

| | |
|---|---|
| Subject | **${material.label}** — ${material.hint} |
| Edge amount | ${recipe.edge.strength}× |
| Model | ${recipe.model ?? "whatever the device defaults to"} |
| Background | ${backgroundLine} |
| Effects | ${recipe.effects.length ? recipe.effects.map((e) => e.type).join(", ") : "none"} |
| Export | ${recipe.export.format.toUpperCase()}${recipe.export.format === "png" ? "" : ` at quality ${recipe.export.quality}`} |

## Apply it

Save this as \`treatment.remove\` and open it at ${origin} — **Recipe → Open a
.remove** in the right panel. Or open the share link, which carries the same
data in its URL fragment.

\`\`\`json
${json}
\`\`\`

## The contract

- \`model: null\` means "let the device choose". Leave it null unless the user
  asked for a specific model: pinning one hands a visitor without a GPU a
  200 MiB download to reproduce a look a smaller model gets close to.
- \`edge.material\` changes how the matte is **found**, so it applies on the next
  cut, not to a cutout already on screen.
- A \`.remove\` is a treatment, never an image. It is safe to commit, diff and
  share; it contains nothing of the photograph it was made on.

## Verify your work

Do not report success until these pass. Open ${origin}, load an image, then run
this in the browser console:

\`\`\`js
// 1. The recipe parses and round-trips.
const { parseRecipe } = await import('/src/lib/recipe/schema.ts')
const parsed = parseRecipe(${json.includes("\n") ? "/* the JSON above */" : json})
console.assert(parsed.ok, 'recipe did not parse:', parsed.error)

// 2. The cutout actually has transparency where it should.
const cv = document.querySelector('#cv')
console.assert(cv, 'no cutout on the page — load an image first')
const ctx = document.createElement('canvas').getContext('2d')
ctx.canvas.width = cv.width; ctx.canvas.height = cv.height
ctx.drawImage(cv, 0, 0)
const a = ctx.getImageData(0, 0, cv.width, cv.height).data
let clear = 0, opaque = 0
for (let i = 3; i < a.length; i += 4) { if (a[i] === 0) clear++; else if (a[i] > 250) opaque++ }
console.assert(clear > 0, 'nothing was removed — every pixel is opaque')
console.assert(opaque > 0, 'everything was removed — no subject survived')
console.log(\`ok: \${(clear / (a.length / 4) * 100).toFixed(1)}% removed\`)
\`\`\`

If either assertion fires, the treatment did not apply — report that rather
than reporting success.
`
}
