import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MotionShaderDef } from "@openreel/core";
import {
  clearGeneratedMotionShaders,
  getMotionShaderDef,
} from "@openreel/core/motion/shaders";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";

const generateAiShaderMock = vi.fn();
const getSecretMock = vi.fn();
const isSessionUnlockedMock = vi.fn();
const makeBYOKClientMock = vi.fn();

vi.mock("../../services/ai-shader", () => ({
  generateAiShader: (...args: unknown[]) => generateAiShaderMock(...args),
}));

vi.mock("../../services/secure-storage", () => ({
  getSecret: (...args: unknown[]) => getSecretMock(...args),
  isSessionUnlocked: (...args: unknown[]) => isSessionUnlockedMock(...args),
  onSessionLock: () => undefined,
}));

vi.mock("../../services/agent/llm-transport", () => ({
  makeBYOKClient: (...args: unknown[]) => makeBYOKClientMock(...args),
}));

import { GenerateShaderBox } from "./GenerateShaderBox";

function sampleDef(): MotionShaderDef {
  return {
    id: "ai-holographic-foil-abcd1234",
    name: "Holographic Foil",
    category: "fill",
    glsl: "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(vUv,0.0,1.0);}",
    params: [],
    origin: "generated",
  };
}

describe("GenerateShaderBox", () => {
  beforeEach(() => {
    generateAiShaderMock.mockReset();
    getSecretMock.mockReset();
    isSessionUnlockedMock.mockReset();
    makeBYOKClientMock.mockReset();
    clearGeneratedMotionShaders();

    isSessionUnlockedMock.mockReturnValue(true);
    getSecretMock.mockResolvedValue("sk-test-key");
    makeBYOKClientMock.mockReturnValue({
      complete: vi.fn().mockResolvedValue({ text: "{}", toolUses: [], stopReason: "end_turn" }),
    });

    useProjectStore.setState({
      hasOpenProject: true,
      project: createEmptyProject("Generate shader test"),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ hasOpenProject: false });
    clearGeneratedMotionShaders();
  });

  it("generates, registers, dispatches and reports the def", async () => {
    const def = sampleDef();
    generateAiShaderMock.mockResolvedValue({ ok: true, def });
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Describe a shader, e.g. holographic foil" }), {
      target: { value: "holographic foil" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate shader" }));

    expect(screen.getByText("Generating shader...")).toBeTruthy();

    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledWith(def);
    });

    expect(generateAiShaderMock).toHaveBeenCalledTimes(1);
    expect(generateAiShaderMock.mock.calls[0][0]).toBe("holographic foil");
    expect(generateAiShaderMock.mock.calls[0][1]).toBe("fill");
    expect(getMotionShaderDef(def.id)?.id).toBe(def.id);

    const project = useProjectStore.getState().project;
    expect((project.generatedShaders ?? []).some((entry) => entry.id === def.id)).toBe(true);
  });

  it("shows the provider guard and does not call generate when no key", async () => {
    getSecretMock.mockResolvedValue(null);
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="fill" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Describe a shader, e.g. holographic foil" }), {
      target: { value: "holographic foil" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate shader" }));

    await waitFor(() => {
      expect(screen.getByText("Configure an AI provider in settings")).toBeTruthy();
    });

    expect(generateAiShaderMock).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("surfaces the service error", async () => {
    generateAiShaderMock.mockResolvedValue({ ok: false, error: "shader failed to compile" });
    const onGenerated = vi.fn();

    render(<GenerateShaderBox category="effect" onGenerated={onGenerated} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Describe a shader, e.g. holographic foil" }), {
      target: { value: "chromatic aberration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate shader" }));

    await waitFor(() => {
      expect(screen.getByText("shader failed to compile")).toBeTruthy();
    });

    expect(onGenerated).not.toHaveBeenCalled();
  });
});
