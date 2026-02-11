import { useState, useEffect } from "react";
import { DollarSign, Lock, Unlock, ArrowDown, ArrowUp, Calculator, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
  sellerId?: string;
}

interface CashRegister {
  id: string;
  opened_at: string;
  opening_balance: number;
  cash_sales: number;
  card_sales: number;
  pix_sales: number;
  other_sales: number;
  withdrawals: number;
  deposits: number;
  status: string;
}

export function POSCashRegister({ storeId, sellerId }: Props) {
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showMovement, setShowMovement] = useState<'withdraw' | 'deposit' | null>(null);
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementNotes, setMovementNotes] = useState("");

  useEffect(() => {
    loadOpenRegister();
  }, [storeId]);

  const loadOpenRegister = async () => {
    try {
      const { data, error } = await supabase
        .from('pos_cash_registers')
        .select('*')
        .eq('store_id', storeId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setRegister(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    const balance = parseFloat(openingBalance) || 0;
    try {
      const { data, error } = await supabase
        .from('pos_cash_registers')
        .insert({ store_id: storeId, seller_id: sellerId || null, opening_balance: balance })
        .select()
        .single();
      if (error) throw error;
      setRegister(data);
      setShowOpen(false);
      setOpeningBalance("");
      toast.success("Caixa aberto!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao abrir caixa");
    }
  };

  const handleClose = async () => {
    if (!register) return;
    const closing = parseFloat(closingBalance) || 0;
    const expected = (register.opening_balance || 0) + (register.cash_sales || 0) + (register.deposits || 0) - (register.withdrawals || 0);
    try {
      const { error } = await supabase
        .from('pos_cash_registers')
        .update({
          closed_at: new Date().toISOString(),
          closing_balance: closing,
          expected_balance: expected,
          difference: closing - expected,
          status: 'closed',
        })
        .eq('id', register.id);
      if (error) throw error;
      setRegister(null);
      setShowClose(false);
      setClosingBalance("");
      toast.success("Caixa fechado!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao fechar caixa");
    }
  };

  const handleMovement = async () => {
    if (!register || !showMovement) return;
    const amount = parseFloat(movementAmount) || 0;
    if (amount <= 0) return;

    const field = showMovement === 'withdraw' ? 'withdrawals' : 'deposits';
    const current = (register as any)[field] || 0;

    try {
      const { error } = await supabase
        .from('pos_cash_registers')
        .update({ [field]: current + amount, notes: movementNotes || null })
        .eq('id', register.id);
      if (error) throw error;
      setRegister(r => r ? { ...r, [field]: current + amount } : r);
      setShowMovement(null);
      setMovementAmount("");
      setMovementNotes("");
      toast.success(showMovement === 'withdraw' ? 'Sangria registrada!' : 'Reforço registrado!');
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar movimentação");
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-pos-white/50">Carregando...</div>;
  }

  const expectedBalance = register
    ? (register.opening_balance || 0) + (register.cash_sales || 0) + (register.deposits || 0) - (register.withdrawals || 0)
    : 0;

  const totalSales = register
    ? (register.cash_sales || 0) + (register.card_sales || 0) + (register.pix_sales || 0) + (register.other_sales || 0)
    : 0;

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-pos-white">Controle de Caixa</h2>
          <p className="text-sm text-pos-white/50">Abertura, fechamento e movimentações</p>
        </div>
        {register ? (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
            <Unlock className="h-3 w-3" /> Aberto
          </Badge>
        ) : (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1">
            <Lock className="h-3 w-3" /> Fechado
          </Badge>
        )}
      </div>

      {!register ? (
        <div className="text-center py-16 space-y-4">
          <div className="h-20 w-20 mx-auto rounded-full bg-pos-yellow/10 flex items-center justify-center">
            <DollarSign className="h-10 w-10 text-pos-yellow" />
          </div>
          <h3 className="text-xl font-bold text-pos-white">Caixa Fechado</h3>
          <p className="text-pos-white/50">Abra o caixa para começar a registrar vendas</p>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2 h-12 px-8" onClick={() => setShowOpen(true)}>
            <Unlock className="h-5 w-5" /> Abrir Caixa
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-pos-white/50">
            <Clock className="h-3 w-3" />
            Aberto em: {new Date(register.opened_at).toLocaleString('pt-BR')}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-pos-white/5 border-pos-yellow/20">
              <CardContent className="p-4">
                <p className="text-xs text-pos-white/50">Abertura</p>
                <p className="text-lg font-bold text-pos-white">R$ {(register.opening_balance || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/20">
              <CardContent className="p-4">
                <p className="text-xs text-pos-white/50">Vendas Total</p>
                <p className="text-lg font-bold text-pos-yellow">R$ {totalSales.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/20">
              <CardContent className="p-4">
                <p className="text-xs text-pos-white/50">Sangrias</p>
                <p className="text-lg font-bold text-red-400">- R$ {(register.withdrawals || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/20">
              <CardContent className="p-4">
                <p className="text-xs text-pos-white/50">Saldo Esperado</p>
                <p className="text-lg font-bold text-pos-orange">R$ {expectedBalance.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          <Separator className="bg-pos-yellow/20" />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="bg-pos-white/5 border-pos-yellow/10">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-pos-white/40">Dinheiro</p>
                <p className="font-bold text-sm text-pos-white">R$ {(register.cash_sales || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/10">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-pos-white/40">Cartão</p>
                <p className="font-bold text-sm text-pos-white">R$ {(register.card_sales || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/10">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-pos-white/40">PIX</p>
                <p className="font-bold text-sm text-pos-white">R$ {(register.pix_sales || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-pos-white/5 border-pos-yellow/10">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-pos-white/40">Outros</p>
                <p className="font-bold text-sm text-pos-white">R$ {(register.other_sales || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-3">
            <Button className="flex-1 gap-2 border-2 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20" variant="outline" onClick={() => setShowMovement('withdraw')}>
              <ArrowUp className="h-4 w-4" /> Sangria
            </Button>
            <Button className="flex-1 gap-2 border-2 border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20" variant="outline" onClick={() => setShowMovement('deposit')}>
              <ArrowDown className="h-4 w-4" /> Reforço
            </Button>
            <Button className="flex-1 gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => setShowClose(true)}>
              <Lock className="h-4 w-4" /> Fechar Caixa
            </Button>
          </div>
        </div>
      )}

      {/* Open Dialog */}
      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent className="bg-pos-black border-pos-yellow/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><Unlock className="h-5 w-5 text-pos-yellow" /> Abrir Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Valor de abertura (fundo de troco)</Label>
              <Input type="number" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
            </div>
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12" onClick={handleOpen}>Abrir Caixa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Dialog */}
      <Dialog open={showClose} onOpenChange={setShowClose}>
        <DialogContent className="bg-pos-black border-pos-yellow/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><Lock className="h-5 w-5 text-pos-orange" /> Fechar Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-yellow/20 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-pos-white/50">Saldo esperado:</span>
                <span className="font-bold text-pos-yellow">R$ {expectedBalance.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Valor contado no caixa</Label>
              <Input type="number" value={closingBalance} onChange={e => setClosingBalance(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
            </div>
            {closingBalance && (
              <div className="p-3 rounded-xl bg-pos-white/5 border border-pos-yellow/20">
                <div className="flex justify-between text-sm">
                  <span className="text-pos-white/50">Diferença:</span>
                  <span className={`font-bold ${(parseFloat(closingBalance) - expectedBalance) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    R$ {(parseFloat(closingBalance) - expectedBalance).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12" onClick={handleClose}>Fechar Caixa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={!!showMovement} onOpenChange={() => setShowMovement(null)}>
        <DialogContent className="bg-pos-black border-pos-yellow/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2">
              {showMovement === 'withdraw' ? <ArrowUp className="h-5 w-5 text-red-400" /> : <ArrowDown className="h-5 w-5 text-green-400" />}
              {showMovement === 'withdraw' ? 'Sangria' : 'Reforço'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Valor</Label>
              <Input type="number" value={movementAmount} onChange={e => setMovementAmount(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Observação</Label>
              <Textarea value={movementNotes} onChange={e => setMovementNotes(e.target.value)} placeholder="Motivo..." className="bg-pos-white/5 border-pos-yellow/30 text-pos-white focus:border-pos-yellow" />
            </div>
            <Button className={`w-full font-bold h-12 ${showMovement === 'withdraw' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`} onClick={handleMovement}>
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
