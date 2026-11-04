# remove.free

**Type what to keep. It cuts it out — privately, on your own GPU.**

[**Live demo**](https://remove.free) · [**Demo video**](https://youtu.be/HxcWxMdLOsw) · **Meta Global AI Developer Hackathon 2026**
Track: Indie Developer · Theme: Build for Your World

---

Background removal is a commodity that charges per photo and uploads every
image to someone else's server. remove.free doesn't. Matting runs in the
visitor's browser on WebGPU, so there is no upload, no account, no per-photo
fee — and it keeps working in airplane mode.

What it could not do was *understand* a photo. That is what this build adds:
Meta's models as the understanding layer, with every pixel-level operation
still on the device. The cloud reasons; your pixels stay home.

## What each Meta model decides

| Model | Decides | What stays local |
| --- | --- | --- |
| **SAM 3.1** | *What* to keep. One noun phrase — `dog`, `red sneaker` — returns every match as its own selectable layer, each tinted in its own colour. | The mask is decoded with the official `@meta-sam/parser` and **gated against the on-device matte**, so SAM supplies meaning and BiRefNet supplies the hair-level edge. |
| **Muse Spark 1.3 / Muse Wonder** | *What to do*. "Keep the dog on white" becomes a validated JSON plan — one concept, one keep/remove action, one backdrop. | The plan is executed by deterministic local tools, then **verified with measured numbers** (subject coverage %, soft-edge %) shown in a trace. Low SAM confidence triggers a visible retry with a simpler concept; a soft edge triggers a re-cut with a stronger model and the cleaner result is kept. |
| **Muse Image** | *What it sits in*. A backdrop described in text is generated from the text alone. | The photo is never sent. The cutout is composited locally over the returned scene. |
| **Muse Voice Transcribe** | *Who is asking*. Speech becomes the same agent command the keyboard produces. | Audio is WAV-encoded in the browser and is the only thing that leaves. |

The planner is multimodal: it sees a disclosed 512px copy of the photo, so
"the main subject" becomes the concrete noun SAM needs — `dog` — instead of
the unfindable concept `main subject`. That fix came from running it live.

## Why this is a composition, not a wrapper

Each model is given a job it can actually do, and the app keeps the part it
does better:

- **Semantics × matte.** SAM's mask is a proposal, never the final alpha. It is
  gated against the local cutout, so a coarse SAM edge cannot ship.
- **Planning × determinism.** The agent never gets free-form control of the
  editor. It emits a small validated plan; the app runs it; then the app
  *checks its own work* and reports the numbers either way.
- **Generation × privacy.** Muse Image only ever receives words. The composite
  is assembled on the visitor's GPU.
- **Voice × the same pipeline.** Transcription feeds the identical plan →
  execute → verify path, so voice adds no second code path to trust.

## What was built for this hackathon

**Meta Model API — bring your own key, straight from the browser**

- Select by text with SAM 3.1, per-object layers and isolation.
- The Muse agent, with a command bar under the canvas and one-click examples.
- Verified execution: coverage and soft-edge measured, retried, re-cut.
- Muse Image backdrops from text; Muse Voice commands.
- SAM 3.1 video tracking — one prompt, stable ids across a clip, click-to-track
  on frame 0, per-object toggles, and real transparent video export from
  tracked masks.

**On-device, no key needed**

- **Select Similar** (DINOv2): shift-click one shoe, both get selected.
  Similarity proposes clusters, SlimSAM cuts them.
- **Seller Pack**: batch in, marketplace pack out — Amazon 2000×2000, Shopify
  2048×2048, transparent PNGs, per-photo QA and a `manifest.json`. Optional
  Muse Spark photo QA (off-centre, halo, blur) judges the photo, never a person.
- **Grounding DINO** offline object boxes seed the same proposal flow.

**Editor**

- Full toolset on a magnifying dock: move, object select, select similar,
  marquee, lasso, pen, brush, healing, clone stamp, eyedropper.
- Layers panel where every eye is a real compositing decision; undo/redo.
- Four view modes, split slider, filter gallery, directional relight, crop
  presets framed on the subject's alpha bounds.
- One side-by-side player for video: original left, segmented right, one
  transport driving both.
- Social Pack (five platform sizes in one ZIP), CSV templates, treatment
  presets, promo badges, Ken Burns animation.
- **Audit trail**: every operation records which model ran, where (on-device
  GPU/CPU or Meta cloud), how long it took and what it cost — with a cloud
  total and JSON export.

## The privacy model

- Matting is BiRefNet/MODNet on WebGPU with a WASM fallback. Nothing is
  uploaded; the app works with the network off.
- The Meta key is the visitor's own. It lives in `sessionStorage` by default
  (gone when the tab closes), `localStorage` only on explicit opt-in, never
  IndexedDB, never a URL, never logged.
- Calls go browser → `api.meta.ai` directly (CORS `*`, verified 2026-11-01).
  No server of ours exists to see a key or an image.
- No key is in this repository.

## Proof, not adjectives

- Every Meta feature was run live against the real API while building it: SAM
  at 0.91 confidence on the demo photo, the agent's trace reporting measured
  coverage, the tracked dog across 30 frames, Seller Pack ZIP contents opened
  and inspected.
- 175 unit tests over the numeric layer — colour, geometry, masks, plans,
  packs — all green, plus browser harnesses for anything that needs a real
  GPU, real pointer events or a second profile.
- `tsc --noEmit` is part of `pnpm build`; the build fails on a type error.
- Pricing is visible in the UI because it is real: SAM ≈ $0.0025/image, Muse
  Image $0.01/generation.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000 — full local mode, zero keys
```

For the Meta features, paste your own Meta Model API key into **Studio
Controls → Select by text · SAM 3.1**. The hackathon's $150 participant credit
covers thousands of SAM calls and Muse Image generations.

```bash
pnpm build      # typecheck + tests + production bundle
pnpm test       # unit tests only
```

Deployed as static files on Cloudflare Workers/Pages:

```bash
pnpm deploy:cf
```

## Agents can use it too

Headless Chrome, no UI:

```
https://remove.free/?src=<image-url>&bg=<colour>
```

- cutout → `canvas#cv`
- status → `#status`, reading `WxH · Ns` on completion or starting `failed`
- data URL → `document.querySelector('#cv').toDataURL('image/png')`
- download → `document.querySelector('#dl').click()`

Or the standalone CLI (`agent.mjs`, Node 20+):

```bash
node agent.mjs photo.jpg
node agent.mjs a.jpg b.png --bg white --out ./cut
```

## Stack

TanStack Start and Router, React 19, shadcn/ui (`sidebar-08` inset shell),
Tailwind v4, `@huggingface/transformers` with `onnxruntime-web` for on-device
inference, Cloudflare Workers/Pages for delivery. No backend, by design.

## License

MIT. Free forever.
