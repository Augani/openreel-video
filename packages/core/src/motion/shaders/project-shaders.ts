import type { Project } from "../../types/project";
import {
  clearGeneratedMotionShaders,
  registerMotionShader,
} from "./registry";

export function registerProjectGeneratedShaders(
  project: Pick<Project, "generatedShaders">,
): void {
  clearGeneratedMotionShaders();
  const shaders = project.generatedShaders ?? [];
  for (const def of shaders) {
    try {
      registerMotionShader(def);
    } catch {
      continue;
    }
  }
}
