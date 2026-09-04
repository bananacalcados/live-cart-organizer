import { ArrowDownUp, Check, RotateCcw, Sparkles, MailWarning, Clock, Headphones, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHAT_LANE_META, type ChatLane } from "@/lib/chat/conversationLanes";
import type { ManualChatLane } from "@/hooks/useChatConversationLanes";

interface TransferLaneMenuProps {
  /** Linha atual do card (para marcar no menu). */
  currentLane?: ChatLane | null;
  /** Há marcação manual ativa (mostra "Voltar ao automático"). */
  hasManualMark?: boolean;
  onMove: (lane: ManualChatLane) => void;
  /** Escolher "Finalizadas" abre o fluxo normal de Finalizar. */
  onFinish?: () => void;
  onClearManual?: () => void;
  /** "button" = botão do cabeçalho do chat; "icon" = ícone compacto no card. */
  variant?: "button" | "icon";
  className?: string;
}

const OPTIONS: { lane: ManualChatLane; icon: JSX.Element }[] = [
  { lane: "new", icon: <Sparkles className="h-3.5 w-3.5 text-emerald-500" /> },
  { lane: "unread", icon: <MailWarning className="h-3.5 w-3.5 text-amber-500" /> },
  { lane: "followup", icon: <Clock className="h-3.5 w-3.5 text-sky-500" /> },
  { lane: "support", icon: <Headphones className="h-3.5 w-3.5 text-orange-500" /> },
];

/** Menu "Transferir etapa": move a conversa para outra linha (compartilhado entre atendentes). */
export function TransferLaneMenu({
  currentLane,
  hasManualMark,
  onMove,
  onFinish,
  onClearManual,
  variant = "button",
  className,
}: TransferLaneMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn("rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground", className)}
            title="Transferir etapa"
            aria-label="Transferir etapa"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button variant="ghost" size="sm" className={cn("h-7 px-1.5 text-xs gap-1 text-indigo-600 hover:text-indigo-500", className)} title="Transferir etapa (linha)">
            <ArrowDownUp className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Etapa</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Mover para a linha</DropdownMenuLabel>
        {OPTIONS.map(({ lane, icon }) => (
          <DropdownMenuItem key={lane} className="gap-2 text-xs" onSelect={() => onMove(lane)}>
            {icon}
            <span className="flex-1">{CHAT_LANE_META[lane].title}</span>
            {currentLane === lane && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        {onFinish && (
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onFinish()}>
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">Finalizadas</span>
            {currentLane === "finished" && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        )}
        {hasManualMark && onClearManual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs text-muted-foreground" onSelect={() => onClearManual()}>
              <RotateCcw className="h-3.5 w-3.5" />
              Voltar ao automático
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
