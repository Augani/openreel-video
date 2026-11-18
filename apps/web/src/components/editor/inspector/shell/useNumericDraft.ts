import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import type { ActionHistory } from "@openreel/core";
import { useProjectStore } from "../../../../stores/project-store";
import { registerEditorFieldDraft, trackEditorDraftWrite, type EditorDraftOwner } from "../../../../services/editor-field-drafts";

/** Keep incomplete numeric text local while previewing valid, bounded values. */
export function useNumericDraft({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
  parse = Number.parseFloat,
  normalize = (next: number) => next,
  displayValue,
  live = true,
}: {
  value: number;
  onChange: (value: number) => unknown;
  min?: number;
  max?: number;
  step?: number;
  format?: (value: number) => string;
  parse?: (value: string) => number | null;
  normalize?: (value: number) => number;
  displayValue?: string;
  live?: boolean;
}): Pick<InputHTMLAttributes<HTMLInputElement>, "value" | "onFocus" | "onBlur" | "onChange" | "onKeyDown"> {
  const current = Number.isFinite(value) ? value : 0;
  const [draft, setDraft] = useState(String(current));
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false);
  const focused = useRef(false);
  const history = useRef<ActionHistory | null>(null);
  const element = useRef<HTMLInputElement | null>(null);
  const owner = useRef<EditorDraftOwner | null>(null);
  const unregister = useRef<(() => void) | null>(null);
  const commit = useRef<() => void>(() => {});
  const pendingValue = useRef<{ value: number } | null>(null);
  const finish = useCallback(() => {
    const active = history.current;
    history.current = null;
    window.removeEventListener("blur", finish);
    active?.endGroup();
  }, []);
  useEffect(() => {
    if (focused.current && element.current?.isConnected) unregister.current = registerEditorFieldDraft(element.current, () => commit.current());
    return () => { unregister.current?.(); finish(); };
  }, [finish]);
  const bound = (next: number) => Math.min(
    typeof max === "number" && Number.isFinite(max) ? max : Infinity,
    Math.max(typeof min === "number" && Number.isFinite(min) ? min : -Infinity, next),
  );
  const publish = (next: number) => {
    const state = useProjectStore.getState();
    if (focused.current && owner.current && (owner.current.projectId !== state.project.id || owner.current.history !== state.actionHistory)) return current;
    const normalized = normalize(next);
    if (!Number.isFinite(normalized)) return current;
    const bounded = bound(normalized);
    if (bounded !== current && pendingValue.current?.value !== bounded) {
      const discrete = !focused.current;
      if (!history.current) {
        history.current = useProjectStore.getState().actionHistory;
        history.current.beginGroup("Edit numeric property");
        window.addEventListener("blur", finish);
      }
      try {
        const scope = { projectId: state.project.id, history: state.actionHistory };
        const request = { value: bounded };
        const result = onChange(bounded);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          const operation = Promise.resolve(result as PromiseLike<unknown>);
          pendingValue.current = request;
          trackEditorDraftWrite(operation, scope);
          void operation.then(() => { if (pendingValue.current === request) pendingValue.current = null; }, () => {
            if (pendingValue.current === request) { pendingValue.current = null; if (focused.current) dirty.current = true; }
          });
        }
      }
      finally { if (discrete) finish(); }
    }
    return bounded;
  };
  commit.current = () => {
    const state = useProjectStore.getState();
    if (!focused.current || !element.current || !owner.current) return;
    if (owner.current.projectId !== state.project.id || owner.current.history !== state.actionHistory) {
      dirty.current = false; setEditing(false); finish(); return;
    }
    try {
      const parsed = parse(element.current.value);
      if (dirty.current && typeof parsed === "number" && Number.isFinite(parsed)) {
        const next = publish(parsed);
        dirty.current = false;
        setDraft(format(next));
      }
    } finally { finish(); }
  };
  return {
    value: editing ? draft : displayValue ?? format(current),
    onFocus: (event) => {
      unregister.current?.();
      element.current = event.currentTarget;
      const state = useProjectStore.getState();
      owner.current = { projectId: state.project.id, history: state.actionHistory };
      unregister.current = registerEditorFieldDraft(event.currentTarget, () => commit.current());
      focused.current = true;
      dirty.current = false;
      setDraft(format(current));
      setEditing(true);
    },
    onChange: (event) => {
      const raw = event.currentTarget.value;
      dirty.current = true;
      setDraft(raw);
      const parsed = parse(raw);
      if (live && typeof parsed === "number" && Number.isFinite(parsed)) publish(parsed);
    },
    onBlur: (event) => {
      try {
        const parsed = parse(event.currentTarget.value);
        if (dirty.current && typeof parsed === "number" && Number.isFinite(parsed)) publish(parsed);
      } finally {
        dirty.current = false;
        focused.current = false;
        unregister.current?.(); unregister.current = null;
        finish();
        setEditing(false);
      }
    },
    onKeyDown: (event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) finish();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        if (event.key === "Escape") dirty.current = false;
        event.currentTarget.blur();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const parsed = parse(event.currentTarget.value);
        // Text that merely shows the rounded stored value steps from the stored value.
        const shownCurrent = event.currentTarget.value === format(current);
        const base = shownCurrent ? current : typeof parsed === "number" && Number.isFinite(parsed) ? parsed : current;
        const next = Number((base + (event.key === "ArrowUp" ? step : -step)).toPrecision(12));
        dirty.current = false;
        setDraft(format(publish(next)));
      }
    },
  };
}
