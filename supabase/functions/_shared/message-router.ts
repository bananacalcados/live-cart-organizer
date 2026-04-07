/**
 * Message Router — Central routing decision for all incoming WhatsApp messages.
 *
 * Evaluates the current state (AI paused, active sessions, ad referral, etc.)
 * and returns a routing decision so the webhook can dispatch to the right agent.
 *
 * This is a pure function module (_shared), NOT an Edge Function.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const AI_MESSAGE_PREFIX_REGEX = /^\[IA(?:-[A-Z]+)?\]\s*/i;
const AUTOMATED_DUPLICATE_WINDOW_MS = 15_000;

function isAiTaggedMessage(message: string | null | undefined): boolean {
  return AI_MESSAGE_PREFIX_REGEX.test((message || '').trim());
}

function normalizeAutomatedMessage(message: string | null | undefined): string {
  return (message || '')
    .replace(AI_MESSAGE_PREFIX_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type RouteAgent =
  | 'none'           // human assumed control or AI paused
  | 'livete'         // live commerce agent
  | 'continue_session' // existing AI session (generic automation)
  | 'ads'            // lead from ad click-to-WhatsApp
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
  /** Ad campaign ID when agent is 'ads' */
  adCampaignId?: string;
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
  const normalizedPhone = phone.replace(/\D/g, '');

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

  // 3. Check for ad referral (Click-to-WhatsApp) OR ad keyword match
  if (referral && referral.source_url) {
    // Check if there's an active ad campaign matching by keyword
    const matchedCampaign = await matchAdCampaign(supabase, input.messageText);
    if (matchedCampaign) {
      console.log(`[router] Ad referral + campaign match for ${phone}, campaign=${matchedCampaign.name}`);
      return { agent: 'ads', reason: 'ad_referral_campaign', referral, adCampaignId: matchedCampaign.id };
    }
    // Fallback: if referral present but no keyword match, try any active campaign
    const fallbackCampaign = await findAnyActiveCampaign(supabase);
    if (fallbackCampaign) {
      console.log(`[router] Ad referral fallback to campaign ${fallbackCampaign.name} for ${phone}`);
      return { agent: 'ads', reason: 'ad_referral_fallback', referral, adCampaignId: fallbackCampaign.id };
    }
    console.log(`[router] Ad referral detected for ${phone}, no campaign match`);
    return { agent: 'legacy', reason: 'ad_referral_legacy', referral };
  }

  // 3b. Check ad keywords even without referral (user may type the keyword directly)
  {
    const matchedCampaign = await matchAdCampaign(supabase, input.messageText);
    if (matchedCampaign) {
      console.log(`[router] Ad keyword match for ${phone}, campaign=${matchedCampaign.name}`);
      return { agent: 'ads', reason: 'ad_keyword_match', adCampaignId: matchedCampaign.id };
    }
  }

  // 3c. Check if lead already has an active ad session (continue conversation)
  {
    const { data: activeLead } = await supabase
      .from('ad_leads')
      .select('id, campaign_id')
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .neq('temperature', 'convertido')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeLead?.campaign_id) {
      // Check if last AI contact was within 2 hours (active conversation)
      const { data: recentLog } = await supabase
        .from('ai_conversation_logs')
        .select('created_at')
        .eq('phone', phone)
        .like('stage', 'ads_%')
        .gt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (recentLog) {
        console.log(`[router] Active ad lead session for ${phone}`);
        return { agent: 'ads', reason: 'active_ad_lead', adCampaignId: activeLead.campaign_id };
      }
    }
  }

  // 4. Operator cooldown — if a human replied recently, don't activate AI
  const cooldownActive = await isOperatorCooldownActive(supabase, phone, 10);
  if (cooldownActive) {
    console.log(`[router] Operator cooldown active for ${phone}, skipping AI`);
    return { agent: 'none', reason: 'operator_cooldown' };
  }

  // 5. Check concierge mode — production (all phones) or test (single phone)
  let conciergeTestMode = false;
  let conciergeProductionMode = false;
  let conciergeTestPhone: string | null = null;
  try {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['concierge_test_mode', 'concierge_test_phone', 'concierge_production_mode']);
    if (settings) {
      for (const s of settings) {
        if (s.key === 'concierge_test_mode') conciergeTestMode = s.value === true || s.value === 'true';
        if (s.key === 'concierge_test_phone') conciergeTestPhone = String(s.value || '').replace(/"/g, '');
        if (s.key === 'concierge_production_mode') conciergeProductionMode = s.value === true || s.value === 'true';
      }
    }
  } catch (err) {
    console.error('[router] Error checking concierge settings:', err);
  }

  const conciergeAvailableForPhone = (() => {
    // Production mode: Bia responds to everyone
    if (conciergeProductionMode) return true;
    // Test mode: Bia responds only to the test phone
    if (!conciergeTestMode || !conciergeTestPhone) return false;
    const phoneSuffix = normalizedPhone.slice(-8);
    const testSuffix = conciergeTestPhone.replace(/\D/g, '').slice(-8);
    return phoneSuffix === testSuffix;
  })();

  // 6. Continue recent concierge conversations even when the follow-up message
  // no longer contains support keywords (e.g. CPF, name, yes/no confirmation).
  if (conciergeAvailableForPhone) {
    try {
      const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: recentConciergeLog } = await supabase
        .from('ai_conversation_logs')
        .select('created_at')
        .eq('phone', phone)
        .eq('stage', 'concierge')
        .gt('created_at', recentCutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentConciergeLog) {
        console.log(`[router] Recent concierge context found for ${phone}`);
        return { agent: 'concierge', reason: 'recent_concierge_context' };
      }
    } catch (err) {
      console.error('[router] Error checking recent concierge context:', err);
    }
  }

  // 7. Intent pre-classification for Concierge
  const msgLower = (input.messageText || '').toLowerCase().trim();

  // Sales-related keywords → legacy (human seller handles it)
  const salesKeywords = [
    'valor', 'preço', 'preco', 'quanto custa', 'quanto é', 'quanto e',
    'tem o', 'tem na', 'tem no', 'tem esse', 'tem essa', 'tem disponível',
    'foto', 'fotos', 'imagem', 'imagens', 'catálogo', 'catalogo',
    'modelo', 'modelos', 'comprar', 'quero comprar', 'encomenda',
    'tamanho', 'numeração', 'numeracao', 'número', 'numero',
    'cor ', 'cores', 'qual cor', 'promoção', 'promocao', 'desconto',
    'parcela', 'parcelas', 'pix', 'cartão', 'cartao',
    'frete pra', 'frete para', 'entrega pra', 'entrega para',
    'novidade', 'novidades', 'lançamento', 'lancamento',
  ];

  // Support/tracking keywords → concierge
  const supportKeywords = [
    'rastreio', 'rastrear', 'rastreamento', 'código de rastreio',
    'cadê meu pedido', 'cade meu pedido', 'meu pedido', 'onde está',
    'onde esta', 'entrega', 'chegou', 'não chegou', 'nao chegou',
    'troca', 'trocar', 'defeito', 'defeituoso', 'quebrado', 'quebrou',
    'devolver', 'devolução', 'devoluçao', 'devolucao', 'estragou',
    'reclamação', 'reclamacao', 'problema', 'errado', 'veio errado',
    'suporte', 'ajuda', 'atendimento',
    'nota fiscal', 'nf', 'cupom fiscal',
    'cancelar', 'cancelamento', 'estorno', 'reembolso',
  ];

  const isSalesIntent = salesKeywords.some(kw => msgLower.includes(kw));
  const isSupportIntent = supportKeywords.some(kw => msgLower.includes(kw));

  // Support intent takes priority; if both detected, route to concierge
  if (isSupportIntent) {
    // Only route to concierge if test mode is on AND phone matches test phone
    if (conciergeAvailableForPhone) {
      console.log(`[router] Support intent + concierge available for ${phone}`);
      return { agent: 'concierge', reason: 'support_intent' };
    }
    // Concierge not available for this phone → legacy
    console.log(`[router] Support intent for ${phone} but concierge not available, routing to legacy`);
    return { agent: 'legacy', reason: 'concierge_not_available' };
  }

  if (isSalesIntent) {
    console.log(`[router] Sales intent detected for ${phone}, routing to legacy (human seller)`);
    return { agent: 'legacy', reason: 'sales_intent' };
  }

  // 8. Default: greetings and unclassified → legacy (human handles)
  console.log(`[router] Unclassified message for ${phone}, routing to legacy`);
  return { agent: 'legacy', reason: 'default_unclassified' };
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
    const { data: recentOutgoing } = await supabase
      .from('whatsapp_messages')
      .select('id, message, created_at')
      .eq('phone', phone)
      .eq('direction', 'outgoing')
      .gt('created_at', cooldownCutoff)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!recentOutgoing?.length) return false;

    const taggedAutomations = recentOutgoing
      .filter((msg) => isAiTaggedMessage(msg.message))
      .map((msg) => ({
        createdAt: new Date(msg.created_at).getTime(),
        normalizedMessage: normalizeAutomatedMessage(msg.message),
      }));

    const recentManual = recentOutgoing.find((msg) => {
      if (isAiTaggedMessage(msg.message)) return false;

      const normalizedMessage = normalizeAutomatedMessage(msg.message);
      const createdAt = new Date(msg.created_at).getTime();

      const duplicatedAutomation = taggedAutomations.some((automation) =>
        automation.normalizedMessage === normalizedMessage
        && Math.abs(automation.createdAt - createdAt) <= AUTOMATED_DUPLICATE_WINDOW_MS
      );

      return !duplicatedAutomation;
    });

    return Boolean(recentManual);
  } catch (err) {
    console.error('[router] Error checking operator cooldown:', err);
    return false; // Don't block AI on error
  }
}

// ─── Helper: Match ad campaign by keyword ────────────────────────────────────

async function matchAdCampaign(
  supabase: SupabaseClient,
  messageText: string | null
): Promise<{ id: string; name: string } | null> {
  if (!messageText) return null;

  try {
    const { data: campaigns } = await supabase
      .from('ad_campaigns_ai')
      .select('id, name, activation_keywords')
      .eq('is_active', true);

    if (!campaigns || campaigns.length === 0) return null;

    const msgLower = messageText.toLowerCase().trim();
    for (const c of campaigns) {
      const keywords = c.activation_keywords || [];
      if (keywords.some((kw: string) => msgLower.includes(kw.toLowerCase()))) {
        return { id: c.id, name: c.name };
      }
    }
  } catch (err) {
    console.error('[router] Error matching ad campaign:', err);
  }
  return null;
}
