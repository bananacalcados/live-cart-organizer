/**
 * routing-log.ts — Persistent diagnostic logging for incoming WhatsApp webhook
 * instance resolution.
 *
 * Every incoming message webhook should call `logRouting` so we can audit HOW
 * the receiving instance (whatsapp_number_id) was decided. This lets us catch
 * cross-instance misattribution in the act (e.g. a customer reply landing on the
 * wrong store inbox because resolution fell back to a query param or default).
 *
 * Pure helper module (_shared), NOT an Edge Function.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type RoutingProvider = "meta" | "zapi" | "uazapi" | "wasender";

export type ResolutionMethod =
  | "phone_number_id"
  | "display_phone_number"
  | "instanceId"
  | "connectedPhone"
  | "owner"
  | "token"
  | "query_param"
  | "none";

export interface RoutingLogInput {
  provider: RoutingProvider;
  senderPhone?: string | null;
  resolutionMethod: ResolutionMethod;
  resolvedWhatsappNumberId?: string | null;
  rawIdentifier?: string | null;
  matched: boolean;
  rawPayload?: unknown;
}

/**
 * Fire-and-forget insert into webhook_routing_log. Never throws — diagnostics
 * must never break message processing.
 */
export async function logRouting(
  supabase: SupabaseClient,
  input: RoutingLogInput,
): Promise<void> {
  try {
    await supabase.from("webhook_routing_log").insert({
      provider: input.provider,
      sender_phone: input.senderPhone ?? null,
      resolution_method: input.resolutionMethod,
      resolved_whatsapp_number_id: input.resolvedWhatsappNumberId ?? null,
      raw_identifier: input.rawIdentifier ?? null,
      matched: input.matched,
      raw_payload: input.rawPayload ?? null,
    });
    if (!input.matched) {
      console.warn(
        `[routing-log] UNRESOLVED ${input.provider} message from ${input.senderPhone ?? "?"} ` +
          `(method=${input.resolutionMethod}, id=${input.rawIdentifier ?? "?"}) — saved with NULL instance`,
      );
    } else if (input.resolutionMethod === "query_param" && input.provider !== "wasender") {
      // WaSender legitimately uses a per-instance ?number_id= param, so it is not
      // suspect there. For zapi/uazapi the param is a shared/last-resort fallback.
      console.warn(
        `[routing-log] SUSPECT ${input.provider} message from ${input.senderPhone ?? "?"} ` +
          `resolved via query_param fallback → ${input.resolvedWhatsappNumberId}`,
      );
    }
  } catch (err) {
    console.error("[routing-log] failed to write diagnostic row:", err);
  }
}
