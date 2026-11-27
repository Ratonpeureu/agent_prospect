import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, Building2, CheckCircle2, Sparkles, MailCheck, Radar, Settings, Users } from "lucide-react";
import { api } from "../lib/api";
import { useActiveJobs, useAsync } from "../lib/hooks";
import { countryName } from "../lib/countries";
import { KIND_LABEL, STATUS, fmtDate, fmtNum } from "../lib/format";
import { BarList, PageHeader, Spinner, StatCard } from "../components/ui";
import { JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";
import JobCard from "../components/JobCard";

const SEG = { ok: "bg-ok", warn: "bg-warn", muted: "bg-muted/60", bad: "bg-bad", info: "bg-info", dark: "bg-fg" };

export default function Dashboard() {
  const stats = useAsync(() => api.get("/api/stats"), []);
  const cfg = useAsync(() => api.get("/api/settings"), []);
  const { jobs: activeJobs } = useActiveJobs();
  const s = stats.data;

  const toast = useToast();
  const [jobId, setJobId] = useState(null);
  const enrichAll = async () => {
    try {
      const r = await api.post("/api/enrich", { limit: 300, crawl_websites: true, discover_emails: true, verify: true });
      setJobId(r.job_id);
      toast.info(`Enrichissement lancé (tâche #${r.job_id})`);
    } catch (e) { toast.error(e.message); }
  };

  if (!s) return <div className="grid h-64 place-items-center text-muted"><Spinner size={24} /></div>;

  const missing = (cfg.data?.checks || []).filter((c) => !c.ok && !c.optional);
  const st = s.contacts_by_status || {};
  const order = ["valid", "risky", "unknown", "invalid", "unverified", "blacklisted"].filter((k) => st[k]);
  const statusItems = order.map((k) => ({ key: k, label: STATUS[k].label, value: st[k], tone: STATUS[k].tone }));
  const statusTotal = statusItems.reduce((a, i) => a + i.value, 0);
  const sourceItems = Object.entries(s.contacts_by_source || {}).map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const countryItems = (s.companies_by_country || []).map((c) => ({ label: countryName(c.country), value: c.count }));
  const maxDay = Math.max(1, ...s.contacts_per_day.map((d) => d.count));
  const lastIdx = s.contacts_per_day.length - 1;
  const job = activeJobs?.[0];
  const pct = Math.max(0, Math.min(100, job?.progress?.percent ?? 0));

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle="Vue d'ensemble de ta base de prospection"
        actions={<Link to="/search" className="btn btn-primary"><Radar size={16} /> Nouvelle recherche</Link>}
      />

      <div className="space-y-6">
        {job && (
          <section className="flex flex-wrap items-center gap-6 rounded-lg bg-ink-950 px-6 py-5 text-white shadow-pop">
            <div className="min-w-0 grow space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold"><Spinner size={12} /> En cours</span>
                <span className="text-base font-semibold">{KIND_LABEL[job.kind] || job.kind} #{job.id}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-2 grow overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full bg-brand-400 transition-all duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
                <span className="text-sm font-semibold">{pct} %</span>
              </div>
              <div className="truncate text-xs text-brand-300">{job.progress?.message || "Démarrage…"}</div>
            </div>
            <Link to="/jobs" className="inline-flex h-9 items-center rounded-md bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-300">Voir la tâche</Link>
          </section>
        )}

        {missing.length > 0 && (
          <div className="card flex flex-wrap items-center gap-4 border-warn/40 bg-warn/5 p-4">
            <AlertTriangle className="text-warn" size={22} />
            <div className="flex-1 text-sm">
              <div className="font-semibold">Configuration incomplète</div>
              <div className="text-muted">À faire : {missing.map((m) => m.label).join(" · ")}</div>
            </div>
            <Link to="/settings" className="btn btn-ghost"><Settings size={16} /> Configurer</Link>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Building2} label="Entreprises" value={fmtNum(s.companies)} hint={`${fmtNum(s.companies_without_contacts)} sans contact`} />
          <StatCard icon={Users} label="Contacts" value={fmtNum(s.contacts)} tone="info" />
          <StatCard icon={CheckCircle2} label="Emails valides" value={fmtNum(st.valid || 0)} tone="ok" hint={`${fmtNum(st.unverified || 0)} à vérifier`} />
          <StatCard icon={Ban} label="Blacklist" value={fmtNum(s.blacklist)} tone="bad" />
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center">
              <h2 className="grow font-semibold">Qualité des emails</h2>
              <span className="text-xs text-muted">{fmtNum(statusTotal)} adresses</span>
            </div>
            {statusItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Aucun contact pour l'instant</p>
            ) : (
              <>
                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
                  {statusItems.map((i) => (
                    <div key={i.key} className={`${SEG[i.tone] || "bg-muted"} transition-all duration-500`} style={{ width: `${(i.value / statusTotal) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-5 space-y-3">
                  {statusItems.map((i) => (
                    <li key={i.key} className="flex items-center gap-2 text-sm">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${SEG[i.tone] || "bg-muted"}`} />
                      <span className="grow">{i.label}</span>
                      <span className="font-mono text-xs">{fmtNum(i.value)}</span>
                      <span className="w-12 text-right text-xs text-muted">{((i.value / statusTotal) * 100).toFixed(1).replace(".", ",")} %</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="card p-5 lg:col-span-3">
            <h2 className="font-semibold">Contacts ajoutés</h2>
            <p className="mb-4 text-xs text-muted">14 derniers jours</p>
            <div className="flex h-44 items-end gap-2 border-b border-line">
              {s.contacts_per_day.map((d, i) => (
                <div key={d.day} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div
                    className={`w-full rounded-t-sm transition ${i === lastIdx ? "bg-brand" : "bg-brand/30 group-hover:bg-brand/60"}`}
                    style={{ height: `${Math.max(3, (d.count / maxDay) * 100)}%` }}
                  />
                  <span className="pointer-events-none absolute -top-7 hidden rounded bg-ink-950 px-1.5 py-0.5 text-xs text-white group-hover:block">{d.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{new Date(s.contacts_per_day[0].day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              <span className="font-semibold text-fg">Aujourd'hui · {fmtNum(s.contacts_per_day[lastIdx].count)}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-5">
            <h2 className="mb-4 font-semibold">Contacts par source</h2>
            <BarList items={sourceItems} />
          </div>
          <div className="card p-5">
            <h2 className="mb-4 font-semibold">Entreprises par pays</h2>
            <BarList items={countryItems} />
          </div>
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Dernières tâches</h2>
              <Link to="/jobs" className="text-xs font-semibold text-brand hover:underline">Tout voir</Link>
            </div>
            {s.recent_jobs.length === 0 && <p className="py-6 text-center text-sm text-muted">Aucune tâche</p>}
            <ul className="space-y-1">
              {s.recent_jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition hover:bg-soft">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{KIND_LABEL[j.kind] || j.kind} <span className="font-normal text-muted">#{j.id}</span></div>
                    <div className="text-xs text-muted">{fmtDate(j.created_at)}</div>
                  </div>
                  <JobStatus status={j.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card flex flex-wrap items-center gap-3 p-5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand/10 text-brand"><Sparkles size={18} /></span>
          <div className="flex-1 text-sm">
            <div className="font-semibold">Enrichir les entreprises sans contact</div>
            <div className="text-muted">Retrouve le site web puis les emails, par lots de 300. Relance le bouton pour traiter le lot suivant.</div>
          </div>
          <button className="btn btn-primary" onClick={enrichAll}>Lancer un lot</button>
        </div>
        {jobId && <JobCard jobId={jobId} />}

        <div className="card flex flex-wrap items-center gap-3 p-5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-brand/10 text-brand"><MailCheck size={18} /></span>
          <div className="flex-1 text-sm">
            <div className="font-semibold">Nettoyer une liste d'emails</div>
            <div className="text-muted">Colle des adresses ou importe un CSV/Excel : tu récupères un fichier propre.</div>
          </div>
          <Link to="/verify" className="btn btn-ghost">Ouvrir la vérification</Link>
        </div>
      </div>
    </>
  );
}