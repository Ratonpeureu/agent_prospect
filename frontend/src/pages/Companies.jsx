import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, ChevronDown, Download, ExternalLink, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { COUNTRIES, countryName } from "../lib/countries";
import { fmtDate, fmtNum } from "../lib/format";
import { Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, Toggle } from "../components/ui";
import JobCard from "../components/JobCard";
import SourceFilter from "../components/SourceFilter";
import { Chip, Dropdown, SearchBox, SelectChip, TextChip } from "../components/Filters";
import { useToast } from "../components/Toast";

const PAGE = 50;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));

const EMPTY_FILTERS = {
  q: "", country: "", city: "", sector: "", source: "", exclude_source: "",
  has_website: "", has_contacts: "", exported: "", file_id: "",
};

const EXTRA_LABELS = {
  naf: "Code NAF", legal_form: "Forme juridique", employees: "Effectif", category: "Catégorie",
  creation_date: "Date de création", status: "Statut", siret: "SIRET", lei: "LEI", wikidata: "Wikidata",
  description: "Description", sic_codes: "Codes SIC", osm_ref: "Réf. OpenStreetMap", registered_as: "Immatriculation",
  jurisdiction: "Juridiction",
};

const splitCsv = (s) => (s ? s.split(",").filter(Boolean) : []);

export default function Companies() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const [f, setF] = useState({
    q: sp.get("q") || "", country: sp.get("country") || "", city: "", sector: "",
    source: sp.get("source") || "", exclude_source: sp.get("exclude_source") || "",
    has_website: "", has_contacts: "", exported: "", file_id: sp.get("file_id") || "",
  });
  const [mark, setMark] = useState(true);
  const [cnt, setCnt] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const d = useDebounce(f, 400);
  const sources = useAsync(() => api.get("/api/sources"), []);
  const stats = useAsync(() => api.get("/api/stats"), []);
  const list = useAsync(() => api.list("/api/companies", { ...clean(d), limit: PAGE, offset: page * PAGE }), [JSON.stringify(d), page]);

  const [importing, setImporting] = useState(false);
  const compSources = useAsync(() => api.get("/api/companies/sources"), []);

  const upd = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(0); };
  const setSrc = (inc, exc) => { setF((x) => ({ ...x, source: inc, exclude_source: exc })); setPage(0); };
  const items = list.data?.items || [];
  const sourceNames = [...new Set([...(sources.data || []).map((s) => s.name), ...(compSources.data || []), "manual", "import"])];

  const exportIt = (format) =>
    api.download("/api/export/companies", { ...clean(f), format, limit: Number(cnt) || undefined, record: mark ? undefined : "false" })
      .then((r) => {
        toast.success(`${r.count} entreprise(s) exportée(s)` + (r.id ? ` · fichier #${r.id} (page Fichiers)` : " · non marquées"));
        if (r.id) list.reload();
      })
      .catch((e) => toast.error(e.message));

  // ---- onglets rapides (raccourcis vers les filtres) ----
  const flags = { c: f.has_contacts, w: f.has_website, e: f.exported };
  const nFlags = [flags.c, flags.w, flags.e].filter(Boolean).length;
  const tabs = [
    { id: "all", label: "Toutes", on: nFlags === 0, count: stats.data?.companies, set: { has_contacts: "", has_website: "", exported: "" } },
    { id: "nocontact", label: "Sans contact", on: nFlags === 1 && flags.c === "false", count: stats.data?.companies_without_contacts, set: { has_contacts: "false", has_website: "", exported: "" } },
    { id: "site", label: "Avec site web", on: nFlags === 1 && flags.w === "true", set: { has_contacts: "", has_website: "true", exported: "" } },
    { id: "new", label: "Non exportées", on: nFlags === 1 && flags.e === "no", set: { has_contacts: "", has_website: "", exported: "no" } },
  ];
  const pickTab = (t) => { setF((x) => ({ ...x, ...t.set })); setPage(0); };

  const incN = splitCsv(f.source).length;
  const excN = splitCsv(f.exclude_source).length;
  const srcActive = incN + excN > 0;
  const anyFilter = Object.entries(f).some(([k, v]) => k !== "file_id" && !!v);

  return (
    <>
      <PageHeader
        title="Entreprises"
        subtitle="Base centralisée et dédoublonnée · n° légal, puis domaine, puis nom + ville"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setImporting(true)}><Upload size={16} /> Importer</button>
            <Dropdown
              width="w-80"
              trigger={({ open, toggle }) => (
                <button className="btn btn-ghost" onClick={toggle}><Download size={16} /> Exporter <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} /></button>
              )}
            >
              {(close) => (
                <div className="space-y-3">
                  <div className="text-sm">
                    <b>{fmtNum(list.data?.total ?? 0)}</b> entreprise(s) correspondent aux filtres.
                  </div>
                  <Field label="Nombre max. à exporter (vide = toutes)">
                    <input type="number" min="1" className="input" placeholder="toutes" value={cnt} onChange={(e) => setCnt(e.target.value)} />
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-brand" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Marquer comme exportées
                  </label>
                  <div className="flex gap-2">
                    <button className="btn btn-primary grow" onClick={() => { exportIt("xlsx"); close(); }}>Excel</button>
                    <button className="btn btn-ghost grow" onClick={() => { exportIt("csv"); close(); }}>CSV</button>
                  </div>
                </div>
              )}
            </Dropdown>
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Ajouter</button>
          </>
        }
      />

      {/* Onglets rapides */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id} onClick={() => pickTab(t)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${t.on ? "border-brand font-semibold text-fg" : "border-transparent text-muted hover:bg-soft hover:text-fg"}`}
          >
            {t.label}
            {t.count != null && <span className={`rounded px-1.5 text-xs font-semibold ${t.on ? "bg-brand/10 text-brand" : "bg-soft text-muted"}`}>{fmtNum(t.count)}</span>}
          </button>
        ))}
      </div>

      {/* Recherche + filtres en pastilles */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox value={f.q} onChange={(v) => upd("q", v)} placeholder="Nom, domaine, n° légal…" />
        <SelectChip label="Pays" value={f.country} onChange={(v) => upd("country", v)} searchable options={[["", "Tous les pays"], ...COUNTRIES]} />
        <TextChip label="Secteur" value={f.sector} onChange={(v) => upd("sector", v)} placeholder="Ex : informatique" />
        <TextChip label="Ville" value={f.city} onChange={(v) => upd("city", v)} placeholder="Ex : Dakar" />
        <SelectChip label="Site web" value={f.has_website} onChange={(v) => upd("has_website", v)} options={[["", "Indifférent"], ["true", "Avec site web"]]} />
        <SelectChip label="Contacts" value={f.has_contacts} onChange={(v) => upd("has_contacts", v)} options={[["", "Indifférent"], ["true", "Avec contacts"], ["false", "Sans contact"]]} />
        <SelectChip label="Export" value={f.exported} onChange={(v) => upd("exported", v)} options={[["", "Indifférent"], ["no", "Pas encore exportées"], ["yes", "Déjà exportées"]]} />
        <Chip label="Sources" active={srcActive} summary={`${incN ? `${incN} incluse(s)` : ""}${incN && excN ? " · " : ""}${excN ? `${excN} ignorée(s)` : ""}`} onClear={() => setSrc("", "")} width="w-[34rem]">
          <div className="p-1"><SourceFilter sources={sourceNames} include={f.source} exclude={f.exclude_source} onChange={setSrc} /></div>
        </Chip>
        {anyFilter && (
          <button className="px-2 text-sm font-semibold text-brand hover:underline" onClick={() => { setF({ ...EMPTY_FILTERS, file_id: f.file_id }); setCnt(""); setPage(0); }}>Réinitialiser</button>
        )}
      </div>

      {f.file_id && (
        <div className="mb-3 animate-drop">
          <Badge tone="brand">Lignes du fichier #{f.file_id} <button className="ml-1" onClick={() => upd("file_id", "")}>✕</button></Badge>
        </div>
      )}

      <div className="card overflow-hidden">
        {list.loading && !items.length ? (
          <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>
        ) : !items.length ? (
          <Empty icon={Building2} title="Aucune entreprise" text="Aucun résultat pour ces filtres, ou lance une recherche de prospection." />
        ) : (
          <div className={`overflow-x-auto transition-opacity ${list.loading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-soft">
                <tr>
                  <th className="th">Entreprise</th><th className="th">Secteur</th><th className="th">Localisation</th>
                  <th className="th">Site / Tél.</th><th className="th">Contacts</th><th className="th">Sources</th><th className="th">Export</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} className="animate-fade cursor-pointer border-b border-line transition last:border-b-0 hover:bg-brand/5">
                    <td className="px-4 py-3"><div className="font-semibold">{c.name}</div><div className="font-mono text-xs text-muted">{c.legal_id || c.domain || ""}</div></td>
                    <td className="px-4 py-3 text-muted">{c.sector || "—"}</td>
                    <td className="px-4 py-3">{c.city || "—"}<div className="text-xs text-muted">{countryName(c.country)}</div></td>
                    <td className="px-4 py-3">
                      {c.website ? <a href={c.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand hover:underline">{c.domain || "site"}</a> : <span className="text-muted">—</span>}
                      <div className="font-mono text-xs text-muted">{c.phone || ""}</div>
                    </td>
                    <td className="px-4 py-3"><Badge tone={c.contacts_count ? "ok" : "muted"}>{c.contacts_count}</Badge></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(c.sources || []).map((s) => <Badge key={s}>{s}</Badge>)}</div></td>
                    <td className="px-4 py-3">
                      {c.exports_count > 0
                        ? <Badge tone="brand" title={`Dernier export : ${fmtDate(c.last_exported_at)}`}>Exportée{c.exports_count > 1 ? ` ×${c.exports_count}` : ""}</Badge>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? null} count={items.length} onPage={setPage} />
      </div>

      {openId && <CompanyModal id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
      {adding && <AddCompany onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); stats.reload(); }} />}
      {importing && <ImportCompanies onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); compSources.reload(); stats.reload(); }} />}
    </>
  );
}

function CompanyModal({ id, onClose, onChanged }) {
  const toast = useToast();
  const company = useAsync(() => api.get(`/api/companies/${id}`), [id]);
  const contacts = useAsync(() => api.list("/api/contacts", { company_id: id, limit: 100 }), [id]);
  const [form, setForm] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const c = company.data;
    if (c) setForm({ name: c.name, website: c.website || "", phone: c.phone || "", address: c.address || "", city: c.city || "", country: c.country || "", sector: c.sector || "", notes: c.notes || "" });
  }, [company.data]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/companies/${id}`, form);
      toast.success("Entreprise mise à jour");
      company.reload();
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const enrich = async () => {
    try {
      const r = await api.post("/api/enrich", { company_ids: [id], crawl_websites: true, discover_emails: true, verify: true });
      setJobId(r.job_id);
    } catch (e) { toast.error(e.message); }
  };
  const remove = async () => {
    if (!window.confirm("Supprimer cette entreprise et tous ses contacts ?")) return;
    try { await api.del(`/api/companies/${id}`); toast.success("Entreprise supprimée"); onChanged(); onClose(); } catch (e) { toast.error(e.message); }
  };

  const c = company.data;
  const extra = c?.extra || {};
  const officers = extra.officers || [];

  return (
    <Modal open onClose={onClose} wide title={c ? c.name : "Entreprise"}
      footer={<>
        <button className="btn btn-danger" onClick={remove}><Trash2 size={15} /> Supprimer</button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !form}>{saving ? <Spinner /> : <Save size={15} />} Enregistrer</button>
      </>}>
      {!form ? <div className="grid h-40 place-items-center"><Spinner size={22} /></div> : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom"><input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Site web" hint="Renseigner le site permet de lancer l'enrichissement d'emails.">
              <input className="input" placeholder="https://…" value={form.website} onChange={(e) => set("website", e.target.value)} />
            </Field>
            <Field label="Téléphone"><input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Secteur"><input className="input" value={form.sector} onChange={(e) => set("sector", e.target.value)} /></Field>
            <Field label="Adresse"><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Ville"><input className="input" value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="Pays">
              <select className="input" value={form.country} onChange={(e) => set("country", e.target.value)}>
                <option value="">—</option>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>

          {(c.legal_id || Object.keys(extra).some((k) => EXTRA_LABELS[k] && extra[k]) || officers.length > 0) && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Informations des registres</h3>
              <div className="grid gap-x-6 gap-y-1.5 rounded-lg border border-line bg-soft p-4 text-sm sm:grid-cols-2">
                {c.legal_id && <div><span className="text-muted">ID légal : </span>{c.legal_id}</div>}
                {Object.entries(EXTRA_LABELS).map(([k, label]) => extra[k] ? (
                  <div key={k}><span className="text-muted">{label} : </span>{Array.isArray(extra[k]) ? extra[k].join(", ") : String(extra[k])}</div>
                ) : null)}
                <div><span className="text-muted">Ajoutée le : </span>{fmtDate(c.created_at)}</div>
              </div>
              {officers.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-semibold text-muted">Dirigeants</div>
                  <div className="flex flex-wrap gap-2">
                    {officers.map((o, i) => <Badge key={i} tone="brand">{o.first_name} {o.last_name}{o.role ? ` · ${o.role}` : ""}</Badge>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {(extra.people || []).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Personnes identifiées sans email ({extra.people.length})</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {extra.people.map((pe, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{pe.first_name} {pe.last_name}</div>
                      <div className="text-xs text-muted">{pe.job_title || "—"} · {pe.source}</div>
                    </div>
                    {pe.profile_url && <a href={pe.profile_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Profil</a>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Contacts ({contacts.data?.total ?? 0})</h3>
              <button className="btn btn-ghost btn-sm" onClick={enrich} disabled={!c.domain} title={c.domain ? "" : "Renseigne d'abord un site web"}>
                <Sparkles size={14} /> Chercher des emails
              </button>
            </div>
            {jobId && <div className="mb-3"><JobCard jobId={jobId} onDone={() => { contacts.reload(); onChanged(); }} /></div>}
            {(contacts.data?.items || []).length === 0 ? (
              <p className="rounded-lg border border-line bg-soft p-4 text-sm text-muted">Aucun contact pour cette entreprise.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {contacts.data.items.map((ct) => (
                  <li key={ct.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0"><div className="truncate font-mono text-xs font-semibold">{ct.email}</div><div className="text-xs text-muted">{ct.full_name || ""} {ct.job_title ? `· ${ct.job_title}` : ""}</div></div>
                    <StatusBadge status={ct.email_status} reason={ct.email_reason} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"><ExternalLink size={14} /> Ouvrir le site</a>}
        </div>
      )}
    </Modal>
  );
}

function AddCompany({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", website: "", city: "", country: "", sector: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ""));
      await api.post("/api/companies", body);
      toast.success("Entreprise ajoutée (ou fusionnée si doublon)");
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Ajouter une entreprise"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={busy || (!f.name.trim() && !f.website.trim())}>{busy && <Spinner />} Ajouter</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Site web"><input className="input" value={f.website} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="Ville"><input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Pays"><select className="input" value={f.country} onChange={(e) => set("country", e.target.value)}><option value="">—</option>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
        <Field label="Secteur"><input className="input" value={f.sector} onChange={(e) => set("sector", e.target.value)} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Adresse" className="sm:col-span-2"><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ImportCompanies({ onClose, onDone }) {
  const toast = useToast();
  const ref = useRef(null);
  const [mode, setMode] = useState("file");
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "file") {
        const fd = new FormData();
        fd.append("file", file); fd.append("source", source || "import"); fd.append("country", country); fd.append("enrich", String(enrich));
        setRes(await api.upload("/api/companies/import", fd));
      } else {
        setRes(await api.post("/api/companies/import-url", { url, source: source || "import", country, enrich }));
      }
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const ready = mode === "file" ? !!file : url.trim().startsWith("http");

  return (
    <Modal open onClose={res ? onDone : onClose} title="Importer une liste d'entreprises"
      footer={res ? <button className="btn btn-primary" onClick={onDone}>Terminer</button>
        : <><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={!ready || busy}>{busy && <Spinner />} Importer</button></>}>
      {res ? (
        <div className="space-y-2 text-sm">
          <p><b>{res.created}</b> entreprise(s) créée(s), <b>{res.merged}</b> fusionnée(s) avec l'existant, sur {res.rows} ligne(s).</p>
          {res.contacts > 0 && <p><b>{res.contacts}</b> contact(s) créé(s) (à vérifier dans Contacts).</p>}
          {res.job_id && <p className="text-muted">Enrichissement lancé : tâche #{res.job_id} (recherche des sites, emails, vérification).</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="inline-flex gap-0.5 rounded-md border border-line bg-soft p-0.5">
            {[["file", "Fichier"], ["url", "Lien web"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={`rounded px-4 py-1.5 text-sm transition ${mode === k ? "bg-surface font-semibold shadow-card" : "text-muted hover:text-fg"}`}>{l}</button>
            ))}
          </div>
          {mode === "file" ? (
            <div onClick={() => ref.current?.click()} className="grid cursor-pointer place-items-center rounded-lg border-2 border-dashed border-line p-8 text-center transition hover:border-brand/50 hover:bg-brand/5">
              <input ref={ref} type="file" accept=".csv,.txt,.xlsx,.xlsm,.pdf,.html,.htm" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
              <Upload className="mb-2 text-brand" size={26} />
              {file ? <div className="font-semibold">{file.name}</div> : <div className="text-sm text-muted">CSV, Excel, PDF ou page HTML (liste d'exposants, annuaire, attributaires…)</div>}
            </div>
          ) : (
            <Field label="Adresse de la page, du PDF ou du fichier"><input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom de la source" hint="Ex. gitex_africa, cciad : filtrable ensuite."><input className="input" placeholder="import" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
            <Field label="Pays par défaut"><select className="input" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">—</option>{COUNTRIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
          </div>
          <Toggle checked={enrich} onChange={setEnrich} label="Enrichir après l'import" hint="Cherche le site web, lit les pages contact et vérifie les emails trouvés." />
        </div>
      )}
    </Modal>
  );
}