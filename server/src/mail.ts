import { config } from './config.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Sends an email through Resend's HTTP API. Does nothing when email isn't set up, so the app works without it. */
export async function sendMail(to: string, subject: string, lines: { text: string; link?: { href: string; label: string }; footer?: string }) {
  if (!config.resendKey || !config.mailFrom) return false;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1B2333;line-height:1.5;max-width:520px">
  <p style="margin:0 0 16px">${esc(lines.text).replace(/\n/g, '<br>')}</p>
  ${lines.link ? `<p style="margin:0 0 24px"><a href="${esc(lines.link.href)}" style="display:inline-block;background:#1B2333;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600">${esc(lines.link.label)}</a></p>` : ''}
  <p style="margin:0;color:#5B6578;font-size:13px">${esc(lines.footer ?? 'Sent by Tessel because someone mentioned you on a board.')}</p></div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, html, text: `${lines.text}\n\n${lines.link?.href ?? ''}` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('resend', r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) { console.error('resend failed', e); return false; }
}
