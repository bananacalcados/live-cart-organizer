import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, Clock, MessageCircle, CheckCircle2 } from "lucide-react";
import { SelfServicePrizeBanner } from "@/components/live/SelfServicePrizeBanner";
import { toast } from "sonner";
import { buildInstallmentOptions, parseInstallmentRule, resolveSelfServiceInstallments, type InstallmentConfig } from "@/lib/installmentRules";
import { maskCpf, maskCep, maskPhoneBR, digitsOnly } from "@/lib/formatMasks";
import { isValidCpf } from "@/lib/cpfUtils";
import { isRealFullName, isUsableEmail } from "@/lib/customerIdentity";
import { formatMmSs, registrationDeadline } from "@/lib/liveModes";
import { openWhatsAppDeepLink } from "@/lib/waDeepLink";
import { completeInitialPhone } from "@/lib/selfServiceInitial";

type Ev = {
  id: string; name: string; prize_name: string | null; prize_image_url: string | null;
  registration_minutes: number; product_notice: string | null; official_phone: string | null;
  official_last4: string | null; installment_max: number | null; installment_min_value: number | null;
  pix_discount_percent: number;
};
type Ord = {
  id: string; products: { title: string; variant?: string; price: number; quantity: number; image?: string | null }[];
  total: number; pix_total: number; created_at: string; payment_window_expires_at: string | null; registered_at: string | null;
};
type Screen = "identify" | "product" | "no_order" | "code" | "register" | "confirm_wa";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("live-selfservice", { body });
  if (error) {
    try { const j = await (error as any).context?.json?.(); if (j) return j; } catch { /* ignore */ }
    return { ok: false, error: "Falha de conexão. Tente de novo." };
  }
  return data;
}

export default function SelfServiceOrderPage() {
  const { eventSlug = "" } = useParams();
  const slug = eventSlug.toLowerCase();
  const [ev, setEv] = useState<Ev | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [screen, setScreen] = useState<Screen>("identify");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [accessId, setAccessId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Ord[]>([]);
  const [known, setKnown] = useState(false);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({ full_name: "", cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "", cpf: "", email: "" });
  const [useAlt, setUseAlt] = useState(false);
  const [alt, setAlt] = useState({ cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "" });
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig | null>(null);
  const captured = useRef<{ phone: string; accessId: string } | null>(null);
  const latestPhone = useRef(phone);
  latestPhone.current = phone;

  useEffect(() => {
    if (screen !== "identify") return;
    const fullPhone = completeInitialPhone(phone);
    if (!fullPhone || captured.current?.phone === fullPhone) return;
    const timer = setTimeout(async () => {
      const result = await call({ action: "capture", slug, phone: fullPhone, instagram });
      if (result?.ok && result.access_id && completeInitialPhone(latestPhone.current) === fullPhone) {
        captured.current = { phone: fullPhone, accessId: result.access_id };
        setAccessId(result.access_id);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [phone, instagram, screen, slug]);

  useEffect(() => {
    call({ action: "event", slug }).then((r) => (r?.ok ? setEv(r.event) : setNotFound(true)));
  }, [slug]);

  // Relógio só para os cronômetros na tela (não busca dados).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const primary = orders[0] || null;
  const reserveLeft = primary?.payment_window_expires_at ? new Date(primary.payment_window_expires_at).getTime() - now : null;
  const reserveExpired = reserveLeft !== null && reserveLeft <= 0;
  const prizeLeft = primary && ev ? registrationDeadline(primary.created_at, ev.registration_minutes) - now : 0;
  const prizeActive = !!ev?.prize_name && !!primary && !primary.registered_at && prizeLeft > 0;
  const totalAll = orders.reduce((s, o) => s + o.total, 0);
  const pixAll = orders.reduce((s, o) => s + o.pix_total, 0);
  const waLink = ev?.official_phone ? `https://wa.me/${ev.official_phone}` : null;

  useEffect(() => {
    if (!ev || !primary) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "installment_config").maybeSingle();
      const base = !error ? parseInstallmentRule(data?.value) : null;
      if (!cancelled) setInstallmentConfig(base);
    })();
    return () => { cancelled = true; };
  }, [ev, primary?.id, primary?.total]);

  const identify = async () => {
    const d = digitsOnly(phone);
    if (d.length < 10 || d.length > 13) { toast.error("Digite o WhatsApp completo com DDD."); return; }
    setBusy(true);
    const r = await call({ action: "identify", slug, phone: d, instagram, access_id: captured.current?.phone === completeInitialPhone(d) ? captured.current.accessId : null });
    setBusy(false);
    if (!r?.ok) { toast.error(r?.error || "Não foi possível buscar agora."); return; }
    setAccessId(r.access_id); setKnown(!!r.known); setOrders(r.orders || []);
    // @ do Instagram descoberto pelo WhatsApp (o pedido da live já tem o @ anexado).
    if (r.instagram_hint) setInstagram(String(r.instagram_hint));
    const sd = r.details;
    if (sd) setForm((f) => ({
      ...f,
      full_name: sd.full_name || f.full_name, cep: maskCep(sd.cep || f.cep), address: sd.address || f.address,
      address_number: sd.address_number || f.address_number, complement: sd.complement || f.complement, neighborhood: sd.neighborhood || f.neighborhood,
      city: sd.city || f.city, state: sd.state || f.state, cpf: maskCpf(sd.cpf || f.cpf), email: sd.email || f.email,
    }));
    // Rascunho de uma visita anterior tem prioridade: ela continua de onde parou.
    const dr = r.draft as Record<string, string> | null;
    if (dr) {
      setForm((f) => {
        const next = { ...f };
        for (const [k, v] of Object.entries(dr)) if (v && k in next) (next as any)[k] = v;
        return next;
      });
      setUseAlt(dr.use_alt === "1");
      setAlt((a) => {
        const next = { ...a };
        for (const k of Object.keys(next) as (keyof typeof next)[]) {
          const v = dr[`alt_${k}`];
          if (v) next[k] = v;
        }
        return next;
      });
    }
    if ((r.orders || []).length) {
      setScreen("product");
      call({ action: "viewed", slug, phone: d, access_id: r.access_id });
    } else setScreen("no_order");
  };

  // Sem código de confirmação: o WhatsApp real chega no redirecionamento final.
  const goRegister = () => setScreen("register");

  // Rascunho em tempo real: 1 s após parar de digitar, os campos vão para o
  // backend e aparecem na ficha da cliente no chat da live (sem confirmar).
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (screen !== "register" || !accessId) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const altFields = Object.fromEntries(Object.entries(alt).map(([k, v]) => [`alt_${k}`, v]));
      call({ action: "draft", slug, phone: digitsOnly(phone), access_id: accessId, details: { ...form, use_alt: useAlt ? "1" : "", ...altFields } });
    }, 1000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [form, alt, useAlt, screen, accessId, slug, phone]);

  const verify = async () => {
    setBusy(true);
    const r = await call({ action: "verify_code", slug, phone: digitsOnly(phone), code });
    setBusy(false);
    if (!r?.ok) { toast.error(r?.error || "Código incorreto."); return; }
    const d = r.details || {};
    setForm((f) => ({
      ...f,
      full_name: d.full_name || f.full_name, cep: maskCep(d.cep || ""), address: d.address || "",
      address_number: d.address_number || "", complement: d.complement || "", neighborhood: d.neighborhood || "",
      city: d.city || "", state: d.state || "", cpf: maskCpf(d.cpf || ""), email: d.email || "",
    }));
    setScreen("register");
  };

  const lookupCep = async (v: string) => {
    const d = digitsOnly(v);
    if (d.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await res.json();
      if (j?.erro) { toast.error("CEP não encontrado."); return; }
      setForm((f) => ({ ...f, address: j.logradouro || f.address, neighborhood: j.bairro || f.neighborhood, city: j.localidade || f.city, state: j.uf || f.state }));
    } catch { /* cliente digita manualmente */ }
  };

  const lookupAltCep = async (v: string) => {
    const d = digitsOnly(v);
    if (d.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await res.json();
      if (j?.erro) { toast.error("CEP não encontrado."); return; }
      setAlt((a) => ({ ...a, address: j.logradouro || a.address, neighborhood: j.bairro || a.neighborhood, city: j.localidade || a.city, state: j.uf || a.state }));
    } catch { /* cliente digita manualmente */ }
  };

  const cpfOk = isValidCpf(form.cpf);
  const altOk = !useAlt || (digitsOnly(alt.cep).length === 8 && alt.address.trim() && alt.address_number.trim() && alt.city.trim() && alt.state.trim());
  const canSubmit = isRealFullName(form.full_name) && cpfOk && isUsableEmail(form.email) && digitsOnly(form.cep).length === 8
    && form.address.trim() && form.address_number.trim() && form.city.trim() && form.state.trim() && altOk;

  const submit = async () => {
    if (!canSubmit) { toast.error("Confira os campos destacados."); return; }
    setBusy(true);
    const r = await call({
      action: "register", slug, phone: digitsOnly(phone), code, access_id: accessId, instagram: instagram || null,
      order_ids: orders.map((o) => o.id), details: form, alt_address: useAlt ? alt : null,
    });
    setBusy(false);
    if (!r?.ok) {
      toast.error(r?.error || "Não foi possível salvar."); return;
    }
    // Fim do cadastro = confirmação no WhatsApp (mesmo deep link do /zap).
    if (!r.wa_url) { toast.error("WhatsApp oficial não configurado neste evento."); return; }
    setConfirmUrl(r.wa_url);
    setScreen("confirm_wa");
    openWhatsAppDeepLink(r.wa_url);
  };

  const footer = (
    <p className="mt-6 text-center text-xs text-muted-foreground">
      <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
      Único WhatsApp oficial da Banana: <strong>{ev?.official_phone ? maskPhoneBR(ev.official_phone) : "não configurado"}</strong>. Qualquer outro número é golpe.
    </p>
  );

  const items = useMemo(() => orders.flatMap((o) => o.products), [orders]);
  // Cada carrinho é pago separadamente: somar pedidos não libera uma oferta indevida.
  const offers = installmentConfig ? orders.map((o) => {
    const config = resolveSelfServiceInstallments(installmentConfig, o.total, ev?.installment_max, ev?.installment_min_value);
    const options = buildInstallmentOptions(o.total, config);
    return { free: options.filter((p) => !p.hasInterest).at(-1), interest: options.filter((p) => p.hasInterest).at(-1) };
  }) : [];
  const freeCount = offers.length ? Math.min(...offers.map((o) => o.free?.installments || 1)) : 0;
  const interestCount = offers.length ? Math.min(...offers.map((o) => o.interest?.installments || 0)) : 0;

  if (notFound) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">Link não encontrado.</div>;
  if (!ev) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md p-4">
        <h1 className="mb-1 text-center text-xl font-bold">{ev.name}</h1>
        <p className="mb-5 text-center text-sm text-muted-foreground">Banana Calçados · pedido da live</p>

        {screen === "identify" && (
          <div className="space-y-4 rounded-2xl border p-4">
            <div className="space-y-1">
              <Label>Seu WhatsApp com DDD</Label>
              <Input inputMode="tel" autoComplete="tel" placeholder="(33) 9.9999-9999" value={maskPhoneBR(phone)} onChange={(e) => setPhone(digitsOnly(e.target.value))} className="h-14 text-lg" />
            </div>
            <div className="space-y-1">
              <Label>@ do Instagram (opcional)</Label>
              <Input placeholder="@seuinsta" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
            </div>
            <Button className="h-14 w-full text-base font-bold" onClick={identify} disabled={busy}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continuar"}
            </Button>
          </div>
        )}

        {screen === "product" && primary && (
          <div className="space-y-4">
            {items.map((p, i) => (
              <div key={i} className="flex gap-3 rounded-2xl border p-3">
                {p.image && <img src={p.image} alt={p.title} className="h-24 w-24 rounded-lg object-cover" />}
                <div className="flex-1">
                  <p className="font-semibold leading-tight">{p.title}</p>
                  {p.variant && <p className="text-sm text-muted-foreground">{p.variant}</p>}
                  <p className="mt-1 text-sm">{p.quantity}x {brl(p.price)}</p>
                </div>
              </div>
            ))}
            <div className="rounded-2xl border p-3 text-sm">
              <p className="text-lg font-bold">{brl(pixAll)} no Pix</p>
              <p className="text-muted-foreground">ou {brl(totalAll)} no cartão</p>
              {freeCount > 0 && <p className="font-semibold">Até {freeCount}x sem juros{orders.length === 1 && offers[0]?.free ? ` de ${brl(offers[0].free.installmentAmount)}` : " por pedido"}</p>}
              {interestCount > 0 && <p className="text-muted-foreground">Ou até {interestCount}x com juros — parcelas e total apresentados antes de pagar.</p>}
              {orders.length > 1 && <p className="text-xs text-muted-foreground">As condições são calculadas pelo valor de cada pedido.</p>}
              {ev.product_notice && <p className="mt-2 text-xs text-muted-foreground">{ev.product_notice}</p>}
            </div>
            {reserveLeft !== null && !reserveExpired && (
              <div className="flex items-center gap-2 rounded-2xl bg-muted p-3 text-sm">
                <Clock className="h-4 w-4" /> Reservado pra você por <strong>{formatMmSs(reserveLeft)}</strong>
              </div>
            )}
            {ev.prize_name && (
              <SelfServicePrizeBanner name={ev.prize_name} image={ev.prize_image_url} left={prizeLeft} active={prizeActive} description={prizeActive ? "Confirme seus dados antes do tempo acabar para concorrer ao sorteio." : primary.registered_at ? "Confira e confirme seus dados para concluir seu cadastro no WhatsApp." : "O prazo para cadastrar e concorrer terminou. Você ainda pode confirmar seus dados."} />
            )}
            {reserveExpired ? (
              <div className="space-y-3 rounded-2xl border border-destructive/40 p-4 text-center">
                <p className="font-semibold">Reserva expirada — fale no WhatsApp</p>
                {waLink && <Button asChild className="w-full"><a href={waLink} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Falar no WhatsApp</a></Button>}
              </div>
            ) : (
              <>
                <Button className="h-14 w-full text-base font-bold" onClick={goRegister} disabled={busy}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : prizeActive ? "Confirmar meus dados e concorrer" : "Confirmar meus dados"}
                </Button>
              </>
            )}
          </div>
        )}

        {screen === "no_order" && (
          <div className="space-y-4 rounded-2xl border p-4 text-center">
            <p>Ainda não encontrei um pedido seu nesta live. Faça seu cadastro agora: quando você pedir na live, seu link já vem pronto e você já concorre.</p>
            <Button className="h-14 w-full text-base font-bold" onClick={goRegister} disabled={busy}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Fazer meu cadastro"}
            </Button>
          </div>
        )}

        {screen === "code" && (
          <div className="space-y-4 rounded-2xl border p-4">
            <p className="text-center font-semibold">Já te conhecemos! Enviamos um código no seu WhatsApp</p>
            <Input inputMode="numeric" autoComplete="one-time-code" placeholder="Código" value={code} onChange={(e) => setCode(digitsOnly(e.target.value).slice(0, 8))} className="h-14 text-center text-2xl tracking-widest" />
            <Button className="h-14 w-full font-bold" onClick={verify} disabled={busy || code.length < 4}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar código"}
            </Button>
            <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={goRegister}>Reenviar código</button>
          </div>
        )}

        {screen === "register" && (
          <div className="space-y-3">
            {prizeActive && (
              <SelfServicePrizeBanner name={ev.prize_name || ""} image={ev.prize_image_url} left={prizeLeft} active={prizeActive} description="Conclua seu cadastro antes do tempo acabar para concorrer ao sorteio." />
            )}
            {!prizeActive && <p className="text-sm text-muted-foreground">Conclua esta etapa pra terminar seu cadastro.</p>}
            {known && <p className="text-xs text-muted-foreground">Já preenchemos com seu último cadastro — só confira.</p>}
            <div className="space-y-1"><Label>Nome completo</Label><Input autoComplete="name" value={form.full_name} onChange={set("full_name")} /></div>
            <div className="space-y-1"><Label>CEP</Label><Input inputMode="numeric" value={form.cep} onChange={(e) => { const v = maskCep(e.target.value); setForm((f) => ({ ...f, cep: v })); lookupCep(v); }} /></div>
            <div className="space-y-1"><Label>Rua</Label><Input value={form.address} onChange={set("address")} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Número</Label><Input value={form.address_number} onChange={set("address_number")} /></div>
              <div className="space-y-1"><Label>Complemento</Label><Input value={form.complement} onChange={set("complement")} /></div>
            </div>
            <div className="space-y-1"><Label>Bairro</Label><Input value={form.neighborhood} onChange={set("neighborhood")} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1"><Label>Cidade</Label><Input value={form.city} onChange={set("city")} /></div>
              <div className="space-y-1"><Label>UF</Label><Input maxLength={2} value={form.state} onChange={set("state")} /></div>
            </div>
            <button type="button" className="text-sm font-semibold text-primary underline" onClick={() => setUseAlt((v) => !v)}>
              {useAlt ? "Usar meu endereço principal" : "Enviar para outro endereço"}
            </button>
            {useAlt && (
              <div className="space-y-3 rounded-xl border border-primary/40 p-3">
                <p className="text-xs font-semibold text-muted-foreground">Endereço de entrega deste pedido (seu endereço principal continua salvo)</p>
                <div className="space-y-1"><Label>CEP de entrega</Label><Input inputMode="numeric" value={alt.cep} onChange={(e) => { const v = maskCep(e.target.value); setAlt((a) => ({ ...a, cep: v })); lookupAltCep(v); }} /></div>
                <div className="space-y-1"><Label>Rua</Label><Input value={alt.address} onChange={(e) => setAlt((a) => ({ ...a, address: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Número</Label><Input value={alt.address_number} onChange={(e) => setAlt((a) => ({ ...a, address_number: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Complemento</Label><Input value={alt.complement} onChange={(e) => setAlt((a) => ({ ...a, complement: e.target.value }))} /></div>
                </div>
                <div className="space-y-1"><Label>Bairro</Label><Input value={alt.neighborhood} onChange={(e) => setAlt((a) => ({ ...a, neighborhood: e.target.value }))} /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1"><Label>Cidade</Label><Input value={alt.city} onChange={(e) => setAlt((a) => ({ ...a, city: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>UF</Label><Input maxLength={2} value={alt.state} onChange={(e) => setAlt((a) => ({ ...a, state: e.target.value }))} /></div>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>CPF</Label>
              <Input inputMode="numeric" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: maskCpf(e.target.value) }))} aria-invalid={digitsOnly(form.cpf).length === 11 && !cpfOk} />
              {digitsOnly(form.cpf).length === 11 && !cpfOk && <p className="text-xs text-destructive">CPF inválido</p>}
            </div>
            <div className="space-y-1"><Label>E-mail</Label><Input type="email" autoComplete="email" value={form.email} onChange={set("email")} /></div>
            <Button className="h-14 w-full text-base font-bold" onClick={submit} disabled={busy || !canSubmit}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><MessageCircle className="mr-2 h-5 w-5" />CONFIRMAR CADASTRO NO WHATSAPP</>}
            </Button>
          </div>
        )}

        {screen === "confirm_wa" && (
          <div className="space-y-4 rounded-2xl border p-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <p className="font-semibold">Falta só um passo: envie a mensagem que abriu no WhatsApp</p>
            <p className="text-sm text-muted-foreground">
              {orders.length ? "Assim que ela chegar, a gente te responde com o link do seu carrinho." : "Assim que ela chegar, seu cadastro fica confirmado."}
            </p>
            {confirmUrl && (
              <Button asChild className="h-14 w-full text-base font-bold">
                <a href={confirmUrl} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-5 w-5" />Abrir o WhatsApp</a>
              </Button>
            )}
          </div>
        )}

        {footer}
      </div>
    </div>
  );
}
