import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

interface Agent {
  user_id: string;
  display_name: string;
}

interface TransferConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  whatsappNumberId?: string | null;
  customerName?: string;
  currentAssignedTo?: string | null;
  onTransferred?: () => void;
}

export function TransferConversationDialog({
  open,
  onOpenChange,
  phone,
  whatsappNumberId,
  customerName,
  currentAssignedTo,
  onTransferred,
}: TransferConversationDialogProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState("");
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .order("display_name");
      if (data) setAgents(data.filter((a: any) => a.user_id !== currentAssignedTo && a.display_name));
    };
    load();
  }, [open, currentAssignedTo]);

  const filtered = agents.filter(a =>
    a.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  const handleTransfer = async (agent: Agent) => {
    setTransferring(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("chat_conversation_assignments").upsert({
        phone,
        whatsapp_number_id: whatsappNumberId || null,
        assigned_to: agent.user_id,
        assigned_by: user?.id || null,
      } as any, { onConflict: "phone,whatsapp_number_id" });

      toast.success(`Conversa transferida para ${agent.display_name}`);
      onOpenChange(false);
      onTransferred?.();
    } catch (err) {
      console.error("Transfer error:", err);
      toast.error("Erro ao transferir conversa");
    } finally {
      setTransferring(false);
    }
  };

  const getInitials = (name: string) =>
    name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Transferir Conversa
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Transferir <strong>{customerName || phone}</strong> para outro atendente:
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar atendente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-60 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum atendente encontrado
            </p>
          ) : (
            filtered.map(agent => (
              <button
                key={agent.user_id}
                onClick={() => handleTransfer(agent)}
                disabled={transferring}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-left disabled:opacity-50"
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {getInitials(agent.display_name || "?")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{agent.display_name}</p>
                </div>
                <UserPlus className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
