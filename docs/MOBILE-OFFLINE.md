# Mobile offline mode

OpenReel's iOS and Android apps are offline-first editors. They do not submit media, prompts, device attestations, or analysis jobs to an OpenReel server.

## Local replacements

| Former cloud/GPU workflow | iOS | Android |
| --- | --- | --- |
| Subject/background work | Vision person segmentation, chroma key, subject blur/glow | Green/blue chroma key and local masks |
| Tracking | Vision face/body/subject/object analysis | Bundled ML Kit object tracking |
| Auto reframe | Vision tracking plus local Core Image/Metal render | ML Kit tracking converted to centering keyframes |
| Stabilization | Vision motion path plus local render | ML Kit counter-motion keyframes |
| Silence trimming | Local subtitle/transcript timeline cuts | Local PCM silence analysis and timeline cuts |
| Auto captions | Apple on-device Speech model when installed; SRT/VTT import otherwise | ML Kit on-device Speech model; SRT/VTT import otherwise |
| Short creation | Sampled-frame motion/detail ranking and local virality scoring | Sampled-frame motion/detail ranking and local virality scoring |
| Music generation | Local music import and procedural sound effects | Prompt-selected procedural music rendered to WAV on device |
| Filters/LUTs | Bundled presets and verified LUT | Bundled presets and verified LUT |
| Voiceover/TTS | AVFoundation recording and system speech synthesis | Local recording and installed Android TTS engine |

Tools that require large generative models without a dependable bundled mobile implementation—such as diffusion image repair, arbitrary prompt-to-music models, stem separation, and general speech translation—are not exposed as working actions.

## Guardrail

Android may download an optional caption language pack after the user confirms the download. Caption generation requires the installed model and processes decoded clip audio on device; it does not fall back to a remote transcription service. Editing and imported captions remain available without that pack.

Run `node scripts/check-mobile-offline.mjs`. It permits Android network permissions only alongside the explicit ML Kit language-pack confirmation flow, rejects direct network/cloud clients and cleartext opt-in, and verifies the bundled LUTs. iOS continues to reject network clients and cloud job implementations. This is a source guardrail; it does not replace device-level network testing of third-party SDKs.

The repository-wide `node scripts/check-retired-cloud-gpu.mjs` guard also
rejects the retired OpenReel GPU/speech endpoints, clients, and infrastructure
from web, desktop, shared packages, and backend runtime sources. Web and desktop
continue to use local WebGPU/WebCodecs/native-sidecar processing; optional
third-party AI services are user-keyed and are not charged to OpenReel's AWS
account.
