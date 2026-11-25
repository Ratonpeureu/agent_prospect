import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api, setKey } from "../lib/api";
import { Spinner } from "./ui";

export default function ApiKeyGate({ onSuccess }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setKey(value.trim());
    try {
      await api.get("/api/stats");
      onSuccess();
    } catch (ex) {
      setErr(ex.status === 401 ? "Clé invalide." : ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand"><KeyRound size={22} /></div>
        <h1 className="text-xl font-semibold">Accès protégé</h1>
        <p className="mt-1 text-sm text-muted">Entre la valeur de <code>API_KEY</code> définie dans ton fichier <code>.env</code>.</p>
        <input className="input mt-5" type="password" autoFocus placeholder="Clé d'accès" value={value} onChange={(e) => setValue(e.target.value)} />
        {err && <p className="mt-2 text-sm text-bad">{err}</p>}
        <button className="btn btn-primary mt-4 w-full" disabled={busy || !value.trim()}>
          {busy && <Spinner />} Se connecter
        </button>
      </form>
    </div>
  );
}