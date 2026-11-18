import { createStore, get, set } from "idb-keyval";
import {
  deserializeOrma,
  serializeOrma,
  type OrmaArtifact,
} from "@openreel/core";

const store = createStore("openreel-multicam-analysis", "orma-artifacts");

const multicamArtifactId = (projectId: string, groupId: string): string =>
  `${projectId}/${groupId}.orma`;

export async function saveMulticamArtifact(
  projectId: string,
  groupId: string,
  artifact: OrmaArtifact,
): Promise<string> {
  const id = multicamArtifactId(projectId, groupId);
  await set(id, serializeOrma(artifact), store);
  return id;
}

export async function loadMulticamArtifact(
  projectId: string,
  groupId: string,
): Promise<OrmaArtifact | undefined> {
  const serialized = await get<string>(multicamArtifactId(projectId, groupId), store);
  return serialized ? deserializeOrma(serialized) : undefined;
}
