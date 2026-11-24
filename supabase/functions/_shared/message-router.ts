/**
 * Message Router — Central routing decision for all incoming WhatsApp messages.
 *
 * Evaluates the current state (AI paused, active sessions, ad referral, etc.)
 * and returns a routing decision so the webhook can dispatch to the right agent.
 *
 * This is a pure function module (_shared), NOT an Edge Function.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resumeAutomationWait } from "./automation-wait-response.ts";
import { handleIncomingOptOut } from "./opt-out.ts";


const AI_MESSAGE_PREFIX_REGEX = /^\[IA(?:-[A-Z]+)?\]\s*/i;
const AUTOMATED_DUPLICATE_WINDOW_MS = 120_000; // 2 min — Z-API echo can arrive with significant delay

function isAiTaggedMessage(message: string | null | undefined): boolean {
  return AI_MESSAGE_PREFIX_REGEX.test((message || '').trim());
}

function normalizeAutomatedMessage(message: string | null | undefined): string {
  return (message || '')
    .replace(AI_MESSAGE_PREFIX_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns all phone variants for DB queries.
 * Messages can be stored as "5561999..." or "61999..." — we need to search both.
 */
function getPhoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  const variants = new Set<string>();
  variants.add(phone);
  variants.add(digits);
  // If starts with 55 and has 12-13 digits, also add without country code
  if (digits.startsWith('55') && digits.length >= 12) {
    variants.add(digits.slice(2));
  }
  // If doesn't start with 55, also add with country code
  if (!digits.startsWith('55') && digits.length >= 10) {
    variants.add('55' + digits);
  }
  return Array.from(variants);
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
  const { phone, isGroup, referral, whatsappNumberId } = input;
  const normalizedPhone = phone.replace(/\D/g, '');

  // 0. Groups → no agent routing (handled separately by group logic)
  if (isGroup) {
    return { agent: 'none', reason: 'group_message' };
  }

  // 0a. Opt-out real ("PARAR") — registra o descadastro cross-instância, limpa a
  // fila pendente do contato e encerra qualquer sessão de IA ativa.
  try {
    const { optedOut, keyword } = await handleIncomingOptOut(
      supabase as unknown as Parameters<typeof handleIncomingOptOut>[0],
      phone,
      input.messageText,
      whatsappNumberId ?? null,
    );
    if (optedOut) {
      console.log(`[router] opt-out de ${phone} via "${keyword}" — nenhum agente acionado`);
      return { agent: 'none', reason: 'opted_out' };
    }
  } catch (err) {
    console.error('[router] erro ao processar opt-out:', err);
  }



  try {
    // Reação (Meta manda como "[reação: 😍]"): só segue o ramo "reagiu" se ele existir;
    // reação nunca conta como resposta. Reação removida (emoji vazio) é ignorada.
    const reaction = /^\[reação: (.*)\]$/.exec(String(input.messageText || '').trim());
    if (reaction) {
      if (reaction[1] && await resumeAutomationWait(supabase, phone, whatsappNumberId, 'reacted')) {
        return { agent: 'none', reason: 'wait_reaction_continued' };
      }
    } else if (await resumeAutomationWait(supabase, phone, whatsappNumberId)) {
      return { agent: 'none', reason: 'wait_reply_continued' };
    }
  } catch (error) {
    console.error('[router] wait reply continuation failed:', error);
    return { agent: 'none', reason: 'wait_reply_error' };
  }

  // 0b. Check if the WhatsApp instance has AI globally paused (e.g. Ravena)
  if (whatsappNumberId) {
    try {
      const { data: numberRow } = await supabase
        .from('whatsapp_numbers')
        .select('ai_paused, label')
        .eq('id', whatsappNumberId)
        .maybeSingle();
      if (numberRow?.ai_paused) {
        console.log(`[router] AI paused for whole instance ${numberRow.label} (${whatsappNumberId}), skipping all agents`);
        return { agent: 'none', reason: 'instance_ai_paused' };
      }
    } catch (err) {
      console.error('[router] Error checking instance ai_paused:', err);
    }
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
    // Fallback: referral present but no keyword match → route to legacy (human/automation handles it)
    // Previously this activated any active ad campaign, causing unwanted AI responses on ad leads
    console.log(`[router] Ad referral detected for ${phone} but no keyword match, routing to legacy`);
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

  // 4. Operator cooldown — if a human replied recently, don't activate AI (48h window)
  const phoneVariants = getPhoneVariants(phone);
  const cooldownActive = await isOperatorCooldownActive(supabase, phoneVariants, 2880);
  if (cooldownActive) {
    console.log(`[router] Operator cooldown active for ${phone}, skipping AI`);
    return { agent: 'none', reason: 'operator_cooldown' };
  }

  // 4b. Mass-dispatch reply gate — if the most recent outgoing message to this
  // contact (last 48h) was a mass dispatch (broadcast/campanha), the customer's
  // reply is likely a short reaction to the broadcast and Bia gets confused
  // ("ué", "obrigado", "para", "ok", emojis…). Hand off to a human.
  try {
    const massCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: lastOutgoing } = await supabase
      .from('whatsapp_messages')
      .select('is_mass_dispatch, created_at')
      .in('phone', phoneVariants)
      .eq('direction', 'outgoing')
      .gt('created_at', massCutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOutgoing?.is_mass_dispatch) {
      console.log(`[router] Last outgoing was mass dispatch for ${phone}, skipping AI (human handoff)`);
      return { agent: 'none', reason: 'mass_dispatch_reply' };
    }
  } catch (err) {
    console.error('[router] Error checking mass-dispatch gate:', err);
  }

  // 5. Intent pre-classification. The concierge was retired while disabled;
  // support messages keep following the exact same legacy path as before.
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

  // Support/tracking keywords → legacy support flow
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

  // Support intent takes priority over sales intent. Keep the previous reason
  // so existing webhook logs and fallback handling remain unchanged.
  if (isSupportIntent) {
    console.log(`[router] Support intent for ${phone}, routing to legacy`);
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
  phoneOrVariants: string | string[],
  cooldownMinutes = 2880
): Promise<boolean> {
  try {
    const variants = Array.isArray(phoneOrVariants)
      ? phoneOrVariants
      : getPhoneVariants(phoneOrVariants);

    // Use a 48h window to detect any human interaction
    const cooldownCutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();
    const { data: recentOutgoing } = await supabase
      .from('whatsapp_messages')
      .select('id, message, created_at')
      .in('phone', variants)
      .eq('direction', 'outgoing')
      .gt('created_at', cooldownCutoff)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!recentOutgoing?.length) return false;

    const taggedAutomations = recentOutgoing
      .filter((msg) => isAiTaggedMessage(msg.message))
      .map((msg) => ({
        createdAt: new Date(msg.created_at).getTime(),
        normalizedMessage: normalizeAutomatedMessage(msg.message),
      }));

    // Find the most recent manual (human) message
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

    if (!recentManual) return false;

    const manualAt = new Date(recentManual.created_at).getTime();

    // Check if there was a bidirectional exchange (human sent + customer replied)
    // If so, use the full 48h cooldown. Otherwise, use a shorter 2h cooldown.
    const { data: recentIncoming } = await supabase
      .from('whatsapp_messages')
      .select('id, created_at')
      .in('phone', variants)
      .eq('direction', 'incoming')
      .gt('created_at', cooldownCutoff)
      .order('created_at', { ascending: false })
      .limit(5);

    const hasBidirectional = recentIncoming?.some((inc) => {
      const incAt = new Date(inc.created_at).getTime();
      // Customer replied AFTER the human message, completing the bidirectional exchange
      return incAt > manualAt;
    });

    if (hasBidirectional) {
      // Full 48h cooldown — human is actively managing this conversation
      console.log(`[router] Bidirectional human exchange detected for ${variants[0]}, 48h cooldown active`);
      return true;
    }

    // Shorter 2h cooldown for single manual message (no customer reply yet)
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const isWithinShortCooldown = (Date.now() - manualAt) < twoHoursMs;
    if (isWithinShortCooldown) {
      console.log(`[router] Recent manual message for ${variants[0]}, 2h cooldown active`);
    }
    return isWithinShortCooldown;
  } catch (err) {
    console.error('[router] Error checking operator cooldown:', err);
    return false; // Don't block AI on error
  }
}

// ─── Helper: Find any active ad campaign (fallback for referral without keyword match) ─

async function findAnyActiveCampaign(
  supabase: SupabaseClient
): Promise<{ id: string; name: string } | null> {
  try {
    const { data } = await supabase
      .from('ad_campaigns_ai')
      .select('id, name')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    return data ? { id: data.id, name: data.name } : null;
  } catch (err) {
    console.error('[router] Error finding fallback campaign:', err);
    return null;
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
