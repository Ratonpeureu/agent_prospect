import { useState } from "react";
import { Ban, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { fmtDate } from "../lib/format";
import { Badge, Empty, Field, PageHeader, Pagination, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";

const PAGE = 50;

export default function Blacklist() {
  const toast = useToast();
  const [kind, setKind] = useState("email");
  const [values, setValues] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDebounce(q, 350);
  const list = useAsync(() => api.get("/api/blacklist", { q: dq, kind: filterKind, limit: PAGE, offset: page * PAGE }), [dq, filterKind, page]);
  const items = list.data || [];

  const add = async () => {
    const vals = values.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
    if (!vals.length) return;
    setBusy(true);
    try {
      const r = await api.post("/api/blacklist", { kind, values: vals, reason: reason.trim() || null });
      toast.success(`${r.added} ajouté(s), ${r.ignored_duplicates} déjà présent(s)`);
      setValues("");
      list.reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!window.confirm("Retirer cette entrée ? Les contacts concernés repassent en « non vérifié ».")) return;
    try { await api.del(`/api/blacklist/${id}`); toast.success("Entrée retirée"); list.reload(); } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Blacklist" subtitle="Les adresses et domaines listés sont exclus automatiquement de toutes les recherches, imports et vérifications" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card h-fit space-y-4 p-5">
          <h2 className="font-semibold">Ajouter</h2>
          <Field label="Type">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="email">Adresses email</option><option value="domain">Domaines entiers</option>
            </select>
          </Field>
          <Field label={kind === "email" ? "Emails (un par ligne ou séparés par virgules)" : "Domaines (ex : concurrent.com)"}>
            <textarea className="input h-40 font-mono text-xs" value={values} onChange={(e) => setValues(e.target.value)} />
          </Field>
          <Field label="Motif (optionnel)"><input className="input" placeholder="désinscription, plainte…" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn btn-primary w-full" onClick={add} disabled={busy || !values.trim()}>{busy ? <Spinner /> : <Plus size={16} />} Ajouter à la blacklist</button>
          <p className="text-xs text-muted">Les adresses détectées invalides à la vérification sont ajoutées automatiquement (motif « auto:invalid »).</p>
        </div>

        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap gap-3 border-b border-line p-4">
            <input className="input max-w-xs" placeholder="Rechercher…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <select className="input w-44" value={filterKind} onChange={(e) => { setFilterKind(e.target.value); setPage(0); }}>
              <option value="">Tous les types</option><option value="email">Emails</option><option value="domain">Domaines</option>
            </select>
          </div>
          {list.loading && !items.length ? <div className="grid h-40 place-items-center"><Spinner size={22} /></div> :
            !items.length ? <Empty icon={Ban} title="Blacklist vide" text="Aucune entrée pour ces critères." /> : (
              <table className="w-full text-sm">
                <thead className="bg-soft/60"><tr><th className="th">Valeur</th><th className="th">Type</th><th className="th">Motif</th><th className="th">Ajouté</th><th className="th" /></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="px-3 py-2.5 font-medium">{e.value}</td>
                      <td className="px-3 py-2.5"><Badge tone={e.kind === "domain" ? "warn" : "info"}>{e.kind === "domain" ? "Domaine" : "Email"}</Badge></td>
                      <td className="px-3 py-2.5 text-xs text-muted">{e.reason || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{fmtDate(e.created_at)}</td>
                      <td className="px-3 py-2.5 text-right"><button className="btn btn-danger btn-sm" onClick={() => remove(e.id)}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <Pagination page={page} pageSize={PAGE} total={null} count={items.length} onPage={setPage} />
        </div>
      </div>
    </>
  );
}