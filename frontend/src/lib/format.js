export const fmtDate = (s) =>
  s ? new Date(s.endsWith?.("Z") || /[+-]\d\d:\d\d$/.test(s) ? s : s + "Z").toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const fmtNum = (n) => (n ?? 0).toLocaleString("fr-FR");

export const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;

export const STATUS = {
  valid: { label: "Valide", tone: "ok" },
  risky: { label: "Risqué", tone: "warn" },
  unknown: { label: "Inconnu", tone: "muted" },
  invalid: { label: "Invalide", tone: "bad" },
  unverified: { label: "Non vérifié", tone: "info" },
  blacklisted: { label: "Blacklisté", tone: "dark" },
};

const REASONS = {
  syntax_invalid: "Syntaxe invalide",
  disposable_domain: "Domaine jetable",
  domain_not_found: "Domaine inexistant",
  no_mx: "Aucun serveur mail (MX)",
  dns_error: "Erreur DNS temporaire",
  smtp_ok: "Boîte confirmée par SMTP",
  catch_all_domain: "Domaine « catch-all » (accepte tout)",
  mailbox_not_found: "Boîte inexistante",
  mailbox_full: "Boîte pleine",
  smtp_unreachable: "Serveur SMTP injoignable (port 25 bloqué ?)",
  mx_ok_smtp_not_checked: "Domaine OK, SMTP non testé",
  role_based: "adresse générique",
};

export function reasonLabel(r) {
  if (!r) return "";
  return r
    .split(";")
    .map((p) => {
      if (REASONS[p]) return REASONS[p];
      if (p.startsWith("smtp_temporary")) return "Refus temporaire (greylisting)";
      if (p.startsWith("smtp_blocked")) return "Serveur bloquant les tests";
      if (p.startsWith("discovery:")) return `Trouvée par pattern (${p.split(":")[1]})`;
      if (p.startsWith("blacklist")) return "Blacklistée";
      if (p.startsWith("error:")) return "Erreur interne";
      return p;
    })
    .join(" · ");
}

export function saveText(name, text, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const KIND_LABEL = {
  search: "Recherche de prospects",
  enrich: "Enrichissement",
  verify_file: "Vérification de fichier",
  verify_pending: "Vérification des contacts",
};