import type {
  LevelsAdjustment,
  CurvesAdjustment,
  ColorBalanceAdjustment,
  SelectiveColorAdjustment,
  BlackWhiteAdjustment,
  PhotoFilterAdjustment,
  ChannelMixerAdjustment,
  GradientMapAdjustment,
  PosterizeAdjustment,
  ThresholdAdjustment,
} from '../types/adjustments';

import {
  applyLevelsToImageData,
  applyCurvesToImageData,
  applyColorBalanceToImageData,
  applyBlackWhiteToImageData,
  applyGradientMapToImageData,
  applyPosterizeToImageData,
  applyThresholdToImageData,
} from '../types/adjustments';

import { applySelectiveColor } from '../adjustments/selective-color';
import { applyPhotoFilter } from '../adjustments/photo-filter';
import { applyChannelMixer } from '../adjustments/channel-mixer';

export interface LayerAdjustments {
  levels: LevelsAdjustment;
  curves: CurvesAdjustment;
  colorBalance: ColorBalanceAdjustment;
  selectiveColor: SelectiveColorAdjustment;
  blackWhite: BlackWhiteAdjustment;
  photoFilter: PhotoFilterAdjustment;
  channelMixer: ChannelMixerAdjustment;
  gradientMap: GradientMapAdjustment;
  posterize: PosterizeAdjustment;
  threshold: ThresholdAdjustment;
}

export function hasActiveAdjustments(adjustments: LayerAdjustments): boolean {
  return (
    adjustments.levels.enabled ||
    adjustments.curves.enabled ||
    adjustments.colorBalance.enabled ||
    adjustments.selectiveColor.enabled ||
    adjustments.blackWhite.enabled ||
    adjustments.photoFilter.enabled ||
    adjustments.channelMixer.enabled ||
    adjustments.gradientMap.enabled ||
    adjustments.posterize.enabled ||
    adjustments.threshold.enabled
  );
}

export function applyAllAdjustments(
  imageData: ImageData,
  adjustments: LayerAdjustments
): ImageData {
  let result = imageData;

  if (adjustments.levels.enabled) {
    result = applyLevelsToImageData(result, adjustments.levels);
  }

  if (adjustments.curves.enabled) {
    result = applyCurvesToImageData(result, adjustments.curves);
  }

  if (adjustments.colorBalance.enabled) {
    result = applyColorBalanceToImageData(result, adjustments.colorBalance);
  }

  if (adjustments.selectiveColor.enabled) {
    result = applySelectiveColor(result, {
      reds: adjustments.selectiveColor.reds,
      yellows: adjustments.selectiveColor.yellows,
      greens: adjustments.selectiveColor.greens,
      cyans: adjustments.selectiveColor.cyans,
      blues: adjustments.selectiveColor.blues,
      magentas: adjustments.selectiveColor.magentas,
      whites: adjustments.selectiveColor.whites,
      neutrals: adjustments.selectiveColor.neutrals,
      blacks: adjustments.selectiveColor.blacks,
      method: adjustments.selectiveColor.method,
    });
  }

  if (adjustments.photoFilter.enabled) {
    result = applyPhotoFilter(result, {
      filter: adjustments.photoFilter.filter,
      color: adjustments.photoFilter.color,
      density: adjustments.photoFilter.density,
      preserveLuminosity: adjustments.photoFilter.preserveLuminosity,
    });
  }

  if (adjustments.channelMixer.enabled) {
    result = applyChannelMixer(result, {
      red: {
        red: adjustments.channelMixer.red.red,
        green: adjustments.channelMixer.red.green,
        blue: adjustments.channelMixer.red.blue,
        constant: adjustments.channelMixer.red.constant,
      },
      green: {
        red: adjustments.channelMixer.green.red,
        green: adjustments.channelMixer.green.green,
        blue: adjustments.channelMixer.green.blue,
        constant: adjustments.channelMixer.green.constant,
      },
      blue: {
        red: adjustments.channelMixer.blue.red,
        green: adjustments.channelMixer.blue.green,
        blue: adjustments.channelMixer.blue.blue,
        constant: adjustments.channelMixer.blue.constant,
      },
      monochrome: adjustments.channelMixer.monochrome,
      monoRed: 40,
      monoGreen: 40,
      monoBlue: 20,
      monoConstant: 0,
    });
  }

  if (adjustments.blackWhite.enabled) {
    result = applyBlackWhiteToImageData(result, adjustments.blackWhite);
  }

  if (adjustments.gradientMap.enabled) {
    result = applyGradientMapToImageData(result, adjustments.gradientMap);
  }

  if (adjustments.posterize.enabled) {
    result = applyPosterizeToImageData(result, adjustments.posterize);
  }

  if (adjustments.threshold.enabled) {
    result = applyThresholdToImageData(result, adjustments.threshold);
  }

  return result;
}
