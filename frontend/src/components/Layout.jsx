import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { FolderOpen, LogOut, Menu, Moon, SlidersHorizontal, Sun, Terminal, X } from "lucide-react";
import { getKey, setKey } from "../lib/api";
import { useActiveJobs } from "../lib/hooks";
import { applyTheme } from "../lib/theme";
import { Spinner } from "./ui";
import { CoffeeCup, DonateModal, Footer } from "./Footer";

const NAV = [
  { to: "/", label: "Tableau de bord", end: true },
  { to: "/search", label: "Prospection" },
  { to: "/companies", label: "Entreprises" },
  { to: "/contacts", label: "Contacts" },
  { to: "/verify", label: "Vérification" },
  { to: "/blacklist", label: "Blacklist" },
  { to: "/jobs", label: "Tâches" },
];
const TOOLS = [
  { to: "/files", label: "Fichiers", icon: FolderOpen },
  { to: "/logs", label: "Journal", icon: Terminal },
  { to: "/settings", label: "Configuration", icon: SlidersHorizontal },
];

const linkCls = ({ isActive }) =>
  `rounded-md px-3 py-1.5 text-sm transition ${isActive ? "bg-white font-semibold text-ink-950" : "text-ink-300 hover:bg-ink-800 hover:text-white"}`;
const iconCls = ({ isActive }) =>
  `grid h-8 w-8 place-items-center rounded-md transition ${isActive ? "bg-ink-700 text-white" : "text-ink-300 hover:bg-ink-800 hover:text-white"}`;

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [donate, setDonate] = useState(false); // <-- ligne manquante
  const [theme, setTheme] = useState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  const loc = useLocation();
  const { running, jobs } = useActiveJobs();
  const job = jobs?.[0];
  const pct = Math.max(0, Math.min(100, job?.progress?.percent ?? 0));

  useEffect(() => setOpen(false), [loc.pathname]);

  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    applyTheme(t);
    setTheme(t);
  };
  const logout = () => {
    setKey("");
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col items-center">
      <div className="w-full px-6 pt-4 max-sm:px-2 max-sm:pt-2">
        <nav className="mx-auto flex w-full max-w-[1320px] items-center gap-2 rounded-lg bg-ink-950 py-2 pl-3 pr-2 shadow-pop ring-1 ring-white/5">
          <Link to="/" className="flex items-center gap-2.5 pr-3">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.25">
                <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="#fff" />
              </svg>
            </span>
            <span className="text-base font-semibold text-white max-sm:hidden">Prospect</span>
          </Link>

          <div className="hidden grow items-center gap-0.5 lg:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>{n.label}</NavLink>
            ))}
          </div>
          <div className="grow lg:hidden" />

          <div className="flex items-center gap-1.5">
            {running > 0 && (
              <Link to="/jobs" title="Tâches en cours" className="hidden items-center gap-2.5 rounded-md bg-ink-900 px-3 py-1.5 transition hover:bg-ink-800 md:flex">
                <Spinner size={14} className="text-brand-300" />
                <span className="text-xs font-semibold text-white">#{job?.id}</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-ink-700">
                  <span className="block h-full rounded-full bg-brand-400 transition-all duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
                </span>
                <span className="text-xs text-ink-400">{pct} %</span>
                {running > 1 && <span className="rounded bg-ink-700 px-1 text-xs font-semibold text-white">+{running - 1}</span>}
              </Link>
            )}
            <span className="hidden h-6 w-px bg-ink-800 md:block" />
            <button type="button" className="app-coffee" onClick={() => setDonate(true)}>
              <CoffeeCup size={16} /><span className="max-sm:hidden">Soutenir</span>
            </button>
            <div className="hidden items-center gap-1.5 sm:flex">
              {TOOLS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} title={label} className={iconCls}><Icon size={16} /></NavLink>
              ))}
            </div>
            <button onClick={toggleTheme} title={theme === "dark" ? "Mode clair" : "Mode sombre"} className="grid h-8 w-8 place-items-center rounded-md text-ink-300 transition hover:bg-ink-800 hover:text-white">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {getKey() && (
              <button onClick={logout} title="Déconnexion" className="grid h-8 w-8 place-items-center rounded-md text-ink-300 transition hover:bg-ink-800 hover:text-white">
                <LogOut size={16} />
              </button>
            )}
            <button onClick={() => setOpen(!open)} className="grid h-8 w-8 place-items-center rounded-md text-ink-300 transition hover:bg-ink-800 hover:text-white lg:hidden">
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </nav>

        {open && (
          <div className="mx-auto mt-2 flex w-full max-w-[1320px] animate-drop flex-col gap-0.5 rounded-lg bg-ink-950 p-2 shadow-pop ring-1 ring-white/5 lg:hidden">
            {[...NAV, ...TOOLS].map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>{n.label}</NavLink>
            ))}
          </div>
        )}
      </div>

      <main className="w-full max-w-[1368px] grow px-6 pb-10 max-sm:px-2">
        <div key={loc.pathname} className="animate-fade">
          <Outlet />
        </div>
      </main>

      {/* w-full : sans ça, le footer se rétrécit à cause de items-center */}
      <div className="w-full">
        <Footer onDonate={() => setDonate(true)} />
      </div>
      {donate && <DonateModal onClose={() => setDonate(false)} />}
    </div>
  );
}