import { supabase } from "../lib/db.js";

export default async function handler(req, res) {
  const env = process.env;
  const checks = {
    node: process.version,
    SUPABASE_URL: !!env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE: !!env.SUPABASE_SERVICE_ROLE,
    DISCORD_WEBHOOK_URL: !!env.DISCORD_WEBHOOK_URL,
    CRON_SECRET: !!env.CRON_SECRET,
    VERCEL_ENV: env.VERCEL_ENV || 'local',
  };

  let tableOk = false, symbolsOk = false, uniqueKeyOk = false;
  try { const { error } = await supabase.from('events').select('id').limit(1); tableOk = !error; } catch {}
  try { const { error } = await supabase.from('events').select('symbols').limit(1); symbolsOk = !error; } catch {}
  try { const { error } = await supabase.from('events').select('source,source_id').limit(1); uniqueKeyOk = !error; } catch {}

  const advice = [];
  if (!checks.DISCORD_WEBHOOK_URL) advice.push('Set DISCORD_WEBHOOK_URL to enable high-impact alerts.');
  if (!checks.CRON_SECRET) advice.push('Set CRON_SECRET to protect /api/ingest cron endpoint.');

  return res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    env: checks,
    db: { eventsTable: !!tableOk, symbolsField: !!symbolsOk, uniqueKeyReadable: !!uniqueKeyOk },
    advice
  });
}