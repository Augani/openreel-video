import type {
  SoundItem,
  SoundLibraryFilter,
  SoundAnalysis,
  BeatMarker,
  SoundCategory,
  MusicGenre,
  SFXCategory,
} from "../types/sound-library";
import { getSoundGenerator, type GeneratedSound } from "./sound-generator";

type SoundJob = () => Promise<GeneratedSound>;
const LOAD_CONCURRENCY = 3;

export class SoundLibraryEngine {
  private sounds: Map<string, SoundItem> = new Map();
  private soundBlobs: Map<string, Blob> = new Map();
  private audioContext: AudioContext | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private previewGain: GainNode | null = null;
  private previewRequest = 0;
  private previewClock: { soundId: string; startedAt: number; duration: number; offset: number; paused: boolean } | null = null;
  private previewBuffer: AudioBuffer | null = null;
  private previewEnded: (() => void) | undefined;
  private initialized = false;
  private loadTotals = { music: 0, sfx: 0 };
  private loadDone = { music: 0, sfx: 0 };
  private loadListeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.loadBuiltinSounds();
  }

  /** How many built-in sounds of a category are generated so far. */
  getLoadProgress(category: "music" | "sfx"): { done: number; total: number } {
    return { done: this.loadDone[category], total: this.loadTotals[category] };
  }

  /** Called after every sound is generated; returns an unsubscribe function. */
  onLoadProgress(listener: () => void): () => void {
    this.loadListeners.add(listener);
    return () => this.loadListeners.delete(listener);
  }

  private notifyLoad(): void {
    for (const listener of [...this.loadListeners]) listener();
  }

  async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  private async loadBuiltinSounds(): Promise<void> {
    if (this.initialized) return;

    const generator = getSoundGenerator();

    try {
      const sfxGenerators: SoundJob[] = [
        () => generator.generateWhoosh("sfx-whoosh-fast-1", "Fast Whoosh", 0.5, true),
        () => generator.generateWhoosh(
          "sfx-whoosh-slow-1",
          "Slow Whoosh",
          1.2,
          false,
        ),
        () => generator.generateWhoosh(
          "sfx-whoosh-medium-1",
          "Medium Swoosh",
          0.8,
          true,
        ),
        () => generator.generateImpact("sfx-impact-heavy-1", "Heavy Impact", true),
        () => generator.generateImpact("sfx-impact-light-1", "Light Hit", false),
        () => generator.generateImpact("sfx-impact-punch-1", "Punch", true),
        () => generator.generateClick("sfx-ui-click-1", "Click"),
        () => generator.generateClick("sfx-ui-tap-1", "Tap"),
        () => generator.generateNotification("sfx-ui-notification-1", "Notification"),
        () => generator.generateNotification("sfx-ui-alert-1", "Alert Ding"),
        () => generator.generateSuccess("sfx-ui-success-1", "Success Chime"),
        () => generator.generateSuccess("sfx-ui-complete-1", "Complete"),
        () => generator.generatePop("sfx-cartoon-pop-1", "Pop"),
        () => generator.generatePop("sfx-cartoon-bubble-1", "Bubble"),
        () => generator.generateBoing("sfx-cartoon-boing-1", "Boing"),
        () => generator.generateBoing("sfx-cartoon-spring-1", "Spring"),
        () => generator.generateGlitch("sfx-transition-glitch-1", "Glitch"),
        () => generator.generateGlitch("sfx-transition-digital-1", "Digital Error"),
        () => generator.generateRiser("sfx-transition-riser-1", "Riser"),
        () => generator.generateRiser("sfx-transition-buildup-1", "Build Up"),
        () => generator.generateLaser("sfx-scifi-laser-1", "Laser Blast"),
        () => generator.generateLaser("sfx-scifi-zap-1", "Zap"),
        () => generator.generatePowerUp("sfx-scifi-powerup-1", "Power Up"),
        () => generator.generatePowerUp("sfx-scifi-charge-1", "Charge"),
        () => generator.generateStinger("sfx-musical-stinger-1", "Logo Stinger", [
          "inspiring",
          "bright",
        ]),
        () => generator.generateStinger("sfx-musical-stinger-2", "Intro Sting", [
          "happy",
          "playful",
        ]),
        () => generator.generateCinematicHit("sfx-cinematic-hit-1", "Epic Hit"),
        () => generator.generateCinematicHit("sfx-cinematic-hit-2", "Trailer Impact"),
        () => generator.generateTypingSound("sfx-ui-typing-1", "Key Press"),
        () => generator.generateTypingSound("sfx-ui-typing-2", "Keyboard Click"),
        () => generator.generateErrorSound("sfx-ui-error-1", "Error Beep"),
        () => generator.generateErrorSound("sfx-ui-error-2", "Warning Tone"),
        () => generator.generateCountdown("sfx-ui-countdown-1", "Countdown Beeps"),
        () => generator.generateCountdown("sfx-ui-countdown-2", "Timer Beeps"),
      ];

      const musicGenerators: SoundJob[] = [
        () => generator.generateSimpleBeat(
          "music-electronic-beat-1",
          "Electronic Beat",
          128,
          "electronic",
          ["energetic", "happy"],
        ),
        () => generator.generateSimpleBeat(
          "music-hiphop-beat-1",
          "Hip-Hop Groove",
          90,
          "hip-hop",
          ["energetic"],
        ),
        () => generator.generateSimpleBeat(
          "music-pop-beat-1",
          "Pop Rhythm",
          110,
          "pop",
          ["happy", "playful"],
        ),
        () => generator.generateSimpleBeat(
          "music-lofi-beat-1",
          "Lo-Fi Chill",
          85,
          "lofi",
          ["calm", "nostalgic"],
        ),
        () => generator.generateSimpleBeat(
          "music-upbeat-beat-1",
          "Upbeat Energy",
          120,
          "upbeat",
          ["energetic", "inspiring"],
        ),
        () => generator.generateSimpleBeat(
          "music-corporate-beat-1",
          "Corporate",
          100,
          "corporate",
          ["inspiring", "bright"],
        ),
        () => generator.generateSimpleBeat(
          "music-trap-beat-1",
          "Trap Banger",
          140,
          "hip-hop",
          ["energetic", "dark"],
        ),
        () => generator.generateSimpleBeat(
          "music-house-beat-1",
          "House Groove",
          124,
          "electronic",
          ["energetic", "happy"],
        ),
        () => generator.generateSimpleBeat(
          "music-dance-beat-1",
          "Dance Floor",
          130,
          "electronic",
          ["energetic", "playful"],
        ),
        () => generator.generateSimpleBeat(
          "music-funk-beat-1",
          "Funky Fresh",
          105,
          "upbeat",
          ["happy", "playful"],
        ),
        () => generator.generateSimpleBeat(
          "music-edm-beat-1",
          "EDM Drop",
          150,
          "electronic",
          ["energetic"],
        ),
        () => generator.generateSimpleBeat(
          "music-party-beat-1",
          "Party Mode",
          128,
          "upbeat",
          ["energetic", "happy"],
        ),
        () => generator.generateSimpleBeat(
          "music-summer-beat-1",
          "Summer Vibes",
          115,
          "pop",
          ["happy", "bright"],
        ),
        () => generator.generateSimpleBeat(
          "music-club-beat-1",
          "Club Night",
          126,
          "electronic",
          ["energetic", "dark"],
        ),
        () => generator.generateAmbientPad(
          "music-ambient-pad-1",
          "Ambient Pad",
          "ambient",
          ["calm", "mysterious"],
        ),
        () => generator.generateAmbientPad(
          "music-cinematic-pad-1",
          "Cinematic Atmosphere",
          "cinematic",
          ["tense", "inspiring"],
        ),
        () => generator.generateAmbientPad(
          "music-dramatic-pad-1",
          "Dramatic Tension",
          "dramatic",
          ["tense", "dark"],
        ),
        () => generator.generateChordProgression(
          "music-pop-chords-1",
          "Pop Chord Progression",
          120,
          "pop",
          ["happy", "bright"],
          "pop",
        ),
        () => generator.generateChordProgression(
          "music-jazz-chords-1",
          "Jazz Chords",
          100,
          "jazz",
          ["calm", "nostalgic"],
          "jazz",
        ),
        () => generator.generateChordProgression(
          "music-lofi-chords-1",
          "Lo-Fi Chords",
          80,
          "lofi",
          ["calm", "nostalgic"],
          "lofi",
        ),
        () => generator.generateChordProgression(
          "music-cinematic-chords-1",
          "Cinematic Chords",
          90,
          "cinematic",
          ["tense", "inspiring"],
          "cinematic",
        ),
        () => generator.generateChordProgression(
          "music-electronic-chords-1",
          "Electronic Chords",
          128,
          "electronic",
          ["energetic", "dark"],
          "electronic",
        ),
        () => generator.generateChordProgression(
          "music-ambient-chords-1",
          "Ambient Chords",
          70,
          "ambient",
          ["calm", "mysterious"],
          "ambient",
        ),
        () => generator.generateChordProgression(
          "music-uplifting-chords-1",
          "Uplifting Anthem",
          138,
          "electronic",
          ["energetic", "inspiring"],
          "pop",
        ),
        () => generator.generateChordProgression(
          "music-future-chords-1",
          "Future Bass Chords",
          150,
          "electronic",
          ["energetic", "happy"],
          "electronic",
        ),
        () => generator.generateMelody(
          "music-pop-melody-1",
          "Pop Melody",
          120,
          "pop",
          ["happy", "playful"],
          "major",
        ),
        () => generator.generateMelody(
          "music-lofi-melody-1",
          "Lo-Fi Melody",
          85,
          "lofi",
          ["calm", "nostalgic"],
          "pentatonic",
        ),
        () => generator.generateMelody(
          "music-electronic-melody-1",
          "Synth Lead",
          128,
          "electronic",
          ["energetic"],
          "minor",
        ),
        () => generator.generateMelody(
          "music-blues-melody-1",
          "Blues Melody",
          95,
          "jazz",
          ["nostalgic"],
          "blues",
        ),
        () => generator.generateMelody(
          "music-euphoric-melody-1",
          "Euphoric Lead",
          140,
          "electronic",
          ["energetic", "inspiring"],
          "major",
        ),
        () => generator.generateMelody(
          "music-catchy-melody-1",
          "Catchy Hook",
          118,
          "pop",
          ["happy", "playful"],
          "pentatonic",
        ),
        () => generator.generateMelody(
          "music-tropical-melody-1",
          "Tropical Vibes",
          100,
          "pop",
          ["happy", "bright"],
          "major",
        ),
        () => generator.generateArpeggio(
          "music-electronic-arp-1",
          "Synth Arpeggio",
          128,
          "electronic",
          ["energetic", "dark"],
        ),
        () => generator.generateArpeggio(
          "music-ambient-arp-1",
          "Ambient Arpeggio",
          100,
          "ambient",
          ["calm", "mysterious"],
        ),
        () => generator.generateArpeggio(
          "music-trance-arp-1",
          "Trance Arpeggio",
          140,
          "electronic",
          ["energetic", "inspiring"],
        ),
        () => generator.generateArpeggio(
          "music-edm-arp-1",
          "EDM Pluck",
          150,
          "electronic",
          ["energetic", "happy"],
        ),
        () => generator.generateBassline(
          "music-electronic-bass-1",
          "Electronic Bass",
          128,
          "electronic",
          ["energetic", "dark"],
        ),
        () => generator.generateBassline(
          "music-hiphop-bass-1",
          "Hip-Hop Bass",
          90,
          "hip-hop",
          ["energetic"],
        ),
        () => generator.generateBassline(
          "music-lofi-bass-1",
          "Lo-Fi Bass",
          85,
          "lofi",
          ["calm"],
        ),
        () => generator.generateBassline(
          "music-dubstep-bass-1",
          "Wobble Bass",
          140,
          "electronic",
          ["energetic", "dark"],
        ),
        () => generator.generateBassline(
          "music-funk-bass-1",
          "Funky Slap Bass",
          110,
          "upbeat",
          ["happy", "playful"],
        ),
        () => generator.generateDrumLoop(
          "music-electronic-drums-1",
          "Electronic Drums",
          128,
          "electronic",
          ["energetic"],
          "complex",
        ),
        () => generator.generateDrumLoop(
          "music-hiphop-drums-1",
          "Hip-Hop Drums",
          90,
          "hip-hop",
          ["energetic"],
          "basic",
        ),
        () => generator.generateDrumLoop(
          "music-lofi-drums-1",
          "Lo-Fi Drums",
          85,
          "lofi",
          ["calm"],
          "minimal",
        ),
        () => generator.generateDrumLoop(
          "music-pop-drums-1",
          "Pop Drums",
          120,
          "pop",
          ["happy"],
          "basic",
        ),
        () => generator.generateDrumLoop(
          "music-cinematic-drums-1",
          "Cinematic Drums",
          100,
          "cinematic",
          ["tense"],
          "complex",
        ),
        () => generator.generateDrumLoop(
          "music-trap-drums-1",
          "Trap Hi-Hats",
          145,
          "hip-hop",
          ["energetic", "dark"],
          "complex",
        ),
        () => generator.generateDrumLoop(
          "music-house-drums-1",
          "Four on Floor",
          125,
          "electronic",
          ["energetic", "happy"],
          "basic",
        ),
        () => generator.generateDrumLoop(
          "music-breakbeat-drums-1",
          "Breakbeat",
          135,
          "electronic",
          ["energetic"],
          "complex",
        ),
        () => generator.generateFullTrack(
          "music-summer-vibes",
          "Summer Vibes",
          118,
          "pop",
          ["happy", "bright"],
        ),
        () => generator.generateFullTrack(
          "music-golden-hour",
          "Golden Hour",
          110,
          "pop",
          ["happy", "nostalgic"],
        ),
        () => generator.generateFullTrack(
          "music-feel-good",
          "Feel Good",
          120,
          "upbeat",
          ["happy", "energetic"],
        ),
        () => generator.generateFullTrack(
          "music-good-times",
          "Good Times",
          124,
          "upbeat",
          ["happy", "playful"],
        ),
        () => generator.generateFullTrack(
          "music-sunshine",
          "Sunshine",
          116,
          "upbeat",
          ["happy", "bright"],
        ),
        () => generator.generateFullTrack(
          "music-celebration",
          "Celebration",
          128,
          "upbeat",
          ["energetic", "happy"],
        ),
        () => generator.generateFullTrack(
          "music-victory-lap",
          "Victory Lap",
          130,
          "upbeat",
          ["energetic", "inspiring"],
        ),
        () => generator.generateFullTrack("music-on-top", "On Top", 126, "upbeat", [
          "inspiring",
          "energetic",
        ]),
        () => generator.generateFullTrack("music-rise-up", "Rise Up", 122, "upbeat", [
          "happy",
          "inspiring",
        ]),
        () => generator.generateFullTrack(
          "music-lets-go",
          "Let's Go",
          132,
          "upbeat",
          ["energetic"],
        ),
        () => generator.generateFullTrack(
          "music-party-time",
          "Party Time",
          128,
          "electronic",
          ["energetic", "happy"],
        ),
        () => generator.generateFullTrack(
          "music-dance-floor",
          "Dance Floor",
          126,
          "electronic",
          ["energetic", "playful"],
        ),
        () => generator.generateFullTrack(
          "music-electric-nights",
          "Electric Nights",
          130,
          "electronic",
          ["energetic"],
        ),
        () => generator.generateFullTrack(
          "music-neon-dreams",
          "Neon Dreams",
          125,
          "electronic",
          ["energetic", "dark"],
        ),
        () => generator.generateFullTrack(
          "music-future-wave",
          "Future Wave",
          135,
          "electronic",
          ["energetic", "inspiring"],
        ),
        () => generator.generateFullTrack(
          "music-beat-drop",
          "Beat Drop",
          140,
          "electronic",
          ["energetic"],
        ),
        () => generator.generateFullTrack("music-bounce", "Bounce", 95, "hip-hop", [
          "energetic",
          "playful",
        ]),
        () => generator.generateFullTrack(
          "music-smooth-flow",
          "Smooth Flow",
          90,
          "hip-hop",
          ["calm", "playful"],
        ),
        () => generator.generateFullTrack(
          "music-fresh-start",
          "Fresh Start",
          98,
          "hip-hop",
          ["happy", "energetic"],
        ),
        () => generator.generateFullTrack(
          "music-street-groove",
          "Street Groove",
          92,
          "hip-hop",
          ["energetic"],
        ),
        () => generator.generateFullTrack(
          "music-hype-mode",
          "Hype Mode",
          105,
          "hip-hop",
          ["energetic", "happy"],
        ),
        () => generator.generateFullTrack(
          "music-chill-wave",
          "Chill Wave",
          85,
          "lofi",
          ["calm", "nostalgic"],
        ),
        () => generator.generateFullTrack(
          "music-peaceful-mind",
          "Peaceful Mind",
          80,
          "lofi",
          ["calm"],
        ),
        () => generator.generateFullTrack(
          "music-cozy-vibes",
          "Cozy Vibes",
          82,
          "lofi",
          ["calm", "happy"],
        ),
        () => generator.generateFullTrack(
          "music-epic-moment",
          "Epic Moment",
          90,
          "cinematic",
          ["inspiring", "tense"],
        ),
        () => generator.generateFullTrack(
          "music-new-beginning",
          "New Beginning",
          95,
          "cinematic",
          ["inspiring", "bright"],
        ),
      ];

      // Music first (it is the tab people open), then effects. A small pool keeps
      // the first rows appearing within a second or two instead of everything
      // finishing together after ~13 s.
      const jobs = [
        ...musicGenerators.map((run) => ({ run, category: "music" as const })),
        ...sfxGenerators.map((run) => ({ run, category: "sfx" as const })),
      ];
      this.loadTotals = {
        music: musicGenerators.length,
        sfx: sfxGenerators.length,
      };
      this.notifyLoad();
      const slots: Array<GeneratedSound | undefined> = new Array(jobs.length);
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const index = next++;
          const job = jobs[index];
          try {
            slots[index] = await job.run();
          } catch (error) {
            console.error("[SoundLibrary] Failed to generate a sound:", error);
          }
          this.loadDone[job.category]++;
          // Keep definition order no matter which finishes first.
          this.sounds.clear();
          this.soundBlobs.clear();
          for (const result of slots) {
            if (!result) continue;
            this.sounds.set(result.item.id, result.item);
            this.soundBlobs.set(result.item.id, result.blob);
          }
          this.notifyLoad();
        }
      };
      await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));

      this.initialized = true;
    } catch (error) {
      console.error("[SoundLibrary] Failed to generate sounds:", error);
    }
  }

  getSoundBlob(id: string): Blob | null {
    return this.soundBlobs.get(id) || null;
  }

  getAllSounds(): SoundItem[] {
    return Array.from(this.sounds.values());
  }

  getMusic(): SoundItem[] {
    return this.getAllSounds().filter((s) => s.category === "music");
  }

  getSFX(): SoundItem[] {
    return this.getAllSounds().filter((s) => s.category === "sfx");
  }

  getByCategory(category: SoundCategory): SoundItem[] {
    return this.getAllSounds().filter((s) => s.category === category);
  }

  getBySubcategory(subcategory: MusicGenre | SFXCategory): SoundItem[] {
    return this.getAllSounds().filter((s) => s.subcategory === subcategory);
  }

  search(filter: SoundLibraryFilter): SoundItem[] {
    let results = this.getAllSounds();

    if (filter.category) {
      results = results.filter((s) => s.category === filter.category);
    }

    if (filter.subcategory) {
      results = results.filter((s) => s.subcategory === filter.subcategory);
    }

    if (filter.mood && filter.mood.length > 0) {
      results = results.filter((s) =>
        s.mood?.some((m) => filter.mood!.includes(m)),
      );
    }

    if (filter.minDuration !== undefined) {
      results = results.filter((s) => s.duration >= filter.minDuration!);
    }

    if (filter.maxDuration !== undefined) {
      results = results.filter((s) => s.duration <= filter.maxDuration!);
    }

    if (filter.minBpm !== undefined) {
      results = results.filter((s) => s.bpm && s.bpm >= filter.minBpm!);
    }

    if (filter.maxBpm !== undefined) {
      results = results.filter((s) => s.bpm && s.bpm <= filter.maxBpm!);
    }

    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)),
      );
    }

    return results;
  }

  getSound(id: string): SoundItem | null {
    return this.sounds.get(id) || null;
  }

  async previewSound(sound: SoundItem, onEnded?: () => void): Promise<void> {
    this.stopPreview();
    const request = ++this.previewRequest;

    if (!sound.previewUrl) throw new Error("No sound preview is available.");

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      if (this.audioContext.state === "suspended")
        await this.audioContext.resume();
      const response = await fetch(sound.previewUrl);
      if (!response.ok) throw new Error("Sound preview could not be loaded.");
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      if (request !== this.previewRequest) return;
      this.startPreviewBuffer(sound.id, audioBuffer, 0, request, onEnded);
    } catch (error) {
      if (request === this.previewRequest) this.stopPreview();
      console.error("[SoundLibrary] Preview failed:", error);
      throw error;
    }
  }

  private startPreviewBuffer(soundId: string, buffer: AudioBuffer, offset: number, request: number, onEnded?: () => void): void {
    const context = this.audioContext!;
    const source = context.createBufferSource();
    this.previewSource = source;
    source.buffer = buffer;
    source.onended = () => {
      if (request === this.previewRequest && this.previewSource === source) {
        this.stopPreview();
        onEnded?.();
      }
    };
    this.previewGain = context.createGain();
    this.previewGain.gain.value = 0.7;
    source.connect(this.previewGain);
    this.previewGain.connect(context.destination);
    source.start(0, offset);
    this.previewBuffer = buffer;
    this.previewEnded = onEnded;
    this.previewClock = { soundId, startedAt: context.currentTime, duration: buffer.duration, offset, paused: false };
  }

  private releasePreviewNodes(): void {
    if (this.previewSource) {
      this.previewSource.onended = null;
      try { this.previewSource.stop(); } catch { /* Already ended. */ }
      this.previewSource.disconnect();
      this.previewSource = null;
    }
    if (this.previewGain) {
      this.previewGain.disconnect();
      this.previewGain = null;
    }
  }

  stopPreview(): void {
    this.previewRequest++;
    this.previewClock = null;
    this.previewBuffer = null;
    this.previewEnded = undefined;
    this.releasePreviewNodes();
  }

  pausePreview(soundId: string): boolean {
    const clock = this.previewClock;
    if (!clock || clock.soundId !== soundId || clock.paused || !this.audioContext) return false;
    const offset = Math.min(clock.duration, clock.offset + Math.max(0, this.audioContext.currentTime - clock.startedAt));
    if (offset >= clock.duration) {
      const ended = this.previewEnded;
      this.stopPreview();
      ended?.();
      return false;
    }
    this.previewRequest++;
    this.releasePreviewNodes();
    this.previewClock = { ...clock, offset, paused: true };
    return true;
  }

  async resumePreview(soundId: string): Promise<boolean> {
    const clock = this.previewClock;
    if (!clock || clock.soundId !== soundId || !this.audioContext || !this.previewBuffer) return false;
    if (!clock.paused) return Boolean(this.previewSource);
    const request = this.previewRequest;
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    if (request !== this.previewRequest) return false;
    const current = this.previewClock;
    if (!current || current.soundId !== soundId || !this.previewBuffer) return false;
    if (!current.paused) return Boolean(this.previewSource);
    try {
      this.startPreviewBuffer(soundId, this.previewBuffer, current.offset, request, this.previewEnded);
      return true;
    } catch (error) {
      if (request === this.previewRequest) this.releasePreviewNodes();
      throw error;
    }
  }

  /** Offset survives pause; elapsed time comes only from the running audio clock. */
  getPreviewProgress(soundId: string): number {
    const clock = this.previewClock;
    if (!clock || clock.soundId !== soundId || !this.audioContext || clock.duration <= 0) return 0;
    const elapsed = clock.paused ? 0 : Math.max(0, this.audioContext.currentTime - clock.startedAt);
    return Math.min(1, Math.max(0, (clock.offset + elapsed) / clock.duration));
  }

  async analyzeAudio(audioBuffer: AudioBuffer): Promise<SoundAnalysis> {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    const waveform = this.generateWaveform(channelData, 200);
    const { bpm, beats } = this.detectBeats(channelData, sampleRate);
    const key = this.detectKey(channelData, sampleRate);

    return { bpm, key, beats, waveform };
  }

  private generateWaveform(
    samples: Float32Array,
    resolution: number,
  ): number[] {
    const waveform: number[] = [];
    const samplesPerPoint = Math.floor(samples.length / resolution);

    for (let i = 0; i < resolution; i++) {
      const start = i * samplesPerPoint;
      const end = start + samplesPerPoint;
      let max = 0;

      for (let j = start; j < end && j < samples.length; j++) {
        const abs = Math.abs(samples[j]);
        if (abs > max) max = abs;
      }

      waveform.push(max);
    }

    return waveform;
  }

  private detectBeats(
    samples: Float32Array,
    sampleRate: number,
  ): { bpm: number; beats: BeatMarker[] } {
    const beats: BeatMarker[] = [];
    const windowSize = Math.floor(sampleRate * 0.02);
    const hopSize = Math.floor(sampleRate * 0.01);

    const energies: number[] = [];
    for (let i = 0; i < samples.length - windowSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < windowSize; j++) {
        energy += samples[i + j] * samples[i + j];
      }
      energies.push(energy / windowSize);
    }

    const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
    const threshold = avgEnergy * 1.5;

    let lastBeatTime = -0.5;
    for (let i = 1; i < energies.length - 1; i++) {
      const time = (i * hopSize) / sampleRate;
      if (
        energies[i] > threshold &&
        energies[i] > energies[i - 1] &&
        energies[i] > energies[i + 1] &&
        time - lastBeatTime > 0.2
      ) {
        beats.push({
          time,
          strength: Math.min(energies[i] / avgEnergy, 2),
          type: beats.length % 4 === 0 ? "downbeat" : "beat",
        });
        lastBeatTime = time;
      }
    }

    let bpm = 120;
    if (beats.length >= 4) {
      const intervals: number[] = [];
      for (let i = 1; i < Math.min(beats.length, 20); i++) {
        intervals.push(beats[i].time - beats[i - 1].time);
      }
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      bpm = Math.round(60 / avgInterval);
      bpm = Math.max(60, Math.min(200, bpm));
    }

    return { bpm, beats };
  }

  private detectKey(_samples: Float32Array, _sampleRate: number): string {
    const keys = [
      "C Major",
      "G Major",
      "D Major",
      "A Major",
      "E Major",
      "A Minor",
      "E Minor",
      "D Minor",
      "B Minor",
      "F Major",
    ];
    return keys[Math.floor(Math.random() * keys.length)];
  }

  addCustomSound(sound: Omit<SoundItem, "isBuiltin">): SoundItem {
    const customSound: SoundItem = {
      ...sound,
      isBuiltin: false,
    };
    this.sounds.set(customSound.id, customSound);
    return customSound;
  }

  removeSound(id: string): boolean {
    const sound = this.sounds.get(id);
    if (sound && !sound.isBuiltin) {
      this.sounds.delete(id);
      return true;
    }
    return false;
  }

  dispose(): void {
    this.stopPreview();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.sounds.clear();
  }
}
