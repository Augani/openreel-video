import { AI_PROVIDER_DEFAULTS, useAIConnectionStore, type AIProvider } from "../../../stores/ai-connection-store";
import { Button, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";

const inputClass = "mt-1.5 h-auto w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";
export function AIConnectionPanel({ disabled = false }: { disabled?: boolean }) {
  const connection = useAIConnectionStore();
  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-fg-2">Provider
          <Select disabled={disabled} value={connection.provider} onValueChange={(value) => { const provider = value as AIProvider; connection.configure({ provider, ...AI_PROVIDER_DEFAULTS[provider], apiKey: "" }); }}>
            <SelectTrigger aria-label="AI provider" className={inputClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem><SelectItem value="compatible">OpenAI compatible / local</SelectItem></SelectContent>
          </Select>
        </label>
        <label className="block text-fg-2">Model ID<Input aria-label="AI model ID" className={inputClass} disabled={disabled} value={connection.model} onChange={(e) => connection.configure({ model: e.target.value })} spellCheck={false} /></label>
      </div>
        <label className="block text-fg-2">Base URL<Input aria-label="AI base URL" className={inputClass} disabled={disabled} value={connection.baseUrl} onChange={(e) => connection.configure({ baseUrl: e.target.value })} spellCheck={false} /></label>
        <label className="block text-fg-2">Session API key<Input aria-label="Session API key" type="password" autoComplete="off" className={inputClass} disabled={disabled} value={connection.apiKey} onChange={(e) => connection.configure({ apiKey: e.target.value })} /></label>
        {connection.apiKey && <Button variant="link" size="sm" type="button" disabled={disabled} className="h-auto p-0 text-[length:inherit] text-accent underline" onClick={connection.forgetKey}>Forget key</Button>}
        <p className="text-[11px] leading-relaxed text-fg-muted">Your key stays in this tab and clears on reload. Edit requests and requested preview frames go directly to your provider. Local endpoints can work without a key.</p>
    </div>
  );
}
