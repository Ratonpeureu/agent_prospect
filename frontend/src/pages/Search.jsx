import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, ChevronDown, Download, History, Plus, Radar, Rocket, X } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { COUNTRIES, countryName } from "../lib/countries";
import { fmtDate } from "../lib/format";
import { Badge, Field, PageHeader, Spinner, Toggle } from "../components/ui";
import JobCard, { JobStatus } from "../components/JobCard";
import { useToast } from "../components/Toast";

const LIST_KEYS = new Set(["osm_tags", "naf", "sic_codes", "signals"]);
const BOOL_KEYS = new Set(["officers", "ess", "siege_only", "include_institutions"]);
const NEEDS_COUNTRY = new Set(["wikidata", "opencorporates", "worldbank", "ted", "common_crawl", "gdelt"]);
const MAX_COMBOS = 100;

const LEVELS = [["c_level", "Dirigeants"], ["director", "Directeurs"], ["manager", "Managers"], ["staff", "Équipe"]];
const DEPTS = [["direction", "Direction"], ["commercial", "Commercial"], ["marketing", "Marketing / Com"], ["finance", "Finance / Compta"], ["rh", "RH"], ["it", "IT / Tech"], ["operations", "Opérations"], ["achats", "Achats"], ["juridique", "Juridique"]];
const PEOPLE_SOURCES = [
  ["website", "Pages équipe / contact des sites", "Rapide : noms, postes, emails publiés, profils liés."],
  ["registry", "Dirigeants des registres officiels", "FR et UK : dirigeants personnes physiques."],
  ["web", "Emails exposés ailleurs sur le web", "Via DuckDuckGo : lent, peut être limité."],
  ["profiles", "Profils via moteur de recherche", "Nom, poste et lien de profil lus dans les titres de résultats. Lent, indicatif."],
  ["github", "GitHub (emails publics)", "Expérimental, utile surtout pour les sociétés tech."],
];

const GROUPS = {
  "Afrique de l'Ouest": ["SN", "CI", "ML", "BF", "NE", "GN", "TG", "BJ", "MR", "GM"],
  "Afrique centrale": ["CM", "GA", "CG", "CD", "TD", "CF"],
  Maghreb: ["MA", "DZ", "TN"],
  Europe: ["FR", "BE", "CH", "LU", "GB"],
};

const STEPS = [
  { id: 0, label: "Critères", title: "Que cherches-tu ?" },
  { id: 1, label: "Sources", title: "Où chercher ?" },
  { id: 2, label: "Emails & décideurs", title: "Que veux-tu récupérer ?" },
];

const DEFAULT = {
  queries: [], location: "", countries: [], sources: ["auto"], exclude_sources: [], limit: 50, filters: {},
  enrich_websites: true, discover_emails: true, verify: true, use_smtp: "",
  find_people: true, person_titles: "", person_levels: [], person_departments: [], people_sources: ["website", "registry"],
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
        <span key={v} className={`inline-flex animate-drop items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium ${cls}`}>
          {label(v)}
          <button type="button" aria-label="Retirer" className="opacity-70 transition hover:opacity-100" onClick={() => onRemove(v)}><X size={13} /></button>
        </span>
      ))}
    </div>
  );
}

function Pill({ on, onClick, children }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs transition active:scale-[0.97] ${on ? "border-brand/50 bg-brand/10 font-semibold text-brand" : "border-line text-muted hover:bg-soft hover:text-fg"}`}
    >
      {on && <Check size={12} className="mr-1 inline" />}{children}
    </button>
  );
}

export default function Search() {
  const toast = useToast();
  const [form, setForm] = useState(DEFAULT);
  const [kw, setKw] = useState("");
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const [step, setStep] = useState(0);

  const sources = useAsync(() => api.get("/api/sources"), []);
  const presets = useAsync(() => api.get("/api/presets"), []);
  const recent = useAsync(() => api.get("/api/jobs", { limit: 25 }), []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, filters: { ...f.filters, [k]: v } }));
  const auto = form.sources.includes("auto");
  const toggleIn = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

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
      (auto ? supports(p) && p.configured && p.auto !== false : form.sources.includes(p.name))),
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
  const nKw = Math.max(1, form.queries.length + pending);
  const nCountries = Math.max(1, form.countries.length);
  const combos = nKw * nCountries;
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
      find_people: form.find_people,
      person_titles: String(form.person_titles).split(",").map((s) => s.trim()).filter(Boolean),
      person_levels: form.person_levels, person_departments: form.person_departments,
      people_sources: form.people_sources.length ? form.people_sources : ["website"],
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
      person_titles: (p.person_titles || []).join(", "),
      person_levels: p.person_levels || [], person_departments: p.person_departments || [],
      people_sources: p.people_sources || ["website", "registry"], find_people: p.find_people ?? true,
    });
    setStep(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const searches = (recent.data || []).filter((j) => j.kind === "search").slice(0, 6);
  const levelLabel = Object.fromEntries(LEVELS);
  const deptLabel = Object.fromEntries(DEPTS);
  const peopleSummary = form.find_people
    ? [...form.person_levels.map((l) => levelLabel[l]), ...form.person_departments.map((d) => deptLabel[d])].join(", ") || "Tous les postes"
    : "Désactivé";
  const filtersShown = active.filter((p) => Object.keys(p.filters || {}).length);

  return (
    <>
      <PageHeader title="Nouvelle prospection" subtitle="Interroge plusieurs sources ouvertes en parallèle, puis enrichit et vérifie les emails" />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        {/* ============ Colonne principale ============ */}
        <div className="space-y-4 xl:col-span-2">
          {/* Navigation par étapes */}
          <div className="card flex flex-wrap items-center gap-1 p-1.5">
            {STEPS.map((s) => {
              const cur = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id} type="button" onClick={() => setStep(s.id)}
                  className={`flex min-w-[140px] flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left transition ${cur ? "bg-brand/10" : "hover:bg-soft"}`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition ${cur ? "bg-brand text-brand-fg" : done ? "bg-ok/15 text-ok" : "border border-line bg-soft text-muted"}`}>
                    {done ? <Check size={13} /> : s.id + 1}
                  </span>
                  <span className={`truncate text-sm ${cur ? "font-semibold text-brand" : "text-muted"}`}>{s.label}</span>
                </button>
              );
            })}
          </div>

          <div key={step} className="card animate-fade space-y-6 p-6">
            <h2 className="text-lg font-semibold">{STEPS[step].title}</h2>

            {/* ---------- Étape 1 : critères ---------- */}
            {step === 0 && (
              <>
                <Field label="Secteurs / mots-clés" hint="Entrée ou virgule pour en ajouter plusieurs.">
                  <input
                    className="input h-11" placeholder="informatique, banque, restaurant…" value={kw}
                    onChange={(e) => setKw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKw(kw); } }}
                    onBlur={() => kw.trim() && addKw(kw)}
                  />
                </Field>
                <Chips items={form.queries} onRemove={toggleKw} />

                {presets.data && (
                  <div>
                    <div className="mb-2 text-xs font-semibold text-muted">Suggestions : un clic pour ajouter ou retirer</div>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.data.map((p) => (
                        <Pill key={p.id} on={form.queries.includes(p.aliases[0])} onClick={() => toggleKw(p.aliases[0])}>{p.label}</Pill>
                      ))}
                    </div>
                  </div>
                )}

                <div className="h-px bg-line" />

                <Field label="Pays (plusieurs possibles)">
                  <select className="input h-11" value="" onChange={(e) => e.target.value && addCountries([e.target.value])}>
                    <option value="">Ajouter un pays…</option>
                    {COUNTRIES.filter(([c]) => !form.countries.includes(c)).map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                  </select>
                </Field>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted">Raccourcis</span>
                  {Object.entries(GROUPS).map(([g, codes]) => (
                    <button type="button" key={g} onClick={() => addCountries(codes)} className="inline-flex items-center gap-1 rounded-md bg-soft px-2.5 py-1 text-xs font-semibold text-fg/80 ring-1 ring-inset ring-line transition hover:bg-brand/10 hover:text-brand">
                      <Plus size={12} /> {g}
                    </button>
                  ))}
                  {form.countries.length > 0 && <button type="button" onClick={() => set("countries", [])} className="px-2 text-xs font-semibold text-bad hover:underline">Tout retirer</button>}
                </div>
                <Chips items={form.countries} label={countryName} onRemove={removeCountry} />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Ville / zone" className="sm:col-span-2" hint="Appliquée à tous les pays.">
                    <input className="input" placeholder="Dakar, Lyon, 75, London…" value={form.location} onChange={(e) => set("location", e.target.value)} />
                  </Field>
                  <Field label="Résultats max." hint="Par source et par combinaison.">
                    <input type="number" min="1" max="500" className="input" value={form.limit} onChange={(e) => set("limit", e.target.value)} />
                  </Field>
                </div>

                <div className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition ${tooMany ? "bg-bad/10 text-bad" : "bg-brand/10 text-brand"}`}>
                  {nKw} mot(s)-clé(s) × {nCountries} pays = <b>{combos}</b> combinaison(s) par source
                  {tooMany && ` · maximum ${MAX_COMBOS}, réduis la sélection.`}
                </div>
              </>
            )}

            {/* ---------- Étape 2 : sources ---------- */}
            {step === 1 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-md text-sm text-muted">Clique une carte pour la choisir. « Ignorer » l'exclut de la recherche, même en mode Auto.</p>
                  <button
                    type="button" onClick={() => set("sources", ["auto"])}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition active:scale-[0.97] ${auto ? "border-brand/50 bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}
                  >
                    ✨ Auto : sources adaptées aux pays
                  </button>
                </div>

                {sources.loading && <Spinner />}
                {sources.error && (
                  <div className="flex items-center gap-2 rounded-md bg-bad/10 p-3 text-sm text-bad">
                    <AlertTriangle size={16} /> Impossible de charger les sources : {sources.error.message}
                    <button type="button" className="ml-auto underline" onClick={sources.reload}>Réessayer</button>
                  </div>
                )}

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {(sources.data || []).map((p) => {
                    const covered = supports(p);
                    const excluded = isExcluded(p.name);
                    const selected = !excluded && (auto ? covered && p.configured : form.sources.includes(p.name));
                    return (
                      <div
                        key={p.name} role="button" tabIndex={0}
                        onClick={() => toggleSource(p.name)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSource(p.name)}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 text-left transition hover:shadow-card active:scale-[0.99] ${
                          excluded ? "border-bad/40 bg-bad/5 opacity-70" : selected ? "border-brand/60 bg-brand/5" : "border-line hover:bg-soft"
                        } ${auto && !selected && !excluded ? "opacity-60" : ""}`}
                      >
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition ${excluded ? "border-bad bg-bad text-white" : selected ? "border-brand bg-brand text-brand-fg" : "border-line bg-surface"}`}>
                          {selected && <Check size={11} strokeWidth={3.5} />}
                          {excluded && <X size={11} strokeWidth={3.5} />}
                        </span>
                        <div className="min-w-0 grow">
                          <div className={`text-sm font-semibold ${excluded ? "line-through" : ""}`}>{p.label}</div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</p>
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
                              type="button" onClick={(e) => { e.stopPropagation(); toggleExclude(p.name); }}
                              className={`inline-flex items-center gap-1 text-xs font-semibold ${excluded ? "text-brand" : "text-bad"} hover:underline`}
                            >
                              <Ban size={12} /> {excluded ? "Réactiver" : "Ignorer"}
                            </button>
                            {p.requires_key && !p.configured && (
                              <Link to="/settings" onClick={(e) => e.stopPropagation()} className="text-xs font-semibold text-brand underline">Ajouter la clé</Link>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!sources.error && !sources.loading && active.length === 0 && (
                  <div className="flex items-center gap-2 rounded-md bg-warn/10 p-3 text-sm text-warn">
                    <AlertTriangle size={16} /> Aucune source active : ajoute un pays, retire une exclusion ou sélectionne des sources manuellement.
                  </div>
                )}
                {noCountryWarn && (
                  <div className="flex items-center gap-2 rounded-md bg-warn/10 p-3 text-sm text-warn">
                    <AlertTriangle size={16} /> Wikidata, OpenCorporates et d'autres sources nécessitent un pays : elles seront ignorées sans pays.
                  </div>
                )}

                {/* Filtres avancés (repliés) */}
                <div className="rounded-lg border border-line">
                  <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpenFilters(!openFilters)}>
                    <span>
                      <span className="text-sm font-semibold">Filtres avancés</span>
                      <span className="ml-2 text-xs text-muted">optionnel · selon les sources actives</span>
                    </span>
                    <ChevronDown size={18} className={`text-muted transition ${openFilters ? "rotate-180" : ""}`} />
                  </button>
                  {openFilters && (
                    <div className="animate-drop space-y-5 border-t border-line p-4">
                      {filtersShown.map((p) => (
                        <div key={p.name}>
                          <div className="mb-2 text-sm font-semibold">{p.label}</div>
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
                      {filtersShown.length === 0 && <p className="text-sm text-muted">Aucun filtre disponible pour les sources actives.</p>}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- Étape 3 : emails & décideurs ---------- */}
            {step === 2 && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["enrich_websites", "Lire les sites web", "Pages contact : emails et téléphones affichés en clair (requêtes HTTP simples)."],
                    ["discover_emails", "Découvrir par patterns", "Teste contact@, info@, prenom.nom@… et ne garde que les adresses confirmées par SMTP."],
                    ["verify", "Vérifier les emails trouvés", "Contrôle de chaque adresse après la collecte."],
                  ].map(([k, l, h]) => (
                    <div key={k} className={`rounded-lg border p-3.5 transition ${form[k] ? "border-brand/40 bg-brand/5" : "border-line bg-soft"}`}>
                      <Toggle checked={form[k]} onChange={(v) => set(k, v)} label={l} hint={h} />
                    </div>
                  ))}
                  <div className="rounded-lg border border-line bg-soft p-3.5">
                    <Field label="Test SMTP">
                      <select className="input" value={form.use_smtp} onChange={(e) => set("use_smtp", e.target.value)}>
                        <option value="">Selon la configuration</option><option value="true">Forcer activé</option><option value="false">Forcer désactivé</option>
                      </select>
                    </Field>
                  </div>
                </div>

                <div className="h-px bg-line" />

                <div className={`rounded-lg border p-3.5 transition ${form.find_people ? "border-brand/40 bg-brand/5" : "border-line bg-soft"}`}>
                  <Toggle
                    checked={form.find_people} onChange={(v) => set("find_people", v)} label="Rechercher les personnes de chaque entreprise"
                    hint="Nom, poste, email, téléphone, profil. Sources publiques uniquement. Un email est déduit seulement s'il est confirmé par SMTP ou calqué sur le format réel du domaine (« Risqué »)."
                  />
                </div>

                {form.find_people && (
                  <div className="animate-drop space-y-5">
                    <Field label="Postes recherchés" hint="Mots-clés séparés par des virgules. Vide = tous les postes trouvés.">
                      <input className="input" placeholder="directeur, responsable achats, dsi…" value={form.person_titles} onChange={(e) => set("person_titles", e.target.value)} />
                    </Field>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted">Niveau (vide = tous)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {LEVELS.map(([k, l]) => <Pill key={k} on={form.person_levels.includes(k)} onClick={() => toggleIn("person_levels", k)}>{l}</Pill>)}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted">Département (vide = tous)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {DEPTS.map(([k, l]) => <Pill key={k} on={form.person_departments.includes(k)} onClick={() => toggleIn("person_departments", k)}>{l}</Pill>)}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted">Où chercher les personnes</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {PEOPLE_SOURCES.map(([k, l, h]) => {
                          const on = form.people_sources.includes(k);
                          return (
                            <div
                              key={k} role="button" tabIndex={0} onClick={() => toggleIn("people_sources", k)}
                              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleIn("people_sources", k)}
                              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition active:scale-[0.99] ${on ? "border-brand/60 bg-brand/5" : "border-line hover:bg-soft"}`}
                            >
                              <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition ${on ? "border-brand bg-brand text-brand-fg" : "border-line bg-surface"}`}>
                                {on && <Check size={11} strokeWidth={3.5} />}
                              </span>
                              <div>
                                <div className="text-sm font-semibold">{l}</div>
                                <div className="text-xs text-muted">{h}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Navigation entre étapes */}
            <div className="flex items-center justify-between border-t border-line pt-4">
              <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Précédent</button>
              {step < STEPS.length - 1
                ? <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Suivant <ArrowRight size={15} /></button>
                : <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || active.length === 0 || tooMany}>{busy ? <Spinner /> : <Rocket size={16} />} Lancer la prospection</button>}
            </div>
          </div>
        </div>

        {/* ============ Colonne droite ============ */}
        <aside className="space-y-4 xl:sticky xl:top-4">
          <div className="rounded-lg bg-ink-950 p-5 text-white shadow-pop">
            <div className="mb-4 flex items-center gap-2">
              <Radar size={18} className="text-brand-300" />
              <h2 className="text-base font-semibold">Récapitulatif</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[[combos * active.length, "requêtes"], [active.length, "sources"], [form.countries.length, "pays"]].map(([v, l]) => (
                <div key={l} className="rounded-md bg-ink-900 px-3 py-3">
                  <div className="text-xl font-semibold tabular-nums">{v}</div>
                  <div className="text-xs text-ink-400">{l}</div>
                </div>
              ))}
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              {[
                ["Secteurs", [...form.queries, ...(kw.trim() ? [kw.trim()] : [])].join(", ") || "—"],
                ["Pays", form.countries.map(countryName).join(", ") || "—"],
                ["Zone", form.location.trim() || "—"],
                ["Décideurs", peopleSummary],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4">
                  <dt className="shrink-0 text-ink-400">{k}</dt>
                  <dd className="line-clamp-2 text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button" onClick={submit} disabled={busy || active.length === 0 || tooMany}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-600 text-sm font-semibold text-white transition hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Spinner /> : <Rocket size={16} />} Lancer la prospection
            </button>
            {tooMany && <p className="mt-2 text-center text-xs text-bad">Trop de combinaisons (max {MAX_COMBOS}).</p>}
            <p className="mt-3 text-center text-xs text-ink-500">La tâche continue sur le serveur : tu peux quitter la page.</p>
          </div>

          {jobId && (
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
          )}

          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><History size={16} /> Recherches récentes</h2>
            {searches.length === 0 && <p className="text-sm text-muted">Aucune recherche.</p>}
            <ul className="space-y-1">
              {searches.map((j) => (
                <li key={j.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition hover:bg-soft">
                  <div className="min-w-0 grow">
                    <div className="truncate font-semibold">{jobLabel(j)}</div>
                    <div className="text-xs text-muted">#{j.id} · {fmtDate(j.created_at)}</div>
                  </div>
                  <JobStatus status={j.status} />
                  <button className="btn btn-ghost btn-sm" onClick={() => reuse(j)}>Réutiliser</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setJobId(j.id)}>Voir</button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}