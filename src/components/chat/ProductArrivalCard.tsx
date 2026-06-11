import { PackageCheck, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductWaitEntry } from "@/hooks/useProductWaitlist";

interface Props {
  arrived: ProductWaitEntry[];
  onOpenConversation: (phone: string, whatsappNumberId?: string | null) => void;
  onDismiss: (id: string) => void;
}

/**
 * Pilha flutuante de avisos "produto chegou" — aparece no canto inferior direito
 * do chat quando uma variação aguardada volta a ter estoque. Cada card oferece
 * abrir a conversa do cliente ou marcar como avisado.
 */
export function ProductArrivalCard({ arrived, onOpenConversation, onDismiss }: Props) {
  if (!arrived.length) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2">
      {arrived.slice(0, 4).map((e) => (
        <div
          key={e.id}
          className="pointer-events-auto overflow-hidden rounded-2xl border-2 border-amber-400 bg-card shadow-2xl ring-4 ring-amber-400/20 animate-in slide-in-from-right-4"
        >
          <div className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 text-white">
            <PackageCheck className="h-5 w-5 animate-bounce" />
            <span className="flex-1 text-sm font-extrabold uppercase tracking-wide">Produto chegou!</span>
            <button
              type="button"
              onClick={() => onDismiss(e.id)}
              className="rounded-full p-0.5 hover:bg-white/20"
              title="Marcar como avisado"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 px-3 py-3">
            {e.image_url ? (
              <img src={e.image_url} alt="" className="h-12 w-12 flex-shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-muted">
                <PackageCheck className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{e.product_name}</p>
              <p className="text-xs text-muted-foreground">
                {e.size ? `Tam ${e.size}` : ""}
                {e.color ? `${e.size ? " · " : ""}${e.color}` : ""}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-amber-600">
                {(e.customer_name || e.phone)} está aguardando
              </p>
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-3">
            <Button
              size="sm"
              className="flex-1 gap-1.5 bg-amber-500 hover:bg-amber-600"
              onClick={() => onOpenConversation(e.phone, e.whatsapp_number_id)}
            >
              <MessageCircle className="h-3.5 w-3.5" /> Abrir conversa
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDismiss(e.id)}>
              Avisei
            </Button>
          </div>
        </div>
      ))}
      {arrived.length > 4 && (
        <p className="pointer-events-auto rounded-full bg-amber-500 px-3 py-1 text-center text-xs font-bold text-white">
          +{arrived.length - 4} aguardando aviso
        </p>
      )}
    </div>
  );
}
