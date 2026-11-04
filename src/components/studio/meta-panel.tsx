import * as React from "react"
import { KeyRound, Mic, ScanSearch, ShieldCheck, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStudio } from "./studio-context"
import {
  clearMetaKey,
  getMetaKey,
  keyFingerprint,
  metaKeyRemembered,
  setMetaKey,
  validateMetaKey,
} from "@/lib/meta"
import { AGENT_MODELS, generateBackdrop, planCommand, transcribeCommand } from "@/lib/muse"
import { blobToWav16k } from "@/lib/wav"
import { recordRun } from "@/lib/run-info"
import { addGroundingStatusListener } from "@/lib/grounding"

// SAM 3.1 text selection + BYOK key management.
//
// The key is the user's own Meta Model API key. It is held in sessionStorage
// (or localStorage only on explicit opt-in) and sent only to api.meta.ai.
// Nothing here talks to a server of ours — there isn't one.

import { LAYER_COLORS } from "@/lib/meta"

const AGENT_RECIPES = [
  { label: "Product on white", command: "keep the main product on a pure white background" },
  { label: "Isolate subject", command: "keep the main subject, transparent background" },
  { label: "Remove subject", command: "remove the main subject and keep everything else" },
]

export function MetaPanel() {
  const studio = useStudio()
  const [keyInput, setKeyInput] = React.useState("")
  const [remember, setRemember] = React.useState(metaKeyRemembered())
  const [storedKey, setStoredKey] = React.useState<string | null>(() => getMetaKey())
  const [keyStatus, setKeyStatus] = React.useState<string | null>(null)
  const [validating, setValidating] = React.useState(false)
  const [prompt, setPrompt] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)
  const [samObjects, setSamObjects] = React.useState<
    Array<{ id: string; confidence?: number; coverage: number }>
  >([])
  const [command, setCommand] = React.useState("")
  const [agentModel, setAgentModel] = React.useState<string>(AGENT_MODELS[0].id)
  const [agentBusy, setAgentBusy] = React.useState(false)
  const [trace, setTrace] = React.useState<string[]>([])
  const [backdropPrompt, setBackdropPrompt] = React.useState("")
  const [backdropBusy, setBackdropBusy] = React.useState(false)
  const [backdropStatus, setBackdropStatus] = React.useState<string | null>(null)

  // Slow cloud calls need a moving number, not a frozen spinner — the same
  // lesson as the model-load bar. One timer covers whichever is running.
  const anyBusy = busy || agentBusy || backdropBusy
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    if (!anyBusy) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [anyBusy])

  const saveKey = async () => {
    const key = keyInput.trim()
    if (!key) return
    setValidating(true)
    setKeyStatus("checking key…")
    const v = await validateMetaKey(key)
    setValidating(false)
    if (!v.ok) {
      setKeyStatus(v.error || "That key did not validate.")
      return
    }
    setMetaKey(key, remember)
    setStoredKey(key)
    setKeyInput("")
    const sam = v.models.includes("sam-3.1")
    setKeyStatus(
      sam
        ? `key accepted ${keyFingerprint(key)} · sam-3.1 available`
        : `key accepted ${keyFingerprint(key)} · ${v.models.length} models (sam-3.1 not listed)`
    )
  }

  const forgetKey = () => {
    clearMetaKey()
    setStoredKey(null)
    setKeyStatus(null)
    setResult(null)
  }

  const runBackdrop = async () => {
    const key = storedKey || getMetaKey()
    if (!key || !backdropPrompt.trim() || backdropBusy) return
    setBackdropBusy(true)
    setBackdropStatus("Generating scene with Muse Image ($0.01)…")
    const backdropT0 = performance.now()
    try {
      // Aspect from the live canvas so the scene matches the frame.
      const cv = document.querySelector<HTMLCanvasElement>("#cv")
      const dataUrl = await generateBackdrop(
        backdropPrompt.trim(),
        key,
        cv?.width ?? 1024,
        cv?.height ?? 1024
      )
      studio.setControls((c) => ({ ...c, mode: "image", backdropImage: dataUrl }))
      recordRun({
        action: `Backdrop: "${backdropPrompt.trim()}"`,
        model: "Muse Image",
        where: "cloud",
        ms: performance.now() - backdropT0,
        cost: 0.01,
      })
      setBackdropStatus("Backdrop applied — your photo was never sent, only the text.")
    } catch (err: any) {
      setBackdropStatus(err?.message || "Backdrop generation failed.")
    } finally {
      setBackdropBusy(false)
    }
  }

  const runAgent = async (spoken?: string) => {
    const key = storedKey || getMetaKey()
    const text = (spoken ?? command).trim()
    if (!key || !text || agentBusy) return
    setAgentBusy(true)
    setTrace([spoken ? `Heard: "${text}"` : "Asking Muse for a plan…"])
    try {
      const plan = await planCommand(text, key, agentModel)
      setTrace([`Plan: ${plan.summary}`, "Executing locally…"])
      const steps = await studio.onAgentPlan(plan)
      setTrace(spoken ? [`Heard: "${text}"`, ...steps] : steps)
    } catch (err: any) {
      setTrace([err?.message || "Agent failed."])
    } finally {
      setAgentBusy(false)
    }
  }

  // Voice command: record -> WAV -> Muse Voice Transcribe -> agent.
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = React.useState(false)

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    const key = storedKey || getMetaKey()
    if (!key) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        setTrace(["Transcribing with Muse Voice…"])
        try {
          const wav = await blobToWav16k(new Blob(chunks, { type: recorder.mimeType }))
          const text = await transcribeCommand(wav, key)
          setCommand(text)
          await runAgent(text)
        } catch (err: any) {
          setTrace([err?.message || "Voice command failed."])
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setTrace(["Listening… tap the mic again to send."])
    } catch {
      setTrace(["Microphone unavailable — check the browser permission."])
    }
  }

  // Offline text select (Grounding DINO, 151 MiB opt-in download).
  const [offlinePrompt, setOfflinePrompt] = React.useState("")
  const [offlineBusy, setOfflineBusy] = React.useState(false)
  const [offlineStatus, setOfflineStatus] = React.useState<string | null>(null)
  const [groundingPct, setGroundingPct] = React.useState<number | null>(null)

  React.useEffect(
    () =>
      addGroundingStatusListener((s) => {
        if (s.kind === "loading") setGroundingPct(s.percent)
        else if (s.kind === "error") setOfflineStatus(s.message)
        else if (s.kind === "ready") setGroundingPct(null)
      }),
    []
  )

  const runOffline = async () => {
    if (!offlinePrompt.trim() || offlineBusy) return
    setOfflineBusy(true)
    setOfflineStatus("Finding boxes locally (first run downloads 151 MiB)…")
    const offlineT0 = performance.now()
    try {
      const out = await studio.onOfflineTextSelect(offlinePrompt.trim())
      recordRun({
        action: `Offline text select "${offlinePrompt.trim()}"`,
        model: "Grounding DINO Tiny + SlimSAM",
        where: "device-gpu",
        ms: performance.now() - offlineT0,
        cost: 0,
        detail: `${out.count} box(es)`,
      })
      setOfflineStatus(
        out.count === 0
          ? `No "${offlinePrompt.trim()}" found locally. With a Meta key, SAM 3.1 is much stronger.`
          : `Found ${out.count} box(es) — masks proposed from their centres. Review, then Apply.`
      )
    } catch (err: any) {
      setOfflineStatus(err?.message || "Offline select failed.")
    } finally {
      setOfflineBusy(false)
    }
  }

  const runPrompt = async () => {
    const key = storedKey || getMetaKey()
    if (!key || !prompt.trim() || busy) return
    setBusy(true)
    setResult("sending a 1024px copy to SAM 3.1…")
    const t0 = performance.now()
    try {
      const out = await studio.onTextSelect(prompt.trim())
      recordRun({
        action: `SAM text select "${prompt.trim()}"`,
        model: "SAM 3.1",
        where: "cloud",
        ms: performance.now() - t0,
        cost: 0.0025,
        detail: `${out.count} object(s)`,
      })
      setSamObjects(out.objects)
      setResult(
        out.count === 0
          ? `SAM 3.1 found no "${prompt.trim()}". Try a shorter noun phrase.`
          : `SAM 3.1 found ${out.count} ${out.count === 1 ? "object" : "objects"} — review the tint, then Apply.`
      )
    } catch (err: any) {
      setResult(err?.message || "Text selection failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="panel-meta" className="pt-3 space-y-2.5 scroll-mt-4">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Select by text · SAM 3.1
        </label>
        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded text-muted-foreground bg-hover/60">
          Meta API
        </span>
      </div>

      {!storedKey ? (
        <>
          <div className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveKey()}
              placeholder="Paste your Meta Model API key"
              aria-label="Meta Model API key"
              autoComplete="off"
              className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
            />
            <Button
              size="compact"
              variant="primary"
              disabled={!keyInput.trim() || validating}
              onClick={() => void saveKey()}
              className="h-7 text-[11px]"
            >
              {validating ? "Checking…" : "Use key"}
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-3 accent-current"
            />
            Remember on this device (otherwise it dies with the tab)
          </label>

          <div className="space-y-1.5 pt-1.5 border-t border-border/40">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              No key? Offline text select
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={offlinePrompt}
                onChange={(e) => setOfflinePrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runOffline()}
                placeholder='Try "dog" — runs Grounding DINO locally'
                aria-label="Object to find offline"
                disabled={!studio.hasCutout || offlineBusy}
                className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
              />
              <Button
                size="compact"
                variant="secondary"
                disabled={!offlinePrompt.trim() || !studio.hasCutout || offlineBusy}
                onClick={() => void runOffline()}
                className="h-7 text-[11px]"
              >
                {offlineBusy ? "…" : "Find"}
              </Button>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Experimental: a one-time 151 MiB download (Grounding DINO,
              Apache-2.0) finds boxes offline; SlimSAM makes the masks.
              SAM 3.1 with a key is faster and far more accurate.
              {groundingPct !== null ? ` Downloading ${groundingPct}%.` : ""}
            </p>
            {offlineStatus && (
              <p className="text-[11px] leading-snug text-muted-foreground">{offlineStatus}</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] text-ok min-w-0">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span className="truncate">
                Your key {keyFingerprint(storedKey)} · browser → Meta only
              </span>
            </span>
            <button
              type="button"
              onClick={forgetKey}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground shrink-0"
            >
              Forget
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runPrompt()}
              placeholder='Try "red hat" or "the dog"'
              aria-label="Object to select, as a noun phrase"
              disabled={!studio.hasCutout || busy}
              className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
            />
            <Button
              size="compact"
              variant="primary"
              disabled={!prompt.trim() || !studio.hasCutout || busy}
              onClick={() => void runPrompt()}
              className="h-7 text-[11px] gap-1"
            >
              <ScanSearch className="size-3.5" />
              {busy ? "…" : "Select"}
            </Button>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            One short noun phrase per search. Sends a 1024px copy (~$0.0025);
            the full-resolution image never leaves this device. Needs Refine
            on to apply the tint.
          </p>

          {samObjects.length >= 1 && (
            <div className="flex flex-wrap gap-1">
              {samObjects.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => studio.onSelectSamObject(o.id)}
                  className="flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-80"
                  title="Propose only this object"
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full shrink-0"
                    style={{ background: LAYER_COLORS[i % LAYER_COLORS.length] }}
                  />
                  #{i + 1} · {o.coverage === 0 ? "<0.1" : o.coverage}%
                  {o.confidence !== undefined ? ` · ${o.confidence.toFixed(2)}` : ""}
                </button>
              ))}
              {samObjects.length > 1 && (
                <span className="text-[10px] text-muted-foreground self-center">
                  tap one to isolate it
                </span>
              )}
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Agent · Muse
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runAgent()}
                placeholder='Try "keep the dog on white"'
                aria-label="Agent command"
                disabled={!studio.hasCutout || agentBusy}
                className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
              />
              <Button
                size="compact"
                variant={recording ? "primary" : "secondary"}
                disabled={!studio.hasCutout || agentBusy}
                onClick={() => void toggleRecording()}
                className="h-7 text-[11px]"
                title="Voice command (Muse Voice Transcribe)"
                aria-label={recording ? "Stop recording and send" : "Record a voice command"}
              >
                {recording ? <Square className="size-3" /> : <Mic className="size-3.5" />}
              </Button>
              <Button
                size="compact"
                variant="primary"
                disabled={!command.trim() || !studio.hasCutout || agentBusy}
                onClick={() => void runAgent()}
                className="h-7 text-[11px]"
              >
                {agentBusy ? "…" : "Run"}
              </Button>
            </div>
            <select
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              aria-label="Agent model"
              className="h-6 rounded-md bg-surface-3 px-1.5 text-[10px] text-muted-foreground outline-none"
            >
              {AGENT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              {AGENT_RECIPES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  onClick={() => setCommand(r.command)}
                  className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-80"
                >
                  {r.label}
                </button>
              ))}
            </div>
            {trace.length > 0 && (
              <ol className="space-y-0.5 rounded-md bg-surface-3/50 px-2 py-1.5">
                {trace.map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
                    <span
                      aria-hidden
                      className={
                        "mt-1 size-1.5 rounded-full shrink-0 " +
                        (step.startsWith("Verified")
                          ? "bg-ok"
                          : step.startsWith("Plan") || step.startsWith("Heard")
                            ? "bg-foreground"
                            : "bg-muted-foreground/50")
                      }
                    />
                    <span className={step.startsWith("Verified") ? "text-ok" : undefined}>
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {anyBusy && (
              <p className="text-[10px] font-mono text-muted-foreground">
                working… {elapsed}s
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Backdrop · Muse Image
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={backdropPrompt}
                onChange={(e) => setBackdropPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runBackdrop()}
                placeholder='Try "Tokyo street at golden hour"'
                aria-label="Backdrop scene description"
                disabled={!studio.hasCutout || backdropBusy}
                className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
              />
              <Button
                size="compact"
                variant="primary"
                disabled={!backdropPrompt.trim() || !studio.hasCutout || backdropBusy}
                onClick={() => void runBackdrop()}
                className="h-7 text-[11px]"
              >
                {backdropBusy ? "…" : "Create"}
              </Button>
            </div>
            {backdropStatus && (
              <p className="text-[10px] leading-snug text-muted-foreground">{backdropStatus}</p>
            )}
            {studio.controls.mode === "image" && studio.controls.backdropImage && (
              <div className="flex items-center gap-2">
                <img
                  src={studio.controls.backdropImage}
                  alt="Generated backdrop"
                  className="h-10 w-16 rounded-md object-cover shadow-surface-1"
                />
                <span className="text-[10px] leading-snug text-muted-foreground">
                  Generated scene, composited locally. Create again to re-roll.
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {keyStatus && (
        <p
          className={
            "text-[11px] font-mono " +
            (/reject|did not|returned/i.test(keyStatus) ? "text-danger" : "text-ok")
          }
        >
          {keyStatus}
        </p>
      )}
      {result && <p className="text-[11px] leading-snug text-muted-foreground">{result}</p>}
    </div>
  )
}
