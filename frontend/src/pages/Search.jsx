import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, Download, History, Radar, Rocket } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { COUNTRIES, countryName } from "../lib/countries";
import { fmtDate } from "../lib/format";
import { Badge, Field, PageHeader, Spinner, Toggle } from "../components/ui";
import JobCard, { JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";

const LIST_KEYS = new Set(["osm_tags", "naf", "sic_codes"]);
const BOOL_KEYS = new Set(["officers", "ess", "siege_only"]);
const NEEDS_COUNTRY = new Set(["wikidata"]);

const DEFAULT = {
  query: "", location: "", country: "", sources: ["auto"], limit: 50, filters: {},
  enrich_websites: true, discover_emails: true, verify: true, use_smtp: "",
};

const filtersToRaw = (f = {}) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]));

export default function Search() {
  const toast = useToast();
  const [form, setForm] = useState(DEFAULT);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openFilters, setOpenFilters] = useState(true);

  const sources = useAsync(() => api.get("/api/sources"), []);
  const presets = useAsync(() => api.get("/api/presets"), []);
  const recent = useAsync(() => api.get("/api/jobs", { limit: 25 }), []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filters: { ...f.filters, [k]: v } }));
  const auto = form.sources.includes("auto");

  const supports = (p) => p.countries === "mondial" || (form.country && p.countries.includes(form.country));
  const active = useMemo(
    () => (sources.data || []).filter((p) => (auto ? supports(p) && p.configured : form.sources.includes(p.name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources.data, form.sources, form.country]
  );

  const toggleSource = (name) => {
    setForm((f) => {
      let list = f.sources.includes("auto") ? [name] : f.sources.includes(name) ? f.sources.filter((s) => s !== name) : [...f.sources, name];
      if (!list.length) list = ["auto"];
      return { ...f, sources: list };
    });
  };

  const submit = async () => {
    const allowed = new Set(active.flatMap((p) => Object.keys(p.filters || {})));
    const filters = {};
    for (const [k, v] of Object.entries(form.filters)) {
      if (!allowed.has(k) || v === "" || v == null) continue;
      if (LIST_KEYS.has(k)) {
        const arr = String(v).split(",").map((s) => s.trim()).filter(Boolean);
        if (arr.length) filters[k] = arr;
      } else if (BOOL_KEYS.has(k)) filters[k] = v === "true";
      else filters[k] = String(v).trim();
    }
    const body = {
      query: form.query.trim(), location: form.location.trim(), country: form.country || null,
      sources: form.sources, limit: Number(form.limit) || 50, filters,
      enrich_websites: form.enrich_websites, discover_emails: form.discover_emails, verify: form.verify,
      use_smtp: form.use_smtp === "" ? null : form.use_smtp === "true",
    };
    setBusy(true);
    try {
      const r = await api.post("/api/search", body);
      setJobId(r.job_id);
      toast.info(`Recherche lancée (tâche #${r.job_id})`);
      setTimeout(recent.reload, 800);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reuse = (job) => {
    const p = job.params || {};
    setForm({
      ...DEFAULT, ...p, country: p.country || "", use_smtp: p.use_smtp == null ? "" : String(p.use_smtp),
      filters: filtersToRaw(p.filters), query: p.query || "", location: p.location || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const searches = (recent.data || []).filter((j) => j.kind === "search").slice(0, 8);
  const noCountryWarn = !form.country && active.some((p) => NEEDS_COUNTRY.has(p.name));

  return (
    <>
      <PageHeader title="Prospection" subtitle="Interroge plusieurs sources ouvertes en parallèle, puis enrichis et vérifie les emails" />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-3">
          {/* Critères */}
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">1. Critères</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Secteur / mot-clé">
                <input className="input" placeholder="informatique, banque, restaurant…" value={form.query} onChange={(e) => set("query", e.target.value)} />
              </Field>
              <Field label="Ville / zone">
                <input className="input" placeholder="Dakar, Lyon, 75, London…" value={form.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
              <Field label="Pays">
                <select className="input" value={form.country} onChange={(e) => set("country", e.target.value)}>
                  <option value="">Non précisé</option>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                </select>
              </Field>
              <Field label="Résultats max. par source">
                <input type="number" min="1" max="500" className="input" value={form.limit} onChange={(e) => set("limit", e.target.value)} />
              </Field>
            </div>
            {presets.data && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted">Secteurs prédéfinis (traduits en tags OSM / codes NAF / SIC)</div>
                <div className="flex flex-wrap gap-1.5">
                  {presets.data.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => set("query", p.aliases[0])}
                      className={`rounded-full border px-3 py-1 text-xs transition ${form.query === p.aliases[0] ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sources */}
          <div className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">2. Sources de données</h2>
              <button
                onClick={() => set("sources", ["auto"])}
                className={`rounded-full border px-3 py-1 text-xs ${auto ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}
              >
                ✨ Auto : toutes les sources adaptées au pays
              </button>
            </div>
            {sources.loading && <Spinner />}
            <div className="grid gap-3 sm:grid-cols-2">
              {(sources.data || []).map((p) => {
                const covered = supports(p);
                const selected = auto ? covered && p.configured : form.sources.includes(p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => toggleSource(p.name)}
                    className={`rounded-2xl border p-3.5 text-left transition ${selected ? "border-brand bg-brand/5" : "border-line hover:bg-soft"} ${auto && !selected ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{p.label}</span>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-brand" : "bg-line"}`} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{p.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="info">{p.countries === "mondial" ? "Mondial" : p.countries.join(", ")}</Badge>
                      {p.requires_key ? (
                        p.configured ? <Badge tone="ok">Clé OK</Badge> : <Badge tone="warn">Clé manquante</Badge>
                      ) : <Badge tone="ok">Sans clé</Badge>}
                      {!covered && form.country && <Badge tone="muted">Pays non couvert</Badge>}
                    </div>
                    {p.requires_key && !p.configured && (
                      <Link to="/settings" onClick={(e) => e.stopPropagation()} className="mt-2 inline-block text-xs text-brand underline">Ajouter la clé</Link>
                    )}
                  </button>
                );
              })}
            </div>
            {active.length === 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                <AlertTriangle size={16} /> Aucune source active pour ce pays : choisis un pays ou sélectionne des sources manuellement.
              </div>
            )}
            {noCountryWarn && (
              <div className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                <AlertTriangle size={16} /> Wikidata nécessite un pays : il sera ignoré sans pays.
              </div>
            )}
          </div>

          {/* Filtres dynamiques */}
          <div className="card p-5">
            <button className="flex w-full items-center justify-between" onClick={() => setOpenFilters(!openFilters)}>
              <h2 className="font-semibold">3. Filtres avancés <span className="text-sm font-normal text-muted">(selon les sources actives)</span></h2>
              <ChevronDown size={18} className={`transition ${openFilters ? "rotate-180" : ""}`} />
            </button>
            {openFilters && (
              <div className="mt-4 space-y-5">
                {active.filter((p) => Object.keys(p.filters || {}).length).map((p) => (
                  <div key={p.name}>
                    <div className="mb-2 text-sm font-medium">{p.label}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(p.filters).map(([k, help]) => (
                        <Field key={k} label={k} hint={help}>
                          {BOOL_KEYS.has(k) ? (
                            <select className="input" value={form.filters[k] ?? ""} onChange={(e) => setFilter(k, e.target.value)}>
                              <option value="">Par défaut</option><option value="true">Oui</option><option value="false">Non</option>
                            </select>
                          ) : (
                            <input className="input" placeholder={LIST_KEYS.has(k) ? "valeur1, valeur2" : ""} value={form.filters[k] ?? ""} onChange={(e) => setFilter(k, e.target.value)} />
                          )}
                        </Field>
                      ))}
                    </div>
                  </div>
                ))}
                {active.every((p) => !Object.keys(p.filters || {}).length) && <p className="text-sm text-muted">Aucun filtre disponible pour les sources actives.</p>}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">4. Emails</h2>
            <Toggle checked={form.enrich_websites} onChange={(v) => set("enrich_websites", v)} label="Lire les sites web (pages contact)" hint="Requêtes HTTP simples, sans navigateur : trouve emails et téléphones affichés en clair." />
            <Toggle checked={form.discover_emails} onChange={(v) => set("discover_emails", v)} label="Découvrir des emails par patterns" hint="Teste contact@, info@, prenom.nom@… et ne garde que les adresses confirmées par SMTP." />
            <Toggle checked={form.verify} onChange={(v) => set("verify", v)} label="Vérifier les emails trouvés" />
            <Field label="Test SMTP">
              <select className="input sm:w-64" value={form.use_smtp} onChange={(e) => set("use_smtp", e.target.value)}>
                <option value="">Selon la configuration</option><option value="true">Forcer activé</option><option value="false">Forcer désactivé</option>
              </select>
            </Field>
          </div>

          <button className="btn btn-primary w-full py-3 text-base" onClick={submit} disabled={busy || active.length === 0}>
            {busy ? <Spinner /> : <Rocket size={18} />} Lancer la prospection
          </button>
        </div>

        {/* Résultats */}
        <div className="space-y-5 xl:col-span-2">
          {jobId ? (
            <JobCard
              jobId={jobId}
              onDone={recent.reload}
              actions={(job) =>
                job.status === "done" && (
                  <>
                    <Link to="/companies" className="btn btn-ghost btn-sm">Voir les entreprises</Link>
                    <Link to="/contacts?status=valid" className="btn btn-ghost btn-sm">Prospects valides</Link>
                    <button className="btn btn-primary btn-sm" onClick={() => api.download("/api/export/contacts", { status: "valid", format: "xlsx" }).catch((e) => toast.error(e.message))}>
                      <Download size={14} /> Excel (valides)
                    </button>
                  </>
                )
              }
            />
          ) : (
            <div className="card grid place-items-center p-10 text-center">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand"><Radar size={26} /></div>
              <div className="font-semibold">Prêt à prospecter</div>
              <p className="mt-1 max-w-xs text-sm text-muted">Renseigne tes critères puis lance la recherche : la progression et les résultats s'affichent ici.</p>
            </div>
          )}

          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><History size={16} /> Recherches récentes</h2>
            {searches.length === 0 && <p className="text-sm text-muted">Aucune recherche.</p>}
            <ul className="divide-y divide-line">
              {searches.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {[j.params?.query, j.params?.location, countryName(j.params?.country)].filter((x) => x && x !== "—").join(" · ") || "Recherche"}
                    </div>
                    <div className="text-xs text-muted">#{j.id} · {fmtDate(j.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <JobStatus status={j.status} />
                    <button className="btn btn-ghost btn-sm" onClick={() => reuse(j)}>Réutiliser</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setJobId(j.id)}>Voir</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}