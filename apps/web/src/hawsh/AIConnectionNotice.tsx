/**
 * Settings → AI Editor in the Hawsh Khalifa build: AI editing runs only on Director's Eyes points, so
 * instead of OpenReel's provider / model / API-key fields this shows who is signed in and the price.
 */
import React, { useEffect, useState } from "react";
import { HAWSH_EDITOR_PAGE } from "./config";
import { hawshClient, useHawshStore } from "./session";

export const AIConnectionNotice: React.FC<{ disabled?: boolean }> = () => {
  const ready = useHawshStore((s) => s.status === "ready");
  const email = useHawshStore((s) => s.email);
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    const c = ready ? hawshClient() : null;
    if (!c) return;
    void c.from("director_prices").select("value").eq("key", "editor_ai_call").maybeSingle().then(({ data }) => {
      const v = Number((data as { value?: unknown } | null)?.value);
      if (Number.isFinite(v) && v >= 0) setPrice(v);
    });
  }, [ready]);

  return (
    <div dir="rtl" data-no-translate="" className="space-y-2 rounded-md border border-border bg-bg-2 p-3 text-xs text-fg-2">
      {ready ? (
        <>
          <p className="text-fg">المحرر الذكي يعمل برصيد نقاط عيون المخرج — بدون مفاتيح ولا إعداد.</p>
          <p>{price ?? 0.1} نقطة لكل خطوة، والطلب الواحد قد يحتاج عدة خطوات.</p>
          {email && <p className="text-fg-muted">الحساب: <span dir="ltr">{email}</span></p>}
        </>
      ) : (
        <>
          <p className="text-fg">المحرر الذكي يعمل فقط برصيد نقاط عيون المخرج.</p>
          <a href={HAWSH_EDITOR_PAGE} target="_blank" rel="noopener noreferrer" className="text-primary underline">افتح المحرر من عيون المخرج</a>
        </>
      )}
    </div>
  );
};
