import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ban, ChevronDown, Download, Plus, RefreshCw, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { COUNTRIES } from "../lib/countries";
import { Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, Toggle } from "../components/ui";
import SourceFilter from "../components/SourceFilter";
import { Chip, Dropdown, SearchBox, SelectChip, TextChip, ToggleChip } from "../components/Filters";
import { useToast } from "../components/Toast";
import { DEPT_LABEL, LEVEL_LABEL, STATUS, fmtDate, fmtNum } from "../lib/format";

const PAGE = 50;
const ORDER = ["valid", "risky", "unknown", "invalid", "unverified", "blacklisted"];
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== false));
const splitCsv = (s) => (s ? s.split(",").filter(Boolean) : []);

export default function Contacts() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    q: sp.get("q") || "", status: sp.get("status") || "", country: sp.get("country") || "", city: "",
    sector: sp.get("sector") || "", source: sp.get("source") || "", exclude_source: sp.get("exclude_source") || "",
    job_title: "", domain: "", has_phone: false, has_website: false, company_id: sp.get("company_id") || "",
    exported: sp.get("exported") || "", file_id: sp.get("file_id") || "", department: sp.get("department") || "",
    seniority: sp.get("seniority") || "", personal: false, has_profile: false,
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [count, setCount] = useState("");
  const [mark, setMark] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const d = useDebounce(f, 400);
  const sources = useAsync(() => api.get("/api/sources"), []);
  const stats = useAsync(() => api.get("/api/stats"), []);
  const list = useAsync(() => api.list("/api/contacts", { ...clean(d), limit: PAGE, offset: page * PAGE }), [JSON.stringify(d), page]);

  const items = list.data?.items || [];
  const total = list.data?.total ?? 0;
  const resetSel = () => setSelected(new Set());
  const upd = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(0); resetSel(); };
  const setSrc = (inc, exc) => { setF((x) => ({ ...x, source: inc, exclude_source: exc })); setPage(0); resetSel(); };
  const statuses = splitCsv(f.status);
  const toggleStatus = (s) => upd("status", (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(","));
  const sourceNames = [...new Set([...(sources.data || []).map((s) => s.name), "website", "discovery", "people_pattern", "web_public", "profiles", "github", "manual", "import"])];

  const sc = stats.data?.contacts_by_status || {};
  const totalAll = Object.entries(sc).filter(([k]) => k !== "blacklisted").reduce((a, [, v]) => a + v, 0);

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((c) => c.id)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...selected];

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  // Nombre visé : la sélection, sinon le nombre saisi, sinon tous les résultats du filtre
  const n = selected.size ? selected.size : Math.min(Number(count) || total, total);
  const scope = () => (selected.size ? { ids } : { filters: clean(f), limit: Number(count) || null });

  const bulk = (action, label) => run(action, async () => {
    if (!n) return;
    if (!window.confirm(`${label} ${n.toLocaleString("fr-FR")} contact(s) ?`)) return;
    const r = await api.post("/api/contacts/bulk", { action, ...scope() });
    toast.success(r.message);
    resetSel();
    stats.reload();
    if (r.job_id) nav("/jobs"); else list.reload();
  });
  const verifyPending = () => run("pending", async () => {
    const r = await api.post("/api/contacts/verify-pending", undefined, { limit: 1000 });
    toast.info(`Vérification lancée (tâche #${r.job_id})`);
    nav("/jobs");
  });
  const verifyOne = (id) => run("one" + id, async () => {
    const c = await api.post(`/api/contacts/${id}/verify`);
    toast.success(`${c.email} : ${STATUS[c.email_status]?.label}`); list.reload(); stats.reload();
  });
  const exportIt = (format) => run("export", async () => {
    if (!n) return;
    const r = await api.download("/api/export/contacts", {
      ...clean(f), format,
      ids: selected.size ? ids.join(",") : undefined,
      limit: selected.size ? undefined : Number(count) || undefined,
      record: mark ? undefined : "false",
    });
    toast.success(`${r.count} contact(s) exportés` + (r.id ? ` · fichier #${r.id} (page Fichiers)` : " · non marqués"));
    resetSel();
    if (r.id) list.reload();
  });

  const incN = splitCsv(f.source).length;
  const excN = splitCsv(f.exclude_source).length;
  const srcActive = incN + excN > 0;
  const anyFilter = Object.entries(f).some(([k, v]) => !["status", "file_id", "company_id"].includes(k) && !!v) || statuses.length > 0;
  const resetAll = () => {
    setF((x) => ({ ...x, q: "", status: "", country: "", city: "", sector: "", source: "", exclude_source: "", job_title: "", domain: "", has_phone: false, has_website: false, exported: "", department: "", seniority: "", personal: false, has_profile: false }));
    setCount(""); setPage(0); resetSel();
  };

  const hasSel = selected.size > 0;
  const bulkBtn = (dark) => `inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${dark ? "text-white hover:bg-ink-800" : "border border-line bg-surface hover:bg-soft"}`;

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Prospects et statut de vérification de chaque adresse"
        actions={
          <>
            <button className="btn btn-ghost" onClick={verifyPending} disabled={busy === "pending"}>
              <ShieldCheck size={16} /> Vérifier les non vérifiés
              {sc.unverified > 0 && <span className="rounded bg-info/10 px-1.5 text-xs font-semibold text-info">{fmtNum(sc.unverified)}</span>}
            </button>
            <Dropdown
              width="w-80"
              trigger={({ open, toggle }) => (
                <button className="btn btn-ghost" onClick={toggle} disabled={busy === "export"}>
                  {busy === "export" ? <Spinner size={15} /> : <Download size={16} />} Exporter
                  <span className="text-xs font-normal text-muted">Excel · CSV</span>
                  <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
                </button>
              )}
            >
              {(close) => (
                <div className="space-y-3">
                  <div className="text-sm">
                    <b>{fmtNum(n)}</b> contact(s) seront exportés
                    <span className="text-muted">{hasSel ? " (sélection)" : " (résultats du filtre)"}</span>.
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm" title="Décoche pour exporter sans marquer les lignes ni conserver le fichier">
                    <input type="checkbox" className="accent-brand" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Marquer comme exportés
                  </label>
                  <div className="flex gap-2">
                    <button className="btn btn-primary grow" disabled={!n} onClick={() => { exportIt("xlsx"); close(); }}>Excel</button>
                    <button className="btn btn-ghost grow" disabled={!n} onClick={() => { exportIt("csv"); close(); }}>CSV</button>
                  </div>
                </div>
              )}
            </Dropdown>
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Ajouter</button>
          </>
        }
      />

      {/* Onglets de statut avec compteurs */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
        <button
          onClick={() => upd("status", "")}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${!statuses.length ? "border-brand font-semibold text-fg" : "border-transparent text-muted hover:bg-soft hover:text-fg"}`}
        >
          Tous {stats.data && <span className={`rounded px-1.5 text-xs font-semibold ${!statuses.length ? "bg-brand/10 text-brand" : "bg-soft text-muted"}`}>{fmtNum(totalAll)}</span>}
        </button>
        {ORDER.map((s) => {
          const on = statuses.includes(s);
          return (
            <button
              key={s} onClick={() => toggleStatus(s)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition ${on ? "border-brand font-semibold text-fg" : "border-transparent text-muted hover:bg-soft hover:text-fg"}`}
            >
              {STATUS[s].label}
              {sc[s] != null && <Badge tone={STATUS[s].tone}>{fmtNum(sc[s])}</Badge>}
            </button>
          );
        })}
        <span className="ml-auto hidden px-3 text-xs text-muted sm:block">{!statuses.length ? "Blacklistés masqués" : "Plusieurs statuts possibles"}</span>
      </div>

      {/* Recherche + filtres en pastilles */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={f.q} onChange={(v) => upd("q", v)} placeholder="Email, nom, entreprise…" />
          <SelectChip label="Pays" value={f.country} onChange={(v) => upd("country", v)} searchable options={[["", "Tous les pays"], ...COUNTRIES]} />
          <TextChip label="Secteur" value={f.sector} onChange={(v) => upd("sector", v)} placeholder="Ex : banque" />
          <TextChip label="Ville" value={f.city} onChange={(v) => upd("city", v)} placeholder="Ex : Dakar" />
          <TextChip label="Poste" value={f.job_title} onChange={(v) => upd("job_title", v)} placeholder="directeur, achats…" />
          <SelectChip label="Niveau" value={f.seniority} onChange={(v) => upd("seniority", v)} options={[["", "Tous les niveaux"], ...Object.entries(LEVEL_LABEL)]} />
          <SelectChip label="Département" value={f.department} onChange={(v) => upd("department", v)} options={[["", "Tous les départements"], ...Object.entries(DEPT_LABEL)]} />
          <TextChip label="Domaine" value={f.domain} onChange={(v) => upd("domain", v)} placeholder="Ex : gmail.com" />
          <SelectChip label="Export" value={f.exported} onChange={(v) => upd("exported", v)} options={[["", "Indifférent"], ["no", "Pas encore exportés"], ["yes", "Déjà exportés"]]} />
          <Chip label="Sources" active={srcActive} summary={`${incN ? `${incN} incluse(s)` : ""}${incN && excN ? " · " : ""}${excN ? `${excN} ignorée(s)` : ""}`} onClear={() => setSrc("", "")} width="w-[34rem]">
            <div className="p-1"><SourceFilter sources={sourceNames} include={f.source} exclude={f.exclude_source} onChange={setSrc} /></div>
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip label="Téléphone" checked={f.has_phone} onChange={(v) => upd("has_phone", v)} />
          <ToggleChip label="Site web" checked={f.has_website} onChange={(v) => upd("has_website", v)} />
          <ToggleChip label="Personnes nommées" checked={f.personal} onChange={(v) => upd("personal", v)} />
          <ToggleChip label="Avec profil" checked={f.has_profile} onChange={(v) => upd("has_profile", v)} />
          {f.company_id && <Badge tone="brand">Entreprise #{f.company_id} <button className="ml-1" onClick={() => upd("company_id", "")}>✕</button></Badge>}
          {f.file_id && <Badge tone="brand">Fichier #{f.file_id} <button className="ml-1" onClick={() => upd("file_id", "")}>✕</button></Badge>}
          {anyFilter && <button className="px-2 text-sm font-semibold text-brand hover:underline" onClick={resetAll}>Réinitialiser</button>}
        </div>
      </div>

      {/* Barre d'actions : sombre si sélection, claire sinon */}
      {total > 0 && (
        <div className={`mb-4 flex animate-drop flex-wrap items-center gap-2 rounded-lg px-4 py-2 transition ${hasSel ? "bg-ink-950 shadow-pop" : "border border-line bg-soft"}`}>
          <span className={`text-sm ${hasSel ? "font-semibold text-white" : ""}`}>
            {hasSel ? `${selected.size} sélectionné(s)` : <>Résultats du filtre : <b>{fmtNum(total)}</b></>}
          </span>
          {!hasSel && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Nombre à traiter
              <input type="number" min="1" max={total} className="input h-8 w-28 py-1" placeholder={`tous (${total})`} value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
          )}
          <span className="grow" />
          <button className={bulkBtn(hasSel)} onClick={() => bulk("verify", "Vérifier")} disabled={!!busy}>
            {busy === "verify" ? <Spinner size={13} /> : <ShieldCheck size={14} />} Vérifier {fmtNum(n)}
          </button>
          {hasSel && (
            <button className={bulkBtn(true)} onClick={() => exportIt("xlsx")} disabled={!!busy}>
              {busy === "export" ? <Spinner size={13} /> : <Download size={14} />} Exporter
            </button>
          )}
          <button className={bulkBtn(hasSel)} onClick={() => bulk("blacklist", "Blacklister")} disabled={!!busy}>
            {busy === "blacklist" ? <Spinner size={13} /> : <Ban size={14} />} Blacklister {fmtNum(n)}
          </button>
          <button className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${hasSel ? "text-red-400 hover:bg-bad/20" : "bg-bad/10 text-bad hover:bg-bad/20"}`} onClick={() => bulk("delete", "Supprimer")} disabled={!!busy}>
            {busy === "delete" ? <Spinner size={13} /> : <Trash2 size={14} />} Supprimer {fmtNum(n)}
          </button>
          {hasSel && <button className="grid h-8 w-8 place-items-center rounded-md text-ink-400 transition hover:bg-ink-800 hover:text-white" title="Désélectionner" onClick={resetSel}><X size={16} /></button>}
        </div>
      )}

      <div className="card overflow-hidden">
        {list.loading && !items.length ? (
          <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>
        ) : !items.length ? (
          <Empty icon={Users} title="Aucun contact" text="Aucun résultat pour ces filtres." />
        ) : (
          <div className={`overflow-x-auto transition-opacity ${list.loading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-soft">
                <tr>
                  <th className="w-10 px-4"><input type="checkbox" className="accent-brand" checked={allSelected} onChange={toggleAll} /></th>
                  <th className="th">Email</th><th className="th">Contact</th><th className="th">Entreprise</th><th className="th">Statut</th><th className="th">Source</th><th className="th">Export</th><th className="th">Ajouté</th><th className="th" />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={`animate-fade border-b border-line transition last:border-b-0 ${selected.has(c.id) ? "bg-brand/5" : "hover:bg-soft"}`}>
                    <td className="px-4"><input type="checkbox" className="accent-brand" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td className="px-4 py-3"><div className="font-mono text-xs font-semibold">{c.email}</div>{c.is_role && <div className="text-xs text-muted">adresse générique</div>}</td>
                    <td className="px-4 py-3">
                      {c.full_name ? <div className="font-semibold">{c.full_name}</div> : <span className="text-muted">—</span>}
                      <div className="text-xs text-muted">{c.job_title || ""}</div>
                      {c.phone && <div className="font-mono text-xs text-muted">{c.phone}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {c.seniority && <Badge tone="brand">{LEVEL_LABEL[c.seniority] || c.seniority}</Badge>}
                        {c.department && <Badge>{DEPT_LABEL[c.department] || c.department}</Badge>}
                        {c.profile_url && <a href={c.profile_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Profil</a>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{c.company_name || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.email_status} reason={c.email_reason} /></td>
                    <td className="px-4 py-3"><Badge>{c.source || "—"}</Badge></td>
                    <td className="px-4 py-3">
                      {c.exports_count > 0
                        ? <Badge tone="brand" title={`Dernier export : ${fmtDate(c.last_exported_at)}`}>Exporté{c.exports_count > 1 ? ` ×${c.exports_count}` : ""}</Badge>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.email_status !== "blacklisted" && (
                        <button className="btn btn-ghost btn-sm" title="Vérifier cette adresse" onClick={() => verifyOne(c.id)} disabled={busy === "one" + c.id}>
                          {busy === "one" + c.id ? <Spinner size={13} /> : <RefreshCw size={13} />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? null} count={items.length} onPage={(p) => { setPage(p); resetSel(); }} />
      </div>

      {adding && <AddContact onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); stats.reload(); }} />}
    </>
  );
}

function AddContact({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ email: "", first_name: "", last_name: "", job_title: "", phone: "" });
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ""));
      await api.post("/api/contacts", { ...body, verify });
      toast.success("Contact ajouté");
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Ajouter un contact"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={busy || !f.email.trim()}>{busy && <Spinner />} Ajouter</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" className="sm:col-span-2"><input className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Prénom"><input className="input" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} /></Field>
        <Field label="Nom"><input className="input" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
        <Field label="Poste"><input className="input" value={f.job_title} onChange={(e) => set("job_title", e.target.value)} /></Field>
        <Field label="Téléphone"><input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <div className="sm:col-span-2"><Toggle checked={verify} onChange={setVerify} label="Vérifier l'email maintenant" /></div>
      </div>
    </Modal>
  );
}