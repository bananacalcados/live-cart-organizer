import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FEW_MESSAGES_LIMIT, otherInstanceHistory, type InstanceLabel, type InstanceMessageCount } from "@/lib/chat/crossInstanceHistory";

type Props = {
  phone: string;
  currentNumberId: string | null;
  currentMessageCount: number;
  loading: boolean;
  instances: InstanceLabel[];
  onView: (numberId: string) => void;
};

export function CrossInstanceHistoryNotice({ phone, currentNumberId, currentMessageCount, loading, instances, onView }: Props) {
  const [counts, setCounts] = useState<InstanceMessageCount[]>([]);
  const requestedKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${phone}|${currentNumberId || "none"}`;
    if (requestedKeyRef.current !== requestKey) setCounts([]);
    if (loading || currentMessageCount > FEW_MESSAGES_LIMIT || !phone || requestedKeyRef.current === requestKey) return;
    requestedKeyRef.current = requestKey;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("chat_cross_instance_message_counts", { p_phone: phone });
      if (!cancelled) {
        if (error) console.warn("[chat] não foi possível contar o histórico das outras instâncias:", error.message);
        else setCounts((data || []) as InstanceMessageCount[]);
      }
    })();
    return () => { cancelled = true; };
  }, [phone, currentNumberId, currentMessageCount, loading]);

  const other = otherInstanceHistory(counts, currentNumberId, currentMessageCount, instances);
  if (!other) return null;

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-x-1 border-b bg-muted/30 px-3 py-1.5 text-center text-xs text-muted-foreground">
      <span>Esta cliente tem histórico em: <strong>{other.label}</strong> ({other.message_count} mensagens)</span>
      <Button variant="link" className="h-auto p-0 text-xs font-semibold" onClick={() => onView(other.whatsapp_number_id)}>Ver</Button>
    </div>
  );
}
