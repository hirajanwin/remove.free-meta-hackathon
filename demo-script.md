# Demo video script — 3:00

Record at 1440p, dark theme, Studio Controls panel open. Have the Meta key
already saved (don't type a key on camera). Use the bundled samples:
golden retriever (agent + SAM), sneakers (similar + pack).

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:15 | Retriever sample loads; cutout lands | "Every background remover charges per photo and uploads your images to do it. remove.free runs the AI on your own GPU. And now it understands what it's looking at." |
| 0:15–0:45 | SAM prompt: type `dog`, Select → tint lands exactly on the dog | "This is SAM 3.1, from Meta. I type what to keep — it finds every match, as layers. The mask is decoded locally and gated against our on-device matte, so the fur edge is ours, the meaning is Meta's." |
| 0:45–1:25 | Command bar under the canvas: click the `keep the main subject on white` example, Run. Trace ticks: Plan → SAM 0.89 → gated → verified 16.1% | "The Muse agent turns a sentence into a plan, runs it with local tools, and then *checks its own work* — measured coverage, not vibes. It can see a small copy of the photo, so 'the main subject' becomes 'dog' — the concrete noun SAM needs. If SAM's confidence is low, it retries with a simpler prompt and tells you it did." |
| 1:25–1:45 | Mic button: say "keep the dog on white" (or reuse typed), then Backdrop: `sunny park with soft green grass`, Create → dog in park | "Voice commands run through Muse Voice Transcribe. And Muse Image generates the backdrop from text alone — the photo itself is never sent. Only the words leave." |
| 1:45–2:10 | Shift-click the sneakers sample → both-similar proposal; Apply | "No key? The local stack still works. Shift-click uses DINOv2 — another Meta-born model — to find everything *like* what you clicked, then SlimSAM cuts it properly." |
| 2:10–2:35 | Batch: two product photos → QA numbers → Seller Pack download → unzip on camera: Amazon + Shopify squares + manifest.json | "For sellers: batch photos in, marketplace pack out. Amazon and Shopify squares, transparent PNGs, and a QA manifest with measured subject coverage per photo. No per-photo fee." |
| 2:35–2:50 | Video page: `dog` tracked across 30 frames, toggle object, render tracked frame | "SAM 3.1 tracks the same object through video with a stable id — one prompt, every frame." |
| 2:50–3:00 | Airplane mode / network off: run a local cutout. End card: name + URL | "The cloud reasons. Your pixels stay home. remove.free — open source, free forever, built for the Meta Global AI Developer Hackathon." |

## Capture notes

- SAM and Muse Image calls through a proxied/headless browser can be slow
  (Muse Image took minutes in our test pane vs ~13s direct). Pre-warm each
  call once before recording the take.
- BiRefNet's first load in a cold browser is ~109 MiB + GPU compile. Record
  with a warm profile, or the first cutout eats 30s of the video.
- Keep the agent trace on screen for its full run — the verification line
  is the differentiator; don't cut it.
- Post a 15-second cut (SAM tint + agent verification) to X at submission
  for the Most Viral window (engagement counted through Nov 8).
