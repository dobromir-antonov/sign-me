
/*** DEPLOY AS SUPABASE EDGE FUNCTION ***/

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
      <tr style="border-bottom:1px solid #e8e5de;">
        <td style="padding:8px 12px;color:#9ba89a;font-size:11px;">${i+1}</td>
        <td style="padding:8px 12px;font-weight:${p.is_head?'600':'400'};font-size:13px;color:#1a1f17;">
          ${p.name}${p.is_head?' <span style="color:#3a6b3a;font-size:10px;letter-spacing:.05em;text-transform:uppercase;">(орг.)</span>':''}
        </td>
        <td style="padding:8px 12px;font-family:monospace;font-size:11px;color:#6b7468;">${p.egn}</td>
        <td style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7468;">${p.age??'—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 14px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0"
  style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.08);border:1px solid #ddd9d0;">

  <!-- Header -->
  <tr><td style="background:#3a6b3a;padding:36px 32px;text-align:center;">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.65);font-weight:300;margin-bottom:8px;">
      Потвърждение за записване</div>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:.02em;">${event}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:6px;font-weight:300;">${evFmt}</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px;">

    <p style="margin:0 0 8px;color:#1a1f17;font-size:15px;">
      Здравей, <strong style="font-weight:600;">${head.name}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#6b7468;font-size:13px;line-height:1.6;">
      Записването е получено успешно. Записани са <strong style="color:#1a1f17;">${total} участник${total!==1?'а':''}</strong>.
      <br/>
      Референтен номер: <span style="background:#f5f4f0;padding:2px 7px;border-radius:4px;font-family:monospace;font-size:11px;color:#6b7468;border:1px solid #ddd9d0;">${id.slice(0,8).toUpperCase()}</span>
    </p>

    <!-- Participants section -->
    <div style="margin-bottom:24px;">
      <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#3a6b3a;font-weight:600;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e8e5de;">
        <span style="display:inline-block;width:3px;height:12px;background:#3a6b3a;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>Участници
      </div>
      <table width="100%" cellpadding="0" cellspacing="0"
        style="border:1px solid #ddd9d0;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f9f8f5;">
            <th style="padding:8px 12px;text-align:left;color:#9ba89a;font-size:10px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;">#</th>
            <th style="padding:8px 12px;text-align:left;color:#9ba89a;font-size:10px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;">Три имена</th>
            <th style="padding:8px 12px;text-align:left;color:#9ba89a;font-size:10px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;">ЕГН</th>
            <th style="padding:8px 12px;text-align:center;color:#9ba89a;font-size:10px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;">Год.</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Edit link section -->
    <div style="background:#edf4ed;border:1px solid #a8c9a8;border-radius:6px;padding:16px 18px;margin-bottom:24px;">
      <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#3a6b3a;font-weight:600;margin-bottom:6px;">
        <span style="display:inline-block;width:3px;height:10px;background:#3a6b3a;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>Линк за редакция
      </div>
      <div style="font-size:12px;color:#6b7468;margin-bottom:14px;line-height:1.6;">
        Можеш да редактираш данните или да потвърдиш участието. Валиден до ${evFmt}.
      </div>
      <a href="${editUrl}"
        style="display:inline-block;background:#3a6b3a;color:#ffffff;padding:10px 20px;
               border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;
               letter-spacing:.03em;">
        Отвори записването →
      </a>
    </div>

    <p style="margin:0;font-size:11px;color:#9ba89a;line-height:1.6;">
      Ако не си попълвал/а тази форма — игнорирай имейла.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9f8f5;padding:14px 32px;border-top:1px solid #e8e5de;
                 text-align:center;font-size:10px;color:#9ba89a;letter-spacing:.05em;">
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
