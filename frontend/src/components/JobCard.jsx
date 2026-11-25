import { useJob } from "../lib/hooks";
import { KIND_LABEL, fmtNum } from "../lib/format";
import { Badge, Spinner } from "./ui";

const LABELS = {
  companies_new: "Nouvelles entreprises", companies_duplicates: "Entreprises déjà connues",
  contacts_created: "Nouveaux contacts", contacts_duplicate: "Contacts déjà connus",
  contacts_blacklisted: "Ignorés (blacklist)", contacts_invalid_syntax: "Syntaxe invalide",
  contacts_discovered: "Emails découverts (patterns)",
  discovery_domain_unverifiable: "Domaines non vérifiables (catch-all / SMTP)",
  discovery_skipped_smtp_disabled: "Découverte ignorée (SMTP désactivé)",
  raw_results: "Résultats bruts", companies_processed: "Entreprises traitées",
  verified: "Vérifiés", valid: "Valides", risky: "Risqués", unknown: "Inconnus", invalid: "Invalides",
  auto_blacklisted: "Auto-blacklistés",
  emails_trouves: "Emails trouvés", uniques: "Uniques", doublons_supprimes: "Doublons supprimés",
  blacklistes_exclus: "Exclus (blacklist)", valides: "Valides", risques: "Risqués",
  inconnus: "Inconnus", invalides: "Invalides",
  sites_found: "Sites web retrouvés", sites_not_found: "Sites introuvables",
  contacts_generic_unverified: "Emails génériques (non vérifiés)",
};

function Chips({ data }) {
  const nums = Object.entries(data).filter(([, v]) => typeof v === "number");
  if (!nums.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {nums.map(([k, v]) => (
        <div key={k} className="rounded-xl bg-soft px-3 py-2">
          <div className="text-lg font-semibold">{fmtNum(v)}</div>
          <div className="text-xs text-muted">{LABELS[k] || k}</div>
        </div>
      ))}
    </div>
  );
}

export function JobResult({ result }) {
  if (!result) return null;
  const { sources_used, sources_skipped, results_per_source, source_errors, verification, ...rest } = result;
  return (
    <div className="space-y-3">
      {results_per_source && Object.keys(results_per_source).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(results_per_source).map(([k, v]) => (
            <Badge key={k} tone={v ? "brand" : "muted"}>{k} : {v}</Badge>
          ))}
        </div>
      )}
      <Chips data={rest} />
      {verification && (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Vérification</div>
          <Chips data={verification} />
        </>
      )}
      {sources_skipped && Object.keys(sources_skipped).length > 0 && (
        <div className="rounded-xl bg-warn/10 p-3 text-xs text-warn">
          <div className="mb-1 font-semibold">Sources ignorées</div>
          {Object.entries(sources_skipped).map(([k, v]) => <div key={k}>{k} : {v}</div>)}
        </div>
      )}
      {source_errors && Object.keys(source_errors).length > 0 && (
        <div className="rounded-xl bg-bad/10 p-3 text-xs text-bad">
          <div className="mb-1 font-semibold">Erreurs de sources</div>
          {Object.entries(source_errors).map(([k, v]) => <div key={k} className="break-all">{k} : {v}</div>)}
        </div>
      )}
    </div>
  );
}

export function JobStatus({ status }) {
  if (status === "done") return <Badge tone="ok">Terminée</Badge>;
  if (status === "error") return <Badge tone="bad">Erreur</Badge>;
  if (status === "running") return <Badge tone="info"><Spinner size={11} /> En cours</Badge>;
  return <Badge tone="muted">En attente</Badge>;
}

export default function JobCard({ jobId, onDone, actions }) {
  const job = useJob(jobId, { onDone });
  if (!jobId) return null;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold">{job ? KIND_LABEL[job.kind] || job.kind : "Tâche"} <span className="text-muted">#{jobId}</span></div>
        {job ? <JobStatus status={job.status} /> : <Spinner />}
      </div>
      {job && (job.status === "queued" || job.status === "running") && (
        <div className="mb-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full w-1/3 animate-pulse rounded-full bg-brand" /></div>
          <p className="mt-2 text-xs text-muted">Traitement en cours : tu peux quitter cette page, la tâche continue sur le serveur.</p>
        </div>
      )}
      {job?.status === "error" && <div className="rounded-xl bg-bad/10 p-3 text-sm text-bad break-all">{job.error}</div>}
      {job?.status === "done" && <JobResult result={job.result} />}
      {job && actions && <div className="mt-4 flex flex-wrap gap-2">{actions(job)}</div>}
    </div>
  );
}