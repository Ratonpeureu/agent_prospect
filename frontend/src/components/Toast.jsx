import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

const STYLE = {
  success: { icon: CheckCircle2, cls: "text-ok" },
  error: { icon: AlertCircle, cls: "text-bad" },
  info: { icon: Info, cls: "text-info" },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = (id) => setItems((i) => i.filter((x) => x.id !== id));
  const push = useCallback((type, msg) => {
    const id = Math.random().toString(36).slice(2);
    setItems((i) => [...i, { id, type, msg }]);
    setTimeout(() => remove(id), type === "error" ? 8000 : 4500);
  }, []);
  const toast = useMemo(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m), info: (m) => push("info", m) }),
    [push]
  );
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => {
          const S = STYLE[t.type];
          return (
            <div key={t.id} className="card flex items-start gap-3 p-3.5 text-sm">
              <S.icon size={18} className={`mt-0.5 shrink-0 ${S.cls}`} />
              <div className="flex-1 break-words">{t.msg}</div>
              <button onClick={() => remove(t.id)} className="text-muted hover:text-fg"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}