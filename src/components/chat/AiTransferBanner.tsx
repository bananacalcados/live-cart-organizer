import { useEffect, useState } from "react";
import { Bot, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AiTransferBannerProps {
  phone: string;
  onResolved?: () => void;
}

interface AssignmentRow {
  id: string;
  ai_classification: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Banner shown at the top of a conversation when the AI has transferred
 * it to a human (i.e. there's a pending row in chat_assignments
 * with assigned_by='ai' and status='pending' for this phone).
 */
export function AiTransferBanner({ phone, onResolved }: AiTransferBannerProps) {
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!phone) return;

    const load = async () => {
      const { data } = await supabase
        .from("chat_assignments")
        .select("id, ai_classification, notes, created_at")
        .eq("phone", phone)
        .eq("assigned_by", "ai")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setAssignment(data as AssignmentRow | null);
    };

    load();

    const channel = supabase
      .channel(`ai-transfer-${phone}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_assignments", filter: `phone=eq.${phone}` },
        () => load()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [phone]);

  if (!assignment) return null;

  const handleResolve = async () => {
    setResolving(true);
    const suffix = (phone || "").replace(/\D/g, "").slice(-8);

    // Resolve EVERY pending AI assignment that matches this contact — there are
    // often several rows (and sometimes alternate phone formats missing the 9th
    // digit), so resolving a single id makes the banner pop right back.
    const { data: pending } = await supabase
      .from("chat_assignments")
      .select("id, phone")
      .eq("assigned_by", "ai")
      .eq("status", "pending");

    const idsToResolve = (pending as { id: string; phone: string }[] | null || [])
      .filter(r => (r.phone || "").replace(/\D/g, "").slice(-8) === suffix)
      .map(r => r.id);

    let error: unknown = null;
    if (idsToResolve.length > 0) {
      const res = await supabase
        .from("chat_assignments")
        .update({ status: "resolved", resolved_at: new Date().toISOString() } as never)
        .in("id", idsToResolve);
      error = res.error;
    }

    // Mark this contact's incoming messages as read so it leaves "Não lidas".
    await supabase
      .from("whatsapp_messages")
      .update({ status: "read" } as never)
      .eq("phone", phone)
      .eq("direction", "incoming")
      .or("status.is.null,status.neq.read");

    setResolving(false);
    if (error) {
      toast.error("Não foi possível marcar como atendida");
      return;
    }
    toast.success("Transferência resolvida");
    setAssignment(null);
    onResolved?.();
  };

  return (
    <div className="px-3 py-2 border-b bg-orange-500/10 dark:bg-orange-500/15 border-orange-500/30 flex items-start gap-2 flex-shrink-0">
      <Bot className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">
            🤖 IA transferiu este atendimento
          </span>
          {assignment.ai_classification && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-700 dark:text-orange-200 truncate max-w-[260px]">
              {assignment.ai_classification}
            </span>
          )}
        </div>
        {assignment.notes && (
          <p className="text-[11px] text-orange-700/80 dark:text-orange-200/80 mt-1 line-clamp-2">
            {assignment.notes}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px] gap-1 text-orange-700 dark:text-orange-200 hover:bg-orange-500/20"
        onClick={handleResolve}
        disabled={resolving}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Marcar como atendida
      </Button>
    </div>
  );
}
