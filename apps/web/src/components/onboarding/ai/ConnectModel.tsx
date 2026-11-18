import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import { Check, Eye, EyeOff, Loader2, KeyRound, Cpu } from "@/icons/lucide-compat";
import {
  AI_PROVIDER_CHOICES,
  providerChoice,
  type AIProviderChoice,
  type AIProviderChoiceId,
} from "../../../services/ai-models";
import {
  canRememberAIKey,
  isAIConnectionReady,
  useAIConnectionStore,
} from "../../../stores/ai-connection-store";
import { detectOllama } from "../../../services/ollama-detect";
import { testAIConnection, type AIConnectionTestResult } from "../../../services/ai-connection-test";
import { validateAIEndpoint } from "../../../services/agent/direct-llm-transport";
import type { OpenReelOllamaProbeResult } from "../../../types/global";

export const KEY_EXPLAINER =
  "An API key is like a password that lets OpenReel use an AI service. You create one on your provider's website and pay them directly for usage. Check their pricing page. OpenReel never sees your key.";
export const PRIVACY_LINE =
  "Your key stays on this computer. Only your prompt and a text summary of your project are sent.";

type OllamaState =
  | { status: "checking" }
  | { status: "found"; models: OpenReelOllamaProbeResult["models"] }
  | { status: "missing" };

function inferChoice(): AIProviderChoiceId {
  const s = useAIConnectionStore.getState();
  if (s.provider === "anthropic") return "anthropic";
  if (s.provider === "openai") return "openai";
  const match = AI_PROVIDER_CHOICES.find((c) => c.provider === "compatible" && c.baseUrl === s.baseUrl);
  return match?.id ?? "anthropic";
}

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-bg-2 px-3 text-sm text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export interface ConnectModelProps {
  /** Connection saved (or already configured): go on to the clips step. */
  onContinue: () => void;
  /** "No key yet? Learn to edit first". */
  onLearn: () => void;
  /** "I'll connect later": continue without a model. */
  onLater: () => void;
}

export default function ConnectModel({ onContinue, onLearn, onLater }: ConnectModelProps): JSX.Element {
  const uid = useId();
  const initial = useAIConnectionStore.getState();
  const [choiceId, setChoiceId] = useState<AIProviderChoiceId>(inferChoice);
  const choice: AIProviderChoice = providerChoice(choiceId);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(initial.remember);
  const [explainer, setExplainer] = useState(false);
  const [ollama, setOllama] = useState<OllamaState>({ status: "checking" });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AIConnectionTestResult | { ok: false; reason: "invalid"; message: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const touched = useRef(false);
  const rememberAvailable = canRememberAIKey();

  const probeLocal = (): void => {
    setOllama({ status: "checking" });
    void detectOllama().then((probe) => {
      setOllama(probe.reachable ? { status: "found", models: probe.models } : { status: "missing" });
    });
  };

  useEffect(() => {
    let alive = true;
    void detectOllama().then((probe) => {
      if (!alive) return;
      setOllama(probe.reachable ? { status: "found", models: probe.models } : { status: "missing" });
      // A running local model is the zero-friction path: preselect it unless the user already chose.
      if (probe.reachable && probe.models.length > 0 && !touched.current && !isAIConnectionReady(useAIConnectionStore.getState())) {
        const local = providerChoice("ollama");
        setChoiceId("ollama");
        setBaseUrl(local.baseUrl);
        setModel(probe.models[0].name);
        setApiKey("");
      }
    });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const localModels = ollama.status === "found" ? ollama.models : [];
  const draft = useMemo(
    () => ({ provider: choice.provider, baseUrl, model, apiKey }),
    [choice.provider, baseUrl, model, apiKey],
  );

  const edit = (): void => {
    touched.current = true;
    abort.current?.abort();
    setTesting(false);
    setResult(null);
  };

  const pick = (next: AIProviderChoice): void => {
    if (next.id === choiceId) return;
    edit();
    setChoiceId(next.id);
    setBaseUrl(next.baseUrl);
    setApiKey("");
    setModel(next.id === "ollama" && localModels[0] ? localModels[0].name : next.model);
  };

  const validate = (): string | null => {
    try {
      validateAIEndpoint(baseUrl);
    } catch (error) {
      return error instanceof Error ? error.message : "Check the endpoint URL.";
    }
    if (!model.trim()) return "Enter a model ID that supports tool use.";
    if (choice.keyRequired && !apiKey.trim()) return "Enter your provider API key.";
    return null;
  };

  const runTest = async (): Promise<void> => {
    const problem = validate();
    if (problem) {
      setResult({ ok: false, reason: "invalid", message: problem });
      return;
    }
    const ac = new AbortController();
    abort.current?.abort();
    abort.current = ac;
    setTesting(true);
    setResult(null);
    const outcome = await testAIConnection(draft, { signal: ac.signal });
    if (ac.signal.aborted) return;
    setTesting(false);
    setResult(outcome);
  };

  const save = (): void => {
    const problem = validate();
    if (problem) {
      setResult({ ok: false, reason: "invalid", message: problem });
      return;
    }
    useAIConnectionStore.getState().configure({
      provider: choice.provider,
      baseUrl,
      model: model.trim(),
      apiKey: apiKey.trim(),
      remember: rememberAvailable && remember && Boolean(apiKey.trim() || !choice.keyRequired),
    });
    onContinue();
  };

  const keyLabelId = `${uid}-key`;
  const modelLabelId = `${uid}-model`;

  return (
    <div className="flex flex-col gap-5">
      <div
        role="radiogroup"
        aria-label="AI provider"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
      >
        {AI_PROVIDER_CHOICES.map((c) => {
          const selected = c.id === choiceId;
          const local = c.id === "ollama";
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(c)}
              className={`group flex min-h-[64px] flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                selected
                  ? "border-accent/60 bg-accent-soft shadow-glow"
                  : "border-border bg-bg-2 hover:border-accent/40"
              }`}
            >
              <span className="flex w-full items-center gap-1.5 text-[13px] font-semibold text-fg">
                {local ? <Cpu size={14} aria-hidden="true" /> : null}
                <span className="truncate">{c.name}</span>
              </span>
              <span className="text-xs text-fg-3">
                {local
                  ? ollama.status === "found"
                    ? `Detected · ${ollama.models.length} ${ollama.models.length === 1 ? "model" : "models"}`
                    : ollama.status === "checking"
                      ? "Looking for Ollama…"
                      : c.subtitle
                  : c.subtitle}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        {choice.editableBaseUrl && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
            Endpoint URL
            <input
              className={fieldClass}
              aria-label="Endpoint URL"
              value={baseUrl}
              spellCheck={false}
              onChange={(e) => {
                edit();
                setBaseUrl(e.target.value);
              }}
            />
          </label>
        )}

        {choice.id === "ollama" ? (
          <div className="flex flex-col gap-1.5">
            <span id={modelLabelId} className="text-xs font-medium text-fg-2">
              Model
            </span>
            {localModels.length > 0 ? (
              <select
                aria-labelledby={modelLabelId}
                className={fieldClass}
                value={model}
                onChange={(e) => {
                  edit();
                  setModel(e.target.value);
                }}
              >
                {localModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  aria-labelledby={modelLabelId}
                  className={fieldClass}
                  value={model}
                  placeholder="Model name, for example one you pulled with ollama"
                  spellCheck={false}
                  onChange={(e) => {
                    edit();
                    setModel(e.target.value);
                  }}
                />
                <p className="text-xs text-fg-3" role="status">
                  {ollama.status === "checking"
                    ? "Looking for Ollama on this computer…"
                    : "Ollama was not found. Start it, then "}
                  {ollama.status === "missing" && (
                    <button
                      type="button"
                      className="rounded text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={probeLocal}
                    >
                      check again
                    </button>
                  )}
                  {ollama.status === "missing" && ", or pick another provider."}
                </p>
              </>
            )}
          </div>
        ) : choice.models.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span id={modelLabelId} className="text-xs font-medium text-fg-2">
              Model
            </span>
            <select
              aria-labelledby={modelLabelId}
              className={fieldClass}
              value={choice.models.some((m) => m.id === model) ? model : choice.model}
              onChange={(e) => {
                edit();
                setModel(e.target.value);
              }}
            >
              {choice.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.recommended ? " (recommended)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-2">
            Model ID
            <input
              className={fieldClass}
              aria-label="Model ID"
              value={model}
              placeholder="A model that supports tool use"
              spellCheck={false}
              onChange={(e) => {
                edit();
                setModel(e.target.value);
              }}
            />
          </label>
        )}

        {choice.id !== "ollama" && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label id={keyLabelId} htmlFor={`${uid}-key-input`} className="text-xs font-medium text-fg-2">
                API key{choice.keyRequired ? "" : " (optional)"}
              </label>
              {choice.keyUrl && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  // Opens in the system browser: the desktop nav-guard's setWindowOpenHandler allows
                  // https URLs and routes them to the OS (see "Get a key" in ConnectModel.test.tsx).
                  onClick={() => window.open(choice.keyUrl, "_blank", "noopener,noreferrer")}
                >
                  <KeyRound size={12} aria-hidden="true" />
                  Get a key
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id={`${uid}-key-input`}
                className={`${fieldClass} pr-10`}
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                placeholder="Paste your API key"
                onChange={(e) => {
                  edit();
                  setApiKey(e.target.value);
                }}
              />
              <button
                type="button"
                aria-label={reveal ? "Hide API key" : "Show API key"}
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-fg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        )}

        {choice.id !== "ollama" && (
        <div>
          <button
            type="button"
            aria-expanded={explainer}
            aria-controls={`${uid}-explainer`}
            className="rounded text-xs text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => setExplainer(!explainer)}
          >
            How do I get a key?
          </button>
          {explainer && (
            <p id={`${uid}-explainer`} className="mt-1.5 rounded-lg border border-border bg-bg-2 p-3 text-xs leading-relaxed text-fg-2">
              {KEY_EXPLAINER}
            </p>
          )}
        </div>
        )}

        {rememberAvailable && choice.id !== "ollama" && (
          <label className="flex items-start gap-2 text-xs text-fg-2">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              <span className="font-medium text-fg">Remember on this device</span>
              <span className="block text-fg-3">
                Stores the key in your system keychain so you do not re-enter it each launch.
              </span>
            </span>
          </label>
        )}

        <p className="text-xs text-fg-3">{PRIVACY_LINE}</p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={testing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-bg-2 px-3 text-xs font-semibold text-fg hover:bg-bg-3 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => void runTest()}
          >
            {testing && <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden="true" />}
            Test connection
          </button>
          <div
            role="status"
            aria-live="polite"
            className={`min-w-0 text-xs ${result?.ok ? "text-accent" : result ? "text-status-error" : "text-fg-3"}`}
          >
            {result ? (
              result.ok ? (
                <span className="inline-flex items-center gap-1">
                  <Check size={13} aria-hidden="true" />
                  Connected · {result.latencyMs} ms · editing tools work
                </span>
              ) : (
                result.message
              )
            ) : testing ? (
              "Testing…"
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <button
            type="button"
            className="rounded text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onLearn}
          >
            No key yet? Learn to edit first
          </button>
          <button
            type="button"
            className="rounded text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onLater}
          >
            I&apos;ll connect later
          </button>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg shadow-glow hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={save}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
