// Minimal WAV encoding for Muse Voice Transcribe.
//
// The transcribe endpoint only accepts RIFF/WAVE, mono, 16-bit PCM at 16 or
// 24 kHz. Browsers record webm/opus, so recorded audio is decoded, mixed to
// mono, resampled, and re-encoded here. Pure byte work; tested.

/** Encode mono Float32 samples (-1..1) as a 16-bit PCM WAV blob. */
export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

/** Decode any browser-recorded blob, mix to mono, resample, encode as WAV. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const raw = await blob.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const decoded = await ctx.decodeAudioData(raw)

  const frames = Math.max(1, Math.ceil(decoded.duration * 16000))
  const offline = new OfflineAudioContext(1, frames, 16000)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()

  return encodeWavMono(rendered.getChannelData(0), 16000)
}
