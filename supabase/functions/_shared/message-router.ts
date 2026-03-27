/**
 * Message Router — Central routing decision for all incoming WhatsApp messages.
 *
 * Evaluates the current state (AI paused, active sessions, ad referral, etc.)
 * and returns a routing decision so the webhook can dispatch to the right agent.
 *
 * This is a pure function module (_shared), NOT an Edge Function.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RouteAgent =
  | 'none'           // human assumed control or AI paused
  | 'livete'         // live commerce agent
  | 'continue_session' // existing AI session (generic automation)
  | 'ads'            // lead from ad click-to-WhatsApp (future)
  | 'concierge'      // default general agent (future)
  | 'legacy';        // fallback to current automation-trigger-incoming behavior

export interface RouteResult {
  agent: RouteAgent;
  reason: string;
  /** Active AI session data when agent is 'livete' or 'continue_session' */
  session?: {
    id: string;
    prompt: string | null;
    whatsapp_number_id: string | null;
    max_messages: number | null;
    messages_sent: number | null;
    flow_id: string | null;
  };
  /** Referral data when agent is 'ads' */
  referral?: Record<string, unknown>;
}

export interface RouteInput {
  phone: string;
  messageText: string | null;
  isGroup: boolean;
  /** Meta ad referral object (from msg.referral) */
  referral?: Record<string, unknown> | null;
  /** The whatsapp_number_id that received the message */
  whatsappNumberId?: string | null;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function routeMessage(
  supabase: SupabaseClient,
  input: RouteInput
): Promise<RouteResult> {
  const { phone, isGroup, referral } = input;

  // 0. Groups → no agent routing (handled separately by group logic)
  if (isGroup) {
    return { agent: 'none', reason: 'group_message' };
  }

  // 1. Check if AI is paused for this phone (human assumed control)
  try {
    const { data: pausedData } = await supabase
      .rpc('check_order_ai_paused', { p_phone: phone });

    if (pausedData && Array.isArray(pausedData) && pausedData.length > 0 && pausedData[0]?.ai_paused) {
      console.log(`[router] AI paused for ${phone}, skipping all agents`);
      return { agent: 'none', reason: 'ai_paused' };
    }
    // Also handle single-row return
    if (pausedData && !Array.isArray(pausedData) && (pausedData as any).ai_paused) {
      console.log(`[router] AI paused for ${phone}, skipping all agents`);
      return { agent: 'none', reason: 'ai_paused' };
    }
  } catch (err) {
    console.error('[router] Error checking ai_paused:', err);
    // Continue — don't block on error
  }

  // 2. Check for active AI session
  try {
    const { data: aiSession } = await supabase
      .from('automation_ai_sessions')
      .select('id, prompt, whatsapp_number_id, max_messages, messages_sent, flow_id')
      .eq('phone', phone)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (aiSession) {
      const session = {
        id: aiSession.id,
        prompt: aiSession.prompt,
        whatsapp_number_id: aiSession.whatsapp_number_id,
        max_messages: aiSession.max_messages,
        messages_sent: aiSession.messages_sent,
        flow_id: aiSession.flow_id,
      };

      // 2a. Livete checkout session
      if (aiSession.prompt?.startsWith('livete_checkout:')) {
        console.log(`[router] Livete session active for ${phone}`);
        return { agent: 'livete', reason: 'active_livete_session', session };
      }

      // 2b. Generic AI session (automation-ai-respond)
      console.log(`[router] AI session active for ${phone}`);
      return { agent: 'continue_session', reason: 'active_ai_session', session };
    }
  } catch (err) {
    console.error('[router] Error checking AI session:', err);
  }

  // 3. Check for ad referral (Click-to-WhatsApp)
  if (referral && referral.source_url) {
    console.log(`[router] Ad referral detected for ${phone}`);
    // For now, route to legacy (automation-trigger-incoming handles it)
    // Future: return { agent: 'ads', reason: 'ad_referral', referral };
    return { agent: 'legacy', reason: 'ad_referral_legacy', referral };
  }

  // 4. Default: Concierge agent handles organic leads
  return { agent: 'concierge', reason: 'default' };
}

// ─── Helper: Operator cooldown check ─────────────────────────────────────────

/**
 * Returns true if a human operator sent a message to this phone recently,
 * meaning AI should NOT respond.
 */
export async function isOperatorCooldownActive(
  supabase: SupabaseClient,
  phone: string,
  cooldownMinutes = 10
): Promise<boolean> {
  try {
    const cooldownCutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();
    const { data: recentManual } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'outgoing')
      .gt('created_at', cooldownCutoff)
      .not('message', 'ilike', '%[IA]%')
      .limit(1);

    return !!(recentManual && recentManual.length > 0);
  } catch (err) {
    console.error('[router] Error checking operator cooldown:', err);
    return false; // Don't block AI on error
  }
}
