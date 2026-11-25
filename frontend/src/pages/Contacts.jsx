import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ban, Download, Plus, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { COUNTRIES } from "../lib/countries";
import { STATUS, fmtDate } from "../lib/format";
import { Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, Toggle } from "../components/ui";
import SourceFilter from "../components/SourceFilter";
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
    sector: sp.get("sector") || "", source: sp.get("source") || "", exclude_source: sp.get("exclude_source") || "",
    job_title: "", domain: "", has_phone: false, has_website: false, company_id: sp.get("company_id") || "",
    exported: sp.get("exported") || "", file_id: sp.get("file_id") || "",
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [count, setCount] = useState("");
  const [mark, setMark] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const d = useDebounce(f, 400);
  const sources = useAsync(() => api.get("/api/sources"), []);
  const list = useAsync(() => api.list("/api/contacts", { ...clean(d), limit: PAGE, offset: page * PAGE }), [JSON.stringify(d), page]);

  const items = list.data?.items || [];
  const total = list.data?.total ?? 0;
  const resetSel = () => setSelected(new Set());
  const upd = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(0); resetSel(); };
  const setSrc = (inc, exc) => { setF((x) => ({ ...x, source: inc, exclude_source: exc })); setPage(0); resetSel(); };
  const statuses = f.status ? f.status.split(",") : [];
  const toggleStatus = (s) => upd("status", (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(","));
  const sourceNames = [...new Set([...(sources.data || []).map((s) => s.name), "website", "discovery", "manual", "import"])];

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
    if (r.job_id) nav("/jobs"); else list.reload();
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

  const nLabel = n ? ` (${n.toLocaleString("fr-FR")})` : "";

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Prospects et statut de vérification de chaque adresse"
        actions={
          <>
            <button className="btn btn-ghost" onClick={verifyPending} disabled={busy === "pending"}><ShieldCheck size={16} /> Vérifier les non vérifiés</button>
            <button className="btn btn-ghost" onClick={() => exportIt("xlsx")} disabled={busy === "export"}>{busy === "export" ? <Spinner size={15} /> : <Download size={16} />} Excel{nLabel}</button>
            <button className="btn btn-ghost" onClick={() => exportIt("csv")} disabled={busy === "export"}>CSV{nLabel}</button>
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
          <select className="input" value={f.country} onChange={(e) => upd("country", e.target.value)}><option value="">Tous les pays</option>{COUNTRIES.map(([c, nm]) => <option key={c} value={c}>{nm}</option>)}</select>
          <input className="input" placeholder="Ville" value={f.city} onChange={(e) => upd("city", e.target.value)} />
          <input className="input" placeholder="Secteur" value={f.sector} onChange={(e) => upd("sector", e.target.value)} />
          <input className="input" placeholder="Poste" value={f.job_title} onChange={(e) => upd("job_title", e.target.value)} />
          <input className="input" placeholder="Domaine email (ex : gmail.com)" value={f.domain} onChange={(e) => upd("domain", e.target.value)} />
          <select className="input" value={f.exported} onChange={(e) => upd("exported", e.target.value)}>
            <option value="">Export : indifférent</option>
            <option value="no">Pas encore exportés</option>
            <option value="yes">Déjà exportés</option>
          </select>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={f.has_phone} onChange={(e) => upd("has_phone", e.target.checked)} /> Téléphone</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={f.has_website} onChange={(e) => upd("has_website", e.target.checked)} /> Site web</label>
            <label className="flex items-center gap-2 text-sm" title="Décoche pour exporter sans marquer les lignes ni conserver le fichier"><input type="checkbox" className="accent-brand" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Marquer comme exporté</label>
          </div>
        </div>
        <SourceFilter sources={sourceNames} include={f.source} exclude={f.exclude_source} onChange={setSrc} />
        <div className="flex flex-wrap gap-2">
          {f.company_id && <Badge tone="brand">Filtré sur l'entreprise #{f.company_id} <button className="ml-1" onClick={() => upd("company_id", "")}>✕</button></Badge>}
          {f.file_id && <Badge tone="brand">Lignes du fichier #{f.file_id} <button className="ml-1" onClick={() => upd("file_id", "")}>✕</button></Badge>}
        </div>
      </div>

      {total > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 border-brand/40 bg-brand/5 p-3">
          <span className="px-2 text-sm">
            {selected.size > 0
              ? <b>{selected.size} sélectionné(s)</b>
              : <>Résultats du filtre : <b>{total.toLocaleString("fr-FR")}</b></>}
          </span>
          {selected.size === 0 && (
            <label className="flex items-center gap-2 text-sm">
              Nombre à traiter
              <input type="number" min="1" max={total} className="input w-28" placeholder={`tous (${total})`}
                value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => bulk("verify", "Vérifier")} disabled={!!busy}>
            {busy === "verify" ? <Spinner size={13} /> : <ShieldCheck size={14} />} Vérifier {n}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => bulk("blacklist", "Blacklister")} disabled={!!busy}>
            {busy === "blacklist" ? <Spinner size={13} /> : <Ban size={14} />} Blacklister {n}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => bulk("delete", "Supprimer")} disabled={!!busy}>
            {busy === "delete" ? <Spinner size={13} /> : <Trash2 size={14} />} Supprimer {n}
          </button>
          {selected.size > 0 && <button className="btn btn-ghost btn-sm" onClick={resetSel}>Désélectionner</button>}
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
                  <th className="th">Email</th><th className="th">Contact</th><th className="th">Entreprise</th><th className="th">Statut</th><th className="th">Source</th><th className="th">Export</th><th className="th">Ajouté</th><th className="th" />
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
                    <td className="px-3 py-2.5">
                      {c.exports_count > 0
                        ? <Badge tone="ok" title={`Dernier export : ${fmtDate(c.last_exported_at)}`}>Exporté{c.exports_count > 1 ? ` ×${c.exports_count}` : ""}</Badge>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
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
        <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? null} count={items.length} onPage={(p) => { setPage(p); resetSel(); }} />
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