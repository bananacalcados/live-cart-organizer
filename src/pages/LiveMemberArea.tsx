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
  Loader2,
  Lock,
  MessageCircle,
  ShoppingBag,
  Timer,
  Trash2,
} from "lucide-react";

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
    shipping_cost: number;
    total: number;
    is_paid: boolean;
    confirmed_at: string | null;
    payment_window_expires_at: string | null;
    checkout_url: string;
  } | null;
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
  const pollRef = useRef<number | null>(null);

  const formatPhone = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  const applyState = useCallback(
    (data: any) => {
      if (!data?.ok) return;
      setState(data as MemberState);
      localStorage.setItem(TOKEN_KEY, data.token);
      setStep("area");
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

  // Atualização em tempo quase-real do pedido (itens novos anotados na live)
  useEffect(() => {
    if (step !== "area" || !state?.token) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await callApi({ action: "state", token: state.token });
        if (st?.ok) {
          setState(st);
          if (st.order && !st.order.confirmed_at && !st.order.is_paid) setConfirmOpen(true);
        }
      } catch {
        /* silencioso */
      }
    }, 15000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [step, state?.token]);

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
      <h1 className="text-xl font-bold px-6">{event?.name}</h1>
    </div>
  );

  // ---------- Etapa 1: WhatsApp ----------
  if (step === "phone") {
    return (
      <div className="min-h-screen bg-background text-foreground px-6">
        <div className="max-w-sm mx-auto">
          {Header}
          <p className="text-muted-foreground text-center text-sm mb-6">
            Digite seu WhatsApp para entrar na sua área e ver seus produtos.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enter();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label className="text-base">Seu WhatsApp</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(33) 99999-9999"
                inputMode="tel"
                className="h-16 text-[18px]"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              disabled={phone.replace(/\D/g, "").length < 10 || busy}
              className="w-full h-16 text-base font-bold gap-2"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShoppingBag className="h-5 w-5" />}
              ENTRAR NA MINHA ÁREA
            </Button>
          </form>
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

        {/* Meu pedido */}
        <section className="rounded-2xl border-2 border-border p-4 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" /> Meu pedido
          </h2>

          {!order || order.products.length === 0 ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-muted-foreground text-sm">
                Você ainda não tem nenhum produto reservado.
              </p>
              <p className="text-muted-foreground text-xs">
                Comente na live o produto e o tamanho que você quer — a gente reserva pra você aqui.
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
              <div className="flex justify-between items-center pt-1">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-xl font-bold">{brl(order.total)}</span>
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
            <Button variant="ghost" className="w-full h-12" onClick={() => setConfirmOpen(false)}>
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
