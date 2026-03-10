// supabase/functions/send-confirmation/index.ts
//
// supabase functions deploy send-confirmation
// supabase secrets set RESEND_API_KEY=re_xxxx
// supabase secrets set SITE_URL=https://твоя-сайт.netlify.app
// supabase secrets set FROM_EMAIL=noreply@твоядомейн.com

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const BREVO  = Deno.env.get('BREVO_API_KEY')!;
const SITE    = Deno.env.get('SITE_URL')!;
const FROM    = Deno.env.get('FROM_EMAIL') ?? 'noreply@brevo.dev';
const SB_URL  = Deno.env.get('SUPABASE_URL')!;
const SB_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    const { record } = await req.json();
    if (!record?.id) return new Response('no record', { status: 400 });

    const { id, edit_token, event, event_date } = record;

    // Вземи всички участници (is_head=true е организаторът)
    const pRes = await fetch(
      `${SB_URL}/rest/v1/participants?registration_id=eq.${id}&order=is_head.desc,name.asc`,
      { headers: { 'apikey': SB_SVC, 'Authorization': `Bearer ${SB_SVC}` } }
    );
    const parts: any[] = await pRes.json();

    const head  = parts.find(p => p.is_head);
    const rest  = parts.filter(p => !p.is_head);
    if (!head) return new Response('no head', { status: 400 });

    const total   = parts.length;
    const editUrl = `${SITE}?token=${edit_token}`;
    const evFmt   = new Date(event_date).toLocaleDateString('bg-BG',
      { day:'numeric', month:'long', year:'numeric' });

    const rows = parts.map((p, i) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:6px 10px;color:#9ca3af;font-size:11px;">${i+1}</td>
        <td style="padding:6px 10px;font-weight:${p.is_head?'700':'400'};font-size:12px;">
          ${p.name}${p.is_head?' <span style="color:#c8a84b;font-size:10px;">(орг.)</span>':''}
        </td>
        <td style="padding:6px 10px;font-family:monospace;font-size:11px;color:#6b7280;">${p.egn}</td>
        <td style="padding:6px 10px;text-align:center;font-size:11px;color:#6b7280;">${p.age??'—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="bg"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 14px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">

  <tr><td style="background:#141810;padding:32px;text-align:center;">
    <div style="font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#c8a84b;margin-bottom:7px;">
      Потвърждение за записване</div>
    <div style="font-size:22px;font-weight:700;color:#ddd6c6;">${event}</div>
    <div style="font-size:12px;color:#8a9080;margin-top:5px;">${evFmt}</div>
  </td></tr>

  <tr><td style="padding:28px 32px;">
    <p style="margin:0 0 12px;color:#374151;font-size:14px;">
      Здравей, <strong>${head.name}</strong>,
    </p>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px;line-height:1.6;">
      Записването е получено.
      Записани са <strong>${total} участник${total!==1?'а':''}</strong>.
      Ref: <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:11px;">
        ${id.slice(0,8).toUpperCase()}</code>
    </p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="border:1px solid #e5e7eb;border-radius:5px;margin-bottom:22px;">
      <thead><tr style="background:#f9fafb;">
        <th style="padding:7px 10px;text-align:left;color:#9ca3af;font-size:10px;">#</th>
        <th style="padding:7px 10px;text-align:left;color:#9ca3af;font-size:10px;">Три имена</th>
        <th style="padding:7px 10px;text-align:left;color:#9ca3af;font-size:10px;">ЕГН</th>
        <th style="padding:7px 10px;text-align:center;color:#9ca3af;font-size:10px;">Год.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:5px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:6px;">🔗 Линк за редакция</div>
      <div style="font-size:11px;color:#78716c;margin-bottom:11px;line-height:1.5;">
        Можеш да редактираш данните или да потвърдиш участието. Валиден до ${evFmt}.
      </div>
      <a href="${editUrl}"
        style="display:inline-block;background:#c8a84b;color:#0d1109;padding:9px 18px;
               border-radius:3px;text-decoration:none;font-size:11px;font-weight:700;">
        Отвори записването →
      </a>
    </div>

    <p style="margin:0;font-size:10px;color:#9ca3af;">
      Ако не си попълвал/а тази форма — игнорирай имейла.
    </p>
  </td></tr>

  <tr><td style="background:#f9fafb;padding:14px 32px;border-top:1px solid #e5e7eb;
                 text-align:center;font-size:10px;color:#9ca3af;">
    ${event} · ${evFmt}
  </td></tr>

</table></td></tr></table>
</body></html>`;

    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
	  method: 'POST',
	  headers: {
		'api-key': BREVO,
		'Content-Type': 'application/json',
	  },
	  body: JSON.stringify({
		sender:  { email: FROM },          // your verified Gmail
		to:      [{ email: head.email }],
		subject: `Записване — ${event} (${total} уч.)`,
		htmlContent: html,
	  }),
	});

    if (!r.ok) { console.error('Brevo:', await r.text()); return new Response('email error',{status:500}); }
    console.log(`Email → ${head.email} | reg ${id}`);
    return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}});

  } catch(e) {
    console.error(e);
    return new Response('error',{status:500});
  }
});
