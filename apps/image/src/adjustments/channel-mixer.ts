export interface ChannelMixerSettings {
  red: {
    red: number;
    green: number;
    blue: number;
    constant: number;
  };
  green: {
    red: number;
    green: number;
    blue: number;
    constant: number;
  };
  blue: {
    red: number;
    green: number;
    blue: number;
    constant: number;
  };
  monochrome: boolean;
  monoRed: number;
  monoGreen: number;
  monoBlue: number;
  monoConstant: number;
}

export const DEFAULT_CHANNEL_MIXER: ChannelMixerSettings = {
  red: { red: 100, green: 0, blue: 0, constant: 0 },
  green: { red: 0, green: 100, blue: 0, constant: 0 },
  blue: { red: 0, green: 0, blue: 100, constant: 0 },
  monochrome: false,
  monoRed: 40,
  monoGreen: 40,
  monoBlue: 20,
  monoConstant: 0,
};

export const CHANNEL_MIXER_PRESETS = {
  default: {
    red: { red: 100, green: 0, blue: 0, constant: 0 },
    green: { red: 0, green: 100, blue: 0, constant: 0 },
    blue: { red: 0, green: 0, blue: 100, constant: 0 },
  },
  swapRedBlue: {
    red: { red: 0, green: 0, blue: 100, constant: 0 },
    green: { red: 0, green: 100, blue: 0, constant: 0 },
    blue: { red: 100, green: 0, blue: 0, constant: 0 },
  },
  sepia: {
    red: { red: 100, green: 50, blue: 0, constant: 0 },
    green: { red: 60, green: 60, blue: 0, constant: 0 },
    blue: { red: 30, green: 30, blue: 30, constant: 0 },
  },
  cyberPunk: {
    red: { red: 100, green: 0, blue: 50, constant: 0 },
    green: { red: 0, green: 100, blue: 50, constant: 0 },
    blue: { red: 50, green: 0, blue: 100, constant: 0 },
  },
};

export function applyChannelMixer(imageData: ImageData, settings: ChannelMixerSettings): ImageData {
  const { width, height, data } = imageData;
  const resultData = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    let newR: number, newG: number, newB: number;

    if (settings.monochrome) {
      const gray =
        r * (settings.monoRed / 100) +
        g * (settings.monoGreen / 100) +
        b * (settings.monoBlue / 100) +
        settings.monoConstant * 2.55;

      newR = newG = newB = Math.max(0, Math.min(255, gray));
    } else {
      newR =
        r * (settings.red.red / 100) +
        g * (settings.red.green / 100) +
        b * (settings.red.blue / 100) +
        settings.red.constant * 2.55;

      newG =
        r * (settings.green.red / 100) +
        g * (settings.green.green / 100) +
        b * (settings.green.blue / 100) +
        settings.green.constant * 2.55;

      newB =
        r * (settings.blue.red / 100) +
        g * (settings.blue.green / 100) +
        b * (settings.blue.blue / 100) +
        settings.blue.constant * 2.55;
    }

    resultData[i] = Math.max(0, Math.min(255, newR));
    resultData[i + 1] = Math.max(0, Math.min(255, newG));
    resultData[i + 2] = Math.max(0, Math.min(255, newB));
    resultData[i + 3] = a;
  }

  return new ImageData(resultData, width, height);
}
