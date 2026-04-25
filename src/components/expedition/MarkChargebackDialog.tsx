import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface ChargebackPrefill {
  source: 'shopify' | 'pos' | 'expedition_beta' | 'manual';
  source_order_id?: string;
  source_order_name?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_cpf?: string;
  address_cep?: string;
  address_number?: string;
  address_street?: string;
  address_neighborhood?: string;
  address_city?: string;
  address_state?: string;
  address_complement?: string;
  amount?: number;
}

interface Props {
  prefill?: ChargebackPrefill;
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function MarkChargebackDialog({ prefill, trigger, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ChargebackPrefill & { reason: string; chargeback_date: string }>({
    source: prefill?.source || 'manual',
    source_order_id: prefill?.source_order_id || '',
    source_order_name: prefill?.source_order_name || '',
    customer_name: prefill?.customer_name || '',
    customer_email: prefill?.customer_email || '',
    customer_phone: prefill?.customer_phone || '',
    customer_cpf: prefill?.customer_cpf || '',
    address_cep: prefill?.address_cep || '',
    address_number: prefill?.address_number || '',
    address_street: prefill?.address_street || '',
    address_neighborhood: prefill?.address_neighborhood || '',
    address_city: prefill?.address_city || '',
    address_state: prefill?.address_state || '',
    address_complement: prefill?.address_complement || '',
    amount: prefill?.amount || 0,
    reason: '',
    chargeback_date: new Date().toISOString().slice(0, 10),
  });

  const handleSubmit = async () => {
    if (!form.customer_name) {
      return toast.error('Nome do cliente é obrigatório');
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('chargebacks').insert({
      ...form,
      amount: form.amount || null,
      created_by: user?.id,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Chargeback registrado! Cliente marcado para verificação.');
    setOpen(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="destructive" size="sm" className="gap-1">
            <ShieldAlert className="h-3 w-3" /> Marcar Chargeback
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Registrar Chargeback
          </DialogTitle>
          <DialogDescription>
            Este cliente e o endereço serão marcados. Pedidos futuros com este nome OU mesmo endereço receberão alerta na expedição.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Nº do pedido (#1234)" value={form.source_order_name}
              onChange={(e) => setForm(f => ({ ...f, source_order_name: e.target.value }))} />
            <Input type="date" value={form.chargeback_date}
              onChange={(e) => setForm(f => ({ ...f, chargeback_date: e.target.value }))} />
          </div>
          <Input placeholder="Nome do cliente *" value={form.customer_name}
            onChange={(e) => setForm(f => ({ ...f, customer_name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="CPF" value={form.customer_cpf}
              onChange={(e) => setForm(f => ({ ...f, customer_cpf: e.target.value }))} />
            <Input placeholder="WhatsApp" value={form.customer_phone}
              onChange={(e) => setForm(f => ({ ...f, customer_phone: e.target.value }))} />
          </div>
          <Input placeholder="Email" value={form.customer_email}
            onChange={(e) => setForm(f => ({ ...f, customer_email: e.target.value }))} />

          <div className="border-t pt-3">
            <p className="text-sm font-semibold mb-2">📍 Endereço (para detecção de golpe)</p>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="CEP" value={form.address_cep}
                onChange={(e) => setForm(f => ({ ...f, address_cep: e.target.value }))} />
              <Input className="col-span-2" placeholder="Rua" value={form.address_street}
                onChange={(e) => setForm(f => ({ ...f, address_street: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Input placeholder="Número" value={form.address_number}
                onChange={(e) => setForm(f => ({ ...f, address_number: e.target.value }))} />
              <Input placeholder="Complemento" value={form.address_complement}
                onChange={(e) => setForm(f => ({ ...f, address_complement: e.target.value }))} />
              <Input placeholder="Bairro" value={form.address_neighborhood}
                onChange={(e) => setForm(f => ({ ...f, address_neighborhood: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input placeholder="Cidade" value={form.address_city}
                onChange={(e) => setForm(f => ({ ...f, address_city: e.target.value }))} />
              <Input placeholder="UF" maxLength={2} value={form.address_state}
                onChange={(e) => setForm(f => ({ ...f, address_state: e.target.value.toUpperCase() }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <Input type="number" step="0.01" placeholder="Valor (R$)" value={form.amount}
              onChange={(e) => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
            <select className="border rounded-md px-3 text-sm bg-background"
              value={form.source}
              onChange={(e) => setForm(f => ({ ...f, source: e.target.value as any }))}>
              <option value="manual">Manual</option>
              <option value="shopify">Shopify</option>
              <option value="pos">PDV</option>
              <option value="expedition_beta">Expedição Beta</option>
            </select>
          </div>
          <Textarea placeholder="Motivo / observações" value={form.reason}
            onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} rows={3} />

          <Button onClick={handleSubmit} disabled={loading} variant="destructive" className="w-full">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Registrar Chargeback
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
