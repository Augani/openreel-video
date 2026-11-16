import { useId, useState, type JSX } from "react";
import { Switch } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { ONBOARDING_STARTER_PROMPTS } from "./starter-prompts";

export const DESCRIBE_PLACEHOLDER = "e.g. A 30-second highlight with a title and smooth transitions";

export interface DescribeProps {
  /** False when the user chose "I'll connect later": the prompt cannot run yet. */
  connected: boolean;
  onSubmit: (prompt: string) => void;
}

export default function Describe({ connected, onSubmit }: DescribeProps): JSX.Element {
  const uid = useId();
  const [prompt, setPrompt] = useState("");
  const dryRun = useSettingsStore((s) => s.agentDryRun);
  const autoConfirm = useSettingsStore((s) => s.agentAutoConfirm);
  const setDryRun = useSettingsStore((s) => s.setAgentDryRun);
  const setAutoConfirm = useSettingsStore((s) => s.setAgentAutoConfirm);
  const canSubmit = connected ? prompt.trim().length > 0 : true;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}-prompt`} className="text-xs font-medium text-fg-2">
          What should the video be?
        </label>
        <textarea
          id={`${uid}-prompt`}
          value={prompt}
          rows={4}
          placeholder={DESCRIBE_PLACEHOLDER}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) onSubmit(prompt);
          }}
          className="w-full resize-none rounded-xl border border-border bg-bg-2 p-3 text-sm leading-relaxed text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
        <div role="group" aria-label="Starter prompts" className="flex flex-wrap gap-2">
          {ONBOARDING_STARTER_PROMPTS.map((starter) => (
            <button
              key={starter.id}
              type="button"
              onClick={() => setPrompt(starter.text)}
              className="rounded-full border border-border bg-bg-1 px-3 py-1.5 text-left text-xs text-fg-2 transition-colors duration-150 hover:border-accent/50 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {starter.text}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-bg-1 p-3.5">
        <label className="flex items-center justify-between gap-3 text-xs text-fg">
          <span>
            Preview edits before applying
            <span className="block text-fg-3">The AI shows what it would do and changes nothing yet.</span>
          </span>
          <Switch checked={dryRun} onCheckedChange={setDryRun} aria-label="Preview edits before applying" />
        </label>
        <label className="flex items-center justify-between gap-3 text-xs text-fg">
          <span>
            Ask before deleting anything
            <span className="block text-fg-3">Removals wait for your OK.</span>
          </span>
          <Switch
            checked={!autoConfirm}
            onCheckedChange={(on) => setAutoConfirm(!on)}
            aria-label="Ask before deleting anything"
          />
        </label>
      </div>

      {!connected && (
        <p className="text-xs text-fg-3" role="note">
          No model is connected yet. We will open the editor with the assistant docked so you can connect one there.
          Your description will be waiting in the chat box.
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(prompt)}
          className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg shadow-glow hover:bg-accent-strong disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {connected ? "Make my video" : "Open the editor"}
        </button>
      </div>
    </div>
  );
}
