import { useState } from "react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Pagination, Spinner } from "./ui";

const PAGE = 100;
const letter = (i) => {
  let s = "";
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const TONE = { valid: "text-ok", valide: "text-ok", risky: "text-warn", unknown: "text-muted", invalid: "text-bad", blacklisted: "text-bad" };
const tone = (col, v) => (/statut|status/i.test(col) ? TONE[String(v).toLowerCase()] || "" : "");

export default function SheetViewer({ fileId }) {
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(0);
  const d = useAsync(
    () => api.get(`/api/files/${fileId}/preview`, { sheet, limit: PAGE, offset: page * PAGE }),
    [fileId, sheet, page]
  );
  const data = d.data;

  if (d.error && !data) return <p className="rounded-xl bg-bad/10 p-4 text-sm text-bad">{d.error.message}</p>;
  if (!data) return <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>;

  const rows = data.rows;
  const ncols = Math.max(data.columns.length, ...rows.map((r) => r.length), 1);
  const cols = Array.from({ length: ncols }, (_, i) => data.columns[i] ?? "");
  const start = page * PAGE;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="max-h-[62vh] overflow-auto bg-surface">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 h-6 w-10 border border-line bg-soft" />
              {cols.map((_, i) => (
                <th key={i} className="sticky top-0 z-20 h-6 min-w-[90px] border border-line bg-soft px-2 text-center font-medium text-muted">{letter(i)}</th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 top-6 z-30 border border-line bg-soft px-2 text-center font-normal text-muted">1</th>
              {cols.map((c, i) => (
                <th key={i} className="sticky top-6 z-20 whitespace-nowrap border border-line bg-soft px-2 py-1 text-left font-semibold">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-brand/5">
                <td className="sticky left-0 z-10 border border-line bg-soft px-2 text-center text-muted">{start + ri + 2}</td>
                {cols.map((c, ci) => {
                  const v = r[ci] ?? "";
                  return (
                    <td key={ci} title={String(v)} className={`max-w-[320px] truncate whitespace-nowrap border border-line px-2 py-1 ${tone(c, v)}`}>
                      {String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={ncols + 1} className="px-4 py-8 text-center text-muted">Feuille vide</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data.sheets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line bg-soft px-2 py-1.5">
          {data.sheets.map((s) => (
            <button
              key={s.name} type="button"
              onClick={() => { setSheet(s.name); setPage(0); }}
              className={`rounded-md px-3 py-1 text-xs ${data.sheet === s.name ? "bg-surface font-semibold shadow-card" : "text-muted hover:text-fg"}`}
            >
              {s.name} <span className="text-muted">({s.rows})</span>
            </button>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE} total={data.total} count={rows.length} onPage={setPage} />
    </div>
  );
}