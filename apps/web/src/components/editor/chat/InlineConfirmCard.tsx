import type { JSX } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { AlertTriangle } from "@/icons/lucide-compat";
import type { ToolCall } from "@openreel/agent";
import { useChatStore } from "../../../stores/chat-store";
import { useTranslation } from "react-i18next";

export function InlineConfirmCard({ call }: { call: ToolCall }): JSX.Element {
  const { t } = useTranslation();
  const resolveConfirm = useChatStore((s) => s.resolveConfirm);
  const argKeys = Object.keys(call.args ?? {});

  return (
    <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-2.5 text-[12px]">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
        <AlertTriangle size={13} className="text-status-warning" />
        {t("Confirm action")}</div>
      <Text type="supporting" color="secondary" className="mb-2 text-fg-2">
        {t("The assistant wants to run")}{" "}
        <span className="font-mono text-fg">{call.name}</span>{t(", which may modify your project or incur cost.")}</Text>
      {argKeys.length > 0 && (
        <pre className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-2 p-1.5 font-mono text-[10px] text-fg-2">
          {JSON.stringify(call.args, null, 2)}
        </pre>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          label={t("Approve")}
          variant="primary"
          size="sm"
          onClick={() => resolveConfirm("approve")}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:bg-accent/90"
        />
        <Button
          label={t("Approve all this turn")}
          variant="secondary"
          size="sm"
          onClick={() => resolveConfirm("approve_for_turn")}
          className="rounded-md bg-bg-2 px-2.5 py-1 text-[11px] font-medium text-fg-2 hover:bg-hover"
        />
        <Button
          label={t("Reject")}
          variant="destructive"
          size="sm"
          onClick={() => resolveConfirm("reject")}
          className="rounded-md px-2.5 py-1 text-[11px] font-medium text-status-error hover:bg-status-error/10"
        />
      </div>
    </div>
  );
}
