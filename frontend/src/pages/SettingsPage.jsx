import { useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, ExternalLink, Eraser, KeyRound, Save, Wifi } from "lucide-react";
import { api, getKey, setKey } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Badge, Field, PageHeader, Spinner, Toggle } from "../components/ui";
import { useToast } from "../components/Toast";

export default function SettingsPage() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get("/api/settings"), []);
  const [changes, setChanges] = useState({});
  const [clear, setClear] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState({});
  const [apiKey, setApiKey] = useState(getKey());

  const dirty = Object.keys(changes).length > 0 || clear.size > 0;
  const groups = useMemo(() => {
    const g = new Map();
    (data?.fields || []).forEach((f) => { if (!g.has(f.group)) g.set(f.group, []); g.get(f.group).push(f); });
    return [...g.entries()];
  }, [data]);

  const setVal = (f, v) =>
    setChanges((c) => {
      const n = { ...c };
      if (f.type === "secret" && v === "") delete n[f.key]; else n[f.key] = v;
      return n;
    });
  const value = (f) => (f.key in changes ? changes[f.key] : f.value);

  const save = async () => {
    setSaving(true);
    try {
      const values = { ...changes };
      clear.forEach((k) => { values[k] = ""; });
      await api.put("/api/settings", { values });
      toast.success("Configuration enregistrée et appliquée");
      setChanges({}); setClear(new Set()); reload();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const runTest = async (name) => {
    setTests((t) => ({ ...t, [name]: { loading: true } }));
    try {
      const r = await api.post(`/api/settings/test/${name}`);
      setTests((t) => ({ ...t, [name]: { loading: false, ...r } }));
    } catch (e) {
      setTests((t) => ({ ...t, [name]: { loading: false, ok: false, message: e.message, results: [] } }));
    }
  };

  const saveFront = async () => {
    setKey(apiKey.trim());
    try { await api.get("/api/stats"); toast.success("Clé d'accès enregistrée"); } catch (e) { toast.error(e.status === 401 ? "Clé refusée par l'API" : e.message); }
  };

  const checks = data?.checks || [];
  const required = checks.filter((c) => !c.optional);
  const doneCount = required.filter((c) => c.ok).length;

  if (loading && !data) return <div className="grid h-64 place-items-center"><Spinner size={24} /></div>;

  return (
    <>
      <PageHeader
        title="Configuration"
        subtitle="Clés API, paramètres de vérification et du moteur : appliqués immédiatement, conservés après redémarrage"
        actions={<button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner /> : <Save size={16} />} Enregistrer</button>}
      />

      {/* Assistant de mise en route */}
      <div className="card mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Mise en route</h2>
          <Badge tone={doneCount === required.length ? "ok" : "warn"}>{doneCount}/{required.length} étapes requises</Badge>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 text-sm">
              {c.ok ? <CheckCircle2 size={17} className="text-ok" /> : <CircleDashed size={17} className="text-muted" />}
              <span className={c.ok ? "" : "text-muted"}>{c.label}</span>
              {c.optional && <Badge>optionnel</Badge>}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-6">
        {groups.map(([group, fields]) => (
          <div key={group} className="card p-5">
            <h2 className="mb-4 font-semibold">{group}</h2>
            <div className="grid gap-5 md:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className={f.type === "bool" ? "md:col-span-2" : ""}>
                  {f.type === "bool" ? (
                    <Toggle checked={!!value(f)} onChange={(v) => setVal(f, v)} label={f.label} hint={f.help} />
                  ) : f.type === "secret" ? (
                    <Field label={f.label} hint={f.help}>
                      <div className="flex gap-2">
                        <input
                          type="password" autoComplete="off" className="input"
                          placeholder={clear.has(f.key) ? "(sera effacée à l'enregistrement)" : f.is_set ? "•••••••••• clé enregistrée" : "Coller la clé ici"}
                          value={changes[f.key] || ""} onChange={(e) => { setVal(f, e.target.value); setClear((s) => { const n = new Set(s); n.delete(f.key); return n; }); }}
                        />
                        {f.is_set && !clear.has(f.key) && (
                          <button className="btn btn-ghost" title="Effacer la clé" onClick={() => { setClear((s) => new Set(s).add(f.key)); setVal(f, ""); }}><Eraser size={15} /></button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {f.is_set ? <Badge tone="ok">Configurée</Badge> : <Badge tone="warn">Non configurée</Badge>}
                        {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline"><ExternalLink size={12} /> Obtenir une clé gratuite</a>}
                        {f.test && f.is_set && (
                          <button className="btn btn-ghost btn-sm" disabled={dirty || tests[f.test]?.loading} title={dirty ? "Enregistre d'abord" : ""} onClick={() => runTest(f.test)}>
                            {tests[f.test]?.loading ? <Spinner size={12} /> : <KeyRound size={13} />} Tester
                          </button>
                        )}
                      </div>
                      {tests[f.test] && !tests[f.test].loading && (
                        <p className={`mt-1.5 text-xs ${tests[f.test].ok ? "text-ok" : "text-bad"}`}>{tests[f.test].message}</p>
                      )}
                    </Field>
                  ) : (
                    <Field label={f.label} hint={f.help}>
                      <input
                        className="input" placeholder={f.placeholder || ""}
                        type={f.type === "int" ? "number" : "text"} min={f.min} max={f.max}
                        value={value(f) ?? ""} onChange={(e) => setVal(f, e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Diagnostics */}
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">Diagnostics du serveur</h2>
          <p className="mb-4 text-sm text-muted">Vérifie que ton serveur peut joindre les sources de données et envoyer des requêtes SMTP.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={() => runTest("smtp")} disabled={tests.smtp?.loading}>{tests.smtp?.loading ? <Spinner /> : <Wifi size={16} />} Tester le port 25 (SMTP)</button>
            <button className="btn btn-ghost" onClick={() => runTest("sources")} disabled={tests.sources?.loading}>{tests.sources?.loading ? <Spinner /> : <Wifi size={16} />} Tester les sources de données</button>
            <button className="btn btn-ghost" onClick={() => runTest("procurement")} disabled={tests.procurement?.loading}>{tests.procurement?.loading ? <Spinner /> : <Wifi size={16} />} Tester les marchés publics</button>
          </div>
          {["smtp", "sources", "procurement"].map((n) => tests[n] && !tests[n].loading && (
            <div key={n} className="mt-4 space-y-2">
              {tests[n].message && <p className={`text-sm ${tests[n].ok ? "text-ok" : "text-warn"}`}>{tests[n].message}</p>}
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {tests[n].results.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span>{r.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted"><span className="max-w-[220px] truncate">{r.detail}</span>{r.ms}ms <Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "OK" : "Échec"}</Badge></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Accès */}
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">Accès à l'API</h2>
          <p className="mb-4 text-sm text-muted">Si tu as défini <code>API_KEY</code> dans le fichier <code>.env</code>, entre-la ici (stockée uniquement dans ce navigateur). Les identifiants de base de données et <code>API_KEY</code> ne se modifient que dans le <code>.env</code>.</p>
          <div className="flex max-w-lg gap-2">
            <input type="password" className="input" placeholder="X-API-Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button className="btn btn-ghost" onClick={saveFront}>Enregistrer</button>
          </div>
        </div>
      </div>
    </>
  );
}