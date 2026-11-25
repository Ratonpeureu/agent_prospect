import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Eye, FileSpreadsheet, FileText, FolderOpen, History, Trash2, Upload, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAsync, useDebounce } from "../lib/hooks";
import { FILE_CATEGORY, fmtDate, fmtSize } from "../lib/format";
import { Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner } from "../components/ui";
import SheetViewer from "../components/SheetViewer";
import { useToast } from "../components/Toast";

const PAGE = 30;
const CATS = [
  ["", "Tous"], ["export_contacts", "Exports contacts"], ["export_companies", "Exports entreprises"],
  ["import", "Imports"], ["verified", "Résultats de vérification"],
];
const filterText = (fl) => Object.entries(fl || {}).map(([k, v]) => `${k}=${v}`).join(" · ");
const isExport = (c) => c === "export_contacts" || c === "export_companies";

export default function Files() {
  const toast = useToast();
  const [cat, setCat] = useState("");
  const [fmt, setFmt] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState(null);
  const [registering, setRegistering] = useState(false);
  const dq = useDebounce(q, 350);
  const list = useAsync(
    () => api.list("/api/files", { category: cat, format: fmt, q: dq, limit: PAGE, offset: page * PAGE }),
    [cat, fmt, dq, page]
  );
  const items = list.data?.items || [];

  const remove = async (f) => {
    const msg = isExport(f.category)
      ? `Supprimer « ${f.filename} » ?\n\nLes ${f.row_count} lignes ne seront plus marquées « exportées » et pourront réapparaître dans « Pas encore exportés ».`
      : `Supprimer « ${f.filename} » ?`;
    if (!window.confirm(msg)) return;
    try { await api.del(`/api/files/${f.id}`); toast.success("Fichier supprimé"); list.reload(); } catch (e) { toast.error(e.message); }
  };
  const linkedTo = (f) =>
    f.category === "export_companies" ? `/companies?file_id=${f.id}` :
    f.category === "export_contacts" || f.category === "import" ? `/contacts?file_id=${f.id}` : null;

  return (
    <>
      <PageHeader
        title="Fichiers"
        subtitle="Tout ce qui a été exporté, importé ou vérifié : conservé, consultable et téléchargeable"
        actions={<button className="btn btn-primary" onClick={() => setRegistering(true)}><Upload size={16} /> Enregistrer un ancien export</button>}
      />

      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {CATS.map(([k, label]) => (
            <button key={k} onClick={() => { setCat(k); setPage(0); }}
              className={`rounded-full border px-3 py-1 text-xs transition ${cat === k ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-soft"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <input className="input max-w-xs" placeholder="Rechercher un nom de fichier…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <select className="input w-40" value={fmt} onChange={(e) => { setFmt(e.target.value); setPage(0); }}>
            <option value="">Tous formats</option><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="txt">Texte</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        {list.loading && !items.length ? (
          <div className="grid h-40 place-items-center text-muted"><Spinner size={22} /></div>
        ) : !items.length ? (
          <Empty icon={FolderOpen} title="Aucun fichier" text="Les exports, imports et résultats de vérification apparaîtront ici." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-soft/60">
                <tr><th className="th">Fichier</th><th className="th">Type</th><th className="th">Format</th><th className="th">Lignes</th><th className="th">Taille</th><th className="th">Date</th><th className="th" /></tr>
              </thead>
              <tbody>
                {items.map((f) => {
                  const c = FILE_CATEGORY[f.category] || { label: f.category, tone: "muted" };
                  const link = linkedTo(f);
                  return (
                    <tr key={f.id} className="border-t border-line hover:bg-soft/50">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {f.format === "xlsx" ? <FileSpreadsheet size={18} className="shrink-0 text-ok" /> : <FileText size={18} className="shrink-0 text-muted" />}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{f.filename} <span className="text-xs font-normal text-muted">#{f.id}</span></div>
                            {(f.note || filterText(f.filters)) && <div className="max-w-md truncate text-xs text-muted" title={`${f.note || ""} ${filterText(f.filters)}`}>{[f.note, filterText(f.filters)].filter(Boolean).join(" · ")}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5"><Badge tone={c.tone}>{c.label}</Badge></td>
                      <td className="px-3 py-2.5 uppercase text-muted">{f.format}</td>
                      <td className="px-3 py-2.5">{f.row_count.toLocaleString("fr-FR")}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{fmtSize(f.size)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{fmtDate(f.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {f.exists ? (
                            <>
                              <button className="btn btn-ghost btn-sm" onClick={() => setView(f)}><Eye size={13} /> Voir</button>
                              <button className="btn btn-ghost btn-sm" title="Télécharger" onClick={() => api.download(`/api/files/${f.id}/download`).catch((e) => toast.error(e.message))}><Download size={13} /></button>
                            </>
                          ) : <Badge tone="bad">Fichier absent</Badge>}
                          {link && <Link to={link} className="btn btn-ghost btn-sm" title="Voir les lignes de ce fichier"><Users size={13} /></Link>}
                          <button className="btn btn-danger btn-sm" title="Supprimer" onClick={() => remove(f)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? null} count={items.length} onPage={setPage} />
      </div>

      {view && (
        <Modal open full onClose={() => setView(null)} title={view.filename}
          footer={<button className="btn btn-primary" onClick={() => api.download(`/api/files/${view.id}/download`).catch((e) => toast.error(e.message))}><Download size={15} /> Télécharger</button>}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={(FILE_CATEGORY[view.category] || {}).tone}>{(FILE_CATEGORY[view.category] || {}).label || view.category}</Badge>
            <span>{view.row_count.toLocaleString("fr-FR")} lignes</span><span>·</span><span>{fmtSize(view.size)}</span><span>·</span><span>{fmtDate(view.created_at)}</span>
            {filterText(view.filters) && <><span>·</span><span>Filtres : {filterText(view.filters)}</span></>}
          </div>
          <SheetViewer fileId={view.id} />
        </Modal>
      )}
      {registering && <RegisterExport onClose={() => setRegistering(false)} onDone={() => { setRegistering(false); list.reload(); }} />}
    </>
  );
}

function RegisterExport({ onClose, onDone }) {
  const toast = useToast();
  const ref = useRef(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("note", note);
      setRes(await api.upload("/api/files/register-export", fd));
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={res ? onDone : onClose} title="Enregistrer un ancien export"
      footer={res
        ? <button className="btn btn-primary" onClick={onDone}>Terminer</button>
        : <><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={submit} disabled={!file || busy}>{busy && <Spinner />} Enregistrer</button></>}>
      {res ? (
        <div className="space-y-2 text-sm">
          <p><b>{res.matched}</b> contact(s) marqué(s) « déjà exportés ».</p>
          <p className="text-muted">{res.emails_in_file} adresse(s) dans le fichier, dont {res.unknown} absente(s) de ta base (rien à marquer).</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Dépose un fichier que tu as déjà exporté et utilisé (CSV, Excel ou TXT). Les contacts dont l'email figure dedans ne sortiront plus avec le filtre « Pas encore exportés ».</p>
          <div onClick={() => ref.current?.click()} className="grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line p-8 text-center hover:bg-soft">
            <input ref={ref} type="file" accept=".csv,.txt,.xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
            <Upload className="mb-2 text-brand" size={26} />
            {file ? <div className="font-medium">{file.name}</div> : <div className="text-sm text-muted">Clique pour choisir un fichier</div>}
          </div>
          <Field label="Note (optionnel)"><input className="input" placeholder="Campagne de mars, envoyé à l'équipe X…" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}