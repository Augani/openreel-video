import { deflateRawSync, deflateSync, gzipSync } from "node:zlib";

/**
 * Builders for realistic .mogrt fixtures (Node only: tests and the Playwright suite). A .mogrt is a zip holding
 * definition.json, the graphic (gzip XML), thumb.png and a preview. The XML layout follows prgraphic.ts and the
 * definition.json fields follow the public evidence listed in definition.ts; no Premiere-written file was
 * available, so these are reconstructions, not captures.
 */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type FixtureFiles = Record<string, string | Uint8Array>;

/** Zip writer: deflate by default, "stored" for names in `stored`. */
export function zipFiles(files: FixtureFiles, stored: readonly string[] = []): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const useStore = stored.includes(name) || data.length === 0;
    const body = useStore ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useStore ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(useStore ? 0 : 8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

/** A solid-colour PNG (w x h). */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const TICKS = 254_016_000_000n;
export const ticks = (seconds: number): string => String(BigInt(Math.round(seconds * 1000)) * TICKS / 1000n);

const NAME_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a01";
const NAME_COLOR_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a02";
const TITLE_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a03";
const ACCENT_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a04";
const PLATE_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a05";
const OPACITY_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a06";
const DOT_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a07";
const LOGO_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a08";
const ROUND_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a09";
const ROT_CTL = "7f3a9c1e-2b4d-4e56-9a10-0c6d5e8f1a0a";

export const FIXTURE_CONTROL_IDS = { NAME_CTL, NAME_COLOR_CTL, TITLE_CTL, ACCENT_CTL, PLATE_CTL, OPACITY_CTL, DOT_CTL, LOGO_CTL, ROUND_CTL, ROT_CTL } as const;

/** Control type GUIDs are opaque in real files; the fixture uses made-up GUIDs, so the reader infers kinds from values. */
const T = {
  text: "a1b2c3d4-0001-4000-8000-000000000001",
  color: "a1b2c3d4-0002-4000-8000-000000000002",
  slider: "a1b2c3d4-0003-4000-8000-000000000003",
  checkbox: "a1b2c3d4-0004-4000-8000-000000000004",
  media: "a1b2c3d4-0005-4000-8000-000000000005",
};

const ls = (value: string) => ({ strDB: [{ locale: "en_US", str: value }] });

export function lowerThirdDefinition(): Record<string, unknown> {
  return {
    schemaversion: 1,
    authorApp: "ppro",
    authorAppVersion: "25.1.0",
    sourceInfoLocalized: { en_US: { name: "Broadcast Lower Third", description: "Name and title over an accent bar." } },
    capsule: {
      clientControls: [
        {
          id: NAME_CTL, type: T.text, uiName: ls("Name"), uiGroupName: ls("Text"),
          textEditValue: "ALEX MORGAN",
          fonteditinfo: { capPropFontEdit: true, capPropFontFauxStyleEdit: false, capPropFontSizeEdit: true, fontEditValue: "Montserrat-Bold", fontSizeEditValue: 56, fontFSBoldValue: false, fontFSItalicValue: false, fontFSAllCapsValue: false, fontFSSmallCapsValue: false },
        },
        { id: NAME_COLOR_CTL, type: T.color, uiName: ls("Name Colour"), uiGroupName: ls("Text"), value: [1, 1, 1, 1] },
        { id: TITLE_CTL, type: T.text, uiName: ls("Title"), uiGroupName: ls("Text"), value: ls("Senior Correspondent"), targets: [{ layer: "Title", property: "Source Text" }] },
        { id: ACCENT_CTL, type: T.color, uiName: ls("Accent Colour"), uiGroupName: ls("Style"), value: { r: 0.976, g: 0.451, b: 0.086, a: 1 } },
        { id: PLATE_CTL, type: T.color, uiName: ls("Plate Colour"), uiGroupName: ls("Style"), value: "#0f172a", targets: [{ layer: "Plate", property: "Fill Color" }] },
        { id: OPACITY_CTL, type: T.slider, uiName: ls("Plate Opacity"), uiGroupName: ls("Style"), value: 85, min: 0, max: 100 },
        { id: DOT_CTL, type: T.checkbox, uiName: ls("Show Dot"), uiGroupName: ls("Style"), value: true },
        { id: ROT_CTL, type: T.slider, uiName: ls("Tilt"), uiGroupName: ls("Style"), value: 0, min: -45, max: 45 },
        { id: LOGO_CTL, type: T.media, uiName: ls("Logo"), value: { mediaReplacement: true } },
        { id: ROUND_CTL, type: T.slider, uiName: ls("Corner Roundness"), value: 12, min: 0, max: 60 },
      ],
    },
  };
}

/** XML of the Premiere graphic: top layer first (panel order). */
export function lowerThirdGraphicXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<PremiereData Version="3">
  <Graphic ObjectUID="3b1f5a52-77f0-4c0e-9b53-0d6a3e1c9e01" Version="2">
    <Name>Broadcast Lower Third</Name>
    <Width>1920</Width><Height>1080</Height><FrameRate>25</FrameRate>
    <Duration>${ticks(6)}</Duration>
    <ResponsiveTime IntroDuration="0.8" OutroDuration="0.6"/>
    <Layers Order="TopToBottom">
      <ImageLayer ID="img1" Name="Logo" Visible="true">
        <Source>media/logo.png</Source>
        <Bounds X="0" Y="0" Width="96" Height="96"/>
        <Transform><Position Value="1700,160"/></Transform>
      </ImageLayer>
      <ShapeLayer ID="dot1" Name="Dot" Type="Ellipse" Visible="true">
        <Bounds X="0" Y="0" Width="24" Height="24"/>
        <Transform><Position Value="150,820"/></Transform>
        <Fill><Color>#ffffff</Color></Fill>
        <Visible ControlID="${DOT_CTL}"/>
      </ShapeLayer>
      <TextLayer ID="t2" Name="Title" Visible="true">
        <Bounds X="0" Y="0" Width="660" Height="40"/>
        <Transform>
          <Position Value="190,900"/>
          <Anchor Value="0,0"/>
          <Opacity><Keyframe Time="${ticks(0.35)}" Value="0" Interpolation="Bezier"/><Keyframe Time="${ticks(0.8)}" Value="100" Interpolation="Bezier"/></Opacity>
        </Transform>
        <Text>Senior Correspondent</Text>
        <Font>Montserrat</Font><FontStyle>Medium</FontStyle><FontSize>30</FontSize>
        <FillColor><Red>0.796</Red><Green>0.835</Green><Blue>0.882</Blue></FillColor>
        <Alignment>Left</Alignment><Tracking>50</Tracking><Leading>36</Leading>
        <Shadow Enabled="true"><Color>#000000</Color><Opacity>60</Opacity><Angle>135</Angle><Distance>3</Distance><Blur>4</Blur></Shadow>
      </TextLayer>
      <TextLayer ID="t1" Name="Name" Visible="true">
        <Bounds X="0" Y="0" Width="700" Height="64"/>
        <Transform>
          <Position Value="190,840"/>
          <Anchor Value="0,0"/>
          <Opacity><Keyframe Time="${ticks(0.2)}" Value="0" Interpolation="Bezier"/><Keyframe Time="${ticks(0.7)}" Value="100" Interpolation="Bezier"/></Opacity>
        </Transform>
        <Text ControlID="${NAME_CTL}">ALEX MORGAN</Text>
        <Font>Montserrat</Font><FontStyle>Bold</FontStyle><FontSize>56</FontSize>
        <FillColor ControlID="${NAME_COLOR_CTL}"><Red>1</Red><Green>1</Green><Blue>1</Blue></FillColor>
        <Alignment>Left</Alignment><Tracking>20</Tracking>
        <Stroke><Width>2</Width><Color>#000000</Color></Stroke>
      </TextLayer>
      <PathLayer ID="p1" Name="Swoosh" Type="Path" Visible="true">
        <Bounds X="0" Y="0" Width="300" Height="60"/>
        <Path>M0 0 C 100 50 200 -50 300 0</Path>
      </PathLayer>
      <ShapeLayer ID="acc" Name="Accent" Type="Rectangle" Visible="true">
        <Bounds X="0" Y="0" Width="14" Height="150"/>
        <Transform>
          <Position Value="150,870"/>
          <Anchor Value="0,0"/>
          <Scale><Keyframe Time="0" Value="100,0" Interpolation="Bezier"/><Keyframe Time="${ticks(0.5)}" Value="100,100" Interpolation="Bezier"/></Scale>
        </Transform>
        <Fill ControlID="${ACCENT_CTL}"><Color>#f97316</Color></Fill>
        <Effects><Effect Name="Glow"/></Effects>
      </ShapeLayer>
      <ShapeLayer ID="plate" Name="Plate" Type="Rectangle" Visible="true">
        <Bounds X="0" Y="0" Width="780" Height="150"/>
        <Transform>
          <Position Value="150,870"/>
          <Anchor Value="0,0"/>
          <Opacity ControlID="${OPACITY_CTL}" Value="85"/>
        </Transform>
        <Fill><Color>#0f172a</Color></Fill>
        <CornerRadius>12</CornerRadius>
        <Shadow Enabled="true"><Color>#000000</Color><Opacity>40</Opacity><Angle>180</Angle><Distance>8</Distance><Blur>16</Blur></Shadow>
        <BlendMode>Normal</BlendMode>
      </ShapeLayer>
    </Layers>
  </Graphic>
</PremiereData>`;
}

export interface LowerThirdOptions {
  /** `.prgraphic` (default) or `project.prproj`. */
  readonly graphicName?: string;
  /** Store (no compression) instead of deflate for these entries. */
  readonly stored?: readonly string[];
}

/** A Premiere-authored lower third: definition.json, gzip-XML graphic, logo, thumbnail and a stub preview. */
export function lowerThirdMogrt(options: LowerThirdOptions = {}): Uint8Array {
  return zipFiles(
    {
      "definition.json": JSON.stringify(lowerThirdDefinition(), null, 2),
      [options.graphicName ?? "Broadcast Lower Third.prgraphic"]: gzipSync(Buffer.from(lowerThirdGraphicXml(), "utf8")),
      "media/logo.png": solidPng(8, 8, [30, 120, 220]),
      "thumb.png": solidPng(16, 9, [15, 23, 42]),
      "preview.mp4": new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    },
    options.stored ?? [],
  );
}

/** An After Effects authored template: definition.json (authorApp "aeft") and an .aegraphic that cannot be rendered. */
export function afterEffectsMogrt(): Uint8Array {
  return zipFiles({
    "definition.json": JSON.stringify({
      authorApp: "aeft", authorAppVersion: "24.2",
      sourceInfoLocalized: { en_US: { name: "Kinetic Title" } },
      clientControls: [{ id: "ae-ctl-1", type: T.text, uiName: ls("Headline"), textEditValue: "HELLO" }, { id: "ae-ctl-2", type: T.color, uiName: ls("Colour"), value: [1, 0, 0, 1] }],
    }),
    "project.aegraphic": Buffer.from("AEGRAPHIC\0binary composition", "utf8"),
    "thumb.png": solidPng(16, 9, [200, 0, 0]),
  });
}

/** The minimal e2e / unit template: one large colour card and a headline. */
export function cardMogrt(): Uint8Array {
  const ctlText = "c0ffee00-0000-4000-8000-000000000001";
  const ctlColor = "c0ffee00-0000-4000-8000-000000000002";
  const xml = `<PremiereData Version="3"><Graphic><Name>Colour Card</Name><Width>1920</Width><Height>1080</Height>
  <DurationSeconds>4</DurationSeconds>
  <Layers>
    <TextLayer ID="head" Name="Headline"><Bounds X="0" Y="0" Width="1200" Height="120"/>
      <Transform><Position Value="960,540"/></Transform>
      <Text ControlID="${ctlText}">HEADLINE</Text><Font>Inter</Font><FontStyle>Bold</FontStyle><FontSize>96</FontSize>
      <FillColor><Color>#ffffff</Color></FillColor><Alignment>Center</Alignment></TextLayer>
    <ShapeLayer ID="card" Name="Card" Type="Rectangle"><Bounds X="0" Y="0" Width="1400" Height="500"/>
      <Transform><Position Value="960,540"/></Transform>
      <Fill ControlID="${ctlColor}"><Color>#1d4ed8</Color></Fill></ShapeLayer>
  </Layers></Graphic></PremiereData>`;
  return zipFiles({
    "definition.json": JSON.stringify({
      authorApp: "ppro",
      sourceInfoLocalized: { en_US: { name: "Colour Card" } },
      clientControls: [
        { id: ctlText, type: "a1b2c3d4-0001-4000-8000-000000000001", uiName: ls("Headline"), textEditValue: "HEADLINE" },
        { id: ctlColor, type: "a1b2c3d4-0002-4000-8000-000000000002", uiName: ls("Card Colour"), value: [0.114, 0.306, 0.847, 1] },
      ],
    }),
    "Colour Card.prgraphic": gzipSync(Buffer.from(xml, "utf8")),
    "thumb.png": solidPng(16, 9, [29, 78, 216]),
  });
}
