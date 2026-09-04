import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEventStore } from "@/stores/eventStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BadgeCheck, KeyRound, Link as LinkIcon, Loader2, Send, ShoppingCart, Shuffle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  eventId: string;
  phone: string;
  name?: string | null;
  /** Quando há pedido, o envio usa os dados do pedido (produtos, total, checkout). */
  orderId?: string | null;
  checkoutLink?: string | null;
  /** Visual sobre fundo escuro (cards de Novos contatos / Aguardando). */
  dark?: boolean;
}

/**
 * Botões do card da live:
 *  - "Msg Área": envia a mensagem da Área de Membros configurada na live,
 *    via template API (Meta) ou via instância não oficial (uazapi, em rodízio).
 *  - "Links": copia o link autenticado da Área de Membros e o link do checkout.
 */
export function LiveCardMessageActions({ eventId, phone, name, orderId, checkoutLink, dark = true }: Props) {
  const event = useEventStore((st) => st.events.find((ev) => ev.id === eventId)) as any;
  const [sending, setSending] = useState<"template" | "wa" | null>(null);
  const [copying, setCopying] = useState(false);

  const templateReady = Boolean(event?.meta_template_name && event?.whatsapp_number_id);
  const waReady =
    Boolean(event?.wa_initial_enabled) &&
    Array.isArray(event?.wa_initial_variants) &&
    (event.wa_initial_variants as any[]).length > 0 &&
    Boolean(event?.wa_initial_number_id);

  const body = orderId ? { orderId } : { eventId, phone, name: name || undefined };

  const send = async (mode: "template" | "wa") => {
    setSending(mode);
    try {
      const fn = mode === "template" ? "event-order-template-send" : "event-order-wa-initial-send";
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        mode === "template"
          ? "Mensagem enviada via template API"
          : `Mensagem enviada via instância não oficial (variação ${((data as any)?.variant_index ?? 0) + 1}/${(data as any)?.variants ?? "?"})`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar mensagem");
    } finally {
      setSending(null);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const copyMemberLink = async () => {
    setCopying(true);
    try {
      const { data, error } = await supabase.functions.invoke("issue-member-magic-link", { body: { phone } });
      if (error) throw error;
      const url = (data as any)?.url as string;
      if (!url) throw new Error("Link não gerado");
      await copy(url, "Link da Área de Membros");
    } catch (e: any) {
      toast.error("Erro ao gerar link: " + (e?.message || "desconhecido"));
    } finally {
      setCopying(false);
    }
  };

  const btn = cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
    dark
      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
  );
  const btnLinks = cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
    dark ? "border-white/20 bg-white/10 text-white hover:bg-white/20" : "border-border bg-muted/40 hover:bg-muted",
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={(e) => e.stopPropagation()} className={btn} title="Enviar mensagem da Área de Membros">
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Msg Área
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()} className="w-72">
          <DropdownMenuLabel className="text-xs">Enviar msg da Área de Membros</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!templateReady || !!sending} onClick={() => send("template")}>
            <BadgeCheck className="mr-2 h-3.5 w-3.5" />
            <div className="flex flex-col">
              <span>Via template API (Meta)</span>
              <span className="text-[10px] text-muted-foreground">
                {templateReady ? `Template: ${event.meta_template_name}` : "Configure o template na etapa MENSAGEM da live"}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!waReady || !!sending} onClick={() => send("wa")}>
            <Shuffle className="mr-2 h-3.5 w-3.5" />
            <div className="flex flex-col">
              <span>Via instância não oficial (uazapi)</span>
              <span className="text-[10px] text-muted-foreground">
                {waReady
                  ? `${(event.wa_initial_variants as any[]).length} variação(ões) em rodízio`
                  : "Ative a mensagem não-API na etapa MENSAGEM da live"}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={(e) => e.stopPropagation()} className={btnLinks} title="Copiar links">
            {copying ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />} Links
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()} className="w-64">
          <DropdownMenuItem disabled={copying} onClick={copyMemberLink}>
            <KeyRound className="mr-2 h-3.5 w-3.5" /> Copiar link da Área de Membros
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!checkoutLink}
            onClick={() => checkoutLink && copy(checkoutLink, "Link do checkout")}
          >
            <ShoppingCart className="mr-2 h-3.5 w-3.5" />
            <div className="flex flex-col">
              <span>Copiar link do checkout</span>
              {!checkoutLink && <span className="text-[10px] text-muted-foreground">Crie o pedido para gerar o checkout</span>}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
