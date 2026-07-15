// supabase/functions/send-reminders/index.ts
// Gira ogni 15 minuti (chiamata da pg_cron, vedi setup_cron.sql).
// Trova gli eventi che rientrano nelle prossime 24h e non ancora notificati,
// invia una notifica push a tutti i dispositivi sottoscritti dall'utente,
// poi segna l'evento come notificato per non rimandarla.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@example.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (_req) => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3600 * 1000);

    // Eventi attivi, non ancora notificati, la cui data/ora cade entro le prossime 24h
    const { data: events, error } = await sb
      .from('events')
      .select('id, user_id, name, date, time')
      .is('deleted_at', null)
      .eq('notified_24h', false)
      .gte('date', now.toISOString().slice(0, 10));

    if (error) throw error;

    const dueEvents = (events || []).filter(ev => {
      const target = new Date(`${ev.date}T${ev.time}`);
      return target > now && target <= in24h;
    });

    let sent = 0, failed = 0;

    for (const ev of dueEvents) {
      const { data: subs } = await sb
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', ev.user_id);

      const target = new Date(`${ev.date}T${ev.time}`);
      const payload = JSON.stringify({
        title: 'Promemoria: ' + ev.name,
        body: `Manca meno di 24 ore — ${target.toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}`
      });

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sent++;
        } catch (err) {
          failed++;
          // Sottoscrizione scaduta/non valida -> la rimuoviamo
          if (err.statusCode === 404 || err.statusCode === 410) {
            await sb.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
      }

      await sb.from('events').update({ notified_24h: true }).eq('id', ev.id);
    }

    return new Response(JSON.stringify({ checked: dueEvents.length, sent, failed }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
