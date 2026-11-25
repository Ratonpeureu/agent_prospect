import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ban, Download, Plus, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { COUNTRIES } from "../lib/countries";
import { STATUS, fmtDate } from "../lib/format";
import { Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, Toggle } from "../components/ui";
import { useToast } from "../components/Toast";

const PAGE = 50;
const ORDER = ["valid", "risky", "unknown", "invalid", "unverified", "blacklisted"];
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== false));

export default function Contacts() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    q: sp.get("q") || "", status: sp.get("status") || "", country: sp.get("country") || "", city: "",
    sector: sp.get("sector") || "", source: sp.get("source") || "", job_title: "", domain: "",
    has_phone: false, has_website: false, company_id: sp.get("company_id") || "",
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const d = useDebounce(f, 400);
  const sources = useAsync(() => api.get("/api/sources"), []);
  const list = useAsync(() => api.list("/api/contacts", { ...clean(d), limit: PAGE, offset: page * PAGE }), [JSON.stringify(d), page]);

  const items = list.data?.items || [];
  const upd = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(0); setSelected(new Set()); };
  const statuses = f.status ? f.status.split(",") : [];
  const toggleStatus = (s) => upd("status", (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(","));
  const sourceNames = [...(sources.data || []).map((s) => s.name), "website", "discovery", "manual", "import"];

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((c) => c.id)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ids = [...selected];
  const selectedEmails = items.filter((c) => selected.has(c.id)).map((c) => c.email);

  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const verifySelected = () => run("verify", async () => {
    const r = await api.post("/api/contacts/verify-batch", { ids });
    toast.success(`${r.verified} vérifiés : ${r.valid ?? 0} valides, ${r.invalid ?? 0} invalides`);
    setSelected(new Set()); list.reload();
  });
  const blacklistSelected = () => run("bl", async () => {
    if (!window.confirm(`Blacklister ${selectedEmails.length} adresse(s) ?`)) return;
    await api.post("/api/blacklist", { kind: "email", values: selectedEmails, reason: "manuel" });
    toast.success("Adresses blacklistées"); setSelected(new Set()); list.reload();
  });
  const deleteSelected = () => run("del", async () => {
    if (!window.confirm(`Supprimer ${ids.length} contact(s) ?`)) return;
    const r = await api.post("/api/contacts/delete-batch", { ids });
    toast.success(`${r.deleted} supprimés`); setSelected(new Set()); list.reload();
  });
  const verifyPending = () => run("pending", async () => {
    const r = await api.post("/api/contacts/verify-pending", undefined, { limit: 1000 });
    toast.info(`Vérification lancée (tâche #${r.job_id})`);
    nav("/jobs");
  });
  const verifyOne = (id) => run("one" + id, async () => {
    const c = await api.post(`/api/contacts/${id}/verify`);
    toast.success(`${c.email} : ${STATUS[c.email_status]?.label}`); list.reload();
  });
  const exportIt = (format) => run("export", () => api.download("/api/export/contacts", { ...clean(f), format }));

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Prospects et statut de vérification de chaque adresse"
        actions={
          <>
            <button className="btn btn-ghost" onClick={verifyPending} disabled={busy === "pending"}><ShieldCheck size={16} /> Vérifier les non vérifiés</button>
            <button className="btn btn-ghost" onClick={() => exportIt("xlsx")}><Download size={16} /> Excel</button>
            <button className="btn btn-ghost" onClick={() => exportIt("csv")}>CSV</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Ajouter</button>
          </>
        }
      />

      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {ORDER.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)} className={`rounded-full border px-3 py-1 text-xs transition ${statuses.includes(s) ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}>
              {STATUS[s].label}
            </button>
          ))}
          {!statuses.length && <span className="self-center text-xs text-muted">(tous sauf blacklistés)</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input className="input" placeholder="Recherche (email, nom, entreprise)" value={f.q} onChange={(e) => upd("q", e.target.value)} />
          <select className="input" value={f.country} onChange={(e) => upd("country", e.target.value)}><option value="">Tous les pays</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          <input className="input" placeholder="Ville" value={f.city} onChange={(e) => upd("city", e.target.value)} />
          <input className="input" placeholder="Secteur" value={f.sector} onChange={(e) => upd("sector", e.target.value)} />
          <select className="input" value={f.source} onChange={(e) => upd("source", e.target.value)}><option value="">Toutes les sources</option>{sourceNames.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <input className="input" placeholder="Poste" value={f.job_title} onChange={(e) => upd("job_title", e.target.value)} />
          <input className="input" placeholder="Domaine email (ex : gmail.com)" value={f.domain} onChange={(e) => upd("domain", e.target.value)} />
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={f.has_phone} onChange={(e) => upd("has_phone", e.target.checked)} /> Téléphone</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={f.has_website} onChange={(e) => upd("has_website", e.target.checked)} /> Site web</label>
          </div>
        </div>
        {f.company_id && <Badge tone="brand">Filtré sur l'entreprise #{f.company_id} <button className="ml-1" onClick={() => upd("company_id", "")}>✕</button></Badge>}
      </div>

      {selected.size > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 border-brand/40 bg-brand/5 p-3">
          <span className="px-2 text-sm font-medium">{selected.size} sélectionné(s)</span>
          <button className="btn btn-ghost btn-sm" onClick={verifySelected} disabled={!!busy}>{busy === "verify" ? <Spinner size={13} /> : <ShieldCheck size={14} />} Vérifier</button>
          <button className="btn btn-ghost btn-sm" onClick={blacklistSelected} disabled={!!busy}><Ban size={14} /> Blacklister</button>
          <button className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={!!busy}><Trash2 size={14} /> Supprimer</button>
        </div>
      )}

      <div className="card overflow-hidden">
        {list.loading && !items.length ? (
          <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>
        ) : !items.length ? (
          <Empty icon={Users} title="Aucun contact" text="Aucun résultat pour ces filtres." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft/60">
                <tr>
                  <th className="w-10 px-3"><input type="checkbox" className="accent-brand" checked={allSelected} onChange={toggleAll} /></th>
                  <th className="th">Email</th><th className="th">Contact</th><th className="th">Entreprise</th><th className="th">Statut</th><th className="th">Source</th><th className="th">Ajouté</th><th className="th" />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-soft/50">
                    <td className="px-3"><input type="checkbox" className="accent-brand" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td className="px-3 py-2.5"><div className="font-medium">{c.email}</div>{c.is_role && <div className="text-xs text-muted">adresse générique</div>}</td>
                    <td className="px-3 py-2.5">{c.full_name || "—"}<div className="text-xs text-muted">{c.job_title || ""}</div></td>
                    <td className="px-3 py-2.5">{c.company_name || "—"}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={c.email_status} reason={c.email_reason} /></td>
                    <td className="px-3 py-2.5"><Badge>{c.source || "—"}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{fmtDate(c.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.email_status !== "blacklisted" && (
                        <button className="btn btn-ghost btn-sm" title="Vérifier" onClick={() => verifyOne(c.id)} disabled={busy === "one" + c.id}>
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
        <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? null} count={items.length} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
      </div>

      {adding && <AddContact onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
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