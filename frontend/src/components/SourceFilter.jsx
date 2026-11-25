import { Ban, Check } from "lucide-react";

const split = (s) => (s ? s.split(",").filter(Boolean) : []);

/**
 * Filtre de sources à 3 états : clic 1 = inclure (vert), clic 2 = ignorer (rouge), clic 3 = retirer.
 * include / exclude : chaînes "a,b,c". onChange(include, exclude).
 */
export default function SourceFilter({ sources, include, exclude, onChange }) {
  const inc = split(include);
  const exc = split(exclude);

  const cycle = (s) => {
    let i = inc;
    let e = exc;
    if (inc.includes(s)) { i = inc.filter((x) => x !== s); e = [...exc, s]; }
    else if (exc.includes(s)) { e = exc.filter((x) => x !== s); }
    else { i = [...inc, s]; }
    onChange(i.join(","), e.join(","));
  };

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          Sources : clic 1 = <b className="text-ok">inclure</b> · clic 2 = <b className="text-bad">ignorer</b> · clic 3 = retirer
        </span>
        {(inc.length > 0 || exc.length > 0) && (
          <button type="button" className="text-xs text-brand" onClick={() => onChange("", "")}>Réinitialiser</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          const on = inc.includes(s);
          const off = exc.includes(s);
          const cls = on ? "border-ok/50 bg-ok/10 text-ok" : off ? "border-bad/50 bg-bad/10 text-bad line-through" : "border-line hover:bg-soft";
          return (
            <button type="button" key={s} onClick={() => cycle(s)} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${cls}`}>
              {on && <Check size={12} />}{off && <Ban size={12} />}{s}
            </button>
          );
        })}
      </div>
    </div>
  );
}