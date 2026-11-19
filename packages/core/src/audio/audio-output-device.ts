/**
 * Audio output device routing (monitor speakers / headphones).
 *
 * The preview mix plays through one master AudioContext. Chromium (and Electron) can retarget it
 * with `AudioContext.setSinkId`. Where only `HTMLMediaElement.setSinkId` exists, the master signal
 * is looped through a MediaStream into a hidden <audio> element that carries the sink instead
 * (slightly higher latency, so it is only used when the context cannot do it directly). The
 * export mixdown renders offline and never touches the output device.
 *
 * The preferred device is remembered by the caller (settings store). This router keeps it applied
 * and, when the device disappears (unplugged, Bluetooth off), falls back to the system default
 * and tells the UI so it can show a toast; when the device returns it is switched back.
 */

/** `""` is the system default in setSinkId terms; the UI uses `"default"` as the same thing. */
export const SYSTEM_DEFAULT_OUTPUT_ID = "";

export interface AudioOutputDevice {
  readonly deviceId: string;
  readonly label: string;
  /** True for the system default entry. */
  readonly isDefault: boolean;
}

export type AudioOutputSupport = "context" | "element" | "none";

export type AudioOutputEvent =
  | { readonly type: "applied"; readonly deviceId: string; readonly label: string }
  /** The preferred device is gone or refused: playing on the system default instead. */
  | { readonly type: "fallback"; readonly reason: "unplugged" | "error"; readonly requestedId: string; readonly requestedLabel: string }
  /** The preferred device is back and playback moved to it again. */
  | { readonly type: "restored"; readonly deviceId: string; readonly label: string }
  | { readonly type: "devices"; readonly devices: readonly AudioOutputDevice[] };

export type AudioOutputListener = (event: AudioOutputEvent) => void;

interface SinkContext {
  readonly destination: AudioNode;
  setSinkId?: (sinkId: string | { type: "none" }) => Promise<void>;
  createMediaStreamDestination?: () => MediaStreamAudioDestinationNode;
}

interface SinkElement {
  srcObject: MediaProvider | null;
  setSinkId?: (sinkId: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
}

export interface AudioOutputEnvironment {
  readonly mediaDevices?: Pick<MediaDevices, "enumerateDevices" | "addEventListener" | "removeEventListener"> & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
  };
  readonly createAudioElement?: () => SinkElement;
}

export function normalizeOutputId(deviceId: string | null | undefined): string {
  return !deviceId || deviceId === "default" ? SYSTEM_DEFAULT_OUTPUT_ID : deviceId;
}

/** What to do after the device list changed. Pure so the unplug / replug matrix is unit-testable. */
export type OutputReconcileAction = "keep" | "fallback" | "restore";

export function reconcileOutputDevice(input: {
  readonly preferredId: string;
  readonly activeId: string;
  readonly availableIds: readonly string[];
  /** The browser returned real device entries (false = ids withheld, so absence proves nothing). Default: any ids at all. */
  readonly listKnown?: boolean;
}): OutputReconcileAction {
  const preferred = normalizeOutputId(input.preferredId);
  if (preferred === SYSTEM_DEFAULT_OUTPUT_ID) return input.activeId === SYSTEM_DEFAULT_OUTPUT_ID ? "keep" : "fallback";
  // No device list at all (permissions withheld): never treat that as "unplugged"; just try to apply.
  if (!(input.listKnown ?? input.availableIds.length > 0)) return input.activeId === preferred ? "keep" : "restore";
  const present = input.availableIds.includes(preferred);
  if (present) return input.activeId === preferred ? "keep" : "restore";
  return input.activeId === SYSTEM_DEFAULT_OUTPUT_ID ? "keep" : "fallback";
}

export class AudioOutputRouter {
  private context: SinkContext | null = null;
  private masterNode: AudioNode | null = null;
  private preferredId = SYSTEM_DEFAULT_OUTPUT_ID;
  private activeId = SYSTEM_DEFAULT_OUTPUT_ID;
  private mode: "context" | "element" | "none" = "none";
  private elementSink: { element: SinkElement; stream: MediaStreamAudioDestinationNode } | null = null;
  private listeners = new Set<AudioOutputListener>();
  private labels = new Map<string, string>();
  private watching = false;
  private queue: Promise<void> = Promise.resolve();
  private fellBack = false;
  private readonly onDeviceChange = () => {
    void this.reconcile();
  };

  constructor(private readonly environment: AudioOutputEnvironment = {}) {}

  private get mediaDevices(): NonNullable<AudioOutputEnvironment["mediaDevices"]> | undefined {
    return this.environment.mediaDevices ?? (typeof navigator !== "undefined" ? (navigator.mediaDevices as AudioOutputEnvironment["mediaDevices"]) : undefined);
  }

  /** Which retargeting path this browser offers for the attached context. */
  getSupport(): AudioOutputSupport {
    if (this.context && typeof this.context.setSinkId === "function") return "context";
    if (this.elementSupported()) return "element";
    // Before a context is attached, report what the platform could do.
    if (!this.context && typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype) return "context";
    return "none";
  }

  private elementSupported(): boolean {
    if (this.environment.createAudioElement) return true;
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && typeof this.context?.createMediaStreamDestination === "function";
  }

  getPreferredDeviceId(): string {
    return this.preferredId;
  }

  /** The device audio is actually playing on right now ("" = system default). */
  getActiveDeviceId(): string {
    return this.activeId;
  }

  isFallbackActive(): boolean {
    return this.fellBack;
  }

  subscribe(listener: AudioOutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AudioOutputEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A faulty listener must not break routing.
      }
    }
  }

  /** Seed a name for a device that is not plugged in yet (remembered across sessions). */
  rememberLabel(deviceId: string, label: string): void {
    const id = normalizeOutputId(deviceId);
    if (id !== SYSTEM_DEFAULT_OUTPUT_ID && label) this.labels.set(id, label);
  }

  labelFor(deviceId: string): string {
    const id = normalizeOutputId(deviceId);
    if (id === SYSTEM_DEFAULT_OUTPUT_ID) return "System default";
    return this.labels.get(id) || "Audio output device";
  }

  /** The master AudioContext and its final node; applies the remembered device straight away. */
  attach(context: AudioContext, masterNode: AudioNode): void {
    if (this.context === context && this.masterNode === masterNode) return;
    this.teardownElementSink();
    this.context = context as unknown as SinkContext;
    this.masterNode = masterNode;
    this.activeId = SYSTEM_DEFAULT_OUTPUT_ID;
    this.mode = "none";
    if (this.preferredId !== SYSTEM_DEFAULT_OUTPUT_ID) void this.enqueue(() => this.reconcileNow(true));
  }

  detach(context?: AudioContext): void {
    if (context && this.context !== (context as unknown as SinkContext)) return;
    this.teardownElementSink();
    this.context = null;
    this.masterNode = null;
    this.activeId = SYSTEM_DEFAULT_OUTPUT_ID;
    this.mode = "none";
  }

  /** Remember the user's choice and apply it. Resolves once the sink changed (or fell back). */
  setPreferredDevice(deviceId: string): Promise<void> {
    this.preferredId = normalizeOutputId(deviceId);
    this.fellBack = false;
    return this.enqueue(() => this.reconcileNow(true));
  }

  async listDevices(): Promise<AudioOutputDevice[]> {
    return (await this.enumerateOutputs()).devices;
  }

  private async enumerateOutputs(): Promise<{ devices: AudioOutputDevice[]; known: boolean }> {
    const mediaDevices = this.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return { devices: [], known: false };
    let infos: MediaDeviceInfo[];
    try {
      infos = await mediaDevices.enumerateDevices();
    } catch {
      return { devices: [], known: false };
    }
    const outputs = infos.filter((info) => info.kind === "audiooutput");
    // Entries without an id mean the browser is withholding the list until the user grants access.
    const known = outputs.some((info) => info.deviceId !== "");
    let unnamed = 0;
    const devices: AudioOutputDevice[] = [];
    for (const info of outputs) {
      // Chromium also lists a "communications" alias of the default; it is not a separate device.
      if (info.deviceId === "communications") continue;
      if (info.deviceId === "") continue;
      const isDefault = info.deviceId === "default";
      const id = normalizeOutputId(info.deviceId);
      const label = info.label ? info.label.replace(/^Default - /, "") : isDefault ? "System default" : `Audio output ${++unnamed}`;
      if (!isDefault || info.label) this.labels.set(id, label);
      devices.push({ deviceId: id, label: isDefault ? "System default" : label, isDefault });
    }
    if (!devices.some((device) => device.isDefault)) devices.unshift({ deviceId: SYSTEM_DEFAULT_OUTPUT_ID, label: "System default", isDefault: true });
    return { devices, known };
  }

  /** True when labels are hidden until the user grants access (Chromium without a media permission). */
  async needsAccessForLabels(): Promise<boolean> {
    const devices = await this.listDevices();
    return devices.some((device) => !device.isDefault && /^Audio output \d+$/.test(device.label));
  }

  /** Prompt the user to pick (and thereby reveal) an output device where the browser supports it. */
  async requestDeviceAccess(): Promise<AudioOutputDevice | null> {
    const select = this.mediaDevices?.selectAudioOutput;
    if (!select) return null;
    try {
      const info = await select.call(this.mediaDevices);
      if (info.label) this.labels.set(normalizeOutputId(info.deviceId), info.label);
      await this.emitDevices();
      return { deviceId: normalizeOutputId(info.deviceId), label: info.label || "Audio output device", isDefault: info.deviceId === "default" };
    } catch {
      return null;
    }
  }

  /** Watch for devices appearing or disappearing; idempotent. */
  startWatching(): void {
    if (this.watching) return;
    const mediaDevices = this.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    this.watching = true;
    mediaDevices.addEventListener("devicechange", this.onDeviceChange);
    void this.emitDevices();
  }

  stopWatching(): void {
    if (!this.watching) return;
    this.watching = false;
    this.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
  }

  private async emitDevices(): Promise<void> {
    this.emit({ type: "devices", devices: await this.listDevices() });
  }

  reconcile(): Promise<void> {
    return this.enqueue(async () => {
      await this.emitDevices();
      await this.reconcileNow(false);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async reconcileNow(announceApplied: boolean): Promise<void> {
    // Nothing to retarget until the preview graph exists; attach() reconciles then.
    if (!this.context) return;
    const { devices, known } = await this.enumerateOutputs();
    const availableIds = devices.filter((device) => !device.isDefault).map((device) => device.deviceId);
    const action = reconcileOutputDevice({ preferredId: this.preferredId, activeId: this.activeId, availableIds, listKnown: known });
    if (action === "fallback") {
      const requestedId = this.preferredId;
      const requestedLabel = this.labelFor(requestedId);
      await this.applySink(SYSTEM_DEFAULT_OUTPUT_ID);
      if (requestedId !== SYSTEM_DEFAULT_OUTPUT_ID) {
        this.fellBack = true;
        this.emit({ type: "fallback", reason: "unplugged", requestedId, requestedLabel });
      }
      return;
    }
    if (action === "restore") {
      const ok = await this.applySink(this.preferredId);
      if (!ok) {
        this.fellBack = true;
        this.emit({ type: "fallback", reason: "error", requestedId: this.preferredId, requestedLabel: this.labelFor(this.preferredId) });
        return;
      }
      const wasFallback = this.fellBack;
      this.fellBack = false;
      this.emit(wasFallback ? { type: "restored", deviceId: this.activeId, label: this.labelFor(this.activeId) } : { type: "applied", deviceId: this.activeId, label: this.labelFor(this.activeId) });
      return;
    }
    // A saved device that is not connected (e.g. after a restart): say so once, we are on the default.
    if (this.preferredId !== SYSTEM_DEFAULT_OUTPUT_ID && known && !availableIds.includes(this.preferredId) && !this.fellBack) {
      this.fellBack = true;
      this.emit({ type: "fallback", reason: "unplugged", requestedId: this.preferredId, requestedLabel: this.labelFor(this.preferredId) });
      return;
    }
    if (announceApplied && this.activeId === this.preferredId && this.context) {
      this.emit({ type: "applied", deviceId: this.activeId, label: this.labelFor(this.activeId) });
    } else if (announceApplied && this.preferredId === SYSTEM_DEFAULT_OUTPUT_ID) {
      await this.applySink(SYSTEM_DEFAULT_OUTPUT_ID);
    }
  }

  /** Point the output at `deviceId`. Returns false (and plays on the default) when the browser refuses. */
  private async applySink(deviceId: string): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    if (deviceId === this.activeId && (deviceId === SYSTEM_DEFAULT_OUTPUT_ID || this.mode !== "none")) return true;
    try {
      if (typeof context.setSinkId === "function") {
        this.teardownElementSink();
        await context.setSinkId(deviceId);
        this.mode = deviceId === SYSTEM_DEFAULT_OUTPUT_ID ? "none" : "context";
      } else if (deviceId === SYSTEM_DEFAULT_OUTPUT_ID) {
        this.teardownElementSink();
        this.mode = "none";
      } else if (this.elementSupported()) {
        await this.routeThroughElement(deviceId);
        this.mode = "element";
      } else {
        return false;
      }
      this.activeId = deviceId;
      return true;
    } catch {
      this.teardownElementSink();
      try {
        if (typeof context.setSinkId === "function") await context.setSinkId(SYSTEM_DEFAULT_OUTPUT_ID);
      } catch {
        // Already on whatever the browser considers default.
      }
      this.activeId = SYSTEM_DEFAULT_OUTPUT_ID;
      this.mode = "none";
      return false;
    }
  }

  private async routeThroughElement(deviceId: string): Promise<void> {
    const context = this.context;
    const master = this.masterNode;
    if (!context || !master) throw new Error("Audio output is not attached");
    if (!this.elementSink) {
      if (!context.createMediaStreamDestination) throw new Error("MediaStream destination is unavailable");
      const stream = context.createMediaStreamDestination();
      const element = this.environment.createAudioElement ? this.environment.createAudioElement() : (new Audio() as unknown as SinkElement);
      element.srcObject = stream.stream;
      this.elementSink = { element, stream };
      try {
        master.disconnect(context.destination);
      } catch {
        // Not connected to the destination (already rerouted).
      }
      master.connect(stream);
    }
    if (!this.elementSink.element.setSinkId) throw new Error("setSinkId is unavailable");
    await this.elementSink.element.setSinkId(deviceId);
    await this.elementSink.element.play();
  }

  private teardownElementSink(): void {
    const sink = this.elementSink;
    if (!sink) return;
    this.elementSink = null;
    try {
      sink.element.pause();
      sink.element.srcObject = null;
    } catch {
      // Element already released.
    }
    const context = this.context;
    const master = this.masterNode;
    if (!context || !master) return;
    try {
      master.disconnect(sink.stream);
    } catch {
      // Already disconnected.
    }
    try {
      master.connect(context.destination);
    } catch {
      // Context closed.
    }
  }
}

let routerInstance: AudioOutputRouter | null = null;

/** The app-wide router the realtime graph attaches its master output to. */
export function getAudioOutputRouter(): AudioOutputRouter {
  if (!routerInstance) routerInstance = new AudioOutputRouter();
  return routerInstance;
}

/** Test seam: replace or clear the shared router. */
export function setAudioOutputRouterForTests(router: AudioOutputRouter | null): void {
  routerInstance = router;
}
