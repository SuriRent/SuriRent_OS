"""SMTP email service.

Uses Python's built-in smtplib + email.message for portability. Each company
has its own SMTP config in `company_settings.smtp`. Secrets are decrypted only
at send time via settings_service.get_company_section().
"""
import asyncio
import smtplib
import ssl
import socket
from email.message import EmailMessage
from email.utils import formataddr


class EmailError(Exception):
    pass


def _build_message(cfg: dict, to: str, subject: str, body_html: str,
                   body_text: str | None = None,
                   attachments: list[tuple[str, bytes, str]] | None = None) -> EmailMessage:
    msg = EmailMessage()
    from_name = cfg.get("from_name") or "SuriRent"
    from_email = cfg.get("from_email") or cfg.get("username") or "no-reply@example.com"
    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text or "Bekijk deze e-mail in een HTML-compatibele e-mailclient.")
    msg.add_alternative(body_html, subtype="html")
    for filename, content, content_type in attachments or []:
        # Allow callers to flag an attachment as inline with a Content-ID by
        # appending '; cid=<id>; inline' to the content_type string.
        # Example: 'image/png; cid=loginqr; inline'
        ctype = content_type or "application/octet-stream"
        parts = [p.strip() for p in ctype.split(";")]
        mime = parts[0] or "application/octet-stream"
        params = dict(p.split("=", 1) for p in parts[1:] if "=" in p)
        inline = any(p.lower() == "inline" for p in parts[1:])
        cid = params.get("cid")
        maintype, _, subtype = mime.partition("/")
        kwargs = {"maintype": maintype or "application", "subtype": subtype or "octet-stream"}
        if inline:
            kwargs["disposition"] = "inline"
            if cid:
                kwargs["cid"] = f"<{cid}>"
        else:
            kwargs["filename"] = filename
        msg.add_attachment(content, **kwargs)
    return msg


def _send_sync(cfg: dict, msg: EmailMessage) -> None:
    """Synchronous SMTP send. Raises EmailError on failure."""
    host = (cfg.get("host") or "").strip()
    port = int(cfg.get("port") or 587)
    username = cfg.get("username") or ""
    password = cfg.get("password") or ""
    use_tls = bool(cfg.get("use_tls"))
    if not host:
        raise EmailError("SMTP host is niet geconfigureerd")
    try:
        if port == 465 or not use_tls:
            # Implicit SSL (port 465) or plain (rare).
            if port == 465:
                ctx = ssl.create_default_context()
                with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as s:
                    if username:
                        s.login(username, password)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(host, port, timeout=15) as s:
                    if username:
                        s.login(username, password)
                    s.send_message(msg)
        else:
            # STARTTLS path (port 587).
            with smtplib.SMTP(host, port, timeout=15) as s:
                s.ehlo()
                s.starttls(context=ssl.create_default_context())
                s.ehlo()
                if username:
                    s.login(username, password)
                s.send_message(msg)
    except (smtplib.SMTPException, socket.gaierror, socket.timeout, ConnectionError, OSError) as e:
        raise EmailError(f"SMTP fout: {e}") from e


async def send_email(cfg: dict, to: str, subject: str, body_html: str,
                     body_text: str | None = None,
                     attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    """Non-blocking wrapper around smtplib (runs in threadpool)."""
    if not cfg.get("enabled"):
        raise EmailError("SMTP is niet ingeschakeld voor dit bedrijf")
    msg = _build_message(cfg, to, subject, body_html, body_text, attachments)
    await asyncio.to_thread(_send_sync, cfg, msg)


def get_platform_smtp_config() -> dict | None:
    """Read SuriRent's platform-wide SMTP from env vars (for transactional
    mails like the post-signup welcome email). Returns None when not configured."""
    import os
    host = (os.environ.get("PLATFORM_SMTP_HOST") or "").strip()
    if not host:
        return None
    return {
        "enabled": True,
        "host": host,
        "port": int(os.environ.get("PLATFORM_SMTP_PORT") or 587),
        "username": os.environ.get("PLATFORM_SMTP_USERNAME") or "",
        "password": os.environ.get("PLATFORM_SMTP_PASSWORD") or "",
        "use_tls": (os.environ.get("PLATFORM_SMTP_TLS") or "true").lower() != "false",
        "from_name": os.environ.get("PLATFORM_FROM_NAME") or "SuriRent",
        "from_email": os.environ.get("PLATFORM_FROM_EMAIL") or "no-reply@surirent.sr",
    }


async def send_platform_email(to: str, subject: str, body_html: str,
                              body_text: str | None = None,
                              attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    """Send a transactional email using SuriRent's platform SMTP.

    Silently no-ops when not configured (so registration still succeeds
    even if the operator hasn't filled in PLATFORM_SMTP_HOST yet).
    """
    cfg = get_platform_smtp_config()
    if not cfg:
        return
    msg = _build_message(cfg, to, subject, body_html, body_text, attachments)
    try:
        await asyncio.to_thread(_send_sync, cfg, msg)
    except EmailError:
        # Welcome email is best-effort: registration must not fail.
        return


# ============== Branded HTML helpers ==============
def _darken_hex(hex_color: str, factor: float = 0.7) -> str:
    """Return a darker variant of `hex_color` (e.g. #FF8A3D → #B36126)."""
    try:
        h = (hex_color or "").lstrip("#")
        if len(h) != 6:
            return "#C74600"
        r = max(0, min(255, int(int(h[0:2], 16) * factor)))
        g = max(0, min(255, int(int(h[2:4], 16) * factor)))
        b = max(0, min(255, int(int(h[4:6], 16) * factor)))
        return f"#{r:02X}{g:02X}{b:02X}"
    except Exception:
        return "#C74600"


def wrap_template(content_html: str, footer: str = "", *,
                  brand_name: str = "SuriRent",
                  brand_color: str = "#FF8A3D",
                  brand_color_dark: str | None = None,
                  logo_url: str = "") -> str:
    """Wrap a snippet in a white-label styled HTML email shell.

    Alle branding-elementen (brand-pil, header, footer, background-tint) worden
    dynamisch afgeleid uit `brand_name` + `brand_color`. Wanneer `logo_url`
    is opgegeven wordt daar een <img> voor gerenderd i.p.v. de brand-tekst.
    Callers die een `send_email` doen namens een klant moeten deze kwargs
    altijd vullen met de gegevens van het klantbedrijf — nooit SuriRent
    branding meesturen in tenant-mails.
    """
    dark = brand_color_dark or _darken_hex(brand_color, 0.6)
    brand_block = (
        f'<img src="{logo_url}" alt="{brand_name}" '
        f'style="max-height:56px;max-width:220px;display:inline-block;" />'
        if logo_url else
        f'<div class="brand">{brand_name}</div>'
    )
    footer_text = footer or f"Deze e-mail is automatisch verzonden door {brand_name}."
    return f"""<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8" />
<title>{brand_name}</title>
<style>
  body {{ margin: 0; padding: 0; background: #F8FAFC; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; }}
  .container {{ max-width: 560px; margin: 0 auto; padding: 24px 16px; }}
  .card {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 28px; }}
  .brand {{ background: linear-gradient(135deg, {brand_color}, {dark}); color: #fff; border-radius: 14px; padding: 14px 18px; font-weight: 800; letter-spacing: 0.5px; display: inline-block; }}
  h1 {{ font-size: 22px; margin: 18px 0 4px; }}
  p {{ line-height: 1.55; font-size: 14px; color: #334155; }}
  .footer {{ text-align: center; color: #94a3b8; font-size: 11px; margin-top: 18px; line-height: 1.5; }}
  table.kv {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
  table.kv td {{ padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 13px; }}
  table.kv td:first-child {{ color: #64748b; }}
  table.kv td:last-child {{ font-weight: 700; text-align: right; }}
</style></head>
<body><div class="container">
  <div class="card">
    {brand_block}
    {content_html}
  </div>
  <div class="footer">{footer_text}</div>
</div></body></html>"""
