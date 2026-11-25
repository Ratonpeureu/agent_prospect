import { useState } from "react";
import { ChevronDown, Download, ListChecks } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, usePoll } from "../lib/hooks";
import { KIND_LABEL, fmtDate } from "../lib/format";
import { Empty, PageHeader, Spinner } from "../components/ui";
import { JobResult, JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";

export default function Jobs() {
  const toast = useToast();
  const list = useAsync(() => api.get("/api/jobs", { limit: 100 }), []);
  const [open, setOpen] = useState(null);
  const jobs = list.data || [];
  const running = jobs.some((j) => j.status === "running" || j.status === "queued");
  usePoll(list.reload, 3000, running);

  return (
    <>
      <PageHeader title="Tâches" subtitle="Recherches, enrichissements et vérifications exécutés en arrière-plan" actions={<button className="btn btn-ghost" onClick={list.reload}>Actualiser</button>} />
      <div className="card overflow-hidden">
        {list.loading && !jobs.length ? <div className="grid h-40 place-items-center"><Spinner size={22} /></div> :
          !jobs.length ? <Empty icon={ListChecks} title="Aucune tâche" text="Les tâches lancées apparaîtront ici." /> : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id}>
                  <div className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-soft/50" onClick={() => setOpen(open === j.id ? null : j.id)}>
                    <ChevronDown size={16} className={`text-muted transition ${open === j.id ? "rotate-180" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{KIND_LABEL[j.kind] || j.kind} <span className="text-muted">#{j.id}</span></div>
                      <div className="truncate text-xs text-muted">
                        {fmtDate(j.created_at)}
                        {j.kind === "search" && ` · ${[j.params?.query, j.params?.location, j.params?.country].filter(Boolean).join(" · ")}`}
                        {j.kind === "verify_file" && ` · ${j.params?.filename || ""}`}
                      </div>
                    </div>
                    {j.has_file && (
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); api.download(`/api/jobs/${j.id}/download`).catch((er) => toast.error(er.message)); }}>
                        <Download size={13} /> Excel
                      </button>
                    )}
                    <JobStatus status={j.status} />
                  </div>
                  {open === j.id && (
                    <div className="space-y-3 border-t border-line bg-soft/40 px-5 py-4">
                      {j.error && <div className="break-all rounded-xl bg-bad/10 p-3 text-sm text-bad">{j.error}</div>}
                      {j.result && <JobResult result={j.result} />}
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer">Paramètres</summary>
                        <pre className="mt-2 overflow-x-auto rounded-xl bg-surface p-3">{JSON.stringify(j.params, null, 2)}</pre>
                      </details>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </>
  );
}