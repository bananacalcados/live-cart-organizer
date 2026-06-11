import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useSellerTasks, type TaskInstance } from "@/hooks/useSellerTasks";
import { POSTaskMessageDialog } from "./POSTaskMessageDialog";
import {
  ClipboardList, MessageCircle, CheckCircle2, Clock, Sparkles, ShieldCheck, Hand, Users, Phone, Target,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  storeId: string;
  sellerId: string;
  sellerName: string;
  isManager?: boolean;
  /** Abre o chat do WhatsApp já no contato (telefone). */
  onOpenWhatsApp?: (phone: string, name?: string) => void;
}

export function SellerTaskReminderPopup({
  open, onClose, storeId, sellerId, sellerName, isManager, onOpenWhatsApp,
}: Props) {
  const { instances, loading, pendingCount, completeManual, uncomplete, markContacted } =
    useSellerTasks(storeId, sellerId);

  const [compose, setCompose] = useState<{ phone: string; name?: string; contactId: string } | null>(null);

  if (!open) return null;

  const total = instances.length;
  const completed = total - pendingCount;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl w-[95vw] max-h-[88vh] bg-pos-black border-2 border-pos-orange/60 text-pos-white p-0 overflow-hidden shadow-[0_0_60px_rgba(255,140,0,0.35)]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-4 bg-gradient-to-r from-pos-orange/20 to-transparent border-b border-pos-orange/30">
          <DialogTitle className="flex items-center gap-3 text-2xl font-extrabold text-pos-white">
            <ClipboardList className="h-7 w-7 text-pos-orange" />
            Suas tarefas de hoje, {sellerName?.split(" ")[0]}!
          </DialogTitle>
          <p className="text-sm text-pos-white/60 mt-1">
            {pendingCount > 0
              ? `Você tem ${pendingCount} tarefa(s) pendente(s). Bora resolver! 🔥`
              : "Tudo concluído! Mandou bem demais! 🎉"}
          </p>
          {total > 0 && (
            <div className="mt-3">
              <Progress value={(completed / total) * 100} className="h-2 bg-pos-white/10" />
              <p className="text-[11px] text-pos-white/40 mt-1">{completed} de {total} concluídas</p>
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="max-h-[52vh] px-6 py-4">
          {loading && instances.length === 0 ? (
            <div className="text-center py-10 text-pos-white/50 text-sm">Carregando suas tarefas...</div>
          ) : instances.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 className="h-12 w-12 text-green-400/60 mx-auto mb-3" />
              <p className="text-pos-white/60">Nenhuma tarefa para hoje.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {instances.map((inst) => (
                <TaskCard
                  key={inst.id}
                  inst={inst}
                  onCompleteManual={() => completeManual(inst.id)}
                  onUncomplete={() => uncomplete(inst.id)}
                  onCompose={(phone, name, contactId) => setCompose({ phone, name, contactId })}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="px-6 py-4 border-t border-pos-white/10 bg-pos-black/80 flex items-center justify-between gap-3">
          {isManager && (
            <Badge variant="outline" className="border-pos-orange/40 text-pos-orange gap-1">
              <Users className="h-3 w-3" /> Gerente
            </Badge>
          )}
          <Button
            onClick={onClose}
            className="ml-auto bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold text-base px-6 py-5 gap-2"
          >
            <Hand className="h-5 w-5" /> Vou realizar ainda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskCard({
  inst, onCompleteManual, onUncomplete, onMarkContacted, onOpenWhatsApp,
}: {
  inst: TaskInstance;
  onCompleteManual: () => void;
  onUncomplete: () => void;
  onMarkContacted: (contactId: string) => void;
  onOpenWhatsApp?: (phone: string, name?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const done = inst.status === "completed";
  const isAuto = inst.verification_mode === "auto";

  return (
    <div className={cn(
      "rounded-xl border p-4 transition-all",
      done ? "border-green-500/40 bg-green-500/5" : "border-pos-white/15 bg-pos-white/5",
    )}>
      <div className="flex items-start gap-3">
        {!isAuto ? (
          <Checkbox
            checked={done}
            onCheckedChange={(v) => (v ? onCompleteManual() : onUncomplete())}
            className="mt-0.5 h-5 w-5 border-pos-orange data-[state=checked]:bg-pos-orange data-[state=checked]:text-pos-black"
          />
        ) : (
          <div className="mt-0.5">
            {done
              ? <CheckCircle2 className="h-5 w-5 text-green-400" />
              : <ShieldCheck className="h-5 w-5 text-pos-orange/70" />}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-bold text-pos-white", done && "line-through text-pos-white/50")}>
              {inst.title}
            </span>
            {isAuto && (
              <Badge variant="outline" className="border-pos-orange/40 text-pos-orange text-[10px] gap-1">
                <Sparkles className="h-2.5 w-2.5" /> Verificada
              </Badge>
            )}
            {inst.points_reward > 0 && (
              <Badge variant="outline" className="border-pos-white/20 text-pos-white/60 text-[10px]">
                +{inst.points_reward} pts
              </Badge>
            )}
          </div>
          {inst.description && (
            <p className="text-xs text-pos-white/50 mt-0.5">{inst.description}</p>
          )}

          {isAuto && inst.progress_target > 1 && (
            <div className="mt-2">
              <Progress
                value={(inst.progress_current / inst.progress_target) * 100}
                className="h-1.5 bg-pos-white/10"
              />
              <p className="text-[11px] text-pos-white/40 mt-1">
                {inst.progress_current}/{inst.progress_target} concluídos
              </p>
            </div>
          )}

          {/* Lista de contatos (tarefas automáticas baseadas em contato) */}
          {isAuto && inst.contacts.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-xs text-pos-orange hover:underline"
              >
                {expanded ? "Ocultar lista" : `Ver lista (${inst.contacts.length})`}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1.5">
                  {inst.contacts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-lg bg-pos-black/40 border border-pos-white/10 px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-pos-white truncate">{c.customer_name || "Cliente"}</p>
                        <p className="text-[10px] text-pos-white/40 flex items-center gap-1">
                          <Phone className="h-2.5 w-2.5" /> {c.customer_phone}
                        </p>
                      </div>
                      {c.contacted ? (
                        <Badge variant="outline" className="border-green-500/40 text-green-400 text-[10px] gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Falei
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 bg-[#00a884] hover:bg-[#00916f] text-white text-[11px] gap-1 px-2"
                          onClick={() => {
                            if (c.customer_phone) onOpenWhatsApp?.(c.customer_phone, c.customer_name || undefined);
                            onMarkContacted(c.id);
                          }}
                        >
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {done && <Clock className="h-4 w-4 text-green-400/60 mt-1" />}
      </div>
    </div>
  );
}
