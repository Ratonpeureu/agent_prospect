import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

function useOutside(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, setOpen]);
  return ref;
}

/** Menu déroulant générique : trigger({ open, toggle }) dessine le bouton. */
export function Dropdown({ trigger, children, align = "right", width = "w-72" }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-30 mt-1.5 ${width} max-w-[92vw] animate-drop rounded-lg border border-line bg-surface p-3 shadow-pop`}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** Pastille de filtre : pointillée si inactive, colorée avec ✕ si active. */
export function Chip({ label, summary, active, onClear, children, width = "w-64" }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  return (
    <div ref={ref} className="relative">
      <div
        className={`inline-flex h-9 items-center rounded-md border text-sm transition ${
          active ? "border-brand/40 bg-brand/10 text-brand" : "border-dashed border-line text-muted hover:bg-soft hover:text-fg"
        }`}
      >
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-full max-w-[240px] items-center gap-1.5 px-3">
          <span className={`truncate ${active ? "font-semibold" : ""}`}>{label}{active && summary ? ` : ${summary}` : ""}</span>
          {!active && <ChevronDown size={14} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />}
        </button>
        {active && onClear && (
          <button type="button" title="Retirer ce filtre" onClick={() => { onClear(); setOpen(false); }} className="pr-2 opacity-70 transition hover:opacity-100">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className={`absolute left-0 top-full z-30 mt-1.5 ${width} max-w-[92vw] animate-drop rounded-lg border border-line bg-surface p-2 shadow-pop`}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/** Liste de choix. options = [[valeur, libellé], ...]. Valeur vide = filtre retiré. */
export function SelectChip({ label, value, onChange, options, searchable = false, width = "w-64" }) {
  const [q, setQ] = useState("");
  const cur = options.find(([v]) => v === value);
  const shown = searchable && q
    ? options.filter(([, l]) => l.toLowerCase().includes(q.toLowerCase()))
    : options;
  return (
    <Chip label={label} active={!!value} summary={cur ? cur[1] : value} onClear={() => onChange("")} width={width}>
      {(close) => (
        <div>
          {searchable && (
            <div className="mb-1.5 flex items-center gap-2 rounded-md border border-line px-2">
              <Search size={14} className="text-muted" />
              <input autoFocus className="h-8 w-full bg-transparent text-sm outline-none" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="max-h-64 overflow-auto">
            {shown.map(([v, l]) => (
              <button
                key={v || "_all"} type="button"
                onClick={() => { onChange(v); setQ(""); close(); }}
                className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm transition hover:bg-soft ${v === value ? "font-semibold text-brand" : ""}`}
              >
                <span className="truncate">{l}</span>
                {v === value && <Check size={14} />}
              </button>
            ))}
            {shown.length === 0 && <div className="px-2.5 py-3 text-sm text-muted">Aucun résultat</div>}
          </div>
        </div>
      )}
    </Chip>
  );
}

/** Champ texte dans une pastille. */
export function TextChip({ label, value, onChange, placeholder = "", type = "text" }) {
  return (
    <Chip label={label} active={!!value} summary={value} onClear={() => onChange("")} width="w-72">
      {(close) => (
        <input
          autoFocus type={type} className="input" placeholder={placeholder} value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && close()}
        />
      )}
    </Chip>
  );
}

/** Interrupteur en forme de pastille (oui / non). */
export function ToggleChip({ label, checked, onChange }) {
  return (
    <button
      type="button" onClick={() => onChange(!checked)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition active:scale-[0.97] ${
        checked ? "border-brand/40 bg-brand/10 font-semibold text-brand" : "border-line text-muted hover:bg-soft hover:text-fg"
      }`}
    >
      {checked && <Check size={14} />} {label}
    </button>
  );
}

/** Barre de recherche avec loupe. */
export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-surface px-3 shadow-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30 sm:w-80">
      <Search size={16} className="shrink-0 text-muted" />
      <input className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted/70" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" onClick={() => onChange("")} className="text-muted hover:text-fg"><X size={14} /></button>}
    </div>
  );
}