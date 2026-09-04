import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Columns2, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type POSWhatsAppViewMode = "classic" | "lanes";

export const viewModeStorageKey = (storeId: string) => `pos-wa-view-mode:${storeId}`;

export function readViewMode(storeId: string): POSWhatsAppViewMode | null {
  try {
    const v = localStorage.getItem(viewModeStorageKey(storeId));
    return v === "classic" || v === "lanes" ? v : null;
  } catch {
    return null;
  }
}

export function saveViewMode(storeId: string, mode: POSWhatsAppViewMode) {
  try {
    localStorage.setItem(viewModeStorageKey(storeId), mode);
  } catch {
    /* ignore */
  }
}

interface Props {
  open: boolean;
  onChoose: (mode: POSWhatsAppViewMode) => void;
}

/** Escolha da versão visual do atendimento (lembrada no aparelho). */
export function POSWhatsAppViewModeDialog({ open, onChoose }: Props) {
  const Option = ({ mode, icon, title, desc }: { mode: POSWhatsAppViewMode; icon: JSX.Element; title: string; desc: string }) => (
    <button
      type="button"
      onClick={() => onChoose(mode)}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border-2 border-border bg-card p-4 text-center transition-colors hover:border-[#00a884] hover:bg-[#00a884]/5",
      )}
    >
      <span className="rounded-full bg-[#00a884]/15 p-3 text-[#00a884]">{icon}</span>
      <span className="text-sm font-bold">{title}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{desc}</span>
    </button>
  );

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>Como você quer atender hoje?</DialogTitle>
          <DialogDescription>Escolha a versão visual do WhatsApp. Dá para trocar depois pelo botão no topo.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Option
            mode="classic"
            icon={<Columns2 className="h-6 w-6" />}
            title="Tradicional"
            desc="Lista de conversas à esquerda e o chat aberto à direita."
          />
          <Option
            mode="lanes"
            icon={<Rows3 className="h-6 w-6" />}
            title="Linhas"
            desc="Todas as etapas visíveis ao mesmo tempo: Novas, Não lidas, Follow Up, Live, Suporte e Finalizadas."
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
