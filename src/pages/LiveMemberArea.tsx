import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  Lock,
  MessageCircle,
  ShoppingBag,
  Timer,
  Trash2,
} from "lucide-react";
import {
  EventPrizeWheelDialog,
  PublicWheel,
  useEventPrizeWheels,
} from "@/components/prize/EventPrizeWheelDialog";


type Step = "phone" | "name" | "area";

interface MemberState {
  token: string;
  event: { id: string; name: string; is_live_broadcasting?: boolean } | null;
  name: string | null;
  phone: string;
  otpUnlocked: boolean;
  hasDetails: boolean;
  details: any;
  order: {
    id: string;
    stage: string;
    products: any[];
    subtotal?: number;
    shipping_cost: number;
    free_shipping?: boolean;
    total: number;
    pix_discount_percent?: number;
    pix_discount?: number;
    pix_total?: number;
    is_paid: boolean;
    confirmed_at: string | null;
    payment_window_expires_at: string | null;
    checkout_url: string;
  } | null;

  history?: {
    id: string;
    event_name: string | null;
    created_at: string;
    is_paid: boolean;
    total: number;
    items: { title: string; variant?: string; quantity: number; price: number }[];
  }[];
}

const TOKEN_KEY = "live_member_token";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function callApi(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-member-area", { body: payload });
  if (error) throw new Error(error.message);
  return data as any;
}

export default function LiveMemberArea() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState<{ id: string; name: string; is_live: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<MemberState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [activeWheel, setActiveWheel] = useState<PublicWheel | null>(null);
  const pollRef = useRef<number | null>(null);

  /** Não reabrir o modal de confirmação se a cliente já fechou (a cada polling). */
  const confirmDismissedRef = useRef<string | null>(null);
  /** Assinatura dos itens do pedido, pra avisar quando a vendedora anota algo novo. */
  const itemsSigRef = useRef<string | null>(null);

  /** Roletas de prêmio disponíveis para esta cliente neste evento. */
  const { wheels, refresh: refreshWheels } = useEventPrizeWheels(
    state?.phone || null,
    state?.event?.id || null,
  );
  const availableWheels = wheels.filter((w) => w.eligible && w.spins_used < w.max_spins);



  /** SEO da página pública (link fica na bio do Instagram). */
  useEffect(() => {
    const title = "Minha Área | Banana Calçados";
    const description =
      "Acesse sua área de cliente Banana Calçados: confira os itens anotados na Live, confirme seu pedido e pague com PIX.";
    document.title = title;

    const upsert = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector);
      if (!el) {
        el = document.createElement(selector.startsWith("link") ? "link" : "meta") as any;
        document.head.appendChild(el!);
      }
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
    };

    upsert('meta[name="description"]', { name: "description", content: description });
    upsert('meta[name="robots"]', { name: "robots", content: "index, follow" });
    upsert('meta[property="og:title"]', { property: "og:title", content: title });
    upsert('meta[property="og:description"]', { property: "og:description", content: description });
    upsert('meta[property="og:type"]', { property: "og:type", content: "website" });
    upsert('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsert('link[rel="canonical"]', {
      rel: "canonical",
      href: "https://checkout.bananacalcados.com.br/minha-area",
    });
  }, []);


  const formatPhone = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  /** Assinatura simples dos itens do pedido pra detectar mudanças vindas da live. */
  const itemsSignature = (order: any) =>
    order
      ? `${order.id}:${(order.products || [])
          .map((p: any) => `${p.id ?? p.title}x${p.quantity ?? 1}`)
          .join("|")}`
      : "none";

  const applyState = useCallback(
    (data: any) => {
      if (!data?.ok) return;
      setState(data as MemberState);
      localStorage.setItem(TOKEN_KEY, data.token);
      setStep("area");
      itemsSigRef.current = itemsSignature(data.order);
      if (data.order && !data.order.confirmed_at && !data.order.is_paid) setConfirmOpen(true);
    },
    [],
  );

  // Bootstrap + sessão salva
  useEffect(() => {
    (async () => {
      try {
        const boot = await callApi({ action: "bootstrap" });
        if (!boot?.ok) {
          setNotFound(true);
          return;
        }
        setEvent(boot.event);
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          const st = await callApi({ action: "state", token });
          if (st?.ok) applyState(st);
          else localStorage.removeItem(TOKEN_KEY);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [applyState]);

  /**
   * Atualização em tempo quase-real: a vendedora anota o item na live e a cliente
   * vê aparecer sozinho, sem recarregar. Polling curto (6s) enquanto a aba está
   * visível, pausado quando ela sai da aba, e refresh imediato ao voltar.
   */
  const refreshState = useCallback(
    async (token: string, silent = true) => {
      try {
        if (!silent) setSyncing(true);
        const st = await callApi({ action: "state", token });
        if (!st?.ok) return;
        setState(st);

        const sig = itemsSignature(st.order);
        const had = itemsSigRef.current;
        if (had && had !== sig && st.order?.products?.length) {
          const prevCount = had.split("|").filter(Boolean).length;
          const nextCount = sig.split("|").filter(Boolean).length;
          if (had !== "none" && nextCount > prevCount) {
            toast.success("Novo item adicionado ao seu pedido 🛍️");
          }
          // Itens mudaram → volta a pedir confirmação
          confirmDismissedRef.current = null;
        }
        itemsSigRef.current = sig;

        if (
          st.order &&
          !st.order.confirmed_at &&
          !st.order.is_paid &&
          st.order.products?.length &&
          confirmDismissedRef.current !== st.order.id
        ) {
          setConfirmOpen(true);
        }
      } catch {
        /* silencioso */
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    const token = state?.token;
    if (step !== "area" || !token) return;

    const start = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => refreshState(token), 6000);
    };
    const stop = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshState(token, false);
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [step, state?.token, refreshState]);


  // Contador da janela de pagamento
  useEffect(() => {
    const exp = state?.order?.payment_window_expires_at;
    if (!exp || state?.order?.is_paid) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(exp).getTime() - Date.now()) / 1000)));
    tick();
    const i = window.setInterval(tick, 1000);
    return () => window.clearInterval(i);
  }, [state?.order?.payment_window_expires_at, state?.order?.is_paid]);

  const enter = async (withName?: string) => {
    setBusy(true);
    try {
      const res = await callApi({ action: "enter", phone, name: withName || undefined });
      if (!res?.ok) {
        toast.error(res?.error || "Não foi possível entrar");
        return;
      }
      if (res.needsName) {
        setStep("name");
        return;
      }
      applyState(res);
    } catch (e: any) {
      toast.error(e.message || "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  };

  const act = async (payload: Record<string, unknown>) => {
    if (!state?.token) return null;
    setBusy(true);
    try {
      const res = await callApi({ ...payload, token: state.token });
      if (res?.ok) setState(res);
      return res;
    } catch (e: any) {
      toast.error(e.message || "Erro");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-3">
        <h1 className="text-xl font-bold">Área indisponível</h1>
        <p className="text-muted-foreground text-sm">
          Este link não está ativo no momento. Volte para a live e tente novamente.
        </p>
      </div>
    );
  }

  const Header = (
    <div className="text-center space-y-3 pt-8 pb-6">
      <img
        src="/images/banana-logo.png"
        alt="Banana Calçados"
        className="w-16 h-16 rounded-full mx-auto object-cover"
      />
      {event?.is_live && (
        <div className="inline-flex items-center gap-1.5 bg-destructive/15 text-destructive text-xs font-bold px-3 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
          AO VIVO
        </div>
      )}
      <h1 className="text-xl font-bold px-6">MINHA ÁREA</h1>
    </div>
  );

  // ---------- Etapa 1: WhatsApp ----------
  if (step === "phone") {
    return (
      <div className="min-h-screen bg-muted/40 text-foreground flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm bg-card rounded-2xl shadow-lg border border-border p-8">
          <div className="flex flex-col items-center text-center">
            <ShoppingBag className="h-9 w-9 text-primary" strokeWidth={2.2} />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">ÁREA DE MEMBROS</h1>
            <p className="mt-2 text-muted-foreground text-base leading-snug">
              Digite seu WhatsApp pra continuar
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              enter();
            }}
            className="mt-8 space-y-6"
          >
            <div className="space-y-2 text-left">
              <Label className="text-sm text-muted-foreground">Whatsapp</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(33) 99999-9999"
                inputMode="tel"
                className="h-14 text-[18px] rounded-xl"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={phone.replace(/\D/g, "").length < 10 || busy}
              className="w-full h-14 text-base font-semibold rounded-xl gap-2"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              Continuar
            </Button>
          </form>

          <button
            type="button"
            onClick={backToLive}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar pra live
          </button>
        </div>
      </div>
    );
  }


  // ---------- Etapa 2: Nome ----------
  if (step === "name") {
    return (
      <div className="min-h-screen bg-background text-foreground px-6">
        <div className="max-w-sm mx-auto">
          <button
            onClick={() => setStep("phone")}
            className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          {Header}
          <p className="text-muted-foreground text-center text-sm mb-6">Como é o seu nome completo?</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enter(name.trim());
            }}
            className="space-y-4"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maria Silva"
              className="h-16 text-[18px]"
              autoFocus
            />
            <Button
              type="submit"
              disabled={name.trim().length < 3 || busy}
              className="w-full h-16 text-base font-bold"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CONTINUAR"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ---------- Área do cliente ----------
  const order = state?.order;
  const mm = remaining != null ? String(Math.floor(remaining / 60)).padStart(2, "0") : null;
  const ss = remaining != null ? String(remaining % 60).padStart(2, "0") : null;

  return (
    <div className="min-h-screen bg-background text-foreground pb-28">
      <div className="max-w-md mx-auto px-5">
        {Header}
        <p className="text-center text-lg font-semibold -mt-3 mb-6">Oi, {state?.name} 👋</p>

        {/* Roleta de prêmios */}
        {availableWheels.length > 0 && (
          <div className="mb-6 space-y-2">
            {availableWheels.map((w) => (
              <button
                key={w.id}
                onClick={() => setActiveWheel(w)}
                className="w-full rounded-2xl px-5 py-4 font-black text-white text-base bg-gradient-to-r from-yellow-400 via-orange-500 to-pink-500 shadow-lg shadow-orange-500/40 animate-pulse hover:scale-[1.02] transition-transform"
              >
                🎰 ROLETA DE PRÊMIOS — {w.name}
              </button>
            ))}
          </div>
        )}

        {activeWheel && (
          <EventPrizeWheelDialog
            wheel={activeWheel}
            phone={state?.phone || phone.replace(/\D/g, "")}
            name={state?.name}
            onClose={() => setActiveWheel(null)}
            onDone={refreshWheels}
          />
        )}


        {/* Meu pedido */}
        <section className="rounded-2xl border-2 border-border p-4 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" /> Meu pedido
            <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
              {syncing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> atualizando
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> ao vivo
                </>
              )}
            </span>
          </h2>

          {!order || order.products.length === 0 ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-muted-foreground text-sm">
                Você ainda não tem nenhum produto reservado.
              </p>
              <p className="text-muted-foreground text-xs">
                Comente na live o produto e o tamanho que você quer — assim que a gente anotar, aparece
                aqui automaticamente.
              </p>
            </div>
          ) : (
            <>
              {order.products.map((p: any, i: number) => (
                <div key={i} className="flex gap-3 items-center border-b border-border/60 pb-3 last:border-0">
                  {p.image && (
                    <img src={p.image} alt={p.title} className="w-16 h-16 rounded-lg object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.variant}</p>
                    <p className="text-sm font-bold">{brl(Number(p.price || 0))}</p>
                  </div>
                  {!order.is_paid && (
                    <button
                      onClick={() => act({ action: "reject_item", index: i })}
                      disabled={busy}
                      aria-label="Remover item"
                      className="p-3 rounded-lg text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="pt-1 space-y-1">
                {typeof order.subtotal === "number" && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Produtos</span>
                    <span>{brl(order.subtotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Frete</span>
                  <span>
                    {order.free_shipping || !order.shipping_cost
                      ? "Grátis"
                      : brl(order.shipping_cost)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-bold">{brl(order.total)}</span>
                </div>
                {!order.is_paid && !!order.pix_discount_percent && (
                  <div className="flex justify-between items-center rounded-xl bg-primary/10 px-3 py-2 mt-1">
                    <span className="text-xs font-semibold text-primary">
                      No PIX ({order.pix_discount_percent}% OFF)
                    </span>
                    <span className="text-lg font-extrabold text-primary">
                      {brl(order.pix_total ?? order.total)}
                    </span>
                  </div>
                )}
              </div>


              {order.is_paid ? (
                <div className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-primary font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5" /> Pagamento confirmado!
                </div>
              ) : order.confirmed_at ? (
                <div className="space-y-3">
                  {mm && (
                    <div className="flex items-center justify-center gap-2 rounded-xl bg-destructive/10 text-destructive font-bold py-3">
                      <Timer className="h-5 w-5" /> Pague em {mm}:{ss}
                    </div>
                  )}
                  <Button
                    className="w-full h-16 text-base font-bold gap-2"
                    onClick={() => (window.location.href = order.checkout_url)}
                  >
                    <CreditCard className="h-5 w-5" /> PAGAR AGORA
                  </Button>
                </div>
              ) : (
                <Button className="w-full h-16 text-base font-bold" onClick={() => setConfirmOpen(true)}>
                  CONFIRMAR MEU PEDIDO
                </Button>
              )}
            </>
          )}
        </section>

        {/* Histórico de compras (todas as lives) */}
        {Array.isArray(state?.history) && state!.history.length > 0 && (
          <section className="rounded-2xl border-2 border-border p-4 mt-5 space-y-3">
            <h2 className="font-bold text-base flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Meus pedidos anteriores
            </h2>
            {state!.history.map((h) => (
              <div key={h.id} className="rounded-xl bg-muted/40 p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground truncate">
                    {h.event_name || "Pedido"} ·{" "}
                    {new Date(h.created_at).toLocaleDateString("pt-BR")}
                  </p>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      h.is_paid ? "bg-primary/15 text-primary" : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {h.is_paid ? "PAGO" : "EM ABERTO"}
                  </span>
                </div>
                {h.items.map((it, i) => (
                  <p key={i} className="text-sm">
                    {it.quantity}x {it.title}
                    {it.variant ? ` — ${it.variant}` : ""}
                  </p>
                ))}
                <p className="text-sm font-bold">{brl(h.total)}</p>
              </div>
            ))}
          </section>
        )}

        {/* Meus dados */}
        <section className="rounded-2xl border-2 border-border p-4 mt-5 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" /> Meus dados
          </h2>
          <p className="text-sm">
            <span className="text-muted-foreground">Nome: </span>
            {state?.name}
          </p>
          {state?.hasDetails && !state?.otpUnlocked ? (
            <>
              <p className="text-sm text-muted-foreground">CPF: {state.details?.cpf || "—"}</p>
              <p className="text-sm text-muted-foreground">E-mail: {state.details?.email || "—"}</p>
              <p className="text-sm text-muted-foreground">Endereço: {state.details?.address || "—"}</p>
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-primary bg-primary/10 font-bold"
                onClick={async () => {
                  const res = await act({ action: "send_otp" });
                  if (res?.ok) {
                    setOtpOpen(true);
                    toast.success("Código enviado no seu WhatsApp");
                  } else toast.error(res?.error || "Falha ao enviar código");
                }}
                disabled={busy}
              >
                VER / EDITAR MEUS DADOS
              </Button>
            </>
          ) : (
            <>
              {state?.hasDetails && (
                <div className="text-sm space-y-1">
                  <p>CPF: {state.details?.cpf || "—"}</p>
                  <p>E-mail: {state.details?.email || "—"}</p>
                  <p>
                    Endereço: {state.details?.address || "—"}, {state.details?.address_number || ""} —{" "}
                    {state.details?.city || ""}/{state.details?.state || ""}
                  </p>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-primary bg-primary/10 font-bold"
                onClick={() => {
                  setForm({ full_name: state?.name || "", ...(state?.details || {}) });
                  setDetailsOpen(true);
                }}
              >
                {state?.hasDetails ? "EDITAR MEUS DADOS" : "PREENCHER MEUS DADOS"}
              </Button>
            </>
          )}
        </section>

        <a
          href="https://wa.me/5533999999999"
          className="mt-5 flex items-center justify-center gap-2 h-14 rounded-2xl border-2 border-border font-semibold"
        >
          <MessageCircle className="h-5 w-5" /> Falar com uma vendedora
        </a>
      </div>

      {/* Modal: confirmar pedido */}
      {confirmOpen && order && order.products.length > 0 && !order.confirmed_at && !order.is_paid && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-center">Confirma este pedido?</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {order.products.map((p: any, i: number) => (
                <div key={i} className="flex gap-3 items-center">
                  {p.image && <img src={p.image} alt={p.title} className="w-14 h-14 rounded-lg object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.variant}</p>
                  </div>
                  <span className="text-sm font-bold">{brl(Number(p.price || 0))}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>{brl(order.total)}</span>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Ao confirmar você tem 20 minutos para pagar. O estoque só é reservado após o pagamento.
            </p>
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={busy}
              onClick={async () => {
                const res = await act({ action: "confirm_order" });
                if (res?.ok) {
                  setConfirmOpen(false);
                  toast.success("Pedido confirmado!");
                }
              }}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "CONFIRMAR"}
            </Button>
            <Button
              variant="ghost"
              className="w-full h-12"
              onClick={() => {
                confirmDismissedRef.current = order.id;
                setConfirmOpen(false);
              }}
            >
              Agora não
            </Button>
          </div>
        </div>
      )}

      {/* Modal: OTP */}
      {otpOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-center">Digite o código do WhatsApp</h3>
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="h-16 text-center text-2xl font-bold tracking-[0.5em]"
              autoFocus
            />
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={otp.length < 4 || busy}
              onClick={async () => {
                const res = await act({ action: "verify_otp", code: otp });
                if (res?.ok) {
                  setOtpOpen(false);
                  setOtp("");
                  toast.success("Dados liberados por 30 minutos");
                } else toast.error(res?.error || "Código inválido");
              }}
            >
              LIBERAR MEUS DADOS
            </Button>
            <Button variant="ghost" className="w-full h-12" onClick={() => setOtpOpen(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {/* Modal: dados pessoais */}
      {detailsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto">
          <div className="bg-background min-h-screen sm:min-h-0 sm:max-w-md sm:mx-auto sm:mt-10 sm:rounded-3xl p-6 space-y-3">
            <button
              onClick={() => setDetailsOpen(false)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <h3 className="text-lg font-bold">Meus dados</h3>
            {[
              ["full_name", "Nome completo"],
              ["cpf", "CPF"],
              ["email", "E-mail"],
              ["cep", "CEP"],
              ["address", "Endereço"],
              ["address_number", "Número"],
              ["complement", "Complemento"],
              ["neighborhood", "Bairro"],
              ["city", "Cidade"],
              ["state", "UF"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label className="text-sm">{label}</Label>
                <Input
                  value={form[k] ?? ""}
                  onChange={(e) => setForm((f: any) => ({ ...f, [k]: e.target.value }))}
                  className="h-14 text-[16px]"
                />
              </div>
            ))}
            <Button
              className="w-full h-16 text-base font-bold"
              disabled={busy}
              onClick={async () => {
                const res = await act({ action: "save_details", details: form });
                if (res?.ok) {
                  setDetailsOpen(false);
                  toast.success("Dados salvos!");
                } else if (res?.error === "otp_required") {
                  toast.error("Confirme o código do WhatsApp para editar seus dados");
                } else toast.error(res?.error || "Erro ao salvar");
              }}
            >
              SALVAR
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
