import * as React from "react"

import { blobToWav16k } from "@/lib/wav"
import { transcribeCommand } from "@/lib/muse"
import { getMetaKey } from "@/lib/meta"
import { recordRun } from "@/lib/run-info"

/**
 * Voice command: record, resample to 16 kHz WAV, Muse Voice Transcribe, then
 * hand the text to the page's agent. Tap once to start, again to send. Only
 * the audio clip leaves the device, and only to api.meta.ai.
 */
export function useVoiceCommand({
  onTranscript,
  onStatus,
}: {
  onTranscript: (text: string) => void | Promise<void>
  onStatus: (message: string) => void
}) {
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = React.useState(false)

  // Release the mic if the page goes away mid-recording.
  React.useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((t) => t.stop()), [])

  const toggle = React.useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    const key = getMetaKey()
    if (!key) {
      onStatus("Add your Meta API key in the AI tab to use voice commands.")
      return
    }
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
        onStatus("Transcribing with Muse Voice…")
        const t0 = performance.now()
        try {
          const wav = await blobToWav16k(new Blob(chunks, { type: recorder.mimeType }))
          const text = await transcribeCommand(wav, key)
          recordRun({
            action: "Voice command",
            model: "Muse Voice Transcribe",
            where: "cloud",
            ms: performance.now() - t0,
            cost: 0,
            detail: `"${text}"`,
          })
          await onTranscript(text)
        } catch (err: any) {
          onStatus(err?.message || "Voice command failed.")
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      onStatus("Listening… tap the mic again to send.")
    } catch {
      onStatus("Microphone unavailable — check the browser permission.")
    }
  }, [recording, onStatus, onTranscript])

  return { recording, toggle }
}
