import type { Subtitle, CaptionAnimationStyle } from "../types/timeline";

export type WordSegmentStyle = "normal" | "highlighted" | "hidden" | "active";

export interface WordSegment {
  readonly text: string;
  readonly style: WordSegmentStyle;
  readonly opacity: number;
  readonly scale: number;
  readonly offsetY: number;
  readonly color?: string;
}

interface AnimatedCaptionFrame {
  readonly segments: WordSegment[];
  readonly visible: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
}

function renderNone(subtitle: Subtitle): AnimatedCaptionFrame {
  return {
    segments: [
      {
        text: subtitle.text,
        style: "normal",
        opacity: 1,
        scale: 1,
        offsetY: 0,
      },
    ],
    visible: true,
  };
}

function renderWordHighlight(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (!subtitle.words || subtitle.words.length === 0) {
    return renderNone(subtitle);
  }

  const highlightColor = subtitle.style?.highlightColor || "#ffff00";
  const upcomingColor = subtitle.style?.upcomingColor;

  const segments: WordSegment[] = subtitle.words.map((word) => {
    const isActive =
      currentTime >= word.startTime && currentTime < word.endTime;
    const isPast = currentTime >= word.endTime;
    const isUpcoming = currentTime < word.startTime;

    let color: string | undefined;
    if (isActive) {
      color = highlightColor;
    } else if (isUpcoming && upcomingColor) {
      color = upcomingColor;
    }

    return {
      text: word.text,
      style: isActive ? "highlighted" : isPast ? "normal" : "normal",
      opacity: 1,
      scale: isActive ? 1.15 : 1,
      offsetY: isActive ? -2 : 0,
      color,
    };
  });

  return { segments, visible: true };
}

function renderWordByWord(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (!subtitle.words || subtitle.words.length === 0) {
    return renderNone(subtitle);
  }

  const activeWord = subtitle.words.find(
    (word) => currentTime >= word.startTime && currentTime < word.endTime,
  );

  if (!activeWord) {
    const lastWord = subtitle.words[subtitle.words.length - 1];
    if (currentTime >= lastWord.endTime) {
      return {
        segments: [
          {
            text: lastWord.text,
            style: "normal",
            opacity: 1,
            scale: 1,
            offsetY: 0,
          },
        ],
        visible: true,
      };
    }
    return { segments: [], visible: false };
  }

  return {
    segments: [
      {
        text: activeWord.text,
        style: "active",
        opacity: 1,
        scale: 1,
        offsetY: 0,
      },
    ],
    visible: true,
  };
}

function renderKaraoke(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (!subtitle.words || subtitle.words.length === 0) {
    return renderNone(subtitle);
  }

  const highlightColor = subtitle.style?.highlightColor || "#ffff00";
  const upcomingColor =
    subtitle.style?.upcomingColor || "rgba(255, 255, 255, 0.5)";

  const segments: WordSegment[] = subtitle.words.map((word) => {
    const wordDuration = word.endTime - word.startTime;
    const elapsed = currentTime - word.startTime;
    const progress = clamp(elapsed / wordDuration, 0, 1);

    const isUpcoming = currentTime < word.startTime;
    const isActive =
      currentTime >= word.startTime && currentTime < word.endTime;
    const isComplete = currentTime >= word.endTime;

    let style: WordSegmentStyle = "normal";
    let color: string | undefined;

    if (isUpcoming) {
      style = "normal";
      color = upcomingColor;
    } else if (isComplete) {
      style = "highlighted";
      color = highlightColor;
    } else if (isActive) {
      style = "active";
      color = `linear-gradient(90deg, ${highlightColor} ${progress * 100}%, ${upcomingColor} ${progress * 100}%)`;
    }

    return {
      text: word.text,
      style,
      opacity: 1,
      scale: isActive ? 1.05 : 1,
      offsetY: 0,
      color,
    };
  });

  return { segments, visible: true };
}

function renderBounce(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (!subtitle.words || subtitle.words.length === 0) {
    return renderNone(subtitle);
  }

  const animationDuration = 0.3;

  const segments: WordSegment[] = subtitle.words.map((word) => {
    const timeSinceStart = currentTime - word.startTime;
    const isVisible = currentTime >= word.startTime;

    if (!isVisible) {
      return {
        text: word.text,
        style: "hidden" as WordSegmentStyle,
        opacity: 0,
        scale: 0,
        offsetY: 20,
      };
    }

    const animProgress = clamp(timeSinceStart / animationDuration, 0, 1);
    const bounceProgress = easeOutBounce(animProgress);

    const isActive =
      currentTime >= word.startTime && currentTime < word.endTime;

    return {
      text: word.text,
      style: isActive ? "active" : "normal",
      opacity: bounceProgress,
      scale: 0.5 + bounceProgress * 0.5,
      offsetY: 20 * (1 - bounceProgress),
    };
  });

  return { segments, visible: true };
}

function renderTypewriter(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (!subtitle.words || subtitle.words.length === 0) {
    return renderNone(subtitle);
  }

  const visibleWords = subtitle.words.filter(
    (word) => currentTime >= word.startTime,
  );

  if (visibleWords.length === 0) {
    return { segments: [], visible: false };
  }

  const segments: WordSegment[] = visibleWords.map((word, index) => {
    const isLast = index === visibleWords.length - 1;
    const timeSinceStart = currentTime - word.startTime;
    const fadeInDuration = 0.1;
    const opacity = isLast ? clamp(timeSinceStart / fadeInDuration, 0, 1) : 1;

    return {
      text: word.text,
      style: "normal",
      opacity,
      scale: 1,
      offsetY: 0,
    };
  });

  return { segments, visible: true };
}

export function renderAnimatedCaption(
  subtitle: Subtitle,
  currentTime: number,
): AnimatedCaptionFrame {
  if (currentTime < subtitle.startTime || currentTime > subtitle.endTime) {
    return { segments: [], visible: false };
  }

  const animationStyle = subtitle.animationStyle || "none";

  switch (animationStyle) {
    case "word-highlight":
      return renderWordHighlight(subtitle, currentTime);
    case "word-by-word":
      return renderWordByWord(subtitle, currentTime);
    case "karaoke":
      return renderKaraoke(subtitle, currentTime);
    case "bounce":
      return renderBounce(subtitle, currentTime);
    case "typewriter":
      return renderTypewriter(subtitle, currentTime);
    case "none":
    default:
      return renderNone(subtitle);
  }
}

export function getAnimationStyleDisplayName(
  style: CaptionAnimationStyle,
): string {
  const names: Record<CaptionAnimationStyle, string> = {
    none: "Static",
    "word-highlight": "Word Highlight",
    "word-by-word": "Word by Word",
    karaoke: "Karaoke",
    bounce: "Bounce",
    typewriter: "Typewriter",
  };
  return names[style];
}

export const CAPTION_ANIMATION_STYLES: CaptionAnimationStyle[] = [
  "none",
  "word-highlight",
  "word-by-word",
  "karaoke",
  "bounce",
  "typewriter",
];
