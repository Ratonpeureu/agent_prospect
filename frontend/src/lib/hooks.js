import { useEffect, useRef, useState } from "react";
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

export function usePoll(fn, ms, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

export function useJob(jobId, { interval = 2000, onDone } = {}) {
  const [job, setJob] = useState(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!jobId) { setJob(null); return; }
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const j = await api.get(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(j);
        if (j.status === "done" || j.status === "error") {
          doneRef.current?.(j);
          return;
        }
      } catch { /* on réessaie */ }
      timer = setTimeout(tick, interval);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId, interval]);
  return job;
}