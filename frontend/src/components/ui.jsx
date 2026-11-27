import { useEffect } from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from "lucide-react";
import { STATUS, reasonLabel } from "../lib/format";

export const Spinner = ({ size = 16, className = "" }) => (
  <Loader2 size={size} className={`animate-spin ${className}`} />
);

const TONES = {
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/15 text-warn",
  bad: "bg-bad/10 text-bad",
  info: "bg-info/10 text-info",
  muted: "bg-soft text-muted border border-line",
  dark: "bg-fg text-bg",
  brand: "bg-brand/10 text-brand",
};

export function Badge({ tone = "muted", title, children }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${TONES[tone] || TONES.muted}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, reason }) {
  const s = STATUS[status] || { label: status, tone: "muted" };
  return <Badge tone={s.tone} title={reason ? reasonLabel(reason) : undefined}>{s.label}</Badge>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pt-8">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-9 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <div className={className}>
      {label && <label className="mb-1.5 block text-xs font-semibold text-fg/80">{label}</label>}
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer select-none items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-brand" : "bg-line"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-transform duration-200 ${checked ? "translate-x-4" : ""}`} />
      </button>
      <span className="text-sm">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide = false, full = false, footer }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`card my-8 w-full animate-fade shadow-pop ${full ? "max-w-7xl" : wide ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-md p-1 text-muted transition hover:bg-soft hover:text-fg" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-soft/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-lg border border-line bg-soft text-muted"><Icon size={22} /></div>
      <div className="font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, count, onPage }) {
  const hasNext = total != null ? (page + 1) * pageSize < total : count === pageSize;
  const from = count ? page * pageSize + 1 : 0;
  const to = page * pageSize + count;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>{count ? `${from}–${to}${total != null ? ` sur ${total.toLocaleString("fr-FR")}` : ""}` : "Aucun résultat"}</span>
      <div className="flex gap-2">
        <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /> Précédent</button>
        <button className="btn btn-ghost btn-sm" disabled={!hasNext} onClick={() => onPage(page + 1)}>Suivant <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

const VALUE_TONE = { ok: "text-ok", bad: "text-bad", warn: "text-warn", info: "text-info" };

export function StatCard({ icon: Icon, label, value, tone = "brand", hint }) {
  return (
    <div className="card flex flex-col gap-3 p-5 transition hover:shadow-pop">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        {Icon && <span className={`grid h-8 w-8 place-items-center rounded-md ${TONES[tone] || TONES.brand}`}><Icon size={16} /></span>}
      </div>
      <div className={`text-[32px] font-semibold leading-9 tracking-tight ${VALUE_TONE[tone] || ""}`}>{value}</div>
      {hint && (
        <>
          <div className="h-px w-full bg-line" />
          <div className="text-xs text-muted">{hint}</div>
        </>
      )}
    </div>
  );
}

const BARS = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info", muted: "bg-muted", dark: "bg-fg", brand: "bg-brand" };

export function BarList({ items, empty = "Aucune donnée" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1.5 flex justify-between text-sm">
            <span>{i.label}</span>
            <span className="font-semibold">{i.value.toLocaleString("fr-FR")}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-soft ring-1 ring-inset ring-line">
            <div className={`h-full rounded-full transition-all duration-500 ${BARS[i.tone || "brand"]}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex gap-0.5 rounded-md border border-line bg-soft p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 rounded px-3.5 py-1.5 text-sm transition ${value === t.id ? "bg-surface font-semibold shadow-card" : "text-muted hover:text-fg"}`}
        >
          {t.icon && <t.icon size={15} />} {t.label}
        </button>
      ))}
    </div>
  );
}