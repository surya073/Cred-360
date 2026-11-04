'use strict';

/*
 * keyShare transactional emails — one premium layout, several templates.
 *  - Table-based + inline styles so it renders in Gmail / Outlook / Apple Mail.
 *  - Same aurora gradient + lock/key motif as the app's top bar.
 *  - Every dynamic value is HTML-escaped; links must be http(s).
 *  - Dates are shown in India Standard Time.
 *
 * Each template returns { subject, html } — pass straight to catalystApp.email().sendMail:
 *     sendMail({ from_email, to_email, subject, html_mode: true, content: html })
 */

const { FROM_EMAIL } = require('./constants');

const BRAND = 'keyShare';
const TAGLINE = 'Secure credential sharing';

const TONES = {
  violet: { grad: 'linear-gradient(135deg,#312e81 0%,#6d28d9 55%,#c026d3 125%)', solid: '#5b21b6', accent: '#6d28d9', soft: '#f5f3ff', line: '#ddd6fe', badge: '🔐' },
  red:    { grad: 'linear-gradient(135deg,#7f1d1d 0%,#dc2626 60%,#fb7185 125%)', solid: '#b91c1c', accent: '#dc2626', soft: '#fef2f2', line: '#fecaca', badge: '⛔' },
  amber:  { grad: 'linear-gradient(135deg,#78350f 0%,#d97706 60%,#fbbf24 125%)', solid: '#b45309', accent: '#d97706', soft: '#fffbeb', line: '#fde68a', badge: '⏳' },
  green:  { grad: 'linear-gradient(135deg,#064e3b 0%,#059669 60%,#2dd4bf 125%)', solid: '#047857', accent: '#059669', soft: '#ecfdf5', line: '#a7f3d0', badge: '✅' },
};

const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');

// "YYYY-MM-DD HH:mm:ss" (UTC) | ISO | Date → "04 Nov 2026, 02:35 PM IST"
const formatIST = (value) => {
  if (!value) return '';
  let d;
  if (value instanceof Date) d = value;
  else {
    const s = String(value).trim();
    d = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s.replace(' ', 'T') + (s.length === 16 ? ':00Z' : 'Z')) : new Date(s);
  }
  if (isNaN(d)) return String(value);
  const date = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(d).toUpperCase();
  return `${date}, ${time} IST`;
};

const button = (label, url, tone) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 8px;">
    <tr><td align="center" bgcolor="${tone.accent}" style="border-radius:12px;background:${tone.grad};box-shadow:0 8px 20px rgba(76,29,149,.28);">
      <a href="${safeUrl(url)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)} &rarr;</a>
    </td></tr>
  </table>`;

const rowsTable = (rows) => !rows || !rows.length ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px;border:1px solid #e5e7eb;border-radius:12px;border-collapse:separate;overflow:hidden;">
    ${rows.map((r, i) => `
    <tr>
      <td style="padding:12px 16px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;width:38%;${i ? 'border-top:1px solid #f1f5f9;' : ''}background:#fafafa;">${esc(r.label)}</td>
      <td style="padding:12px 16px;font-size:14px;color:#111827;font-weight:600;${i ? 'border-top:1px solid #f1f5f9;' : ''}">${esc(r.value)}</td>
    </tr>`).join('')}
  </table>`;

const highlightBox = (h, tone) => !h ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
    <tr><td align="center" style="background:${tone.soft};border:1.5px dashed ${tone.accent};border-radius:14px;padding:22px 16px;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">🔑 &nbsp;${esc(h.label)}</div>
      <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:.14em;color:${tone.accent};word-break:break-all;">${esc(h.value)}</div>
      ${h.hint ? `<div style="font-size:12px;color:#9ca3af;margin-top:10px;">${esc(h.hint)}</div>` : ''}
    </td></tr>
  </table>`;

const noticeBox = (n) => !n ? '' : `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;">
    <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.55;color:#92400e;">
      <strong>🔒 ${esc(n.title || 'Security notice')}</strong><br/>${n.html || esc(n.text)}
    </td></tr>
  </table>`;

function renderEmail({ preheader = '', tone = 'violet', eyebrow = '', title, introHtml = '', rows, highlight, cta, notice, footer }) {
  const t = TONES[tone] || TONES.violet;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/><meta name="supported-color-schemes" content="light dark"/>
<title>${esc(title)}</title>
<style>
  @media (max-width:620px){ .ks-card{width:100%!important;border-radius:0!important} .ks-pad{padding:26px 20px!important} }
  @media (prefers-color-scheme:dark){ .ks-body{background:#0b1020!important} .ks-main{background:#111827!important} .ks-h,.ks-strong{color:#f9fafb!important} .ks-p{color:#cbd5e1!important} }
</style></head>
<body class="ks-body" style="margin:0;padding:0;background:#eef0f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f7;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="ks-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(30,27,75,.16);">

    <tr><td align="center" bgcolor="${t.solid}" style="background:${t.grad};padding:34px 32px 30px;font-family:'Segoe UI',Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td align="center" style="width:58px;height:58px;border-radius:16px;background:rgba(255,255,255,.18);font-size:28px;line-height:58px;">${t.badge}</td>
      </tr></table>
      <div style="margin-top:14px;font-size:24px;font-weight:700;letter-spacing:.04em;color:#ffffff;">${BRAND}</div>
      <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,.82);letter-spacing:.04em;">${TAGLINE}</div>
      <div style="margin-top:14px;font-size:15px;letter-spacing:.5em;color:rgba(255,255,255,.35);">🔒 &nbsp;·&nbsp; 🔑 &nbsp;·&nbsp; 🔒</div>
    </td></tr>

    <tr><td class="ks-main ks-pad" style="background:#ffffff;padding:36px 40px 30px;font-family:'Segoe UI',Arial,sans-serif;">
      ${eyebrow ? `<div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${t.accent};margin-bottom:8px;">${esc(eyebrow)}</div>` : ''}
      <h1 class="ks-h" style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#0f172a;">${esc(title)}</h1>
      <div class="ks-p" style="font-size:15px;line-height:1.65;color:#475569;">${introHtml}</div>
      ${highlightBox(highlight, t)}
      ${rowsTable(rows)}
      ${cta ? button(cta.label, cta.url, t) : ''}
      ${cta ? `<div style="text-align:center;font-size:12px;color:#94a3b8;margin-top:10px;word-break:break-all;">Button not working? Open: <a href="${safeUrl(cta.url)}" style="color:${t.accent};">${esc(cta.url)}</a></div>` : ''}
      ${noticeBox(notice)}
    </td></tr>

    <tr><td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:22px 40px;font-family:'Segoe UI',Arial,sans-serif;text-align:center;">
      <div style="font-size:12px;line-height:1.6;color:#94a3b8;">${footer ? esc(footer) : 'You are receiving this because of activity on your keyShare account.'}<br/>
      Never share your passphrase over chat. keyShare will never ask for your password by email.</div>
      <div style="margin-top:10px;font-size:11px;letter-spacing:.1em;color:#cbd5e1;">🔐 ${BRAND.toUpperCase()}</div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

const strong = (v) => `<strong class="ks-strong" style="color:#0f172a;">${esc(v)}</strong>`;

// ── Templates ─────────────────────────────────────────────────────────────

function externalPasswordShare({ sharedBy, description, passphrase, link, expiry }) {
  return {
    subject: `${BRAND} — a password was shared with you`,
    html: renderEmail({
      preheader: `${sharedBy} shared a password with you. Your passphrase is inside.`,
      eyebrow: 'Secure share',
      title: 'A password has been shared with you',
      introHtml: `${strong(sharedBy)} has securely shared a password with you through ${BRAND}.${description ? `<br/><br/><em style="color:#64748b;">“${esc(description)}”</em>` : ''}`,
      highlight: { label: 'Your access passphrase', value: passphrase, hint: 'You will need this passphrase to open the link' },
      rows: expiry ? [{ label: 'Link expires', value: formatIST(expiry) }] : [],
      cta: { label: 'View shared password', url: link },
      notice: { title: 'Security notice', html: `This link expires on <strong>${esc(formatIST(expiry) || 'a set date')}</strong>. Do not forward this email — anyone with the link and passphrase can view the password.` },
    }),
  };
}

function externalFolderShare({ sharedBy, folderName, count, description, passphrase, link, expiry }) {
  const n = Number(count) || 0;
  return {
    subject: `${BRAND} — folder "${String(folderName).slice(0, 60)}" was shared with you`,
    html: renderEmail({
      preheader: `${sharedBy} shared the folder "${folderName}" with you.`,
      eyebrow: 'Secure folder share',
      title: 'A folder has been shared with you',
      introHtml: `${strong(sharedBy)} has securely shared the folder ${strong(`“${folderName}”`)} with you.${description ? `<br/><br/><em style="color:#64748b;">“${esc(description)}”</em>` : ''}`,
      highlight: { label: 'Your access passphrase', value: passphrase, hint: 'You will need this passphrase to open the link' },
      rows: [
        { label: 'Folder', value: folderName },
        { label: 'Contains', value: `${n} password${n === 1 ? '' : 's'}` },
        ...(expiry ? [{ label: 'Link expires', value: formatIST(expiry) }] : []),
      ],
      cta: { label: 'View shared folder', url: link },
      notice: { title: 'Security notice', html: `Do not forward this email — anyone with the link and passphrase can view the folder.` },
    }),
  };
}

function passwordExpired({ name, link }) {
  return {
    subject: `${BRAND} — password expired: "${String(name).slice(0, 60)}"`,
    html: renderEmail({
      tone: 'red',
      preheader: `"${name}" has expired. Update it to stay secure.`,
      eyebrow: 'Action required',
      title: 'Your password has expired',
      introHtml: `Your saved password ${strong(`“${name}”`)} has passed its expiry date. Update it now so anyone it is shared with keeps working, secure access.`,
      cta: { label: 'Update password now', url: link },
      notice: { title: 'Why this matters', text: 'Expired credentials are a common way accounts get compromised. Rotate this password as soon as you can.' },
    }),
  };
}

function passwordExpiring({ name, days, expiryDate, link }) {
  const d = Number(days) || 0;
  return {
    subject: `${BRAND} — password expiring in ${d} day${d === 1 ? '' : 's'}: "${String(name).slice(0, 60)}"`,
    html: renderEmail({
      tone: 'amber',
      preheader: `"${name}" expires in ${d} day${d === 1 ? '' : 's'}.`,
      eyebrow: 'Heads up',
      title: `Password expiring in ${d} day${d === 1 ? '' : 's'}`,
      introHtml: `Your saved password ${strong(`“${name}”`)} will expire soon. Update it before then to avoid interruptions.`,
      rows: [{ label: 'Password', value: name }, { label: 'Expires on', value: formatIST(expiryDate) }],
      cta: { label: 'Update password', url: link },
    }),
  };
}

// Generic notification email (team / share / role events) — ready for use by any handler.
function genericNotification({ title, message, ctaLabel, link, tone = 'violet', rows }) {
  return {
    subject: `${BRAND} — ${title}`,
    html: renderEmail({
      tone, preheader: message, eyebrow: 'Notification', title,
      introHtml: esc(message), rows,
      cta: link ? { label: ctaLabel || 'Open keyShare', url: link } : null,
    }),
  };
}

// Send a { subject, html } template through Catalyst Mail.
const sendTemplated = (catalystApp, to, tpl) => catalystApp.email().sendMail({
  from_email: FROM_EMAIL, to_email: to, subject: tpl.subject, html_mode: true, content: tpl.html,
});

module.exports = {
  sendTemplated, renderEmail, formatIST, esc,
  externalPasswordShare, externalFolderShare, passwordExpired, passwordExpiring, genericNotification,
};
