import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface PendingAssignment {
  id: string;
  phone: string;
  ai_classification: string | null;
  notes: string | null;
  created_at: string;
}

interface AiTransferBellProps {
  /** Called when user clicks a pending row to jump to that conversation */
  onSelectPhone?: (phone: string) => void;
  className?: string;
}

export function AiTransferBell({ onSelectPhone, className }: AiTransferBellProps) {
  const [pending, setPending] = useState<PendingAssignment[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("chat_assignments")
        .select("id, phone, ai_classification, notes, created_at")
        .eq("assigned_by", "ai")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50);
      setPending((data as PendingAssignment[]) || []);
    };
    load();

    const channel = supabase
      .channel("ai-transfer-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_assignments" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const count = pending.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative h-8 w-8 text-[#aebac1] hover:bg-[#2a3942]", className)}
          title={`${count} transferência(s) pela IA aguardando`}
        >
          <Bot className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-3 py-2 border-b flex items-center gap-2">
          <Bot className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-semibold">Transferidas pela IA</span>
          <span className="ml-auto text-xs text-muted-foreground">{count}</span>
        </div>
        <ScrollArea className="h-80">
          {count === 0 ? (
            <p className="p-4 text-xs text-center text-muted-foreground">
              Nenhuma transferência pendente
            </p>
          ) : (
            <ul className="divide-y">
              {pending.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      onSelectPhone?.(p.phone);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-foreground truncate">{p.phone}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    {p.ai_classification && (
                      <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-0.5 truncate">
                        {p.ai_classification}
                      </p>
                    )}
                    {p.notes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {p.notes}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
