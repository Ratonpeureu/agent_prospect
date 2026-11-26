import { useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce, usePoll } from "../lib/hooks";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";

const TONE = { ERROR: "text-bad", CRITICAL: "text-bad", WARNING: "text-warn", INFO: "text-muted", DEBUG: "text-muted" };

export default function Logs() {
  const toast = useToast();
  const [level, setLevel] = useState("WARNING");
  const [jobId, setJobId] = useState("");
  const [q, setQ] = useState("");
  const [slow, setSlow] = useState(false);
  const [auto, setAuto] = useState(false);
  const [open, setOpen] = useState(null);
  const dq = useDebounce({ q, jobId }, 400);

  const list = useAsync(
    () => api.get("/api/logs", { level, job_id: dq.jobId, q: dq.q, slow: slow ? "true" : "", limit: 300 }),
    [level, dq.q, dq.jobId, slow]
  );
  usePoll(list.reload, 10000, auto);
  const entries = list.data?.entries || [];

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Événements, erreurs, échecs d'API, lenteurs et blocages (fichier conservé dans le volume /data/logs)"
        actions={
          <>
            <button className="btn btn-ghost" onClick={list.reload}>Actualiser</button>
            <button className="btn btn-ghost" onClick={() => api.download("/api/logs/download").catch((e) => toast.error(e.message))}><Download size={16} /> Fichier complet</button>
          </>
        }
      />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <select className="input w-44" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="ERROR">Erreurs seulement</option>
          <option value="WARNING">Avertissements + erreurs</option>
          <option value="INFO">Tout (événements)</option>
          <option value="DEBUG">Tout + détail HTTP</option>
        </select>
        <input className="input w-32" placeholder="N° de tâche" value={jobId} onChange={(e) => setJobId(e.target.value.replace(/\D/g, ""))} />
        <input className="input max-w-xs" placeholder="Rechercher (source, domaine, mot…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Lenteurs / blocages seulement</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Actualiser toutes les 10 s</label>
      </div>

      <div className="card overflow-hidden">
        {list.loading && !entries.length ? (
          <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>
        ) : !entries.length ? (
          <Empty icon={ScrollText} title="Rien à signaler" text="Aucune entrée pour ces filtres." />
        ) : (
          <div className="divide-y divide-line font-mono text-xs">
            {entries.map((e, i) => {
              const isOpen = open === i;
              const first = e.message.split("\n")[0];
              const multi = e.message.includes("\n");
              return (
                <div key={i} className="cursor-pointer px-4 py-2 hover:bg-soft/50" onClick={() => setOpen(isOpen ? null : i)}>
                  <div className="flex gap-3">
                    <span className="shrink-0 text-muted">{e.ts.slice(5)}</span>
                    <span className={`w-16 shrink-0 font-semibold ${TONE[e.level] || ""}`}>{e.level}</span>
                    <span className="w-14 shrink-0 text-muted">{e.job}</span>
                    <span className="hidden w-24 shrink-0 truncate text-muted sm:block">{e.logger}</span>
                    <span className={`min-w-0 flex-1 ${isOpen ? "whitespace-pre-wrap break-all" : "truncate"}`}>
                      {isOpen ? e.message : first}{!isOpen && multi && " …"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="border-t border-line px-4 py-2 text-xs text-muted">{entries.length} entrée(s) affichée(s) · du plus récent au plus ancien · clique une ligne pour la déplier</div>
      </div>
    </>
  );
}