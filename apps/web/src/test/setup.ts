import "@testing-library/jest-dom/vitest";
import "../i18n";

// Mock matchMedia for tests
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock ResizeObserver for tests
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

// Also set it globally for jsdom
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Mock HTMLCanvasElement.getContext for tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLCanvasElement.prototype as any).getContext = function (contextId: string) {
  if (contextId === "bitmaprenderer") {
    return {
      transferFromImageBitmap: () => {},
    };
  }
  return {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
    fillText: () => {},
    strokeText: () => {},
    createLinearGradient: () => ({
      addColorStop: () => {},
    }),
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
    createPattern: () => ({}),
    canvas: this,
  } as unknown as CanvasRenderingContext2D;
};

// Mock IndexedDB for tests
const indexedDBMock = {
  open: () => ({
    result: {
      createObjectStore: () => ({}),
      transaction: () => ({
        objectStore: () => ({
          put: () => ({}),
          get: () => ({}),
          delete: () => ({}),
        }),
      }),
    },
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  }),
  deleteDatabase: () => ({}),
};

Object.defineProperty(window, "indexedDB", {
  writable: true,
  value: indexedDBMock,
});

// Mock AudioContext for tests
class AudioContextMock {
  destination = {
    channelCount: 2,
    channelCountMode: "max",
    channelInterpretation: "speakers",
  };
  sampleRate = 48000;
  currentTime = 0;
  state = "running";

  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      onended: null,
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      minDecibels: -100,
      maxDecibels: -30,
      smoothingTimeConstant: 0.8,
      connect: () => {},
      disconnect: () => {},
      getByteFrequencyData: () => {},
      getByteTimeDomainData: () => {},
      getFloatFrequencyData: () => {},
      getFloatTimeDomainData: () => {},
    };
  }

  createBiquadFilter() {
    return {
      type: "lowpass",
      frequency: { value: 350, setValueAtTime: () => {} },
      Q: { value: 1, setValueAtTime: () => {} },
      gain: { value: 0, setValueAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: -24, setValueAtTime: () => {} },
      knee: { value: 30, setValueAtTime: () => {} },
      ratio: { value: 12, setValueAtTime: () => {} },
      attack: { value: 0.003, setValueAtTime: () => {} },
      release: { value: 0.25, setValueAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createStereoPanner() {
    return {
      pan: {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      length,
      duration: length / sampleRate,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    };
  }

  decodeAudioData(_audioData: ArrayBuffer) {
    return Promise.resolve(this.createBuffer(2, 48000, 48000));
  }

  close() {
    return Promise.resolve();
  }

  resume() {
    return Promise.resolve();
  }

  suspend() {
    return Promise.resolve();
  }
}

Object.defineProperty(window, "AudioContext", {
  writable: true,
  value: AudioContextMock,
});

Object.defineProperty(window, "webkitAudioContext", {
  writable: true,
  value: AudioContextMock,
});

class OfflineAudioContextMock extends AudioContextMock {
  constructor(_numberOfChannels: number, _length: number, _sampleRate: number) {
    super();
  }

  startRendering() {
    return Promise.resolve(this.createBuffer(2, 48000, 48000));
  }
}

Object.defineProperty(window, "OfflineAudioContext", {
  writable: true,
  value: OfflineAudioContextMock,
});

Object.defineProperty(globalThis, "OfflineAudioContext", {
  writable: true,
  value: OfflineAudioContextMock,
});

// Mock OffscreenCanvas for tests
class OffscreenCanvasMock {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(contextId: string) {
    if (contextId === "2d") {
      return {
        fillRect: () => {},
        clearRect: () => {},
        getImageData: (
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        putImageData: () => {},
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          width,
          height,
        }),
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        measureText: () => ({ width: 0 }),
        transform: () => {},
        rect: () => {},
        clip: () => {},
        fillText: () => {},
        strokeText: () => {},
        canvas: this,
      };
    }
    return null;
  }

  convertToBlob() {
    return Promise.resolve(new Blob());
  }

  transferToImageBitmap() {
    return {} as ImageBitmap;
  }
}

Object.defineProperty(globalThis, "OffscreenCanvas", {
  writable: true,
  value: OffscreenCanvasMock,
});
