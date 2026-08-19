import type { JSX } from "react";
import { useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftIconButton as IconButton,
  ToolcraftPopover as Popover,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { Settings2 } from "@/icons/lucide-compat";
import {
  useSettingsStore,
  type LlmProvider,
} from "../../../stores/settings-store";
import { discoverCompatibleModels } from "../../../services/agent/model-discovery";
import {
  getSecret,
  isSessionUnlocked,
} from "../../../services/secure-storage";

const PROVIDERS: ReadonlyArray<{ id: LlmProvider; label: string }> = [
  { id: "openai-compatible", label: "OpenAI-compatible" },
  { id: "anthropic-compatible", label: "Anthropic-compatible" },
];

interface ProviderModelPickerProps {
  readonly disabled?: boolean;
}

export function ProviderModelPicker({
  disabled = false,
}: ProviderModelPickerProps): JSX.Element {
  const provider = useSettingsStore((s) => s.defaultLlmProvider);
  const baseUrl = useSettingsStore((s) => s.llmBaseUrl);
  const model = useSettingsStore((s) => s.llmModel);
  const configuredServices = useSettingsStore((s) => s.configuredServices);
  const setProvider = useSettingsStore((s) => s.setDefaultLlmProvider);
  const setBaseUrl = useSettingsStore((s) => s.setLlmBaseUrl);
  const setModel = useSettingsStore((s) => s.setLlmModel);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const [open, setOpen] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [discoveryMessage, setDiscoveryMessage] = useState("");

  const providerLabel =
    PROVIDERS.find((item) => item.id === provider)?.label ?? "Not configured";
  const currentModel = model.trim();
  const isConfigured = Boolean(provider && baseUrl.trim() && currentModel);

  const discoverModels = async (): Promise<void> => {
    if (!provider) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("Choose an API format first.");
      return;
    }
    if (!baseUrl.trim()) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("Enter the endpoint base URL first.");
      return;
    }
    if (configuredServices.includes(provider) && !isSessionUnlocked()) {
      setDiscoveryStatus("error");
      setDiscoveryMessage("Unlock API keys before loading models.");
      return;
    }

    setDiscoveryStatus("loading");
    setDiscoveryMessage("");
    try {
      const apiKey = configuredServices.includes(provider)
        ? ((await getSecret(provider)) ?? "")
        : "";
      const models = await discoverCompatibleModels({
        provider,
        baseUrl,
        apiKey,
      });
      setDiscoveredModels(models);
      setDiscoveryStatus(models.length > 0 ? "ready" : "error");
      setDiscoveryMessage(
        models.length > 0
          ? `${models.length} model${models.length === 1 ? "" : "s"} found.`
          : "The endpoint returned no models. Enter a model ID manually.",
      );
    } catch (error) {
      setDiscoveredModels([]);
      setDiscoveryStatus("error");
      setDiscoveryMessage(
        error instanceof Error
          ? error.message
          : "Could not load models from this endpoint.",
      );
    }
  };

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="below"
      alignment="end"
      width={360}
      label="AI endpoint and model"
      content={
        <div className="space-y-3 p-3">
          <div>
            <Text type="body" color="primary" className="text-[12px] font-medium">
              Connect any compatible model
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[10px] leading-relaxed">
              Choose the API format, then use your own host and model. OpenReel does not select a vendor or model for you.
            </Text>
          </div>

          <Selector
            label="API format"
            size="sm"
            width="100%"
            value={provider ?? ""}
            options={[
              { value: "", label: "Choose API format…" },
              ...PROVIDERS.map((item) => ({ value: item.id, label: item.label })),
            ]}
            onChange={(value) => {
              setProvider((value || null) as LlmProvider | null);
              setDiscoveredModels([]);
              setDiscoveryStatus("idle");
              setDiscoveryMessage("");
            }}
          />

          <TextInput
            label="Base URL"
            value={baseUrl}
            onChange={(value) => {
              setBaseUrl(value);
              setDiscoveredModels([]);
              setDiscoveryStatus("idle");
            }}
            placeholder={
              provider === "anthropic-compatible"
                ? "https://gateway.example/v1"
                : "http://localhost:11434/v1"
            }
            width="100%"
          />

          <div className="space-y-2 rounded-md border border-border bg-bg-2 p-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextInput
                  label="Model ID"
                  value={model}
                  onChange={setModel}
                  placeholder="Enter any tool-capable model ID"
                  width="100%"
                />
              </div>
              <Button
                label={discoveryStatus === "loading" ? "Loading…" : "Load models"}
                size="sm"
                variant="secondary"
                isDisabled={discoveryStatus === "loading" || !provider || !baseUrl.trim()}
                onClick={() => void discoverModels()}
              />
            </div>

            {discoveredModels.length > 0 && (
              <Selector
                label="Models from endpoint"
                size="sm"
                width="100%"
                value={
                  discoveredModels.some((item) => item.id === currentModel)
                    ? currentModel
                    : ""
                }
                options={[
                  { value: "", label: "Choose a discovered model…" },
                  ...discoveredModels.map((item) => ({
                    value: item.id,
                    label: item.label === item.id ? item.id : `${item.label} · ${item.id}`,
                  })),
                ]}
                onChange={(value) => {
                  if (value) setModel(value);
                }}
              />
            )}

            {discoveryStatus !== "idle" && discoveryStatus !== "loading" && (
              <Text
                type="supporting"
                color={discoveryStatus === "error" ? "danger" : "secondary"}
                className="block text-[10px] leading-relaxed"
              >
                {discoveryMessage}
              </Text>
            )}
          </div>

          <Text type="supporting" color="secondary" className="block text-[10px] leading-relaxed">
            Model discovery uses GET /models. If your gateway does not expose it, enter the model ID manually. Browser endpoints must allow CORS.
          </Text>

          <Button
            label="Manage optional API key"
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              openSettings("api-keys");
            }}
            className="w-full"
          />
        </div>
      }
    >
      {isConfigured ? (
        <IconButton
          label={`AI settings: ${providerLabel}, ${currentModel}`}
          icon={<Settings2 size={14} aria-hidden />}
          size="sm"
          variant="ghost"
          isDisabled={disabled}
          className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        />
      ) : (
        <Button
          label="Configure AI"
          size="sm"
          variant="secondary"
          isDisabled={disabled}
        />
      )}
    </Popover>
  );
}
