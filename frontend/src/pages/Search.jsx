import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, ChevronDown, Download, History, Radar, Rocket, X } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { COUNTRIES, countryName } from "../lib/countries";
import { fmtDate } from "../lib/format";
import { Badge, Field, PageHeader, Spinner, Toggle } from "../components/ui";
import JobCard, { JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";

const LIST_KEYS = new Set(["osm_tags", "naf", "sic_codes"]);
const BOOL_KEYS = new Set(["officers", "ess", "siege_only"]);
const NEEDS_COUNTRY = new Set(["wikidata", "opencorporates"]);
const MAX_COMBOS = 60;

const GROUPS = {
  "Afrique de l'Ouest": ["SN", "CI", "ML", "BF", "NE", "GN", "TG", "BJ", "MR", "GM"],
  "Afrique centrale": ["CM", "GA", "CG", "CD", "TD", "CF"],
  Maghreb: ["MA", "DZ", "TN"],
  Europe: ["FR", "BE", "CH", "LU", "GB"],
};

const DEFAULT = {
  queries: [], location: "", countries: [], sources: ["auto"], exclude_sources: [], limit: 50, filters: {},
  enrich_websites: true, discover_emails: true, verify: true, use_smtp: "",
};

const filtersToRaw = (f = {}) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]));

const jobLabel = (j) => {
  const p = j.params || {};
  const qs = p.queries?.length ? p.queries : p.query ? [p.query] : [];
  const cs = (p.countries?.length ? p.countries : p.country ? [p.country] : []).map(countryName);
  return [qs.join(", "), p.location, cs.join(", ")].filter(Boolean).join(" · ") || "Recherche";
};

function Chips({ items, label = (v) => v, onRemove, tone = "brand" }) {
  if (!items.length) return null;
  const cls = tone === "bad" ? "bg-bad/10 text-bad" : "bg-brand/10 text-brand";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <span key={v} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
          {label(v)}
          <button type="button" aria-label="Retirer" onClick={() => onRemove(v)}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}

export default function Search() {
  const toast = useToast();
  const [form, setForm] = useState(DEFAULT);
  const [kw, setKw] = useState("");
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openFilters, setOpenFilters] = useState(true);

  const sources = useAsync(() => api.get("/api/sources"), []);
  const presets = useAsync(() => api.get("/api/presets"), []);
  const recent = useAsync(() => api.get("/api/jobs", { limit: 25 }), []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filters: { ...f.filters, [k]: v } }));
  const auto = form.sources.includes("auto");

  // ---- mots-clés (plusieurs) ----
  const addKw = (raw) => {
    const vals = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (vals.length) setForm((f) => ({ ...f, queries: [...new Set([...f.queries, ...vals])] }));
    setKw("");
  };
  const toggleKw = (v) =>
    setForm((f) => ({ ...f, queries: f.queries.includes(v) ? f.queries.filter((x) => x !== v) : [...f.queries, v] }));

  // ---- pays (plusieurs) ----
  const addCountries = (codes) =>
    setForm((f) => ({ ...f, countries: [...new Set([...f.countries, ...codes])] }));
  const removeCountry = (c) => setForm((f) => ({ ...f, countries: f.countries.filter((x) => x !== c) }));

  // ---- sources ----
  const supports = (p) => p.countries === "mondial" || form.countries.some((c) => p.countries.includes(c));
  const isExcluded = (name) => form.exclude_sources.includes(name);

  const active = useMemo(
    () => (sources.data || []).filter((p) =>
      !form.exclude_sources.includes(p.name) &&
      (auto ? supports(p) && p.configured : form.sources.includes(p.name))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources.data, form.sources, form.countries, form.exclude_sources]
  );

  const toggleSource = (name) => {
    setForm((f) => {
      let list = f.sources.includes("auto") ? [name] : f.sources.includes(name) ? f.sources.filter((s) => s !== name) : [...f.sources, name];
      if (!list.length) list = ["auto"];
      return { ...f, sources: list, exclude_sources: f.exclude_sources.filter((s) => s !== name) };
    });
  };
  const toggleExclude = (name) => {
    setForm((f) => {
      if (f.exclude_sources.includes(name)) return { ...f, exclude_sources: f.exclude_sources.filter((s) => s !== name) };
      let list = f.sources.filter((s) => s !== name);
      if (!list.length) list = ["auto"];
      return { ...f, sources: list, exclude_sources: [...f.exclude_sources, name] };
    });
  };

  const pending = kw.trim() ? 1 : 0;
  const combos = Math.max(1, form.queries.length + pending) * Math.max(1, form.countries.length);
  const tooMany = combos > MAX_COMBOS;
  const noCountryWarn = !form.countries.length && active.some((p) => NEEDS_COUNTRY.has(p.name));

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
    const queries = kw.trim() ? [...new Set([...form.queries, ...kw.split(",").map((s) => s.trim()).filter(Boolean)])] : form.queries;
    const body = {
      queries, countries: form.countries, location: form.location.trim(),
      sources: form.sources, exclude_sources: form.exclude_sources,
      limit: Number(form.limit) || 50, filters,
      enrich_websites: form.enrich_websites, discover_emails: form.discover_emails, verify: form.verify,
      use_smtp: form.use_smtp === "" ? null : form.use_smtp === "true",
    };
    setBusy(true);
    try {
      const r = await api.post("/api/search", body);
      setJobId(r.job_id);
      setKw("");
      setForm((f) => ({ ...f, queries }));
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
      ...DEFAULT, ...p,
      queries: p.queries?.length ? p.queries : p.query ? [p.query] : [],
      countries: p.countries?.length ? p.countries : p.country ? [p.country] : [],
      exclude_sources: p.exclude_sources || [],
      location: p.location || "", use_smtp: p.use_smtp == null ? "" : String(p.use_smtp),
      filters: filtersToRaw(p.filters),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const searches = (recent.data || []).filter((j) => j.kind === "search").slice(0, 8);

  return (
    <>
      <PageHeader title="Prospection" subtitle="Interroge plusieurs sources ouvertes en parallèle, puis enrichis et vérifie les emails" />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-3">
          {/* 1. Critères */}
          <div className="card space-y-4 p-5">
            <h2 className="font-semibold">1. Critères</h2>

            <Field label="Secteurs / mots-clés (Entrée ou virgule pour en ajouter plusieurs)">
              <input
                className="input" placeholder="informatique, banque, restaurant…" value={kw}
                onChange={(e) => setKw(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKw(kw); } }}
                onBlur={() => kw.trim() && addKw(kw)}
              />
            </Field>
            <Chips items={form.queries} onRemove={toggleKw} />

            {presets.data && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted">Secteurs prédéfinis (cliquer pour ajouter / retirer, traduits en tags OSM / codes NAF / SIC)</div>
                <div className="flex flex-wrap gap-1.5">
                  {presets.data.map((p) => {
                    const on = form.queries.includes(p.aliases[0]);
                    return (
                      <button
                        type="button" key={p.id} onClick={() => toggleKw(p.aliases[0])}
                        className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Field label="Pays (plusieurs possibles)">
              <select className="input" value="" onChange={(e) => e.target.value && addCountries([e.target.value])}>
                <option value="">Ajouter un pays…</option>
                {COUNTRIES.filter(([c]) => !form.countries.includes(c)).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-1.5">
              {Object.entries(GROUPS).map(([g, codes]) => (
                <button type="button" key={g} onClick={() => addCountries(codes)} className="rounded-full border border-line px-3 py-1 text-xs hover:bg-soft">+ {g}</button>
              ))}
              {form.countries.length > 0 && <button type="button" onClick={() => set("countries", [])} className="px-2 text-xs text-bad">Tout retirer</button>}
            </div>
            <Chips items={form.countries} label={countryName} onRemove={removeCountry} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ville / zone (appliquée à tous les pays)">
                <input className="input" placeholder="Dakar, Lyon, 75, London…" value={form.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
              <Field label="Résultats max. par source et par combinaison">
                <input type="number" min="1" max="500" className="input" value={form.limit} onChange={(e) => set("limit", e.target.value)} />
              </Field>
            </div>

            <div className={`rounded-xl p-3 text-xs ${tooMany ? "bg-bad/10 text-bad" : "bg-soft text-muted"}`}>
              {Math.max(1, form.queries.length + pending)} mot(s)-clé(s) × {Math.max(1, form.countries.length)} pays = <b>{combos}</b> combinaison(s) par source
              {tooMany && ` : maximum ${MAX_COMBOS}, réduis la sélection.`}
            </div>
          </div>

          {/* 2. Sources */}
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">2. Sources de données</h2>
              <button
                type="button" onClick={() => set("sources", ["auto"])}
                className={`rounded-full border px-3 py-1 text-xs ${auto ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}
              >
                ✨ Auto : toutes les sources adaptées aux pays
              </button>
            </div>
            <p className="text-xs text-muted">Clique une carte pour la choisir. « Ignorer » l'exclut de la recherche, même en mode Auto.</p>
            {sources.loading && <Spinner />}
            <div className="grid gap-3 sm:grid-cols-2">
              {(sources.data || []).map((p) => {
                const covered = supports(p);
                const excluded = isExcluded(p.name);
                const selected = !excluded && (auto ? covered && p.configured : form.sources.includes(p.name));
                return (
                  <div
                    key={p.name} role="button" tabIndex={0}
                    onClick={() => toggleSource(p.name)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSource(p.name)}
                    className={`cursor-pointer rounded-2xl border p-3.5 text-left transition ${
                      excluded ? "border-bad/40 bg-bad/5 opacity-70" : selected ? "border-brand bg-brand/5" : "border-line hover:bg-soft"
                    } ${auto && !selected && !excluded ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-sm font-semibold ${excluded ? "line-through" : ""}`}>{p.label}</span>
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${excluded ? "bg-bad" : selected ? "bg-brand" : "bg-line"}`} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{p.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">{p.countries === "mondial" ? "Mondial" : p.countries.join(", ")}</Badge>
                      {p.requires_key ? (
                        p.configured ? <Badge tone="ok">Clé OK</Badge> : <Badge tone="warn">Clé manquante</Badge>
                      ) : <Badge tone="ok">Sans clé</Badge>}
                      {!covered && form.countries.length > 0 && <Badge tone="muted">Pays non couvert</Badge>}
                      {excluded && <Badge tone="bad">Ignorée</Badge>}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleExclude(p.name); }}
                        className={`inline-flex items-center gap-1 text-xs ${excluded ? "text-brand" : "text-bad"} hover:underline`}
                      >
                        <Ban size={12} /> {excluded ? "Réactiver" : "Ignorer"}
                      </button>
                      {p.requires_key && !p.configured && (
                        <Link to="/settings" onClick={(e) => e.stopPropagation()} className="text-xs text-brand underline">Ajouter la clé</Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {active.length === 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                <AlertTriangle size={16} /> Aucune source active : ajoute un pays, retire une exclusion ou sélectionne des sources manuellement.
              </div>
            )}
            {noCountryWarn && (
              <div className="flex items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
                <AlertTriangle size={16} /> Wikidata et OpenCorporates nécessitent un pays : ils seront ignorés sans pays.
              </div>
            )}
          </div>

          {/* 3. Filtres avancés */}
          <div className="card p-5">
            <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpenFilters(!openFilters)}>
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

          {/* 4. Emails */}
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

          <button className="btn btn-primary w-full py-3 text-base" onClick={submit} disabled={busy || active.length === 0 || tooMany}>
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
                    <button className="btn btn-primary btn-sm" onClick={() => api.download("/api/export/contacts", { status: "valid", exported: "no", format: "xlsx" }).then((r) => toast.success(`${r.count} prospect(s) exporté(s), fichier #${r.id} dans Fichiers`)).catch((e) => toast.error(e.message))}>
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
                    <div className="truncate font-medium">{jobLabel(j)}</div>
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