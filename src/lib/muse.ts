// Muse agent brain (BYOK, direct from the browser).
//
// The agent does not get free-form control of the app. Muse Spark turns a
// sentence into a small, validated plan (one concept, one keep/remove
// action, one backdrop); the app executes that plan with its own tools and
// then *verifies* the result with measured numbers (object count, subject
// coverage). Natural language in, deterministic tools, checked output.

export interface AgentPlan {
  /** Noun phrase for SAM 3.1, or null to keep the current matte untouched. */
  concept: string | null
  /** Keep the concept, or remove it and keep everything else. */
  action: "keep" | "remove"
  background:
    | { type: "transparent" }
    | { type: "color"; color: string }
  /** One line, in the user's terms, of what will happen. */
  summary: string
}

export const AGENT_MODELS = [
  { id: "muse-spark-1.3", label: "Muse Spark 1.3" },
  { id: "muse-wonder-1.0", label: "Muse Wonder" },
] as const

const SYSTEM = `You plan image cutout edits for a background-removal studio.
Reply with ONLY a JSON object, no prose, of this shape:
{"concept": string|null, "action": "keep"|"remove", "background": {"type":"transparent"} | {"type":"color","color":"#rrggbb"}, "summary": string}

Rules:
- concept is ONE short noun phrase naming a CONCRETE visible thing ("dog", "red shoes"), or null when the request does not name an object. Never use generic words like "main subject", "subject", or "foreground" as the concept — when the user says "the main subject", look at the image and name the actual object you see.
- action "keep" isolates the concept; "remove" deletes the concept and keeps the rest.
- background defaults to transparent unless a colour/backdrop colour is asked for. "white background" -> {"type":"color","color":"#ffffff"}.
- summary is one short sentence describing the edit.`

/** Parse and validate a model reply into a plan. Pure; tested. */
export function parsePlan(text: string): AgentPlan {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
  const raw = JSON.parse(cleaned)

  const concept =
    typeof raw?.concept === "string" && raw.concept.trim() ? raw.concept.trim() : null
  const action = raw?.action === "remove" ? "remove" : "keep"

  let background: AgentPlan["background"] = { type: "transparent" }
  if (raw?.background?.type === "color") {
    const color = String(raw.background.color ?? "")
    background = {
      type: "color",
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ffffff",
    }
  }

  return {
    concept,
    action,
    background,
    summary: typeof raw?.summary === "string" ? raw.summary : "Edit planned.",
  }
}

export async function planCommand(
  command: string,
  key: string,
  model: string = "muse-spark-1.3",
  /** Downscaled copy so Muse can name the actual subject. Caller discloses the send. */
  imageDataUrl?: string
): Promise<AgentPlan> {
  const userContent = imageDataUrl
    ? [
        { type: "text", text: command },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ]
    : command

  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
    }),
  })

  if (!res.ok) {
    let message = `Muse returned HTTP ${res.status}.`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const body: any = await res.json()
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("Muse returned no plan.")
  try {
    return parsePlan(content)
  } catch {
    throw new Error("Muse's plan was not valid JSON. Try rephrasing.")
  }
}

// ─── Camera: one sentence picks the live background ───

export interface CameraPlan {
  mode: "transparent" | "color" | "gradient" | "blur" | "image"
  color: string | null
  gradient: "dark" | "sunset" | "ocean" | "cyberpunk" | "light" | null
  blur: number | null
  /** A scene description for Muse Image when mode is "image". */
  scene: string | null
  summary: string
}

const CAMERA_SYSTEM = `You choose the live background for a webcam cutout.
Reply with ONLY a JSON object, no prose:
{"mode":"transparent"|"color"|"gradient"|"blur"|"image","color":"#rrggbb"|null,"gradient":"dark"|"sunset"|"ocean"|"cyberpunk"|"light"|null,"blur":number|null,"scene":string|null,"summary":string}

Rules:
- "blur" or "soften the background" -> mode "blur", blur 2-40 (default 16).
- A plain colour -> mode "color" with its hex.
- A named look (sunset, ocean, cyberpunk, dark studio, light) -> mode "gradient" with that gradient.
- A place or scene ("a beach", "cozy home office") -> mode "image" and scene = a short, concrete description of an empty scene.
- "transparent" only when the user asks to remove the background entirely.
- summary is one short sentence describing the change.`

/** Parse and validate a camera plan. Pure; tested. */
export function parseCameraPlan(text: string): CameraPlan {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
  const raw = JSON.parse(cleaned)

  const modes = ["transparent", "color", "gradient", "blur", "image"] as const
  const mode = (modes as readonly string[]).includes(raw?.mode) ? raw.mode : "blur"
  const color = typeof raw?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : null
  const gradients = ["dark", "sunset", "ocean", "cyberpunk", "light"] as const
  const gradient = (gradients as readonly string[]).includes(raw?.gradient) ? raw.gradient : null
  const blurNum = Number(raw?.blur)
  const blur = Number.isFinite(blurNum) ? Math.min(40, Math.max(2, Math.round(blurNum))) : null
  const scene = typeof raw?.scene === "string" && raw.scene.trim() ? raw.scene.trim() : null

  return {
    // A mode that needs a value it did not get degrades to something that works.
    mode:
      mode === "image" && !scene ? "blur" : mode === "color" && !color ? "blur" : mode,
    color,
    gradient: mode === "gradient" ? (gradient ?? "dark") : gradient,
    blur,
    scene,
    summary: typeof raw?.summary === "string" ? raw.summary : "Background changed.",
  }
}

export async function planCameraCommand(
  command: string,
  key: string,
  model: string = "muse-spark-1.3"
): Promise<CameraPlan> {
  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CAMERA_SYSTEM },
        { role: "user", content: command },
      ],
    }),
  })
  if (!res.ok) {
    let message = `Muse returned HTTP ${res.status}.`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }
  const body: any = await res.json()
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("Muse returned no plan.")
  try {
    return parseCameraPlan(content)
  } catch {
    throw new Error("Muse's plan was not valid JSON. Try rephrasing.")
  }
}

/** Muse Image size string for a source aspect ratio. Aspect only, per the API. */
export function backdropSizeFor(width: number, height: number): string {
  const aspect = width / Math.max(1, height)
  if (aspect > 1.2) return "1536x1024"
  if (aspect < 0.83) return "1024x1536"
  return "1024x1024"
}

/**
 * Generate a backdrop scene with Muse Image ($0.01 flat).
 *
 * Only the text prompt leaves the device — the subject photo is not sent;
 * the cutout is composited locally over the returned scene.
 */
export async function generateBackdrop(
  prompt: string,
  key: string,
  width: number,
  height: number
): Promise<string> {
  const res = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "muse-image-1.0",
      prompt: `${prompt}. Empty scene, no people, no text, suitable as a photo backdrop.`,
      size: backdropSizeFor(width, height),
      output_format: "webp",
      reasoning_strength: "low",
      tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false },
    }),
  })

  if (!res.ok) {
    let message = `Muse Image returned HTTP ${res.status}.`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const body: any = await res.json()
  const b64 = body?.data?.[0]?.b64_json
  if (typeof b64 !== "string") throw new Error("Muse Image returned no image.")
  const format = body?.output_format === "png" ? "png" : body?.output_format === "jpeg" ? "jpeg" : "webp"
  return `data:image/${format};base64,${b64}`
}

/**
 * Transcribe a short voice command with Muse Voice Transcribe.
 *
 * Expects the WAV from src/lib/wav.ts. Multipart with a `request` JSON part
 * and an `audio` part — both are required by the endpoint.
 */
export async function transcribeCommand(wav: Blob, key: string): Promise<string> {
  const form = new FormData()
  form.append(
    "request",
    new Blob(
      [
        JSON.stringify({
          mode: "PUSH_TO_TALK",
          model: "muse-voice-transcribe-1.0",
          audioEncoding: "WAV",
        }),
      ],
      { type: "application/json" }
    )
  )
  form.append("audio", wav, "command.wav")

  const res = await fetch("https://api.meta.ai/v1/asr/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${key.trim()}` },
    body: form,
  })

  if (!res.ok) {
    let message = `Transcription returned HTTP ${res.status}.`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const body: any = await res.json()
  const text = typeof body?.transcript === "string" ? body.transcript.trim() : ""
  if (!text) throw new Error("Heard nothing — try again, closer to the mic.")
  return text.replace(/\.\.+$/, ".")
}

/**
 * Vision QA of a product cutout (on white) with Muse Spark.
 *
 * Judges the PHOTO, never a person: centring, edge cleanliness, lighting.
 * Returns one short line of flags, or "OK".
 */
export async function qaProductPhoto(
  imageDataUrl: string,
  key: string
): Promise<string> {
  const res = await fetch("https://api.meta.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "muse-spark-1.3",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You QA product photos for a marketplace listing. Reply with ONE short line: either \"OK\" or a comma list of at most three flags chosen from: off-centre, edge halo, harsh shadow, blurry, dark, cropped subject, noisy background. Judge only the photo, never any person in it.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "QA this product cutout." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    if (res.status === 401) throw new Error("Meta rejected that key (401).")
    throw new Error(`QA returned HTTP ${res.status}.`)
  }
  const body: any = await res.json()
  const text = body?.choices?.[0]?.message?.content
  return typeof text === "string" && text.trim() ? text.trim() : "OK"
}

/** "the dog" -> "dog": SAM concept prompts work best as bare noun phrases. */
export function simplifyConcept(concept: string): string {
  return concept.replace(/^(the|a|an)\s+/i, "").trim()
}

/** Measured check of a finished mask, shown to the user as the agent's proof. */
export function verifyMask(mask: Uint8Array): { coverage: number; softEdge: number } {
  let kept = 0
  let soft = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 127) kept++
    if (mask[i] > 0 && mask[i] < 255) soft++
  }
  const total = mask.length || 1
  return {
    coverage: Math.round((kept / total) * 1000) / 10,
    softEdge: Math.round((soft / total) * 1000) / 10,
  }
}
