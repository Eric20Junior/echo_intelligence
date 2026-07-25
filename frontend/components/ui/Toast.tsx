"use client";

import * as React from "react";

const KINDS = {
  success: "border-live",
  info: "border-gold",
  danger: "border-danger",
  warning: "border-pending",
} as const;
const DOTS = { success: "bg-live", info: "bg-gold", danger: "bg-danger", warning: "bg-pending" } as const;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  id: string | number;
  kind?: keyof typeof KINDS;
  title: string;
  detail?: string;
  action?: ToastAction;
}

export function Toast({ kind = "info", title, detail, action, onDismiss }: Omit<ToastData, "id"> & { onDismiss?: () => void }) {
  return (
    <div className={`flex min-w-[260px] max-w-[360px] animate-card-in items-center gap-2.5 rounded-sm border bg-bg-3 px-3.5 py-2.5 font-sans shadow-raised ${KINDS[kind]}`}>
      <span className={`h-2 w-2 flex-none rounded-pill ${DOTS[kind]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-text-1">{title}</div>
        {detail && <div className="mt-px text-xs text-text-2">{detail}</div>}
        {action && (
          <button onClick={action.onClick} className="mt-1.5 text-xs font-semibold text-gold underline underline-offset-2">
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="px-1 text-sm leading-none text-text-3">×</button>
      )}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss?: (id: ToastData["id"]) => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} kind={t.kind} title={t.title} detail={t.detail} action={t.action} onDismiss={onDismiss ? () => onDismiss(t.id) : undefined} />
      ))}
    </div>
  );
}

/** Owns the toast array + 4s auto-expiry (skipped for toasts with an action — the operator needs time to click it, and dismissing it themselves is the natural "done" signal). */
export function useToasts() {
  const [toasts, setToasts] = React.useState<ToastData[]>([]);
  const push = React.useCallback((kind: ToastData["kind"], title: string, detail?: string, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, detail, action }]);
    if (!action) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = React.useCallback((id: ToastData["id"]) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}
