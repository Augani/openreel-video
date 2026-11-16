import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
  Switch,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ToggleGroup,
  ToggleGroupItem,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
} from "@openreel/ui";
import {
  Check,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  AI_PROVIDER_DEFAULTS,
  canRememberAIKey,
  useAIConnectionStore,
  type AIProvider,
} from "../../../stores/ai-connection-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useUIStore } from "../../../stores/ui-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { aiModelLabel } from "./ai-connection-labels";
import { AssistantIcon } from "./AssistantIcon";
import {
  makeDirectBYOKClient,
  validateAIEndpoint,
} from "../../../services/agent/direct-llm-transport";

const providers = [
  {
    id: "anthropic",
    name: "Anthropic",
    subtitle: "Claude models",
    monogram: "A",
    color: "#D97757",
    provider: "anthropic",
  },
  {
    id: "openai",
    name: "OpenAI",
    subtitle: "GPT models",
    monogram: "O",
    color: "#E8E9EC",
    provider: "openai",
  },
  {
    id: "google",
    name: "Google",
    subtitle: "Gemini models",
    monogram: "G",
    color: "#5B8DEF",
    provider: "compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    subtitle: "Any model, one key",
    monogram: "R",
    color: "#8C6EFF",
    provider: "compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
  },
  {
    id: "ollama",
    name: "Ollama",
    subtitle: "Local, offline",
    monogram: "L",
    color: "#2bd49a",
    provider: "compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "",
  },
  {
    id: "custom",
    name: "Custom",
    subtitle: "OpenAI-compatible URL",
    monogram: "{ }",
    color: "#F0A43A",
    provider: "compatible",
    ...AI_PROVIDER_DEFAULTS.compatible,
  },
] as const;
export function AIConnectionDialog() {
  const open = useEditorWorkspaceStore((s) => s.aiConnectionOpen);
  const setOpen = useEditorWorkspaceStore((s) => s.setAIConnectionOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <ConnectionForm onClose={() => setOpen(false)} />}
    </Dialog>
  );
}
function ConnectionForm({ onClose }: { onClose: () => void }) {
  const connection = useAIConnectionStore.getState();
  const [draft, setDraft] = useState({
    provider: connection.provider,
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    model: connection.model,
  });
  const [selected, setSelected] = useState(
    () =>
      providers.find((p) => "baseUrl" in p && p.baseUrl === connection.baseUrl)
        ?.id ?? connection.provider,
  );
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [privacy, setPrivacy] = useState(false);
  const rememberAvailable = canRememberAIKey();
  const [remember, setRemember] = useState(connection.remember);
  const [modelOpen, setModelOpen] = useState(false);
  const [dryRun, setDryRun] = useState(useSettingsStore.getState().agentDryRun);
  const [autoConfirm, setAutoConfirm] = useState(
    useSettingsStore.getState().agentAutoConfirm,
  );
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const update = (value: Partial<typeof draft>) => {
    abort.current?.abort();
    setTesting(false);
    setResult(null);
    setDraft((d) => ({ ...d, ...value }));
  };
  const validate = () => {
    validateAIEndpoint(draft.baseUrl);
    if (!draft.model.trim())
      throw new Error("Enter a model ID that supports tool use.");
    if (draft.provider !== "compatible" && !draft.apiKey.trim())
      throw new Error("Enter your provider API key.");
  };
  const test = async () => {
    const ac = new AbortController();
    abort.current?.abort();
    abort.current = ac;
    try {
      validate();
      setTesting(true);
      setResult(null);
      const start = performance.now();
      await makeDirectBYOKClient({ ...draft, signal: ac.signal }).complete({
        messages: [{ role: "user", content: "Reply with OK." }],
        tools: [],
      });
      if (!ac.signal.aborted)
        setResult({
          ok: true,
          text: `Connected · ${Math.round(performance.now() - start)} ms · key stays on this computer`,
        });
    } catch (e) {
      if (!ac.signal.aborted)
        setResult({
          ok: false,
          text: e instanceof Error ? e.message : "Connection test failed.",
        });
    } finally {
      if (!ac.signal.aborted) setTesting(false);
    }
  };
  return (
    <DialogContent
      className="workspace-ai-connect"
      overlayClassName="bg-black/50"
      onEscapeKeyDown={() => abort.current?.abort()}
    >
      <div className="workspace-ai-connect-heading">
        <span>
          <AssistantIcon size={18} />
        </span>
        <div>
          <DialogTitle>Connect your AI</DialogTitle>
          <DialogDescription>
            AI assist edits your timeline for you. Connect the provider you
            already use, or run a model on your device.
          </DialogDescription>
        </div>
      </div>
      <ScrollArea className="workspace-ai-connect-scroll">
      <div className="workspace-ai-connect-content">
      <ToggleGroup type="single" value="provider" role="radiogroup" aria-label="How to power AI assist" className="workspace-ai-plans">
        <ToggleGroupItem value="hosted" disabled title="OpenReel-hosted AI is not available in this installation">
          <strong>OpenReel AI</strong>
          <span>Hosted service not configured</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="provider">
          <strong>Your own provider</strong>
          <span>Pay them directly · no OpenReel limits</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="workspace-ai-providers">
        {providers.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            aria-pressed={selected === p.id}
            onClick={() => {
              if (selected === p.id) return;
              setSelected(p.id);
              setModelOpen(false);
              update({
                provider: p.provider as AIProvider,
                apiKey: "",
                ...("baseUrl" in p
                  ? { baseUrl: p.baseUrl, model: p.model }
                  : AI_PROVIDER_DEFAULTS[p.provider as AIProvider]),
              });
            }}
          >
            <span
              className="workspace-provider-monogram"
              style={{ color: p.color, background: `${p.color}22` }}
            >
              {p.monogram}
            </span>
            <span>
              <strong>{p.name}</strong>
              <small>{p.subtitle}</small>
            </span>
          </Button>
        ))}
      </div>
      <div className="workspace-ai-credentials">
        <label>
          API key
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                aria-label="Session API key"
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={
                  selected === "ollama"
                    ? "Optional for local models"
                    : "Enter your API key"
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={reveal ? "Hide API key" : "Show API key"}
                className="workspace-ai-key-visibility absolute right-1 top-1"
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
            <Button
              variant="secondary"
              disabled={testing}
              onClick={() => void test()}
            >
              {testing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          </div>
        </label>
        <div
          role="status"
          className={
            result?.ok
              ? "text-accent"
              : result
                ? "text-status-error"
                : "text-fg-muted"
          }
        >
          {result ? (
            <>
              {result.ok && <Check size={13} />}
              {result.text}
            </>
          ) : (
            rememberAvailable
              ? "Your key stays on this computer. Tick Remember on this device to keep it in your system keychain. Test sends a short request to your provider."
              : "Your key stays in this tab and clears on reload. Test sends a short request to your provider."
          )}
        </div>
        <div className="workspace-ai-model-fields">
          <label>
            Editing model
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-haspopup="dialog" aria-expanded={modelOpen}
                  aria-label="AI editing model" title={draft.model || "Choose a model or enter a model ID"}>
                  <span className="truncate">{aiModelLabel(draft.provider, draft.model)}</span><span aria-hidden="true" className="workspace-ai-caret">▾</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" aria-label="Choose AI editing model" className="workspace-ai-model-menu">
                {draft.provider !== "compatible" && <Button variant="ghost" className="w-full justify-start"
                  onClick={() => { update({ model: AI_PROVIDER_DEFAULTS[draft.provider].model }); setModelOpen(false); }}>
                  {aiModelLabel(draft.provider, AI_PROVIDER_DEFAULTS[draft.provider].model)}
                </Button>}
                <label>Model ID<Input aria-label="AI model ID" value={draft.model} onChange={e => update({ model: e.target.value })}
                  placeholder="Tool-capable model ID" spellCheck={false} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setModelOpen(false); } }} /></label>
                <Button variant="secondary" onClick={() => setModelOpen(false)}>Done</Button>
              </PopoverContent>
            </Popover>
          </label>
          <label>
            Transcription
            <Select value="whisper">
              <SelectTrigger aria-label="Transcription engine" icon={<span className="workspace-ai-caret" aria-hidden="true">▾</span>}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whisper">On-device (Whisper)</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {rememberAvailable && (
          <label className="flex items-center gap-2">
            <input type="checkbox" aria-label="Remember on this device" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember on this device (system keychain)
          </label>
        )}
        {draft.provider === "compatible" && (
          <label>
            Base URL
            <Input
              aria-label="AI base URL"
              value={draft.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              spellCheck={false}
            />
          </label>
        )}
      </div>
      <div className="workspace-ai-permissions">
        <h3>WHAT THE ASSISTANT MAY DO</h3>
        <label>
          Edit the timeline directly (every change is undoable)
          <Switch checked={!dryRun} onCheckedChange={(v) => setDryRun(!v)} />
        </label>
        <label>
          Approve destructive edits automatically
          <Switch checked={autoConfirm} onCheckedChange={setAutoConfirm} />
        </label>
        <label title="Export always opens its settings dialog for your review and confirmation.">
          Export or publish without asking
          <Switch checked={false} disabled aria-label="Export or publish without asking" />
        </label>
      </div>
      {privacy && (
        <p className="workspace-ai-privacy">
          Edit requests, timeline metadata and preview frames requested by the
          assistant go directly to your chosen endpoint. Original media stays on
          your device. Connection details and keys are held in memory for this
          tab only, unless you choose Remember on this device, which keeps the key
          in your system keychain. Export opens its settings dialog for your review and confirmation.
        </p>
      )}
      </div>
      </ScrollArea>
      <footer>
        <Button variant="link" onClick={() => setPrivacy(!privacy)}>
          What gets sent to the provider?
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="workspace-ai-primary"
            onClick={() => {
              try {
                validate();
                connection.configure({ ...draft, ...(rememberAvailable ? { remember } : {}) });
                useSettingsStore.getState().setAgentDryRun(dryRun);
                useSettingsStore.getState().setAgentAutoConfirm(autoConfirm);
                useUIStore.getState().setPanelVisible("agentChat", true);
                onClose();
              } catch (e) {
                setResult({
                  ok: false,
                  text:
                    e instanceof Error
                      ? e.message
                      : "Check your connection settings.",
                });
              }
            }}
          >
            Connect and start
          </Button>
        </div>
      </footer>
    </DialogContent>
  );
}
