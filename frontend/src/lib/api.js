const KEY_STORE = "prospect_api_key";
export const getKey = () => localStorage.getItem(KEY_STORE) || "";
export const setKey = (k) => (k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE));

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const qs = (params) => {
  const u = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    u.append(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
};

async function call(path, { method = "GET", body, params, form } = {}) {
  const headers = {};
  const key = getKey();
  if (key) headers["X-API-Key"] = key;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path + qs(params), { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "API injoignable");
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("api-unauthorized"));
    let msg = res.statusText;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d) => d.msg || JSON.stringify(d)).join(" ; ");
      else msg = JSON.stringify(j.detail ?? j);
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return res;
}

export const api = {
  get: async (p, params) => (await call(p, { params })).json(),
  list: async (p, params) => {
    const r = await call(p, { params });
    const t = r.headers.get("x-total-count");
    return { items: await r.json(), total: t === null ? null : Number(t) };
  },
  post: async (p, body, params) => {
    const r = await call(p, { method: "POST", body, params });
    return r.status === 204 ? null : r.json();
  },
  patch: async (p, body) => (await call(p, { method: "PATCH", body })).json(),
  put: async (p, body) => (await call(p, { method: "PUT", body })).json(),
  del: async (p) => {
    await call(p, { method: "DELETE" });
  },
  upload: async (p, form) => (await call(p, { method: "POST", form })).json(),
  download: async (p, params, { method = "GET", body } = {}) => {
    const res = await call(p, { method, params, body });
    const blob = await res.blob();
    const m = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") || "");
    const name = m ? m[1] : "export.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return name;
  },
};