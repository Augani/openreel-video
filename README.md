<div align="center">

# OpenReel Video

### Your footage. Your timeline. Your final cut.

An open source video editor for the browser and desktop.<br>
Cut clips, add captions, mix audio, and finish your video without a watermark.

**[Open the editor](https://openreel.video)** &nbsp;·&nbsp; **[Download desktop](https://github.com/Augani/openreel-video/releases/latest)** &nbsp;·&nbsp; **[Get help](https://github.com/Augani/openreel-video/issues)**

[![License: MIT](https://img.shields.io/badge/License-MIT-6366F1?style=flat-square)](LICENSE)
[![Desktop releases](https://img.shields.io/github/v/release/Augani/openreel-video?include_prereleases&label=Desktop&style=flat-square&color=6366F1)](https://github.com/Augani/openreel-video/releases/latest)

<a href="https://github.com/sponsors/Augani">
  <img src="https://img.shields.io/badge/Sponsor_me-EA4AAA?style=for-the-badge&amp;logo=githubsponsors&amp;logoColor=white" alt="Sponsor me on GitHub" height="40">
</a>

</div>

---

## Make something worth watching

From a quick social clip to a longer edit, OpenReel gives you a timeline, a live preview, and control over the details.

| What you want to do | What you can use |
| :--- | :--- |
| **Get to the good part** | Trim, split, crop, ripple delete, rearrange clips, and change playback speed. |
| **Build your story** | Stack video, audio, text, and graphics on multiple tracks. Add transitions and animate with keyframes. |
| **Make every word readable** | Create and style captions, import SRT subtitles, and add animated titles. |
| **Make it sound right** | Mix music and dialogue with waveforms, volume controls, fades, EQ, compression, and audio ducking. |
| **Find your look** | Adjust color with wheels, curves, HSL controls, and LUTs. Add effects, masks, and chroma key. |
| **Fit the platform** | Work in landscape, portrait, or square, then choose export resolution, frame rate, and bitrate. |

## Start editing in minutes

1. **[Open OpenReel](https://openreel.video)** and create a project.
2. **Import your media** and drag clips onto the timeline.
3. **Shape your edit** with cuts, captions, music, color, and transitions.
4. **Export your video** using a preset or your own settings.

The browser editor needs no installation. For a native app, download a **macOS, Windows, or Linux** build from [Releases](https://github.com/Augani/openreel-video/releases/latest). Desktop builds are currently in **alpha**.

## Keep control of your footage

**Core editing and rendering happen on your device.** You can import, cut, preview, and export local media without uploading it to a server.

- **No export watermark.** Your finished video stays yours.
- **Open source, MIT licensed.** Use it for personal or commercial work, inspect the code, or host your own copy.
- **Save as you work.** Local autosave and undo/redo help you recover edits. Export project files for backups and moving between sessions.
- **Choose when to connect.** Optional AI and connected services use network requests; their data handling depends on the provider and feature you choose.

Browser storage can be cleared by your browser. Keep backups of your project files and original media for work you want to keep.

## Export for the next step

| Destination | Export options |
| :--- | :--- |
| **Social posts, tutorials, and everyday sharing** | MP4 with H.264; landscape, portrait, and square presets. |
| **Web playback** | WebM, with codec availability determined by your browser and device. |
| **High-resolution delivery** | Resolution presets up to 4K, plus custom frame rate and bitrate controls. |
| **Further editing and compositing** | Use desktop for ProRes and exports that need transparency. |

Browser codec support, available memory, and hardware affect which settings you can use and how fast exports finish. OpenReel adjusts unsupported browser settings where needed; use desktop when you need native export capabilities.

## A little help from AI, if you want it

Describe an edit in the **AI Editor** panel: trim a clip, add a title, adjust a transform, or build a sequence through chat. Connect your own OpenAI, Anthropic, or compatible endpoint.

AI is optional and provider usage may cost money. See the [AI Editor setup guide](docs/AGENT-GUIDE.md#bring-your-own-key-web--desktop-chat) for configuration, data handling, and approval controls. Desktop also supports [MCP clients](docs/AGENT-GUIDE.md), so external assistants can work with your project.

## Choose your setup

| | Browser | Desktop |
| :--- | :--- | :--- |
| **Get started** | [Open the web editor](https://openreel.video) | [Download a release](https://github.com/Augani/openreel-video/releases/latest) |
| **Install** | No installation | macOS, Windows, or Linux |
| **Editing** | Timeline, captions, audio, color, effects, and keyframes | The editor with native desktop integrations |
| **Export** | Browser-supported codecs and settings | Native FFmpeg export, including ProRes/alpha workflows |
| **AI connection** | Bring your own provider or compatible endpoint | Provider connections plus external MCP clients |

Use an up-to-date browser. Chrome or Edge is a good starting point; codec and GPU support vary across browsers and operating systems. Larger projects and 4K footage benefit from more memory and a capable GPU.

---

## Run it locally

Install [Node.js](https://nodejs.org/) and the pnpm version declared in [`package.json`](package.json), then:

```bash
git clone https://github.com/Augani/openreel-video.git
cd openreel-video
pnpm install
pnpm dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

```bash
# Build and preview the browser app
pnpm build
pnpm preview

# Check your changes
pnpm typecheck
pnpm test
pnpm lint
```

<details>
<summary><strong>Inside the project</strong></summary>

<br>

| Path | Purpose |
| :--- | :--- |
| [`apps/web`](apps/web) | Browser editor and shared desktop interface |
| [`apps/desktop`](apps/desktop) | Desktop app, native integrations, and packaging |
| [`packages/core`](packages/core) | Timeline, media, audio, rendering, and export engines |
| [`packages/ui`](packages/ui) | Shared interface components |
| [`packages/agent`](packages/agent) | AI editing tools and routing |

Built with React, TypeScript, Zustand, MediaBunny, WebCodecs, WebGPU, Web Audio, and Three.js.

For desktop packaging, see the [distribution guide](apps/desktop/DISTRIBUTION.md).

</details>

## Help shape OpenReel

**Found a bug?** [Open an issue](https://github.com/Augani/openreel-video/issues/new) with what you tried, what happened, your browser or desktop version, and steps to reproduce it.

**Want to contribute?** Start with the [contributing guide](CONTRIBUTING.md). Fixes, documentation, accessibility improvements, and reproducible test cases all help.

**Want to support development?** [Sponsor Augustus on GitHub](https://github.com/sponsors/Augani) to support continued work on OpenReel.

---

<div align="center">

Made by [Augustus Otu](https://github.com/Augani) and [contributors](https://github.com/Augani/openreel-video/graphs/contributors).<br>
[MIT License](LICENSE) &nbsp;·&nbsp; [Updates on X](https://x.com/python_xi) &nbsp;·&nbsp; [Sponsor](https://github.com/sponsors/Augani)

</div>
