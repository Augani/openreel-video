# Pro audio

Wave 14: limiter, low-pass, live ducking, stems. Everything here runs through the
same code in the live preview and the offline mixdown/export, and every edit is
an ordinary undoable action.

## Brickwall Limiter and Low-Pass Filter

Two effects in the repair family (`repair-dsp.ts`: one sample-streaming processor
class, run in the AudioWorklet for preview and in the OfflineAudioContext worklet
for export, so the samples match):

| Effect | Params | Notes |
| --- | --- | --- |
| `brickwallLimiter` | ceiling -24..0 dBTP, release 10..1000 ms | Lookahead (fixed 5 ms, reported to plugin delay compensation), channel-linked, 8x oversampled peak detection plus the samples themselves. The gain is the sliding minimum over the lookahead window, smoothed by a moving average, so the peak is attenuated before it arrives. The release smoother only slows recovery and can never let a peak through. It aims 0.25 dB under the ceiling to absorb the detector's error near Nyquist. |
| `lowPass` | cutoff 100..20000 Hz, slope 12/24/36/48 dB/oct | Butterworth cascade of RBJ second-order sections, zero latency. |

Both are available as clip effects (Inspector > Audio > Add effect) and as
track / bus / master rack effects (Audio Mixer > rack). Essential Sound uses
them where Premiere does: SFX gets the Brickwall Limiter, Ambience gets the
Low-Pass Filter.

Correctness is measured in `repair/brickwall-limiter.test.ts`: on a hot stereo
signal (inter-sample peaks at fs/4, noise, full-scale clicks, square wave, a
50x impulse) the true peak of the output never exceeds the ceiling, measured by
the BS.1770 4x meter and by an independent 16x windowed-sinc reference, for
ceilings of -1, -3, -6 and -12 dBTP. The e2e `audio-stems-export.spec.ts`
repeats the check on the real export mixdown.

## Live ducking

Ducking is no longer a one-shot set of baked keyframes. A clip carries
`metadata.liveDucking` (amount, attack, release, hold; action
`audio/setLiveDucking`, undoable). The dip is computed from the Dialogue clips
(clips tagged Dialogue, or on a track whose role is Dialogue, on an unmuted
track) every time the clip's volume lane is resolved:
`resolveClipVolumeAutomation` is used by the live preview, the offline mixdown,
export, stems and compound clips, so all of them agree. Move, trim, add, delete
or mute a dialogue clip and every ducked clip follows with no re-analysis; the
preview re-schedules itself (`services/live-ducking-sync.ts`).

* The activity is the extent of the dialogue clips, not the speech level inside
  them. Pauses inside one clip are not ducked; the gap between two dialogue
  clips is, unless it is shorter than the hold or the attack plus release.
* A split clip keeps `liveDucking` and does not bake the dip into its fragments.
* Projects saved by the previous version keep their baked keyframes and the
  Essential Sound "Duck" switch restores them as before; turning it on again
  switches to the live duck.

## Stems

Export dialog > Custom Settings > Audio stems. Split by:

* **Tracks**: one WAV per unmuted track that carries audio. The track's own
  clips, effects, rack and fader, before buses and the master rack.
* **Audio type**: one WAV per Essential Sound type in use (Dialogue, Music, SFX,
  Ambience, and Untyped). Each clip still goes through its own track rack and
  bus routing, before the master rack.
* **Buses**: unchanged (the existing bus stems).

The job is a zip of 16 or 24-bit WAVs in the export queue; all stems cover the
whole timeline and are the same length. Live ducking is frozen against the full
timeline before a stem isolates its clips, so the Music stem is ducked even
though the dialogue clip is not in it.

Stems do not include the master rack (limiter, loudness normalisation) or
hosted plugins on the master; they are the pre-master parts of the mix.

## Master bus order

Tracks and buses sum, then hosted master plugins (Audio Unit / VST3, see
[audio-plugin-hosting.md](audio-plugin-hosting.md)), then the master fader, the
built-in master rack and, for an export with a loudness target, loudness
normalisation and the true-peak limiter. This is Premiere's order (master track
effects, then the export-time normalisation): the target is measured on the mix
after the plugins and the ceiling holds whatever a plugin does.

## 5.1 surround

Wave 15. A sequence can be **Stereo** (default, unchanged) or **5.1**. Everything
is in the Audio Mixer and the Inspector; every edit is an ordinary undoable action.

### Layout

Audio Mixer > **Sequence audio** selects Stereo or 5.1 Surround. It is the
`project/updateSettings` action with `{ channelLayout, channels }` (`channels` is
6 for 5.1), so one Undo restores both, and each sequence has its own layout
(`settings.channelLayout`, absent = stereo). Channel order everywhere is
**L R C LFE Ls Rs** (Web Audio / SMPTE).

### What changes in a 5.1 sequence

* **Mixdown** (`AudioEngine.renderAudio`, used by export, stems, loudness): the
  OfflineAudioContext has 6 channels. A stereo sequence builds exactly the same
  node graph as before (same samples); none of the surround code runs.
* **Surround panner** (`audio/surround.ts`, `SurroundPanner.tsx`): per **track**
  (Audio Mixer strip) and per **clip** (Inspector > Audio > Surround pan; a clip
  without its own position follows its track, "Follow track" clears it). Position
  is a 2D room (x left/right, y rear/front) with constant-power gains: front/back
  by sin/cos of y, then an L/R pan law, **divergence** moving a share of the front
  image into C (fading out towards the hard left/right edges), and an **LFE send**.
  The six speaker feeds always sum to unit power (unit tests sweep the room). The
  action is `audio/setSurroundPan` (`{ clipId | trackId, pan | null }`); a puck
  drag coalesces into one undo step.
* **Routing matrices** (`sourceToSurroundMatrix`, wired as splitter -> gain ->
  merger with discrete channel interpretation, so no implicit Web Audio mix rule
  touches the signal): mono is panned; a stereo source is a pair (L at x-1, R at
  x+1, so the default is the identity L->L, R->R); **5.1 sources map to their own
  channels** and are not positioned (5.0 and quad map to the matching speakers).
  Sources keep their channels when a 5.1 sequence decodes them (ffmpeg `-ac N`
  up to 6, desktop sidecar and ffmpeg.wasm; streaming decode up to 6).
* **Racks and buses** (`createRackBus`): the track, bus and master effect racks are
  one **six-channel rack**. EQ, gain, delay and the limiter's hard clip process
  every channel natively; the Compressor, Limiter, repair effects (the Brickwall
  Limiter, Gate and DeEss detect on the loudest channel) and reverb run on all six
  at once: one detector and one gain for the compressor and limiter, one mono
  convolver per channel for reverb (`multichannel-fx.ts`). The stereo pan stage
  becomes a unity gain (position lives on the panner).
* **Clip-level and legacy track effect chains**: built for the channel count that
  flows through them (the clip's own channels, six on the track chain). Gain, EQ,
  delay and noise reduction are channel-agnostic; the compressor becomes the
  **linked N-channel compressor** (`LinkedCompressorProcessor`, an AudioWorklet
  processor with the same 6 ms lookahead as the Web Audio compressor, so delay
  compensation is unchanged), reverb uses per-channel convolvers, repair effects
  run six channels linked. A 5.1 clip is never folded to stereo. Stereo and mono
  clips keep the exact native nodes they always had, and the offline mixdown
  (`AudioEffectsEngine.applyEffectChain`) builds the same chain from the clip
  buffer's channel count, so preview and export agree.
* **Preview**: the live graph builds the same six-channel graph
  (`RealtimeAudioGraph.setChannelLayout`, driven by `audio-rack-sync.ts`) and the
  device output monitors it through the Web Audio 5.1 -> stereo down-mix (ITU-R
  BS.775: L + 0.707 C + 0.707 Ls, LFE omitted). Switching the layout while playing
  stops the sources, rebuilds the topology, rewinds the scheduling horizon and
  puts the sounding clips straight back (they join at the right media offset).
  The Preview's ffmpeg fallback decode (`extractAudioWav`) keeps the source's own
  channels (up to six, from the media metadata) in a 5.1 sequence.
* **Meters**: the mixer's master, bus and track meters read the live graph
  (`createMixerSignalMeter`): two bars (L R) in a stereo sequence, **six bars
  labelled L R C LFE Ls Rs** in a 5.1 one, each with its own peak and RMS from a
  discrete six-channel analyser tap. The tap rebinds when the layout changes.
* **Loudness**: the offline analysis and the export normaliser already meter all
  six channels with the BS.1770 weights (L R C 1.0, LFE 0, Ls Rs 1.41), and the
  live meter now taps six channels in a 5.1 sequence. `e2e/surround-51.spec.ts`
  measures the same tone +1.5 dB louder in Ls than in L.

### Export

* **MP4 / MOV**: six-channel **AAC** (384 kbps minimum). `ffprobe` reports
  `channels=6, channel_layout=5.1`; MOV also gets the QuickTime `chan` atom
  (MPEG 5.1 A, L R C LFE Ls Rs). Chrome's WebCodecs AAC encoder reads channels in
  bitstream order (C L R Ls Rs LFE) and does not translate from the mix order, so
  `aac-surround-order.ts` measures the browser's behaviour once (encode six tones,
  decode them) and reorders the buffers fed to the encoder. The e2e decodes the
  exported files with ffmpeg and checks a clean diagonal per-channel energy matrix.
* **WebM** cannot carry 5.1 (no six-channel Opus encoder in WebCodecs): the dialog
  says so and the export is refused with the same message.
* Export dialog > Custom > Audio > **Audio channels**: "5.1 surround" (default)
  or "Stereo downmix" (the sequence is mixed in 5.1, then folded down with the
  BS.775 coefficients). Preset exports follow the sequence. Audio-only WAV export
  of a 5.1 sequence is a six-channel WAVE_FORMAT_EXTENSIBLE file; other audio-only
  formats get the stereo downmix.
* **Stems** (tracks / audio type / buses) of a 5.1 sequence are six-channel WAVs
  with the 5.1 speaker mask (`ffprobe`: 6 channels, layout 5.1).
* Desktop (ffmpeg sidecar): the mixdown is written as a six-channel WAV that
  ffmpeg treats as 5.1 and encodes to AAC.

## Not done

* **Monitoring**: the preview does not output six discrete channels to a
  multichannel audio device; it monitors through the stereo down-mix (the meters
  show all six). The stereo-only DeClick / DeClip / DeReverb repair effects still
  process each channel on its own (they have no cross-channel state to link).
* 6-channel Opus export is not available. 5.1 delivery is AAC in MP4 / MOV, PCM WAV,
  and Dolby Digital (AC-3) / Digital Plus (E-AC-3) in MP4 / MOV / MKV (desktop) or
  raw `.ac3` / `.ec3` (desktop and web); see docs/PREMIERE-GAPS.md.
* 7.1 and other layouts. Sources wider than six channels are folded to 5.1 by ffmpeg.
* The legacy clip "pan" effect and the stereo track pan are ignored in a 5.1
  sequence (the surround panner replaces them); they come back with Stereo.
* The ffmpeg.wasm / sidecar decode fallback for sources the browser cannot stream
  keeps the source's own channel count only when the media metadata reports it.
* Ducking responds to dialogue clip presence, not to speech level.
* The limiter's lookahead is fixed at 5 ms (changing it live would change the
  plugin delay compensation).
