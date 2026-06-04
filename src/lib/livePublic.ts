import { supabase } from "@/integrations/supabase/client";

async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke("checkout-public", {
      body: { action, ...payload },
    });
    if (error) {
      console.warn(`[live-public:${action}]`, error);
      return null;
    }
    return data as T;
  } catch (e) {
    console.warn(`[live-public:${action}] threw`, e);
    return null;
  }
}

export async function lpGetState(sessionId: string) {
  return call<{ viewerCount: number; messages: any[] }>("live_get_state", { sessionId });
}

export async function lpUpsertViewer(sessionId: string, viewer: { name: string; phone: string }) {
  return call<{ ok: boolean }>("live_upsert_viewer", { sessionId, viewer });
}

export async function lpUpdateViewer(sessionId: string, phone: string, patch: Record<string, unknown>) {
  return call<{ ok: boolean }>("live_update_viewer", { sessionId, phone, patch });
}

export async function lpSendMessage(sessionId: string, viewerName: string, viewerPhone: string, message: string, messageType: "text" | "system" = "text") {
  return call<{ ok: boolean }>("live_send_message", { sessionId, viewerName, viewerPhone, message, messageType });
}