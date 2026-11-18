/** AUID helpers and the AAF identifiers (classes, data definitions, operations, property ids) used by the AAF code. */

const HEX = "0123456789abcdef";

export const hexOf = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s;
};

/** Canonical "01030202-0100-0000-060e-2b3404010101" -> the 16 bytes AAF stores (GUID little-endian layout). */
export function auid(canonical: string): Uint8Array {
  const hex = canonical.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Bad AUID ${canonical}`);
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const out = new Uint8Array(16);
  out.set([b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6]], 0);
  out.set(b.subarray(8), 8);
  return out;
}

/** The 16 stored bytes -> canonical lowercase "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx". */
export function auidString(bytes: Uint8Array, offset = 0): string {
  const b = bytes.subarray(offset, offset + 16);
  const h = (i: number): string => HEX[b[i] >> 4] + HEX[b[i] & 15];
  return (
    `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-` +
    `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
  );
}

const CLASS_SUFFIX = "-060e-2b3402060101";
const cls = (n: string): string => `0d010101-0101-${n}00${CLASS_SUFFIX}`;

export const CLASS = {
  root: "b3b398a5-1c90-11d4-8053-080036210804",
  header: cls("2f"),
  dictionary: cls("22"),
  contentStorage: cls("18"),
  identification: cls("30"),
  compositionMob: cls("35"),
  masterMob: cls("36"),
  sourceMob: cls("37"),
  eventMobSlot: cls("39"),
  staticMobSlot: cls("3a"),
  timelineMobSlot: cls("3b"),
  sequence: cls("0f"),
  sourceClip: cls("11"),
  filler: cls("09"),
  transition: cls("17"),
  operationGroup: cls("0a"),
  timecode: cls("14"),
  nestedScope: cls("0b"),
  scopeReference: cls("0d"),
  selector: cls("0e"),
  essenceGroup: cls("05"),
  pulldown: cls("0c"),
  commentMarker: cls("08"),
  descriptiveMarker: cls("41"),
  constantValue: cls("3d"),
  varyingValue: cls("3e"),
  importDescriptor: cls("4a"),
  networkLocator: cls("32"),
  operationDef: cls("1c"),
  parameterDef: cls("1d"),
} as const;

export const DATADEF = {
  picture: "01030202-0100-0000-060e-2b3404010101",
  sound: "01030202-0200-0000-060e-2b3404010101",
  timecode: "01030201-0100-0000-060e-2b3404010101",
  descriptive: "01030201-1000-0000-060e-2b3404010101",
  legacyPicture: "6f3c8ce1-6cef-11d2-807d-006008143e6f",
  legacySound: "78e1ebe1-6cef-11d2-807d-006008143e6f",
  legacyTimecode: "7f275e81-77e5-11d2-807f-006008143e6f",
} as const;

export const OPERATION = {
  videoDissolve: "0c3bea40-fc05-11d2-8a29-0050040ef7d2",
  monoAudioDissolve: "0c3bea41-fc05-11d2-8a29-0050040ef7d2",
  stereoAudioDissolve: "0c3bea42-fc05-11d2-8a29-0050040ef7d2",
  videoFadeToBlack: "0c3bea43-fc05-11d2-8a29-0050040ef7d2",
  smpteVideoWipe: "0c3bea44-fc05-11d2-8a29-0050040ef7d2",
  videoSpeedControl: "9d2ea890-0968-11d3-8a38-0050040ef7d2",
  monoAudioGain: "9d2ea894-0968-11d3-8a38-0050040ef7d2",
  stereoAudioGain: "9d2ea895-0968-11d3-8a38-0050040ef7d2",
  videoOpacity: "9bb90dfd-2aad-49af-b09c-8ba6cd5281d1",
} as const;

export const PARAMETER = {
  speedRatio: "72559a80-24d7-11d3-8a50-0050040ef7d2",
  amplitude: "e4962321-2267-11d3-8a4c-0050040ef7d2",
  level: "e4962320-2267-11d3-8a4c-0050040ef7d2",
} as const;

export const TYPEDEF_RATIONAL = "03010100-0000-0000-060e-2b3401040101";
export const USAGE_TOPLEVEL = "0d010102-0101-0700-060e-2b3404010101";
export const OPERATION_CATEGORY_EFFECT = "0d010102-0101-0100-060e-2b3404010101";
export const OPERATIONAL_PATTERN_UNSPECIFIED = "0d011201-0100-0000-060e-2b3404010105";

/** Property ids (AAF object specification). */
export const PID = {
  // Root / Header
  rootMetaDictionary: 0x0001,
  rootHeader: 0x0002,
  headerContent: 0x3b03,
  headerDictionary: 0x3b04,
  headerLastModified: 0x3b02,
  headerIdentificationList: 0x3b06,
  // Identification
  identDate: 0x3c06,
  identGenerationAUID: 0x3c09,
  // Dictionary
  dictOperationDefinitions: 0x2603,
  dictParameterDefinitions: 0x2604,
  dictDataDefinitions: 0x2605,
  // Definition objects
  defIdentification: 0x1b01,
  defName: 0x1b02,
  defDescription: 0x1b03,
  opDataDefinition: 0x1e01,
  opIsTimeWarp: 0x1e02,
  opCategory: 0x1e06,
  opNumberInputs: 0x1e07,
  opBypass: 0x1e08,
  paramDefType: 0x1f01,
  // ContentStorage
  contentMobs: 0x1901,
  // Mob
  mobId: 0x4401,
  mobName: 0x4402,
  mobSlots: 0x4403,
  mobLastModified: 0x4404,
  mobCreationTime: 0x4405,
  mobUsageCode: 0x4408,
  sourceMobDescriptor: 0x4701,
  // MobSlot
  slotId: 0x4801,
  slotName: 0x4802,
  slotSegment: 0x4803,
  slotPhysicalTrack: 0x4804,
  eventEditRate: 0x4901,
  timelineEditRate: 0x4b01,
  timelineOrigin: 0x4b02,
  // Component
  dataDefinition: 0x0201,
  length: 0x0202,
  // Sequence / SourceClip / Transition / OperationGroup / Timecode / Event
  components: 0x1001,
  sourceId: 0x1101,
  sourceMobSlotId: 0x1102,
  startTime: 0x1201,
  tcStart: 0x1501,
  tcFps: 0x1502,
  tcDrop: 0x1503,
  transitionOperationGroup: 0x1801,
  transitionCutPoint: 0x1802,
  ogOperation: 0x0b01,
  ogInputSegments: 0x0b02,
  ogParameters: 0x0b03,
  eventPosition: 0x0601,
  eventComment: 0x0602,
  describedSlots: 0x6102,
  // Parameter
  paramDefinition: 0x4c01,
  paramValue: 0x4d01,
  // Descriptors / locators
  descriptorLocator: 0x2f01,
  locatorUrl: 0x4001,
} as const;

/** Property storage formats (SF_*). */
export const FMT = {
  data: 0x82,
  strongRef: 0x22,
  strongRefVector: 0x32,
  strongRefSet: 0x3a,
  weakRef: 0x02,
  weakRefVector: 0x12,
  weakRefSet: 0x1a,
  stream: 0x42,
} as const;

/** The weak-reference table of every file this writer emits (pid paths, see "referenced properties"). */
export const WEAKREF_PATHS: readonly (readonly number[])[] = [
  [0x0001, 0x0003], // MetaDictionary ClassDefinitions (index 0)
  [0x0001, 0x0004], // MetaDictionary TypeDefinitions (index 1)
  [0x0002, 0x3b04, 0x2605], // Header Dictionary DataDefinitions (index 2)
  [0x0002, 0x3b04, 0x2603], // Header Dictionary OperationDefinitions (index 3)
];
export const WEAKREF_INDEX = { typeDef: 1, dataDef: 2, operationDef: 3 } as const;

/** Shortens `name` to `size` characters the way the AAF SDK does for property storage names. */
export function squeezeName(name: string, size: number): string {
  if (name.length <= size) return name;
  const half = Math.floor(size / 2);
  let out = "";
  for (let i = 0; i < size; i++) {
    if (i < half) out += name[i];
    else if (i === half) out += "-";
    else out += name[name.length - (size - i)];
  }
  return out;
}

/** Storage name for a property: `mangleName("Slots", 0x4403, 32)` -> "Slots-4403". */
export function mangleName(name: string, pid: number, size: number): string {
  const p = pid.toString(16);
  return `${squeezeName(name, size - p.length - 2)}-${p}`;
}
