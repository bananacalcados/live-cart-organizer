import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook that returns the set of phone numbers with active (non-resolved) support tickets.
 * Used across all WhatsApp modules to filter conversations with active support.
 */
export function useSupportPhones() {
  const [supportPhones, setSupportPhones] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("support_tickets")
      .select("customer_phone")
      .neq("status", "resolved");

    if (data) {
      const phones = new Set<string>();
      for (const t of data as any[]) {
        if (t.customer_phone) {
          // Store as-is and also digits-only suffix for matching
          phones.add(t.customer_phone);
        }
      }
      setSupportPhones(phones);
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("support-tickets-filter")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  /** Check if a phone has active support (matches last 8 digits) */
  const hasActiveSupport = useCallback((phone: string): boolean => {
    const suffix = phone.replace(/\D/g, "").slice(-8);
    for (const sp of supportPhones) {
      if (sp.replace(/\D/g, "").slice(-8) === suffix) return true;
    }
    return false;
  }, [supportPhones]);

  return { supportPhones, hasActiveSupport, supportCount: supportPhones.size };
}
