/// <reference lib="webworker" />

import { serveSceneDetection, type MessagePortLike } from "@openreel/core/media/scene-detection-worker";

serveSceneDetection(self as unknown as MessagePortLike);

export {};
