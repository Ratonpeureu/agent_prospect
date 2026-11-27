import { useEffect, useState } from "react";
import { Download, ListChecks, RotateCw } from "lucide-react";
import { api } from "../lib/api";
import { useActiveJobs, useAsync, usePoll } from "../lib/hooks";
import { KIND_LABEL, fmtDate } from "../lib/format";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { JobResult, JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";

const subtitle = (j) => {
  const p = j.params || {};
  const parts = [fmtDate(j.created_at)];
  if (j.kind === "search") {
    const q = (p.queries?.length ? p.queries : [p.query]).filter(Boolean).join(", ");
    const c = (p.countries?.length ? p.countries : [p.country]).filter(Boolean).join(", ");
    parts.push([q, p.location, c].filter(Boolean).join(" · "));
  }
  if (j.kind === "verify_file") parts.push(p.filename || "");
  if ((j.status === "running" || j.status === "queued") && j.progress?.message) {
    parts.push(`${j.progress.message}${j.progress.percent != null ? ` (${j.progress.percent} %)` : ""}`);
  }
  return parts.filter(Boolean).join(" · ");
};

export default function Jobs() {
  const toast = useToast();
  const list = useAsync(() => api.get("/api/jobs", { limit: 50 }), []);
  const { running } = useActiveJobs();
  const [sel, setSel] = useState(null);
  const jobs = list.data || [];

  usePoll(list.reload, 8000, running > 0);               // 8 s, seulement si une tâche tourne
  useEffect(() => { list.reload(); }, [running]);         // eslint-disable-line react-hooks/exhaustive-deps

  const canResume = (j) => j.status === "error" || j.stalled || ((j.status === "running" || j.status === "queued") && !j.alive);
  const resume = async (j) => {
    try {
      await api.post(`/api/jobs/${j.id}/resume`);
      toast.info(`Tâche #${j.id} relancée au dernier point d'avancement`);
      setTimeout(list.reload, 1000);
    } catch (e) { toast.error(e.message); }
  };

  const current = jobs.find((j) => j.id === sel) || jobs[0];

  return (
    <>
      <PageHeader
        title="Tâches"
        subtitle="Recherches, enrichissements et vérifications exécutés en arrière-plan"
        actions={<button className="btn btn-ghost" onClick={list.reload}><RotateCw size={14} /> Actualiser</button>}
      />

      {list.loading && !jobs.length ? (
        <div className="card grid h-40 place-items-center"><Spinner size={22} /></div>
      ) : !jobs.length ? (
        <div className="card"><Empty icon={ListChecks} title="Aucune tâche" text="Les tâches lancées apparaîtront ici." /></div>
      ) : (
        <div className="flex items-start gap-4 max-lg:flex-col">
          {/* Liste */}
          <div className="card w-[420px] max-w-full shrink-0 overflow-hidden max-lg:w-full">
            {jobs.map((j) => {
              const active = current && current.id === j.id;
              const live = j.status === "running" || j.status === "queued";
              return (
                <button
                  key={j.id}
                  onClick={() => setSel(j.id)}
                  className={`flex w-full flex-col items-start gap-1.5 border-b border-line px-4 py-3 text-left transition last:border-b-0 ${active ? "bg-brand/5" : "hover:bg-soft"}`}
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="grow truncate text-sm font-semibold">
                      {KIND_LABEL[j.kind] || j.kind} <span className="font-normal text-muted">#{j.id}</span>
                      {j.attempts > 1 && <span className="ml-2 text-xs font-normal text-warn">reprise ×{j.attempts - 1}</span>}
                    </span>
                    <JobStatus status={j.status} stalled={j.stalled} />
                  </div>
                  <span className="line-clamp-1 text-xs text-muted">{subtitle(j)}</span>
                  {live && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand/10">
                      <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, j.progress?.percent ?? 0))}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Détail */}
          {current && (
            <div className="card min-w-0 grow animate-fade space-y-6 p-6" key={current.id}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{KIND_LABEL[current.kind] || current.kind} #{current.id}</h2>
                    <JobStatus status={current.status} stalled={current.stalled} />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {fmtDate(current.created_at)}{current.finished_at ? ` → ${fmtDate(current.finished_at)}` : ""}
                    {current.progress?.elapsed_s != null ? ` · durée ${Math.round(current.progress.elapsed_s)} s` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canResume(current) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => resume(current)}><RotateCw size={13} /> Reprendre</button>
                  )}
                  {current.has_file && (
                    <button className="btn btn-primary btn-sm" onClick={() => api.download(`/api/jobs/${current.id}/download`).catch((er) => toast.error(er.message))}>
                      <Download size={13} /> Excel
                    </button>
                  )}
                </div>
              </div>

              {(current.status === "running" || current.status === "queued") && (
                <div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-brand/10">
                    <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, current.progress?.percent ?? 0))}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {current.progress?.message || "Démarrage…"}{current.progress?.percent != null && ` · ${current.progress.percent} %`}
                  </p>
                </div>
              )}

              {current.step && <div className="text-xs text-muted">Étape en cours : {current.step}</div>}
              {current.error && <div className="break-all rounded-md bg-bad/10 p-3 text-sm text-bad">{current.error}</div>}
              {current.result && <JobResult result={current.result} />}

              <details className="text-xs text-muted">
                <summary className="cursor-pointer font-semibold">Paramètres</summary>
                <pre className="mt-2 overflow-x-auto rounded-md border border-line bg-soft p-3 font-mono">{JSON.stringify(current.params, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      )}
    </>
  );
}