export const MULTICAM_BLEED_CALIBRATION_SPEC =
  "openreel-bleed-calibration/v1" as const;

interface MulticamCalibrationSource {
  angleId: string;
  samples: Float32Array;
  sampleRate: number;
}

export interface MulticamCalibrationRange {
  /** The participant/microphone intentionally speaking alone. */
  speakerAngleId: string;
  startTime: number;
  endTime: number;
}

export interface MulticamBleedCalibration {
  spec: typeof MULTICAM_BLEED_CALIBRATION_SPEC;
  angleIds: string[];
  /** ratios[speaker][receiver] is expected bleed energy at receiver. */
  ratios: Record<string, Record<string, number>>;
  noiseFloor: Record<string, number>;
}

function rmsRange(
  source: MulticamCalibrationSource,
  startTime: number,
  endTime: number,
): number {
  const start = Math.max(0, Math.floor(startTime * source.sampleRate));
  const end = Math.min(source.samples.length, Math.ceil(endTime * source.sampleRate));
  if (end <= start) return 0;
  const stride = Math.max(1, Math.floor(source.sampleRate / 2_000));
  let sum = 0;
  let count = 0;
  for (let index = start; index < end; index += stride) {
    const sample = source.samples[index] ?? 0;
    sum += sample * sample;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Learns cross-channel bleed ratios from isolated speaking calibration ranges. */
export function calibrateMulticamBleed(
  sources: readonly MulticamCalibrationSource[],
  ranges: readonly MulticamCalibrationRange[],
  silenceRange?: { startTime: number; endTime: number },
): MulticamBleedCalibration {
  const angleIds = sources.map((source) => source.angleId);
  const ratios: Record<string, Record<string, number>> = {};
  const noiseFloor: Record<string, number> = {};
  for (const source of sources) {
    noiseFloor[source.angleId] = silenceRange
      ? rmsRange(source, silenceRange.startTime, silenceRange.endTime)
      : 0;
  }

  for (const speakerAngleId of angleIds) {
    ratios[speakerAngleId] = {};
    const speakerRanges = ranges.filter(
      (range) =>
        range.speakerAngleId === speakerAngleId && range.endTime > range.startTime,
    );
    const speaker = sources.find((source) => source.angleId === speakerAngleId);
    for (const receiver of sources) {
      if (receiver.angleId === speakerAngleId) {
        ratios[speakerAngleId][receiver.angleId] = 1;
        continue;
      }
      const measurements = speakerRanges.flatMap((range) => {
        if (!speaker) return [];
        const speakerEnergy = Math.max(
          0,
          rmsRange(speaker, range.startTime, range.endTime) -
            (noiseFloor[speakerAngleId] ?? 0),
        );
        const receiverEnergy = Math.max(
          0,
          rmsRange(receiver, range.startTime, range.endTime) -
            (noiseFloor[receiver.angleId] ?? 0),
        );
        return speakerEnergy > 0 ? [receiverEnergy / speakerEnergy] : [];
      });
      ratios[speakerAngleId][receiver.angleId] = Math.max(
        0,
        Math.min(1, median(measurements)),
      );
    }
  }
  return {
    spec: MULTICAM_BLEED_CALIBRATION_SPEC,
    angleIds,
    ratios,
    noiseFloor,
  };
}

/** Removes energy predicted by the learned cross-channel bleed matrix. */
export function correctMulticamBleedEnergies(
  energies: Readonly<Record<string, number>>,
  calibration?: MulticamBleedCalibration,
): Record<string, number> {
  if (!calibration) return { ...energies };
  const corrected: Record<string, number> = {};
  for (const receiver of calibration.angleIds) {
    const measured = Math.max(
      0,
      (energies[receiver] ?? 0) - (calibration.noiseFloor[receiver] ?? 0),
    );
    let predictedBleed = 0;
    for (const speaker of calibration.angleIds) {
      if (speaker === receiver) continue;
      predictedBleed = Math.max(
        predictedBleed,
        Math.max(0, energies[speaker] ?? 0) *
          (calibration.ratios[speaker]?.[receiver] ?? 0),
      );
    }
    corrected[receiver] = Math.max(0, measured - predictedBleed);
  }
  return corrected;
}
