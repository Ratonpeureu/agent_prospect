import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, getKey } from "./lib/api";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import ApiKeyGate from "./components/ApiKeyGate";
import { Spinner } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Search from "./pages/Search";
import Companies from "./pages/Companies";
import Contacts from "./pages/Contacts";
import Verify from "./pages/Verify";
import Blacklist from "./pages/Blacklist";
import Jobs from "./pages/Jobs";
import SettingsPage from "./pages/SettingsPage";
import Files from "./pages/Files";
import Logs from "./pages/Logs";

export default function App() {
  const [auth, setAuth] = useState("loading"); // loading | ok | needkey | offline

  const check = useCallback(async () => {
    setAuth("loading");
    try {
      const { required } = await api.get("/api/auth-required");
      if (!required) return setAuth("ok");
      if (!getKey()) return setAuth("needkey");
      await api.get("/api/stats");
      setAuth("ok");
    } catch (e) {
      setAuth(e.status === 401 ? "needkey" : "offline");
    }
  }, []);

  useEffect(() => {
    check();
    const h = () => setAuth("needkey");
    window.addEventListener("api-unauthorized", h);
    return () => window.removeEventListener("api-unauthorized", h);
  }, [check]);

  if (auth === "loading")
    return <div className="grid h-screen place-items-center text-muted"><Spinner size={28} /></div>;

  if (auth === "offline")
    return (
      <div className="grid h-screen place-items-center p-6">
        <div className="card max-w-md p-8 text-center">
          <div className="mb-2 text-4xl">🔌</div>
          <h1 className="text-lg font-semibold">API injoignable</h1>
          <p className="mt-2 text-sm text-muted">
            Le backend ne répond pas. Vérifie que le conteneur <code>api</code> tourne
            (<code>docker compose ps</code> / <code>docker compose logs api</code>).
          </p>
          <button className="btn btn-primary mt-5" onClick={check}>Réessayer</button>
        </div>
      </div>
    );

  if (auth === "needkey") return <ApiKeyGate onSuccess={() => setAuth("ok")} />;

  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="search" element={<Search />} />
          <Route path="companies" element={<Companies />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="verify" element={<Verify />} />
          <Route path="blacklist" element={<Blacklist />} />
          <Route path="files" element={<Files />} />
          <Route path="logs" element={<Logs />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="settings" element={<SettingsPage />} />      
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}