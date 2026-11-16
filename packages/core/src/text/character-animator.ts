import type { TextClip } from "./types";
import { isTextAnimationEntry, resolveTextAnimationPhase } from "./text-animation-phase";
import {
  calculateUnitAnimationState,
  type AnimatedUnit,
  type UnitAnimationState,
  type TextAnimationContext,
} from "./text-animation-presets";

interface CharacterInfo {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineIndex: number;
  charIndexInLine: number;
  globalIndex: number;
}

interface WordInfo {
  word: string;
  chars: CharacterInfo[];
  x: number;
  y: number;
  width: number;
  height: number;
  lineIndex: number;
  wordIndexInLine: number;
  globalIndex: number;
}

interface LineInfo {
  text: string;
  words: WordInfo[];
  x: number;
  y: number;
  width: number;
  height: number;
  lineIndex: number;
}

interface TextLayout {
  characters: CharacterInfo[];
  words: WordInfo[];
  lines: LineInfo[];
  totalWidth: number;
  totalHeight: number;
}

interface AnimatedCharacter extends CharacterInfo {
  state: UnitAnimationState;
}

interface AnimatedWord extends WordInfo {
  state: UnitAnimationState;
  animatedChars: AnimatedCharacter[];
}

interface AnimatedLine extends LineInfo {
  state: UnitAnimationState;
  animatedWords: AnimatedWord[];
}

interface AnimatedTextLayout {
  lines: AnimatedLine[];
  totalWidth: number;
  totalHeight: number;
}

export class CharacterAnimator {
  private measureCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;

  constructor() {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(1, 1);
      this.measureCtx = canvas.getContext("2d");
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      this.measureCtx = canvas.getContext("2d");
    }
  }

  measureText(
    text: string,
    fontFamily: string,
    fontSize: number,
    fontWeight: string | number,
    letterSpacing: number,
    lineHeight: number,
  ): TextLayout {
    if (!this.measureCtx) {
      return this.createFallbackLayout(text, fontSize, lineHeight);
    }

    const ctx = this.measureCtx;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const lines = text.split("\n");
    const lineInfos: LineInfo[] = [];
    const allCharacters: CharacterInfo[] = [];
    const allWords: WordInfo[] = [];

    let globalCharIndex = 0;
    let globalWordIndex = 0;
    let currentY = 0;
    const lineHeightPx = fontSize * lineHeight;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      const lineWords: WordInfo[] = [];
      const lineMetrics = ctx.measureText(lineText);
      const lineWidth =
        lineMetrics.width + (lineText.length - 1) * letterSpacing;

      let currentX = 0;
      const wordsInLine = lineText.split(/(\s+)/);
      let wordIndexInLine = 0;

      for (const word of wordsInLine) {
        if (!word) continue;

        const isWhitespace = /^\s+$/.test(word);
        const wordChars: CharacterInfo[] = [];
        const wordStartX = currentX;

        for (let i = 0; i < word.length; i++) {
          const char = word[i];
          const charMetrics = ctx.measureText(char);
          const charWidth = charMetrics.width;

          const charInfo: CharacterInfo = {
            char,
            x: currentX,
            y: currentY,
            width: charWidth,
            height: fontSize,
            lineIndex,
            charIndexInLine: wordChars.length,
            globalIndex: globalCharIndex,
          };

          wordChars.push(charInfo);
          allCharacters.push(charInfo);
          globalCharIndex++;
          currentX += charWidth + letterSpacing;
        }

        if (!isWhitespace && wordChars.length > 0) {
          const wordWidth = currentX - wordStartX - letterSpacing;
          const wordInfo: WordInfo = {
            word,
            chars: wordChars,
            x: wordStartX,
            y: currentY,
            width: wordWidth,
            height: fontSize,
            lineIndex,
            wordIndexInLine,
            globalIndex: globalWordIndex,
          };
          lineWords.push(wordInfo);
          allWords.push(wordInfo);
          globalWordIndex++;
          wordIndexInLine++;
        }
      }

      const lineInfo: LineInfo = {
        text: lineText,
        words: lineWords,
        x: 0,
        y: currentY,
        width: lineWidth,
        height: lineHeightPx,
        lineIndex,
      };
      lineInfos.push(lineInfo);
      currentY += lineHeightPx;
    }

    const totalWidth = Math.max(...lineInfos.map((l) => l.width), 0);
    const totalHeight = currentY;

    return {
      characters: allCharacters,
      words: allWords,
      lines: lineInfos,
      totalWidth,
      totalHeight,
    };
  }

  private createFallbackLayout(
    text: string,
    fontSize: number,
    lineHeight: number,
  ): TextLayout {
    const avgCharWidth = fontSize * 0.6;
    const lines = text.split("\n");
    const lineInfos: LineInfo[] = [];
    const allCharacters: CharacterInfo[] = [];
    const allWords: WordInfo[] = [];

    let globalCharIndex = 0;
    let globalWordIndex = 0;
    let currentY = 0;
    const lineHeightPx = fontSize * lineHeight;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      const lineWords: WordInfo[] = [];
      let currentX = 0;

      const wordsInLine = lineText.split(/(\s+)/);

      for (const word of wordsInLine) {
        if (!word) continue;

        const isWhitespace = /^\s+$/.test(word);
        const wordChars: CharacterInfo[] = [];
        const wordStartX = currentX;

        for (let i = 0; i < word.length; i++) {
          const char = word[i];
          const charWidth = avgCharWidth;

          const charInfo: CharacterInfo = {
            char,
            x: currentX,
            y: currentY,
            width: charWidth,
            height: fontSize,
            lineIndex,
            charIndexInLine: wordChars.length,
            globalIndex: globalCharIndex,
          };

          wordChars.push(charInfo);
          allCharacters.push(charInfo);
          globalCharIndex++;
          currentX += charWidth;
        }

        if (!isWhitespace && wordChars.length > 0) {
          const wordWidth = currentX - wordStartX;
          const wordInfo: WordInfo = {
            word,
            chars: wordChars,
            x: wordStartX,
            y: currentY,
            width: wordWidth,
            height: fontSize,
            lineIndex,
            wordIndexInLine: lineWords.length,
            globalIndex: globalWordIndex,
          };
          lineWords.push(wordInfo);
          allWords.push(wordInfo);
          globalWordIndex++;
        }
      }

      const lineInfo: LineInfo = {
        text: lineText,
        words: lineWords,
        x: 0,
        y: currentY,
        width: currentX,
        height: lineHeightPx,
        lineIndex,
      };
      lineInfos.push(lineInfo);
      currentY += lineHeightPx;
    }

    return {
      characters: allCharacters,
      words: allWords,
      lines: lineInfos,
      totalWidth: Math.max(...lineInfos.map((l) => l.width), 0),
      totalHeight: currentY,
    };
  }

  calculateAnimatedLayout(
    clip: TextClip,
    currentTime: number,
  ): AnimatedTextLayout {
    const sourceAnimation = clip.animation;
    const relativeTime = currentTime - clip.startTime;
    const animation = sourceAnimation
      ? resolveTextAnimationPhase(sourceAnimation, isTextAnimationEntry(sourceAnimation, relativeTime, clip.duration))
      : undefined;
    if (!animation || animation.preset === "none") {
      return this.createStaticLayout(clip);
    }

    const layout = this.measureText(
      clip.text,
      clip.style.fontFamily,
      clip.style.fontSize,
      String(clip.style.fontWeight),
      clip.style.letterSpacing,
      clip.style.lineHeight,
    );

    const clipDuration = clip.duration;

    const isInPhase = relativeTime <= (sourceAnimation?.out && sourceAnimation.preset === "none" ? 0 : animation.inDuration);
    const isOutPhase = relativeTime >= clipDuration - animation.outDuration;
    const isMiddlePhase = !isInPhase && !isOutPhase;

    let progress: number;
    let isIn: boolean;

    if (isInPhase) {
      progress =
        animation.inDuration > 0 ? relativeTime / animation.inDuration : 1;
      isIn = true;
    } else if (isOutPhase) {
      const outStart = clipDuration - animation.outDuration;
      progress =
        animation.outDuration > 0
          ? (relativeTime - outStart) / animation.outDuration
          : 0;
      isIn = false;
    } else {
      progress = 1;
      isIn = true;
    }

    const unit = animation.unit || "character";
    const animatedLines: AnimatedLine[] = [];

    for (const lineInfo of layout.lines) {
      const animatedWords: AnimatedWord[] = [];

      for (const wordInfo of lineInfo.words) {
        const animatedChars: AnimatedCharacter[] = [];

        for (const charInfo of wordInfo.chars) {
          let animatedUnit: AnimatedUnit;
          let totalUnits: number;

          if (unit === "character") {
            animatedUnit = {
              text: charInfo.char,
              index: charInfo.globalIndex,
              totalUnits: layout.characters.length,
              x: charInfo.x,
              y: charInfo.y,
              width: charInfo.width,
              height: charInfo.height,
            };
            totalUnits = layout.characters.length;
          } else if (unit === "word") {
            animatedUnit = {
              text: wordInfo.word,
              index: wordInfo.globalIndex,
              totalUnits: layout.words.length,
              x: wordInfo.x,
              y: wordInfo.y,
              width: wordInfo.width,
              height: wordInfo.height,
            };
            totalUnits = layout.words.length;
          } else {
            animatedUnit = {
              text: lineInfo.text,
              index: lineInfo.lineIndex,
              totalUnits: layout.lines.length,
              x: lineInfo.x,
              y: lineInfo.y,
              width: lineInfo.width,
              height: lineInfo.height,
            };
            totalUnits = layout.lines.length;
          }

          const ctx: TextAnimationContext = {
            unit: { ...animatedUnit, totalUnits },
            progress: isMiddlePhase ? 1 : progress,
            isIn,
            animation,
            totalDuration: clipDuration,
          };

          const state = calculateUnitAnimationState(ctx);

          animatedChars.push({
            ...charInfo,
            state,
          });
        }

        const wordUnit: AnimatedUnit = {
          text: wordInfo.word,
          index: wordInfo.globalIndex,
          totalUnits: layout.words.length,
          x: wordInfo.x,
          y: wordInfo.y,
          width: wordInfo.width,
          height: wordInfo.height,
        };

        const wordCtx: TextAnimationContext = {
          unit: wordUnit,
          progress: isMiddlePhase ? 1 : progress,
          isIn,
          animation,
          totalDuration: clipDuration,
        };

        const wordState =
          unit === "word" || unit === "line"
            ? calculateUnitAnimationState(wordCtx)
            : {
                opacity: 1,
                scale: { x: 1, y: 1 },
                rotation: 0,
                offsetX: 0,
                offsetY: 0,
                blur: 0,
              };

        animatedWords.push({
          ...wordInfo,
          state: wordState,
          animatedChars,
        });
      }

      const lineUnit: AnimatedUnit = {
        text: lineInfo.text,
        index: lineInfo.lineIndex,
        totalUnits: layout.lines.length,
        x: lineInfo.x,
        y: lineInfo.y,
        width: lineInfo.width,
        height: lineInfo.height,
      };

      const lineCtx: TextAnimationContext = {
        unit: lineUnit,
        progress: isMiddlePhase ? 1 : progress,
        isIn,
        animation,
        totalDuration: clipDuration,
      };

      const lineState =
        unit === "line"
          ? calculateUnitAnimationState(lineCtx)
          : {
              opacity: 1,
              scale: { x: 1, y: 1 },
              rotation: 0,
              offsetX: 0,
              offsetY: 0,
              blur: 0,
            };

      animatedLines.push({
        ...lineInfo,
        state: lineState,
        animatedWords,
      });
    }

    return {
      lines: animatedLines,
      totalWidth: layout.totalWidth,
      totalHeight: layout.totalHeight,
    };
  }

  private createStaticLayout(clip: TextClip): AnimatedTextLayout {
    const layout = this.measureText(
      clip.text,
      clip.style.fontFamily,
      clip.style.fontSize,
      String(clip.style.fontWeight),
      clip.style.letterSpacing,
      clip.style.lineHeight,
    );

    const defaultState: UnitAnimationState = {
      opacity: 1,
      scale: { x: 1, y: 1 },
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      blur: 0,
    };

    const animatedLines: AnimatedLine[] = layout.lines.map((line) => ({
      ...line,
      state: defaultState,
      animatedWords: line.words.map((word) => ({
        ...word,
        state: defaultState,
        animatedChars: word.chars.map((char) => ({
          ...char,
          state: defaultState,
        })),
      })),
    }));

    return {
      lines: animatedLines,
      totalWidth: layout.totalWidth,
      totalHeight: layout.totalHeight,
    };
  }
}

