import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api";

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useDebounce(value, ms = 400) {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

/** setInterval qui se met en pause quand l'onglet est caché. */
export function usePoll(fn, ms, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

/* ---------- Poller GLOBAL partagé : une seule requête légère pour toute l'application ---------- */

const active = { data: { running: 0, jobs: [] }, listeners: new Set(), timer: null, fails: 0, inflight: false, again: false, boostUntil: 0 };

function schedule() {
  clearTimeout(active.timer);
  if (!active.listeners.size) return;
  const boosted = Date.now() < active.boostUntil;                 // juste après un lancement : 1,5 s
  const base = active.data.running > 0 ? 5000 : boosted ? 1500 : 20000;
  const delay = Math.min(60000, base * 2 ** active.fails);
  active.timer = setTimeout(pollActive, delay);
}

async function pollActive() {
  if (document.hidden) return schedule();
  if (active.inflight) { active.again = true; return; }           // un poll périmé est en cours : on en refait un après
  active.inflight = true;
  try {
    const d = await api.get("/api/jobs/active");
    active.fails = 0;
    if (JSON.stringify(d) !== JSON.stringify(active.data)) {
      active.data = d;
      active.listeners.forEach((l) => l());
    }
  } catch {
    active.fails = Math.min(active.fails + 1, 4);
  } finally {
    active.inflight = false;
    if (active.again) { active.again = false; clearTimeout(active.timer); pollActive(); }
    else schedule();
  }
}

const onVisible = () => { if (!document.hidden) { clearTimeout(active.timer); pollActive(); } };

function subscribe(listener) {
  active.listeners.add(listener);
  if (active.listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisible);
    pollActive();
  }
  return () => {
    active.listeners.delete(listener);
    if (!active.listeners.size) {
      clearTimeout(active.timer);
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** { running, jobs } : tâches en attente / en cours, partagé par tous les composants. */
export const useActiveJobs = () => useSyncExternalStore(subscribe, () => active.data);

/** Rafraîchit tout de suite, puis poll rapidement pendant 30 s le temps que la tâche démarre. */
export const refreshActive = () => {
  active.boostUntil = Date.now() + 30000;
  active.fails = 0;
  clearTimeout(active.timer);
  pollActive();
};

// Déclenché par api.js dès qu'une réponse contient un job_id (recherche, enrichissement, vérification, import, reprise…)
if (typeof window !== "undefined") window.addEventListener("job-started", refreshActive);



/** Suivi d'une tâche : 2 s au début, puis de plus en plus espacé (max 10 s), pause si onglet caché. */
export function useJob(jobId, { onDone } = {}) {
  const [job, setJob] = useState(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    let alive = true;
    let timer;
    let delay = 2000;
    const tick = async () => {
      if (!alive) return;
      if (document.hidden) { timer = setTimeout(tick, 5000); return; }
      try {
        const j = await api.get(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(j);
        if (j.status === "done" || j.status === "error") { doneRef.current?.(j); return; }
        delay = Math.min(10000, Math.round(delay * 1.25));
      } catch {
        delay = Math.min(30000, delay * 2);
      }
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId]);
  return job;
}