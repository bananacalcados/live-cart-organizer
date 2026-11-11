import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Official = { display: string; digits: string; wa_link?: string | null };
const cache = new Map<string, Promise<Official | null>>();

function loadOfficial(eventId: string | null, slug: string) {
  const key = `${eventId || ""}|${slug}`;
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve(supabase.rpc("get_event_official_whatsapp" as any, { p_event_id: eventId, p_slug: slug }))
      .then(({ data, error }: any) => (!error && data?.display ? (data as Official) : null))
      .catch(() => null));
  }
  return cache.get(key)!;
}

/** Faixa anti-golpe com o número oficial da live. Se a consulta falhar, não mostra nada. */
export function OfficialWhatsAppBanner({ eventId, slug }: { eventId: string | null; slug: string }) {
  const [official, setOfficial] = useState<Official | null>(null);
  useEffect(() => {
    let alive = true;
    loadOfficial(eventId, slug).then((o) => { if (alive) setOfficial(o); });
    return () => { alive = false; };
  }, [eventId, slug]);
  if (!official) return null;
  return (
    <div className="my-3 rounded-2xl border-2 border-whatsapp bg-whatsapp p-4 text-center text-whatsapp-foreground shadow-lg">
      <div className="flex items-center justify-center gap-2">
        <ShieldCheck className="h-6 w-6 shrink-0" />
        <p className="text-sm font-extrabold uppercase leading-tight tracking-wide">WhatsApp oficial da Banana Calçados</p>
      </div>
      <p className="mt-2 break-words text-3xl font-black leading-tight sm:text-4xl">{official.display}</p>
      <p className="mt-2 text-sm font-bold leading-snug">Este é o ÚNICO número oficial da loja. Não fazemos cobrança nem pedimos Pix por nenhum outro número.</p>
    </div>
  );
}

/** Passo a passo da confirmação, com desenho do botão CONFIRMAR CADASTRO. */
export function ConfirmStepsCard() {
  return (
    <div className="rounded-2xl border-2 border-whatsapp bg-whatsapp/10 p-4 text-left">
      <ol className="space-y-3 text-base">
        <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-whatsapp text-sm font-black text-whatsapp-foreground">1</span><span className="font-semibold">Abra o WhatsApp</span></li>
        <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-whatsapp text-sm font-black text-whatsapp-foreground">2</span><span className="font-semibold">Envie a mensagem que já vem pronta</span></li>
        <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-whatsapp text-sm font-black text-whatsapp-foreground">3</span>
          <span className="font-semibold">Toque no botão <strong className="font-black">CONFIRMAR CADASTRO</strong> para receber o link de pagamento do seu carrinho
            <span aria-hidden className="mt-2 block w-full rounded-lg border border-border bg-card px-3 py-2 text-center text-sm font-black uppercase text-whatsapp shadow-sm">CONFIRMAR CADASTRO</span>
          </span>
        </li>
      </ol>
    </div>
  );
}
