import React, { useEffect, useRef } from "react";
import { X } from "@/icons/lucide-compat";
import type { OnboardingSheetProps } from "../types";
import { AgentConnectCard } from "./AgentConnectCard";

const HEADING_ID = "agent-connect-heading";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** G1 sheet: full-screen modal. Esc or the close button dismisses; Tab stays inside; focus returns to the opener. */
export default function Sheet({ onClose }: OnboardingSheetProps): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const items = focusableIn(dialogRef.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={HEADING_ID}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 overflow-y-auto bg-bg pt-11"
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-14 inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-2 outline-none transition-colors hover:bg-bg-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={16} aria-hidden />
      </button>
      <div className="px-6 py-10">
        <AgentConnectCard headingId={HEADING_ID} />
      </div>
    </div>
  );
}
