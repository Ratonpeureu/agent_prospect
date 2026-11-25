import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Copy, Download, FileSpreadsheet, Upload } from "lucide-react";
import { api } from "../lib/api";
import { EMAIL_RE, STATUS, reasonLabel, saveText } from "../lib/format";
import { Field, PageHeader, Spinner, StatusBadge, Tabs, Toggle } from "../components/ui";
import JobCard from "../components/JobCard";
import { useToast } from "../components/Toast";

const SMTP_OPTS = (
  <>
    <option value="">SMTP selon la configuration</option>
    <option value="true">Forcer le test SMTP</option>
    <option value="false">Sans SMTP (DNS/MX uniquement)</option>
  </>
);
const smtpVal = (v) => (v === "" ? null : v === "true");

export default function Verify() {
  const [tab, setTab] = useState("text");
  return (
    <>
      <PageHeader title="Vérification d'emails" subtitle="Colle une liste ou importe un fichier : syntaxe, domaine jetable, MX, test SMTP, doublons et blacklist" />
      <div className="mb-5">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "text", label: "Coller une liste", icon: ClipboardList },
          { id: "file", label: "Importer un fichier", icon: FileSpreadsheet },
        ]} />
      </div>
      {tab === "text" ? <TextTab /> : <FileTab />}
    </>
  );
}

function TextTab() {
  const toast = useToast();
  const [text, setText] = useState("");
  const [smtp, setSmtp] = useState("");
  const [save, setSave] = useState(false);
  const [risky, setRisky] = useState(false);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  const detected = useMemo(() => [...new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))], [text]);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      setRes(await api.post("/api/verify/text", { text, use_smtp: smtpVal(smtp), save_to_db: save }));
      setFilter("all");
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const rows = res?.results || [];
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});

  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["email", "statut", "raison", "score", "generique", "prenom", "nom"];
    const body = shown.map((r) => [r.email, r.status, reasonLabel(r.reason), r.score, r.is_role ? "oui" : "non", r.first_name, r.last_name].map(esc).join(","));
    saveText("emails_verifies.csv", "\uFEFF" + [head.join(","), ...body].join("\n"));
  };
  const xlsx = () =>
    api.download("/api/verify/text", { format: "xlsx", include_risky: risky }, { method: "POST", body: { text, use_smtp: smtpVal(smtp), save_to_db: false } })
      .catch((e) => toast.error(e.message));
  const copyValid = async () => {
    const v = rows.filter((r) => r.status === "valid").map((r) => r.email).join("\n");
    await navigator.clipboard.writeText(v);
    toast.success(`${rows.filter((r) => r.status === "valid").length} adresses valides copiées`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="card space-y-4 p-5 lg:col-span-2">
        <Field label="Adresses (une par ligne, ou séparées par virgules / espaces / texte libre)">
          <textarea className="input h-72 font-mono text-xs" placeholder={"jean.dupont@exemple.com\ncontact@societe.sn, info@autre.fr"} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="text-sm text-muted"><b className="text-fg">{detected.length}</b> adresse(s) unique(s) détectée(s) · max. 500 (au-delà : onglet « fichier »)</div>
        <Field label="Méthode"><select className="input" value={smtp} onChange={(e) => setSmtp(e.target.value)}>{SMTP_OPTS}</select></Field>
        <Toggle checked={save} onChange={setSave} label="Enregistrer dans la base" hint="Crée les contacts (et entreprises via le domaine) avec leur statut." />
        <button className="btn btn-primary w-full" onClick={run} disabled={busy || !detected.length || detected.length > 500}>
          {busy && <Spinner />} Vérifier {detected.length || ""} adresse(s)
        </button>
      </div>

      <div className="card overflow-hidden lg:col-span-3">
        {!res && !busy && <div className="grid h-full min-h-64 place-items-center p-8 text-center text-sm text-muted">Les résultats s'affichent ici.</div>}
        {busy && <div className="grid min-h-64 place-items-center text-muted"><div className="text-center"><Spinner size={26} className="mx-auto" /><p className="mt-3 text-sm">Vérification en cours (DNS + SMTP)…</p></div></div>}
        {res && (
          <>
            <div className="space-y-3 border-b border-line p-4">
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setFilter("all")} className={`rounded-full border px-3 py-1 text-xs ${filter === "all" ? "border-brand bg-brand/10 text-brand" : "border-line"}`}>Tous ({rows.length})</button>
                {Object.keys(STATUS).filter((s) => counts[s]).map((s) => (
                  <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-3 py-1 text-xs ${filter === s ? "border-brand bg-brand/10 text-brand" : "border-line"}`}>{STATUS[s].label} ({counts[s]})</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-ghost btn-sm" onClick={copyValid}><Copy size={14} /> Copier les valides</button>
                <button className="btn btn-ghost btn-sm" onClick={csv}><Download size={14} /> CSV (affichage)</button>
                <button className="btn btn-primary btn-sm" onClick={xlsx}><Download size={14} /> Excel propre</button>
                <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="accent-brand" checked={risky} onChange={(e) => setRisky(e.target.checked)} /> inclure les « risqués »</label>
              </div>
              <div className="text-xs text-muted">
                {res.summary.doublons_supprimes} doublon(s) supprimé(s) · {res.summary.blacklistes_exclus} exclu(s) par la blacklist.
                {save && " Contacts enregistrés dans la base."}
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-soft"><tr><th className="th">Email</th><th className="th">Statut</th><th className="th">Détail</th><th className="th">Nom déduit</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.email} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{r.email}</td>
                      <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 text-xs text-muted">{reasonLabel(r.reason)}</td>
                      <td className="px-3 py-2 text-xs">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileTab() {
  const toast = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [smtp, setSmtp] = useState("");
  const [save, setSave] = useState(false);
  const [risky, setRisky] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = (f) => {
    if (!f) return;
    if (!/\.(csv|txt|xlsx|xlsm)$/i.test(f.name)) return toast.error("Formats acceptés : .csv, .txt, .xlsx");
    setFile(f);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("save_to_db", String(save));
      fd.append("include_risky", String(risky));
      if (smtp !== "") fd.append("use_smtp", smtp);
      const r = await api.upload("/api/verify/file", fd);
      setJobId(r.job_id);
      toast.info(`Traitement lancé (tâche #${r.job_id})`);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition ${drag ? "border-brand bg-brand/5" : "border-line hover:bg-soft"}`}
        >
          <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xlsm" className="hidden" onChange={(e) => pick(e.target.files[0])} />
          <Upload className="mb-2 text-brand" size={28} />
          {file ? (
            <div><div className="font-medium">{file.name}</div><div className="text-xs text-muted">{(file.size / 1024).toFixed(0)} Ko : clique pour changer</div></div>
          ) : (
            <div><div className="font-medium">Dépose ton fichier ici</div><div className="text-xs text-muted">CSV, TXT ou Excel (.xlsx) · max. 20 Mo</div></div>
          )}
        </div>
        <p className="text-xs text-muted">Les colonnes email / nom / prénom / entreprise / téléphone / poste sont détectées automatiquement. Sans colonne « email », toutes les cellules sont analysées.</p>
        <Field label="Méthode"><select className="input" value={smtp} onChange={(e) => setSmtp(e.target.value)}>{SMTP_OPTS}</select></Field>
        <Toggle checked={save} onChange={setSave} label="Enregistrer dans la base" hint="Ajoute contacts et entreprises (dédoublonnés) à ta base." />
        <Toggle checked={risky} onChange={setRisky} label="Inclure les adresses « risquées » dans la feuille Valides" hint="Catch-all, boîte pleine… sinon elles vont dans « A_revoir »." />
        <button className="btn btn-primary w-full" disabled={!file || busy} onClick={submit}>{busy && <Spinner />} Lancer la vérification</button>
      </div>

      <div>
        {jobId ? (
          <JobCard
            jobId={jobId}
            actions={(job) => job.status === "done" && (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => api.download(`/api/jobs/${jobId}/download`).catch((e) => toast.error(e.message))}><Download size={14} /> Télécharger l'Excel propre</button>
                {save && <Link to="/contacts" className="btn btn-ghost btn-sm">Voir les contacts</Link>}
              </>
            )}
          />
        ) : (
          <div className="card grid min-h-64 place-items-center p-8 text-center text-sm text-muted">
            Le fichier Excel produit contient les feuilles : <b className="text-fg">Valides · A_revoir · Invalides · Exclus_blacklist · Resume</b>.
          </div>
        )}
      </div>
    </div>
  );
}