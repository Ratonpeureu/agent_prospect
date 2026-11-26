import random
import smtplib
import socket
import string
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import dns.exception
import dns.resolver
from email_validator import EmailNotValidError, validate_email

from app.config import settings
from app.services.normalize import ROLE_LOCALS
from app.services import applog

log = applog.get("verifier")

DISPOSABLE = {
    "mailinator.com", "yopmail.com", "yopmail.fr", "guerrillamail.com", "guerrillamail.net",
    "10minutemail.com", "tempmail.com", "temp-mail.org", "trashmail.com", "sharklasers.com",
    "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com",
    "mailnesia.com", "mintemail.com", "mytemp.email", "tempail.com", "emailondeck.com",
    "spamgourmet.com", "moakt.com", "tempinbox.com", "burnermail.io", "discard.email",
}
BLOCK_HINTS = ("spam", "block", "blacklist", "denied", "policy", "reputation", "spamhaus", "banned", "rejected due")
SCORES = {"valid": 100, "risky": 50, "unknown": 30, "invalid": 0}

_mx_cache: dict[str, tuple] = {}
_catch_cache: dict[str, bool | None] = {}
_lock = threading.Lock()


def _resolve_mx(domain: str) -> tuple[list[str] | None, str | None]:
    with _lock:
        if domain in _mx_cache:
            return _mx_cache[domain]
    resolver = dns.resolver.Resolver()
    resolver.lifetime, resolver.timeout = 8, 4
    hosts, err = None, None
    try:
        ans = resolver.resolve(domain, "MX")
        hosts = [str(r.exchange).rstrip(".") for r in sorted(ans, key=lambda r: r.preference)
                 if str(r.exchange).rstrip(".")]
        if not hosts:
            hosts, err = None, "no_mx"
    except dns.resolver.NXDOMAIN:
        err = "domain_not_found"
    except dns.resolver.NoAnswer:
        try:
            resolver.resolve(domain, "A")
            hosts = [domain]
        except dns.resolver.NXDOMAIN:
            err = "domain_not_found"
        except dns.resolver.NoAnswer:
            err = "no_mx"
        except dns.exception.DNSException:
            err = "dns_error"
    except dns.exception.DNSException:
        err = "dns_error"
    res = (hosts, err)
    if err != "dns_error":
        with _lock:
            _mx_cache[domain] = res
    return res


def _probe(host: str, rcpt: str) -> tuple[int | None, str]:
    t0 = time.perf_counter()
    try:
        with smtplib.SMTP(timeout=settings.SMTP_TIMEOUT) as s:
            s.connect(host, 25)
            s.ehlo(settings.SMTP_HELO_DOMAIN)
            s.mail(settings.SMTP_MAIL_FROM)
            code, msg = s.rcpt(rcpt)
            return code, (msg.decode(errors="ignore") if isinstance(msg, bytes) else str(msg))
    except (smtplib.SMTPException, socket.timeout, OSError) as e:
        log.debug("SMTP injoignable %s (%s) : %s", host, rcpt.split("@")[-1], e)
        return None, str(e)
    finally:
        d = time.perf_counter() - t0
        if d >= settings.SLOW_OP_S:
            log.warning("SLOW smtp %s (%s) : %.1fs", host, rcpt.split("@")[-1], d)


def _is_catch_all(domain: str, hosts: list[str]) -> bool | None:
    with _lock:
        if domain in _catch_cache:
            return _catch_cache[domain]
    fake = "".join(random.choices(string.ascii_lowercase + string.digits, k=18)) + "@" + domain
    code, _ = _probe(hosts[0], fake)
    res = True if code in (250, 251) else (False if code is not None and 500 <= code < 600 else None)
    with _lock:
        _catch_cache[domain] = res
    return res


def probe_domain(domain: str) -> dict:
    """has_mx : le domaine reçoit des mails. catch_all : True / False / None (SMTP injoignable ou ambigu)."""
    hosts, err = _resolve_mx(domain)
    if err or not hosts:
        return {"has_mx": False, "catch_all": None}
    return {"has_mx": True, "catch_all": _is_catch_all(domain, hosts)}


def _result(email: str, status: str, reason: str, **extra) -> dict:
    return {"email": email, "status": status, "reason": reason, "score": SCORES[status],
            "is_role": False, "is_disposable": False, **extra}


def verify_email(email: str, use_smtp: bool | None = None) -> dict:
    use_smtp = settings.SMTP_CHECK_ENABLED if use_smtp is None else use_smtp
    raw = (email or "").strip().lower()
    try:
        email = validate_email(raw, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        return _result(raw, "invalid", "syntax_invalid")

    local, domain = email.rsplit("@", 1)
    is_role = local in ROLE_LOCALS

    if domain in DISPOSABLE:
        return _result(email, "invalid", "disposable_domain", is_disposable=True, is_role=is_role)

    hosts, err = _resolve_mx(domain)
    if err == "dns_error":
        return _result(email, "unknown", "dns_error", is_role=is_role)
    if err:
        return _result(email, "invalid", err, is_role=is_role)

    status, reason = "unknown", "mx_ok_smtp_not_checked"
    if use_smtp:
        code, msg = None, ""
        for host in hosts[:2]:
            code, msg = _probe(host, email)
            if code is not None:
                break
        low = msg.lower()
        if code in (250, 251):
            catch = _is_catch_all(domain, hosts)
            status, reason = ("risky", "catch_all_domain") if catch else ("valid", "smtp_ok")
        elif code in (550, 551, 553) and not any(h in low for h in BLOCK_HINTS):
            status, reason = "invalid", "mailbox_not_found"
        elif code == 552:
            status, reason = "risky", "mailbox_full"
        elif code is not None and 400 <= code < 500:
            status, reason = "unknown", f"smtp_temporary_{code}"
        elif code is not None:
            status, reason = "unknown", f"smtp_blocked_{code}"
        else:
            status, reason = "unknown", "smtp_unreachable"

    if is_role and status == "valid":
        reason += ";role_based"
    return _result(email, status, reason, is_role=is_role)


def _safe(email: str, use_smtp: bool | None) -> dict:
    try:
        return verify_email(email, use_smtp)
    except Exception as e:  
        log.warning("verify_email a planté (domaine %s)", email.split("@")[-1], exc_info=True)
        return _result(email, "unknown", f"error:{type(e).__name__}")


def verify_many(emails: list[str], use_smtp: bool | None = None) -> dict[str, dict]:
    unique = list(dict.fromkeys(e.strip().lower() for e in emails if e and e.strip()))
    with ThreadPoolExecutor(max_workers=settings.VERIFY_WORKERS) as ex:
        results = list(ex.map(lambda e: _safe(e, use_smtp), unique))
    return dict(zip(unique, results))