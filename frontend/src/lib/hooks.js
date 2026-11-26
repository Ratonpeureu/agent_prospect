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
const active = { data: { running: 0, jobs: [] }, listeners: new Set(), timer: null, fails: 0, inflight: false };

function schedule() {
  clearTimeout(active.timer);
  if (!active.listeners.size) return;
  const base = active.data.running > 0 ? 5000 : 20000;           // 5 s si une tâche tourne, sinon 20 s
  const delay = Math.min(60000, base * 2 ** active.fails);        // backoff si l'API répond mal
  active.timer = setTimeout(pollActive, delay);
}

async function pollActive() {
  if (document.hidden || active.inflight) return schedule();      // onglet caché : aucune requête
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
    schedule();
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
/** À appeler juste après avoir lancé une tâche pour afficher son état sans attendre. */
export const refreshActive = () => { clearTimeout(active.timer); pollActive(); };

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