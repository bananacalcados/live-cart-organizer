import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Normalize a phone number for Z-API:
 * - Strip all non-digit characters
 * - Skip group IDs (contain @ or '-' or start with '120')
 * - Brazilian numbers (10-11 local digits, or 12-13 starting with 55): ensure '55' prefix
 * - International non-BR numbers (12+ digits NOT starting with 55): return as-is, do NOT prepend '55'
 */
export function normalizePhone(phone: string): string {
  if (!phone) return phone;
  // Don't touch group IDs
  if (phone.includes('@') || phone.includes('-')) return phone;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('120')) return digits; // group

  // BR with DDI already present (12 landline / 13 mobile starting with 55) — keep
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // Local BR format (10 or 11 digits, no DDI) — prepend 55
  if (digits.length >= 10 && digits.length <= 11) {
    return '55' + digits;
  }

  // International (12+ digits not starting with 55) — return as-is, NO 55 prefix
  if (digits.length >= 12 && !digits.startsWith('55')) {
    return digits;
  }

  // Fallback (shorter/unknown): keep previous behavior of prepending 55
  return '55' + digits;
}

interface ZApiCredentials {
  instanceId: string;
  token: string;
  clientToken: string;
}

/**
 * Resolve Z-API credentials from whatsapp_number_id (DB lookup) or fall back to env vars.
 */
export async function resolveZApiCredentials(
  whatsappNumberId?: string | null
): Promise<ZApiCredentials> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // If a whatsapp_number_id is provided, look up from DB
  if (whatsappNumberId && supabase) {
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .select("zapi_instance_id, zapi_token, zapi_client_token")
      .eq("id", whatsappNumberId)
      .eq("provider", "zapi")
      .single();

    if (!error && data?.zapi_instance_id && data?.zapi_token && data?.zapi_client_token) {
      return {
        instanceId: data.zapi_instance_id,
        token: data.zapi_token,
        clientToken: data.zapi_client_token,
      };
    }
    console.warn(`Could not resolve Z-API credentials for whatsapp_number_id=${whatsappNumberId}, falling back to env vars`);
  }

  if (supabase) {
    const { data: activeNumbers, error } = await supabase
      .from("whatsapp_numbers")
      .select("zapi_instance_id, zapi_token, zapi_client_token")
      .eq("provider", "zapi")
      .eq("is_active", true)
      .limit(2);

    if (!error && activeNumbers?.length === 1) {
      const [onlyNumber] = activeNumbers;
      if (onlyNumber.zapi_instance_id && onlyNumber.zapi_token && onlyNumber.zapi_client_token) {
        return {
          instanceId: onlyNumber.zapi_instance_id,
          token: onlyNumber.zapi_token,
          clientToken: onlyNumber.zapi_client_token,
        };
      }
    }

    if (!error && (activeNumbers?.length ?? 0) > 1) {
      throw new Error("Ambiguous Z-API route: whatsapp_number_id is required when multiple active Z-API numbers exist");
    }
  }

  // Fallback to environment variables
  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
  const token = Deno.env.get("ZAPI_TOKEN");
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");

  if (!instanceId || !token || !clientToken) {
    throw new Error("Z-API credentials not configured");
  }

  return { instanceId, token, clientToken };
}
