import type { Page } from "@playwright/test";

/**
 * Chrome's fake audio capture device (--use-fake-device-for-media-stream) answers getUserMedia in under a
 * second on Linux CI, but on a macOS host whose microphone privacy (TCC) state is unresolved for Chrome the
 * audio request never settles (video is unaffected; enumerateDevices still lists the fake inputs). This
 * init script keeps the fake device first and falls back to a synthetic tone stream (a sine written through a
 * MediaStreamTrackGenerator) only when the real request has not settled after `FALLBACK_MS`, so the
 * recorder is exercised end to end on either host. `window.__voiceOverFakeMic` records which one answered.
 */
export function installFakeMicFallback(page: Page, fallbackMs = 4000): Promise<void> {
  // fallbackMs <= 0 is strict mode: only Chrome's real fake device may answer (CI sets VO_STRICT_FAKE_MIC).
  return page.addInitScript((ms: number) => {
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) return;
    const original = devices.getUserMedia.bind(devices);
    // Every audio request is logged so specs can assert which device a take actually opened.
    const calls: Array<{ deviceId: string | null; echoCancellation: boolean | null }> = [];
    (window as unknown as { __voiceOverGum: typeof calls }).__voiceOverGum = calls;
    let synthetic = false;
    // A MediaStreamTrackGenerator needs no AudioContext, which can take many seconds to open on a host whose
    // audio device is wedged (the same condition that stalls the real fake-device request).
    const tone = (): MediaStream => {
      const Generator = (window as unknown as { MediaStreamTrackGenerator?: new (init: { kind: "audio" }) => MediaStreamTrack & { writable: WritableStream } }).MediaStreamTrackGenerator;
      const AudioDataCtor = (window as unknown as { AudioData?: new (init: Record<string, unknown>) => unknown }).AudioData;
      if (Generator && AudioDataCtor) {
        const track = new Generator({ kind: "audio" });
        const writer = track.writable.getWriter();
        const rate = 48000;
        const frames = 960;
        let sampleIndex = 0;
        setInterval(() => {
          const samples = new Float32Array(frames);
          for (let i = 0; i < frames; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * (sampleIndex + i)) / rate);
          const data = new AudioDataCtor({ format: "f32-planar", sampleRate: rate, numberOfFrames: frames, numberOfChannels: 1, timestamp: Math.round((sampleIndex / rate) * 1e6), data: samples });
          sampleIndex += frames;
          void writer.write(data).catch(() => undefined);
        }, 20);
        return new MediaStream([track]);
      }
      const context = new AudioContext();
      void context.resume();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 220;
      const gain = context.createGain();
      gain.gain.value = 0.3;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      return destination.stream;
    };
    (window as unknown as { __voiceOverFakeMic: string }).__voiceOverFakeMic = "chrome-fake-device";
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (!constraints?.audio || constraints.video) return original(constraints);
      const audio = constraints.audio === true ? {} : (constraints.audio as MediaTrackConstraints);
      const wanted = audio.deviceId;
      calls.push({
        deviceId: wanted ? (typeof wanted === "string" ? wanted : Array.isArray(wanted) ? (wanted[0] ?? null) : ((wanted as ConstrainDOMStringParameters).exact as string | undefined) ?? null) : null,
        echoCancellation: typeof audio.echoCancellation === "boolean" ? audio.echoCancellation : null,
      });
      if (ms <= 0) return original(constraints);
      if (synthetic) return tone();
      const real = original(constraints);
      const settled = await Promise.race([
        real.then(
          (stream) => ({ stream }),
          (error: unknown) => ({ error }),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
      ]);
      if (settled && "stream" in settled) return settled.stream;
      if (settled && "error" in settled) throw settled.error;
      synthetic = true;
      (window as unknown as { __voiceOverFakeMic: string }).__voiceOverFakeMic = "synthetic-tone";
      return tone();
    };
  }, fallbackMs);
}
