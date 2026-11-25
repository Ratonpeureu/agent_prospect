import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Ban, Building2, LayoutDashboard, ListChecks, LogOut,FolderOpen, MailCheck, Menu, Moon, Radar, Settings, Sun, Users, X } from "lucide-react";
import { api, getKey, setKey } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { applyTheme } from "../lib/theme";
import { Spinner } from "./ui";

const NAV = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/search", label: "Prospection", icon: Radar },
  { to: "/companies", label: "Entreprises", icon: Building2 },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/verify", label: "Vérification", icon: MailCheck },
  { to: "/blacklist", label: "Blacklist", icon: Ban },
  { to: "/jobs", label: "Tâches", icon: ListChecks },
  { to: "/files", label: "Fichiers", icon: FolderOpen },
  { to: "/settings", label: "Configuration", icon: Settings },

];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  const loc = useLocation();
  const jobs = useAsync(() => api.get("/api/jobs", { limit: 10 }), []);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const t = setInterval(jobs.reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = (jobs.data || []).filter((j) => j.status === "running" || j.status === "queued").length;
  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    applyTheme(t);
    setTheme(t);
  };
  const logout = () => {
    setKey("");
    window.location.reload();
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <Link to="/" className="mb-5 flex items-center gap-2.5 px-2 text-lg font-semibold tracking-tight">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-brand-fg">🎯</span>
        Prospect Tool
      </Link>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? "bg-brand/10 text-brand" : "text-muted hover:bg-soft hover:text-fg"}`
          }
        >
          <Icon size={18} /> {label}
          {to === "/jobs" && running > 0 && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs text-brand-fg"><Spinner size={11} />{running}</span>
          )}
        </NavLink>
      ))}
      <div className="mt-auto space-y-1 border-t border-line pt-4">
        <button onClick={toggleTheme} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-soft hover:text-fg">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />} {theme === "dark" ? "Mode clair" : "Mode sombre"}
        </button>
        {getKey() && (
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-soft hover:text-fg">
            <LogOut size={18} /> Déconnexion
          </button>
        )}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(!open)} className="rounded-lg p-1.5 hover:bg-soft">{open ? <X size={20} /> : <Menu size={20} />}</button>
          <span className="font-semibold">🎯 Prospect Tool</span>
          <span className="w-8" />
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}