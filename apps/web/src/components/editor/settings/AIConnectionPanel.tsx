import { getProviderConnection, useAIConnectionStore, type AIProvider } from "../../../stores/ai-connection-store";

const inputClass = "mt-1.5 w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";
export function AIConnectionPanel({ disabled = false }: { disabled?: boolean }) {
  const connection = useAIConnectionStore();
  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-fg-2">Provider
          <select aria-label="AI provider" className={inputClass} disabled={disabled} value={connection.provider} onChange={(e) => { const provider = e.target.value as AIProvider; connection.configure(getProviderConnection(provider)); }}>
            <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="compatible">OpenAI compatible / local</option>
          </select>
        </label>
        <label className="block text-fg-2">Model ID<input aria-label="AI model ID" className={inputClass} disabled={disabled} value={connection.model} onChange={(e) => connection.configure({ model: e.target.value })} spellCheck={false} /></label>
      </div>
        <label className="block text-fg-2">Base URL<input aria-label="AI base URL" className={inputClass} disabled={disabled} value={connection.baseUrl} onChange={(e) => connection.configure({ baseUrl: e.target.value })} spellCheck={false} /></label>
        <label className="block text-fg-2">Session API key<input aria-label="Session API key" type="password" autoComplete="off" className={inputClass} disabled={disabled} value={connection.apiKey} onChange={(e) => connection.configure({ apiKey: e.target.value })} /></label>
        {connection.apiKey && <button type="button" disabled={disabled} className="text-accent underline" onClick={connection.forgetKey}>Forget key</button>}
        <p className="text-[11px] leading-relaxed text-fg-muted">Your key stays in this tab and clears on reload. Edit requests and requested preview frames go directly to your provider. Local endpoints can work without a key.</p>
    </div>
  );
}
