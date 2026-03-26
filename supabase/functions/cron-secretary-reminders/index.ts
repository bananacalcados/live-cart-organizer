import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveZApiCredentials, normalizePhone } from "../_shared/zapi-credentials.ts";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const currentDay = brNow.getDay();
    const currentHour = brNow.getHours();

    // 1. Process one-time reminders that are due
    const { data: dueReminders } = await supabase
      .from('secretary_reminders')
      .select('*')
      .eq('is_completed', false)
      .lte('remind_at', now.toISOString());

    if (dueReminders && dueReminders.length > 0) {
      for (const reminder of dueReminders) {
        try {
          const creds = await resolveZApiCredentials(reminder.whatsapp_number_id);
          const phone = normalizePhone(reminder.phone);
          const message = `🔔 *Lembrete da Secretária Virtual*\n\n*${reminder.title}*\n${reminder.description || ''}\n\n⏰ Agendado para: ${new Date(reminder.remind_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

          await fetch(`https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/send-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Client-Token': creds.clientToken },
            body: JSON.stringify({ phone, message }),
          });

          if (reminder.reminder_type === 'one_time') {
            await supabase.from('secretary_reminders')
              .update({ is_completed: true, completed_at: now.toISOString(), last_reminded_at: now.toISOString() })
              .eq('id', reminder.id);
          } else {
            // For recurring, set next remind_at
            const nextDate = new Date(reminder.remind_at);
            if (reminder.reminder_type === 'daily') nextDate.setDate(nextDate.getDate() + 1);
            else if (reminder.reminder_type === 'weekly') nextDate.setDate(nextDate.getDate() + 7);

            await supabase.from('secretary_reminders')
              .update({ remind_at: nextDate.toISOString(), last_reminded_at: now.toISOString() })
              .eq('id', reminder.id);
          }

          console.log(`Sent reminder: ${reminder.title} to ${reminder.phone}`);
        } catch (e) {
          console.error(`Failed to send reminder ${reminder.id}:`, e);
        }
      }
    }

    // 2. Weekly digest - check if any user has their weekly reminder set for now
    const { data: settings } = await supabase
      .from('secretary_settings')
      .select('*')
      .eq('is_active', true)
      .eq('weekly_reminder_day', currentDay)
      .eq('weekly_reminder_hour', currentHour);

    if (settings && settings.length > 0) {
      for (const s of settings) {
        if (!s.reminder_phone) continue;

        try {
          // Get accounts payable for this week and next week
          const today = brNow.toISOString().split('T')[0];
          const nextWeek = new Date(brNow);
          nextWeek.setDate(nextWeek.getDate() + 14);
          const nextWeekStr = nextWeek.toISOString().split('T')[0];

          const { data: accounts } = await supabase
            .from('tiny_accounts_payable')
            .select('nome_fornecedor, valor, data_vencimento, situacao, categoria')
            .eq('situacao', 'aberto')
            .gte('data_vencimento', today)
            .lte('data_vencimento', nextWeekStr)
            .order('data_vencimento', { ascending: true });

          if (!accounts || accounts.length === 0) continue;

          // Split into this week and next week
          const endOfWeek = new Date(brNow);
          endOfWeek.setDate(endOfWeek.getDate() + 7);
          const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

          const thisWeek = accounts.filter(a => a.data_vencimento && a.data_vencimento <= endOfWeekStr);
          const nextWeekAccounts = accounts.filter(a => a.data_vencimento && a.data_vencimento > endOfWeekStr);

          let message = `📋 *Resumo Semanal - Contas a Pagar*\n`;

          if (thisWeek.length > 0) {
            const totalThis = thisWeek.reduce((s, a) => s + (a.valor || 0), 0);
            message += `\n*🔴 Esta semana (${thisWeek.length} contas = R$ ${totalThis.toFixed(2)}):*\n`;
            for (const a of thisWeek) {
              const dt = a.data_vencimento ? new Date(a.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '?';
              message += `• ${a.nome_fornecedor} - R$ ${(a.valor || 0).toFixed(2)} (vence ${dt})\n`;
            }
          }

          if (nextWeekAccounts.length > 0) {
            const totalNext = nextWeekAccounts.reduce((s, a) => s + (a.valor || 0), 0);
            message += `\n*🟡 Próxima semana (${nextWeekAccounts.length} contas = R$ ${totalNext.toFixed(2)}):*\n`;
            for (const a of nextWeekAccounts) {
              const dt = a.data_vencimento ? new Date(a.data_vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '?';
              message += `• ${a.nome_fornecedor} - R$ ${(a.valor || 0).toFixed(2)} (vence ${dt})\n`;
            }
          }

          message += `\n_Enviado pela Secretária Virtual 🤖_`;

          const creds = await resolveZApiCredentials(s.whatsapp_number_id);
          const phone = normalizePhone(s.reminder_phone);

          await fetch(`https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/send-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Client-Token': creds.clientToken },
            body: JSON.stringify({ phone, message }),
          });

          console.log(`Sent weekly digest to ${s.reminder_phone}`);
        } catch (e) {
          console.error(`Failed to send weekly digest:`, e);
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      reminders_processed: dueReminders?.length || 0,
      digests_sent: settings?.length || 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Cron secretary error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
