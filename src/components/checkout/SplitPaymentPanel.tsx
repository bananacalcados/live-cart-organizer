import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Copy, CreditCard, Loader2, Plus, QrCode, Split, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { initMercadoPago, tokenizeCardMP } from "@/lib/mercadopago";
import {
  MAX_SPLIT_PARTS, SPLIT_METHOD_LABEL, rebalanceLastPart, validateSplit,
  type SplitMethod, type SplitPartInput,
} from "@/lib/splitPayment";

interface Part {
  id: string; seq: number; method: SplitMethod; amount: number; discount_amount: number;
  charge_amount: number; installments: number; status: string;
}

interface Payer { fullName: string; email: string; cpf: string }

interface Props {
  orderId?: string;
  saleId?: string;
  total: number;
  form: Payer;
  maxInstallments?: number;
  onPaid: () => void;
  /** Pagamento normal (exibido quando não há divisão). */
  children: ReactNode;
}

const BRL = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("split-payment", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function SplitPaymentPanel({ orderId, saleId, total, form, maxInstallments = 6, onPaid, children }: Props) {
  const target = orderId ? { orderId } : { saleId };
  const [enabled, setEnabled] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [pixPct, setPixPct] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const paidFired = useRef(false);

  const load = useCallback(async () => {
    if (!orderId && !saleId) return;
    try {
      const d = await call({ action: "get", ...target });
      setEnabled(!!d.enabled);
      setParts(d.parts || []);
      setPixPct(Number(d.pix_discount_pct) || 0);
    } catch { /* sem divisão: segue normal */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, saleId]);

  useEffect(() => { load(); }, [load]);

  const allPaid = parts.length > 0 && parts.every((p) => p.status === "approved");
  useEffect(() => {
    if (allPaid && !paidFired.current) { paidFired.current = true; onPaid(); }
  }, [allPaid, onPaid]);

  if (!loaded) return <>{children}</>;

  const anyPaid = parts.some((p) => p.status === "approved");
  const sumParts = parts.reduce((a, p) => a + Number(p.amount), 0);
  const totalMismatch = parts.length > 0 && !anyPaid && Math.abs(sumParts - total) > 0.009;

  if (editing || (parts.length > 0 && totalMismatch)) {
    return (
      <SplitEditor
        total={total}
        pixPct={pixPct}
        maxInstallments={maxInstallments}
        initial={parts.length ? parts.map((p) => ({ method: p.method, amount: Number(p.amount), installments: p.installments })) : undefined}
        notice={totalMismatch ? "O valor do pedido mudou (frete). Confira a divisão." : undefined}
        onCancel={async () => {
          if (parts.length && !anyPaid) { try { await call({ action: "clear", ...target }); } catch { /* */ } }
          setParts([]); setEditing(false);
        }}
        onSave={async (list) => {
          const d = await call({ action: "setup", ...target, total, parts: list });
          setParts(d.parts || []); setEditing(false);
        }}
      />
    );
  }

  if (parts.length === 0) {
    return (
      <div className="space-y-3">
        {children}
        {enabled && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            <Split className="h-4 w-4" /> Pagar com mais de uma forma
          </button>
        )}
      </div>
    );
  }

  const active = parts.find((p) => p.status !== "approved");
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold flex items-center gap-2"><Split className="h-4 w-4" /> Pagamento em {parts.length} partes</p>
          {!anyPaid && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>Alterar</Button>}
        </div>
        {parts.map((p) => (
          <div key={p.id} className={`flex items-center justify-between text-sm rounded-md px-2 py-1.5 ${p.id === active?.id ? "bg-muted" : ""}`}>
            <span>
              {p.seq}. {SPLIT_METHOD_LABEL[p.method]}
              {p.method === "credit" && p.installments > 1 ? ` em até ${p.installments}x` : ""}
              {p.discount_amount > 0 && <span className="text-muted-foreground line-through ml-2 text-xs">{BRL(p.amount)}</span>}
            </span>
            <span className="flex items-center gap-2 font-semibold">
              {BRL(p.charge_amount)}
              {p.status === "approved"
                ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Pago</Badge>
                : <Badge variant="outline">Pendente</Badge>}
            </span>
          </div>
        ))}
      </div>

      {active && (active.method === "pix"
        ? <SplitPixPart key={active.id} part={active} form={form} onApproved={load} />
        : <SplitCardPart key={active.id} part={active} form={form} onApproved={load} />)}
      {allPaid && <p className="text-center text-sm font-semibold">Todas as partes pagas ✅</p>}
    </div>
  );
}

export function SplitEditor({ total, pixPct, maxInstallments, initial, notice, onSave, onCancel }: {
  total: number; pixPct: number; maxInstallments: number; initial?: SplitPartInput[]; notice?: string;
  onSave: (p: SplitPartInput[]) => Promise<void>; onCancel: () => void;
}) {
  const half = Math.round((total / 2) * 100) / 100;
  const [list, setList] = useState<SplitPartInput[]>(
    rebalanceLastPart(total, initial?.length ? initial : [{ method: "pix", amount: half }, { method: "credit", amount: 0, installments: 1 }]),
  );
  const [saving, setSaving] = useState(false);
  const v = validateSplit(total, list, maxInstallments);

  const update = (i: number, patch: Partial<SplitPartInput>) => {
    const next = list.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    if (patch.method && patch.method !== "credit") next[i].installments = 1;
    setList(i === list.length - 1 && patch.amount !== undefined ? next : rebalanceLastPart(total, next));
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><Split className="h-4 w-4" /> Dividir pagamento — total {BRL(total)}</p>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {list.map((p, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="w-28">
            <Label className="text-xs">Forma {i + 1}</Label>
            <Select value={p.method} onValueChange={(m) => update(i, { method: m as SplitMethod })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="credit">Crédito</SelectItem>
                <SelectItem value="debit">Débito</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <Label className="text-xs">Valor (R$)</Label>
            <Input className="h-9" type="number" inputMode="decimal" step="0.01" min="1" value={p.amount || ""}
              readOnly={i === list.length - 1}
              onChange={(e) => update(i, { amount: Number(e.target.value) })} />
          </div>
          {p.method === "credit" && (
            <div className="w-24">
              <Label className="text-xs">Parcelas</Label>
              <Select value={String(p.installments || 1)} onValueChange={(n) => update(i, { installments: Number(n) })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: maxInstallments }, (_, k) => k + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {p.method === "pix" && pixPct > 0 && p.amount > 0 && (
            <span className="text-xs text-muted-foreground pb-2">paga {BRL(Math.round(p.amount * (1 - pixPct / 100) * 100) / 100)} ({pixPct}% off)</span>
          )}
          {list.length > 2 && (
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setList(rebalanceLastPart(total, list.filter((_, k) => k !== i)))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {list.length < MAX_SPLIT_PARTS && (
        <Button variant="outline" size="sm" onClick={() => setList(rebalanceLastPart(total, [...list, { method: "credit", amount: 0, installments: 1 }]))}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar forma
        </Button>
      )}
      {!v.ok && <ul className="text-xs text-destructive space-y-0.5">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>Pagar de uma forma só</Button>
        <Button disabled={!v.ok || saving} onClick={async () => {
          setSaving(true);
          try { await onSave(list); } catch (e: any) { toast.error(e.message); }
          setSaving(false);
        }}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Continuar
        </Button>
      </div>
    </div>
  );
}

function SplitPixPart({ part, form, onApproved }: { part: Part; form: Payer; onApproved: () => void }) {
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pix) return;
    const t = setInterval(async () => {
      try {
        const d = await call({ action: "check", splitId: part.id });
        if (d.status === "approved") { clearInterval(t); toast.success(`Parte ${part.seq} paga!`); onApproved(); }
      } catch { /* tenta de novo */ }
    }, 4000);
    return () => clearInterval(t);
  }, [pix, part.id, part.seq, onApproved]);

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><QrCode className="h-4 w-4" /> Parte {part.seq}: Pix de {BRL(part.charge_amount)}</p>
      {!pix ? (
        <Button className="w-full" disabled={loading} onClick={async () => {
          setLoading(true);
          try { setPix(await call({ action: "create_pix", splitId: part.id, payer: { name: form.fullName, email: form.email, cpf: form.cpf } })); }
          catch (e: any) { toast.error(e.message); }
          setLoading(false);
        }}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Gerar Pix desta parte
        </Button>
      ) : (
        <div className="space-y-2 text-center">
          {pix.qrCodeBase64 && <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code Pix" className="mx-auto h-48 w-48" />}
          {pix.qrCode && (
            <Button variant="outline" className="w-full" onClick={() => { navigator.clipboard.writeText(pix.qrCode!); toast.success("Código Pix copiado"); }}>
              <Copy className="h-4 w-4 mr-2" /> Copiar código Pix
            </Button>
          )}
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Aguardando pagamento...</p>
          <Button variant="ghost" size="sm" onClick={() => setPix(null)}>Gerar novo Pix</Button>
        </div>
      )}
    </div>
  );
}

function SplitCardPart({ part, form, onApproved }: { part: Part; form: Payer; onApproved: () => void }) {
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState(form.fullName || "");
  const [exp, setExp] = useState("");
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const isDebit = part.method === "debit";

  useEffect(() => { initMercadoPago(); }, []);

  const pay = async () => {
    const [mm, yy] = exp.split("/").map((s) => s.trim());
    if (number.replace(/\D/g, "").length < 13 || !mm || !yy || cvv.length < 3 || !holder) {
      toast.error("Preencha os dados do cartão"); return;
    }
    setBusy(true);
    try {
      const tok = await tokenizeCardMP({
        number: number.replace(/\D/g, ""), holderName: holder, expMonth: mm.padStart(2, "0"),
        expYear: yy.length === 2 ? `20${yy}` : yy, cvv, cpf: form.cpf.replace(/\D/g, ""),
      }, isDebit ? "debit" : "credit");
      if (!tok) throw new Error(isDebit ? "Este cartão não aceita débito" : "Não foi possível validar o cartão");
      const d = await call({
        action: "charge_card", splitId: part.id, ...tok, attemptId: crypto.randomUUID(),
        customer: { name: form.fullName, email: form.email, cpf: form.cpf },
      });
      if (!d.success) throw new Error("Pagamento recusado. Confira os dados ou tente outro cartão.");
      toast.success(`Parte ${part.seq} paga!`);
      onApproved();
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2">
        <CreditCard className="h-4 w-4" /> Parte {part.seq}: {isDebit ? "Débito" : "Crédito"} {BRL(part.charge_amount)}
        {!isDebit && part.installments > 1 ? ` em ${part.installments}x` : ""}
      </p>
      <Input placeholder="Número do cartão" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
      <Input placeholder="Nome impresso no cartão" value={holder} onChange={(e) => setHolder(e.target.value)} />
      <div className="flex gap-2">
        <Input placeholder="MM/AA" value={exp} onChange={(e) => setExp(e.target.value)} />
        <Input placeholder="CVV" inputMode="numeric" maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} />
      </div>
      <Button className="w-full" disabled={busy} onClick={pay}>
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Pagar {BRL(part.charge_amount)}
      </Button>
    </div>
  );
}
