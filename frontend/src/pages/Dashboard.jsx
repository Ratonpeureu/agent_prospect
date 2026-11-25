import { Link } from "react-router-dom";
import { AlertTriangle, Ban, Building2, CheckCircle2, MailCheck, Radar, Settings, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { countryName } from "../lib/countries";
import { KIND_LABEL, STATUS, fmtDate, fmtNum } from "../lib/format";
import { BarList, Badge, PageHeader, Spinner, StatCard } from "../components/ui";
import { JobStatus } from "../components/JobCard";

export default function Dashboard() {
  const stats = useAsync(() => api.get("/api/stats"), []);
  const cfg = useAsync(() => api.get("/api/settings"), []);
  const s = stats.data;

  if (!s) return <div className="grid h-64 place-items-center text-muted"><Spinner size={24} /></div>;

  const missing = (cfg.data?.checks || []).filter((c) => !c.ok && !c.optional);
  const st = s.contacts_by_status || {};
  const statusItems = ["valid", "risky", "unknown", "invalid", "unverified", "blacklisted"]
    .filter((k) => st[k])
    .map((k) => ({ label: STATUS[k].label, value: st[k], tone: STATUS[k].tone }));
  const sourceItems = Object.entries(s.contacts_by_source || {}).map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const countryItems = (s.companies_by_country || []).map((c) => ({ label: countryName(c.country), value: c.count }));
  const maxDay = Math.max(1, ...s.contacts_per_day.map((d) => d.count));

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle="Vue d'ensemble de ta base de prospection"
        actions={<Link to="/search" className="btn btn-primary"><Radar size={16} /> Nouvelle recherche</Link>}
      />

      {missing.length > 0 && (
        <div className="card mb-6 flex flex-wrap items-center gap-4 border-warn/40 bg-warn/5 p-4">
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

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Qualité des emails</h2>
          <BarList items={statusItems} empty="Aucun contact pour l'instant" />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Contacts ajoutés (14 derniers jours)</h2>
          <div className="flex h-36 items-end gap-1.5">
            {s.contacts_per_day.map((d) => (
              <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end">
                <div className="w-full rounded-t-md bg-brand/80 transition group-hover:bg-brand" style={{ height: `${Math.max(3, (d.count / maxDay) * 100)}%` }} />
                <span className="pointer-events-none absolute -top-6 hidden rounded bg-fg px-1.5 py-0.5 text-xs text-bg group-hover:block">{d.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>{new Date(s.contacts_per_day[0].day).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
            <span>Aujourd'hui</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Contacts par source</h2>
          <BarList items={sourceItems} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-semibold">Entreprises par pays</h2>
          <BarList items={countryItems} />
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Dernières tâches</h2>
            <Link to="/jobs" className="text-xs text-brand">Tout voir</Link>
          </div>
          {s.recent_jobs.length === 0 && <p className="py-6 text-center text-sm text-muted">Aucune tâche</p>}
          <ul className="space-y-3">
            {s.recent_jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{KIND_LABEL[j.kind] || j.kind} <span className="text-muted">#{j.id}</span></div>
                  <div className="text-xs text-muted">{fmtDate(j.created_at)}</div>
                </div>
                <JobStatus status={j.status} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card mt-4 flex flex-wrap items-center gap-3 p-5">
        <MailCheck className="text-brand" size={20} />
        <div className="flex-1 text-sm">
          <div className="font-semibold">Nettoyer une liste d'emails</div>
          <div className="text-muted">Colle des adresses ou importe un CSV/Excel : tu récupères un fichier propre.</div>
        </div>
        <Link to="/verify" className="btn btn-ghost">Ouvrir la vérification</Link>
      </div>
    </>
  );
}