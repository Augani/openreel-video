import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { useChatStore } from "../../../stores/chat-store";
import { lockSession } from "../../../services/secure-storage";
import { SettingsDialog } from "./SettingsDialog";

const vault = vi.hoisted(() => ({ configured: false, unlocked: false, keys: new Map<string, string>(), refresh: vi.fn(), save: vi.fn(), remove: vi.fn(), reveal: vi.fn(), listeners: new Set<() => void>() }));
vi.mock("../../../services/secure-storage", () => ({
  onSessionLock: (listener: () => void) => { vault.listeners.add(listener); return () => { vault.listeners.delete(listener); }; },
  isMasterPasswordSet: async () => { vault.refresh(); return vault.configured; }, isSessionUnlocked: () => vault.unlocked,
  setupMasterPassword: async () => { vault.configured = true; vault.unlocked = true; }, unlockSession: async () => { vault.unlocked = true; return true; },
  lockSession: () => { vault.unlocked = false; for (const listener of vault.listeners) listener(); }, changeMasterPassword: async () => true,
  saveSecret: async (id: string, label: string, value: string) => { vault.save(id, label, value); vault.keys.set(id, value); },
  getSecret: (id: string) => vault.reveal(id), deleteSecret: async (id: string) => { vault.remove(id); vault.keys.delete(id); }, hasSecret: async (id: string) => vault.keys.has(id),
  listSecrets: async () => [...vault.keys.keys()].map(id => ({ id, label: id, createdAt: 1, updatedAt: 1 })),
}));
const preferences = () => useSettingsStore.getState();
beforeEach(() => {
  vi.clearAllMocks(); vault.listeners.clear(); vault.reveal.mockImplementation(async (id: string) => vault.keys.get(id)); vault.configured = false; vault.unlocked = false; vault.keys.clear();
  useProjectStore.getState().createNewProject("Settings verification");
  useSettingsStore.setState({ settingsOpen: false, settingsTab: "general", autoSave: true, autoSaveInterval: 5, defaultLlmProvider: null, llmBaseUrl: "", llmModel: "", configuredServices: [], agentDryRun: false, agentAutoConfirm: false });
  useChatStore.setState({ status: "idle" }); Reflect.deleteProperty(window, "openreel");
});
afterEach(() => { cleanup(); preferences().closeSettings(); vi.restoreAllMocks(); Reflect.deleteProperty(window, "openreel"); });
function view() { return render(<><button onClick={() => preferences().openSettings()}>Open preferences</button><SettingsDialog /></>); }
async function open() { const opener = screen.getByRole("button", { name: "Open preferences" }); opener.focus(); fireEvent.click(opener); await screen.findByRole("dialog", { name: "Settings" }); }
function tab(name: string) { const trigger = screen.getByRole("tab", { name }); trigger.focus(); fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false }); }

describe("full settings dialog workflows", () => {
  it("keeps drafts local until Apply and preserves composition history and clip data", async () => {
    view(); await open(); const before = structuredClone(useProjectStore.getState().project.timeline);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "1080" } }); fireEvent.change(screen.getByLabelText("Height"), { target: { value: "1920" } });
    expect(useProjectStore.getState().project.settings.width).toBe(1920); fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1920 }));
    expect(useProjectStore.getState().project.timeline).toEqual(before);
    await act(async () => { await useProjectStore.getState().undo(); }); expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1920, height: 1080 });
  });
  it("keeps encrypted-key add, reveal, hide and lock connected to the existing vault", async () => {
    vault.configured = true; vault.unlocked = true; view(); await open(); tab("API Keys");
    fireEvent.click(await screen.findByRole("button", { name: "Add ElevenLabs API key" }));
    const input = screen.getByLabelText("API key"); expect(input).toHaveAttribute("type", "password"); fireEvent.change(input, { target: { value: " fixture-key " } }); fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    await waitFor(() => expect(vault.save).toHaveBeenCalledWith("elevenlabs", "ElevenLabs", "fixture-key")); expect(preferences().configuredServices).toContain("elevenlabs");
    expect(screen.queryByText("fixture-key")).toBeNull(); fireEvent.click(await screen.findByRole("button", { name: "Show key" })); expect(await screen.findByText("fixture-key")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide key" })); expect(screen.queryByText("fixture-key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lock" })); expect(await screen.findByRole("button", { name: "Unlock" })).toBeInTheDocument(); expect(screen.queryByText("fixture-key")).toBeNull();
  });
  it("shows system-keychain controls on supported desktops and retains the browser vault elsewhere", async () => {
    vault.configured = true; vault.unlocked = true;
    Object.defineProperty(window, "openreel", { configurable: true, value: { platform: "desktop", keychain: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } } });
    view(); await open(); tab("API Keys"); expect(await screen.findByText("System keychain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change Password" })).toBeNull(); expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Add ElevenLabs API key" })).toBeInTheDocument();
  });
  it("clears visible keys and an unfinished key draft when the browser vault auto-locks", async () => {
    vault.configured = true; vault.unlocked = true; vault.keys.set("elevenlabs", "fixture-key"); view(); await open(); tab("API Keys");
    fireEvent.click(await screen.findByRole("button", { name: "Show key" })); await screen.findByText("fixture-key");
    act(() => lockSession()); expect(screen.queryByText("fixture-key")).toBeNull(); expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    vault.keys.clear(); fireEvent.click(screen.getByRole("button", { name: "Unlock" })); fireEvent.change(screen.getByLabelText("Master Password"), { target: { value: "fixture-password" } }); fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add ElevenLabs API key" })); fireEvent.change(screen.getByLabelText("API key"), { target: { value: "unfinished-fixture" } });
    act(() => lockSession()); fireEvent.click(screen.getByRole("button", { name: "Unlock" })); fireEvent.change(screen.getByLabelText("Master Password"), { target: { value: "fixture-password" } }); fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByRole("button", { name: "Add ElevenLabs API key" }); expect(screen.queryByLabelText("API key")).toBeNull();
  });
  it("drops a key reveal that resolves after the browser vault locks", async () => {
    let finish!: (value: string) => void; vault.reveal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vault.configured = true; vault.unlocked = true; vault.keys.set("elevenlabs", "fixture-key"); view(); await open(); tab("API Keys");
    fireEvent.click(await screen.findByRole("button", { name: "Show key" })); act(() => lockSession()); await act(async () => finish("late-fixture-key"));
    expect(screen.queryByText("late-fixture-key")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Unlock" })); fireEvent.change(screen.getByLabelText("Master Password"), { target: { value: "fixture-password" } }); fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByRole("button", { name: "Show key" }); expect(screen.queryByText("late-fixture-key")).toBeNull(); expect(screen.queryByRole("button", { name: "Hide key" })).toBeNull();
  });

});
