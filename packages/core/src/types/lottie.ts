export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: number;
  assets: LottieAsset[];
  layers: LottieLayer[];
  markers?: LottieMarker[];
  meta?: LottieMeta;
}

export interface LottieMeta {
  g: string;
  a: string;
  k: string;
  d: string;
  tc: string;
}

export interface LottieMarker {
  tm: number;
  cm: string;
  dr: number;
}

export type LottieAsset = LottieImageAsset | LottiePrecompAsset;

interface LottieImageAsset {
  id: string;
  w: number;
  h: number;
  u: string;
  p: string;
  e?: number;
}

interface LottiePrecompAsset {
  id: string;
  nm: string;
  layers: LottieLayer[];
}

export type LottieLayer =
  | LottiePrecompLayer
  | LottieSolidLayer
  | LottieImageLayer
  | LottieNullLayer
  | LottieShapeLayer
  | LottieTextLayer;

interface BaseLottieLayer {
  ddd: number;
  ind: number;
  ty: number;
  nm: string;
  sr: number;
  ks: LottieTransform;
  ao: number;
  ip: number;
  op: number;
  st: number;
  bm: number;
  parent?: number;
  tt?: number;
  td?: number;
  hasMask?: boolean;
  masksProperties?: LottieMask[];
}

export interface LottiePrecompLayer extends BaseLottieLayer {
  ty: 0;
  refId: string;
  w: number;
  h: number;
  tm?: LottieAnimatedProperty;
}

export interface LottieSolidLayer extends BaseLottieLayer {
  ty: 1;
  sc: string;
  sh: number;
  sw: number;
}

export interface LottieImageLayer extends BaseLottieLayer {
  ty: 2;
  refId: string;
}

export interface LottieNullLayer extends BaseLottieLayer {
  ty: 3;
}

export interface LottieShapeLayer extends BaseLottieLayer {
  ty: 4;
  shapes: LottieShape[];
}

export interface LottieTextLayer extends BaseLottieLayer {
  ty: 5;
  t: LottieTextData;
}

export interface LottieTransform {
  a?: LottieAnimatedProperty;
  p?: LottieAnimatedProperty | LottieSeparatedProperty;
  s?: LottieAnimatedProperty;
  r?: LottieAnimatedProperty;
  o?: LottieAnimatedProperty;
  sk?: LottieAnimatedProperty;
  sa?: LottieAnimatedProperty;
  rx?: LottieAnimatedProperty;
  ry?: LottieAnimatedProperty;
  rz?: LottieAnimatedProperty;
  or?: LottieAnimatedProperty;
}

export interface LottieAnimatedProperty {
  a: 0 | 1;
  k: number | number[] | LottieKeyframe[];
  ix?: number;
  x?: string;
}

export interface LottieSeparatedProperty {
  s: boolean;
  x: LottieAnimatedProperty;
  y: LottieAnimatedProperty;
}

export interface LottieKeyframe {
  t: number;
  s: number[];
  e?: number[];
  i?: LottieBezier;
  o?: LottieBezier;
  h?: 0 | 1;
}

export interface LottieBezier {
  x: number | number[];
  y: number | number[];
}

interface LottieMask {
  inv: boolean;
  mode: "a" | "s" | "i" | "f" | "d" | "l" | "n";
  pt: LottieAnimatedProperty;
  o: LottieAnimatedProperty;
  x: LottieAnimatedProperty;
}

export type LottieShape =
  | LottieGroupShape
  | LottieRectShape
  | LottieEllipseShape
  | LottiePathShape
  | LottieStarShape
  | LottieFillShape
  | LottieStrokeShape
  | LottieGradientFillShape
  | LottieGradientStrokeShape
  | LottieTransformShape
  | LottieTrimShape;

interface BaseLottieShape {
  ty: string;
  nm: string;
  hd?: boolean;
}

export interface LottieGroupShape extends BaseLottieShape {
  ty: "gr";
  it: LottieShape[];
  np: number;
  cix: number;
  bm: number;
  ix: number;
  mn: string;
}

export interface LottieRectShape extends BaseLottieShape {
  ty: "rc";
  d: number;
  s: LottieAnimatedProperty;
  p: LottieAnimatedProperty;
  r: LottieAnimatedProperty;
}

export interface LottieEllipseShape extends BaseLottieShape {
  ty: "el";
  d: number;
  s: LottieAnimatedProperty;
  p: LottieAnimatedProperty;
}

export interface LottiePathShape extends BaseLottieShape {
  ty: "sh";
  ind: number;
  ix: number;
  ks: LottieAnimatedProperty;
  d?: number;
}

export interface LottieFillShape extends BaseLottieShape {
  ty: "fl";
  c: LottieAnimatedProperty;
  o: LottieAnimatedProperty;
  r: number;
  bm: number;
}

export interface LottieStrokeShape extends BaseLottieShape {
  ty: "st";
  c: LottieAnimatedProperty;
  o: LottieAnimatedProperty;
  w: LottieAnimatedProperty;
  lc: number;
  lj: number;
  ml?: number;
  bm: number;
  d?: LottieStrokeDash[];
}

interface LottieStrokeDash {
  n: "o" | "d" | "g";
  v: LottieAnimatedProperty;
}

export interface LottieTransformShape extends BaseLottieShape {
  ty: "tr";
  p: LottieAnimatedProperty;
  a: LottieAnimatedProperty;
  s: LottieAnimatedProperty;
  r: LottieAnimatedProperty;
  o: LottieAnimatedProperty;
  sk?: LottieAnimatedProperty;
  sa?: LottieAnimatedProperty;
}

export interface LottieTrimShape extends BaseLottieShape {
  ty: "tm";
  s: LottieAnimatedProperty;
  e: LottieAnimatedProperty;
  o: LottieAnimatedProperty;
  m: 1 | 2;
}

export interface LottieStarShape extends BaseLottieShape {
  ty: "sr";
  sy?: number;
  p?: LottieAnimatedProperty;
  pt?: LottieAnimatedProperty;
  or?: LottieAnimatedProperty;
  ir?: LottieAnimatedProperty;
  r?: LottieAnimatedProperty;
  os?: LottieAnimatedProperty;
  is?: LottieAnimatedProperty;
}

export interface LottieGradientFillShape extends BaseLottieShape {
  ty: "gf";
  t?: 1 | 2;
  g?: LottieGradientColors;
  s?: LottieAnimatedProperty;
  e?: LottieAnimatedProperty;
  o?: LottieAnimatedProperty;
}

export interface LottieGradientStrokeShape extends BaseLottieShape {
  ty: "gs";
  t?: 1 | 2;
  g?: LottieGradientColors;
  s?: LottieAnimatedProperty;
  e?: LottieAnimatedProperty;
  w?: LottieAnimatedProperty;
  o?: LottieAnimatedProperty;
}

interface LottieGradientColors {
  p: number;
  k: LottieAnimatedProperty;
}

export interface LottieTextData {
  d: LottieTextDocument;
  p: LottieTextMoreOptions;
  m: LottieTextAlignmentOptions;
  a: LottieTextAnimator[];
}

interface LottieTextDocument {
  k: LottieTextDocumentKeyframe[];
}

interface LottieTextDocumentKeyframe {
  s: {
    s: number;
    f: string;
    t: string;
    ca?: number;
    j: number;
    tr: number;
    lh: number;
    ls?: number;
    fc: number[];
    sc?: number[];
    sw?: number;
    of?: boolean;
  };
  t: number;
}

interface LottieTextMoreOptions {
  a?: LottieAnimatedProperty;
  p?: LottieAnimatedProperty;
  r?: LottieAnimatedProperty;
  sw?: LottieAnimatedProperty;
}

interface LottieTextAlignmentOptions {
  g: number;
  a: LottieAnimatedProperty;
}

interface LottieTextAnimator {
  nm: string;
  a: LottieTextAnimatorProperties;
  s?: LottieTextSelector;
}

interface LottieTextAnimatorProperties {
  p?: LottieAnimatedProperty;
  a?: LottieAnimatedProperty;
  s?: LottieAnimatedProperty;
  r?: LottieAnimatedProperty;
  o?: LottieAnimatedProperty;
  fc?: LottieAnimatedProperty;
  sc?: LottieAnimatedProperty;
  sw?: LottieAnimatedProperty;
  fh?: LottieAnimatedProperty;
  fs?: LottieAnimatedProperty;
  fb?: LottieAnimatedProperty;
  t?: LottieAnimatedProperty;
}

interface LottieTextSelector {
  t: number;
  xe?: LottieAnimatedProperty;
  ne?: LottieAnimatedProperty;
  a?: LottieAnimatedProperty;
  b?: number;
  sh?: number;
  s?: LottieAnimatedProperty;
  e?: LottieAnimatedProperty;
  o?: LottieAnimatedProperty;
  r?: number;
  rn?: number;
  sm?: LottieAnimatedProperty;
}
