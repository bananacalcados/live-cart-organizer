import { useState, useEffect, useRef } from "react";
import { DollarSign, Lock, Unlock, ArrowDown, ArrowUp, Calculator, Clock, Search, Loader2, Receipt, Camera, CreditCard, Smartphone, Trash2, Image, Eye, List, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ProviderPayablesPanel } from "./ProviderPayablesPanel";
import { Truck } from "lucide-react";

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

interface CrediarioSale {
  id: string;
  created_at: string;
  total: number;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: string | null;
  crediario_status: string | null;
  crediario_due_date: string | null;
}

interface PaymentReceipt {
  id: string;
  payment_method: string;
  amount: number;
  receipt_image_url: string;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  sale_id: string | null;
}

interface CashMovement {
  id: string;
  type: 'withdraw' | 'deposit';
  amount: number;
  description: string | null;
  created_at: string;
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

  // Crediário
  const [showCrediario, setShowCrediario] = useState(false);
  const [crediarioSearch, setCrediarioSearch] = useState("");
  const [crediarioResults, setCrediarioResults] = useState<CrediarioSale[]>([]);
  const [searchingCrediario, setSearchingCrediario] = useState(false);
  const [selectedCrediario, setSelectedCrediario] = useState<CrediarioSale | null>(null);
  const [crediarioPayMethod, setCrediarioPayMethod] = useState("pix");
  const [crediarioPayAmount, setCrediarioPayAmount] = useState("");
  const [receivingCrediario, setReceivingCrediario] = useState(false);

  // Receipt uploads
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [showUploadReceipt, setShowUploadReceipt] = useState(false);
  const [receiptMethod, setReceiptMethod] = useState("cartao_credito");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);

  // Movements (sangrias/reforços)
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [showMovements, setShowMovements] = useState(false);
  const [counterpartAccounts, setCounterpartAccounts] = useState<{ id: string; name: string; account_type: string | null }[]>([]);
  const [movementCounterpart, setMovementCounterpart] = useState<string>("");


  // Report
  const [showReport, setShowReport] = useState(false);
  const [reportSales, setReportSales] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    loadOpenRegister();
  }, [storeId]);

  useEffect(() => {
    if (register) {
      loadReceipts();
      loadMovements();
    }
  }, [register?.id]);

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

  const loadReceipts = async () => {
    if (!register) return;
    const { data } = await supabase
      .from('pos_payment_receipts')
      .select('*')
      .eq('cash_register_id', register.id)
      .order('created_at', { ascending: false });
    setReceipts((data as PaymentReceipt[]) || []);
  };

  const loadMovements = async () => {
    if (!register) return;
    const { data } = await (supabase as any)
      .from('pos_cash_movements')
      .select('*')
      .eq('cash_register_id', register.id)
      .order('created_at', { ascending: false });
    setMovements((data as CashMovement[]) || []);
  };

  const loadCounterpartAccounts = async () => {
    // CAIXA da loja não aparece (é a conta de origem/destino implícita)
    const { data } = await (supabase as any)
      .from('bank_accounts')
      .select('id, name, account_type, store_id')
      .eq('is_active', true)
      .neq('account_type', 'caixa_loja')
      .order('name');
    setCounterpartAccounts((data || []) as any);
  };

  useEffect(() => { loadCounterpartAccounts(); }, []);


  const loadReportSales = async () => {
    if (!register) return;
    setLoadingReport(true);
    try {
      const { data } = await supabase
        .from('pos_sales')
        .select('id, created_at, total, payment_method, payment_method_detail, customer_name, status')
        .eq('cash_register_id', register.id)
        .order('created_at', { ascending: true });
      setReportSales((data as any[]) || []);
    } finally {
      setLoadingReport(false);
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
      setReceipts([]);
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
    if (!movementCounterpart) {
      toast.error(showMovement === 'withdraw' ? 'Selecione o destino do dinheiro' : 'Selecione a origem do dinheiro');
      return;
    }

    const field = showMovement === 'withdraw' ? 'withdrawals' : 'deposits';
    const current = (register as any)[field] || 0;

    try {
      const { error } = await supabase
        .from('pos_cash_registers')
        .update({ [field]: current + amount, notes: movementNotes || null })
        .eq('id', register.id);
      if (error) throw error;

      // Log individual movement with counterpart account (trigger creates transfer entries)
      await (supabase as any).from('pos_cash_movements').insert({
        cash_register_id: register.id,
        store_id: storeId,
        seller_id: sellerId || null,
        type: showMovement,
        amount,
        description: movementNotes || null,
        counterpart_bank_account_id: movementCounterpart,
      });

      setRegister(r => r ? { ...r, [field]: current + amount } : r);
      setShowMovement(null);
      setMovementAmount("");
      setMovementNotes("");
      setMovementCounterpart("");
      loadMovements();
      toast.success(showMovement === 'withdraw' ? 'Sangria registrada!' : 'Reforço registrado!');
    } catch (e) {
      console.error(e);
      toast.error("Erro ao registrar movimentação");
    }
  };


  // Receipt upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Arquivo muito grande. Máximo 10MB."); return; }
    setSelectedFile(file);
    setSelectedFilePreview(URL.createObjectURL(file));
  };

  const uploadReceipt = async () => {
    if (!register || !selectedFile) { toast.error("Selecione uma foto do comprovante"); return; }
    const amount = parseFloat(receiptAmount) || 0;
    if (amount <= 0) { toast.error("Informe o valor"); return; }

    setUploadingReceipt(true);
    try {
      const ext = selectedFile.name.split('.').pop();
      const fileName = `${storeId}/${register.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('payment-receipts').upload(fileName, selectedFile);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('payment-receipts').getPublicUrl(fileName);

      const { error } = await supabase.from('pos_payment_receipts').insert({
        store_id: storeId,
        cash_register_id: register.id,
        payment_method: receiptMethod,
        amount,
        receipt_image_url: urlData.publicUrl,
        notes: receiptNotes || null,
        uploaded_by: sellerId || null,
      });
      if (error) throw error;

      toast.success("Comprovante salvo!");
      setShowUploadReceipt(false);
      setReceiptAmount("");
      setReceiptNotes("");
      setReceiptMethod("cartao_credito");
      setSelectedFile(null);
      setSelectedFilePreview(null);
      loadReceipts();
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao salvar comprovante: " + (e.message || ""));
    } finally {
      setUploadingReceipt(false);
    }
  };

  const deleteReceipt = async (receipt: PaymentReceipt) => {
    if (!confirm("Excluir este comprovante?")) return;
    try {
      await supabase.from('pos_payment_receipts').delete().eq('id', receipt.id);
      // try to delete from storage too
      const path = receipt.receipt_image_url.split('/payment-receipts/')[1];
      if (path) await supabase.storage.from('payment-receipts').remove([decodeURIComponent(path)]);
      toast.success("Comprovante excluído");
      loadReceipts();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao excluir");
    }
  };

  // Crediário search
  const searchCrediario = async () => {
    if (crediarioSearch.trim().length < 2) { toast.error("Digite pelo menos 2 caracteres"); return; }
    setSearchingCrediario(true);
    try {
      const term = `%${crediarioSearch.trim()}%`;
      const { data } = await supabase
        .from("pos_sales")
        .select("id, created_at, total, payment_method, crediario_status, crediario_due_date" as any)
        .eq("store_id", storeId)
        .ilike("payment_method", "%crediario%")
        .or(`crediario_status.is.null,crediario_status.eq.pending`)
        .or(`customer_name.ilike.${term},customer_phone.ilike.${term}` as any)
        .order("created_at", { ascending: false })
        .limit(20);
      setCrediarioResults((data as any as CrediarioSale[]) || []);
      if (!data || data.length === 0) toast.info("Nenhum crediário pendente encontrado");
    } catch (e) {
      console.error(e);
      toast.error("Erro na busca");
    } finally {
      setSearchingCrediario(false);
    }
  };

  const loadAllPendingCrediarios = async () => {
    setSearchingCrediario(true);
    try {
      const { data } = await supabase
        .from("pos_sales")
        .select("id, created_at, total, payment_method, crediario_status, crediario_due_date" as any)
        .eq("store_id", storeId)
        .ilike("payment_method", "%crediario%")
        .or("crediario_status.is.null,crediario_status.eq.pending")
        .order("created_at", { ascending: false })
        .limit(50);
      setCrediarioResults((data as any as CrediarioSale[]) || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSearchingCrediario(false);
    }
  };

  const receiveCrediario = async () => {
    if (!selectedCrediario || !register) return;
    const amount = parseFloat(crediarioPayAmount) || selectedCrediario.total;
    if (amount <= 0) return;
    setReceivingCrediario(true);
    try {
      const { error } = await supabase
        .from("pos_sales")
        .update({
          crediario_status: "paid",
          crediario_paid_at: new Date().toISOString(),
          crediario_paid_method: crediarioPayMethod,
          crediario_paid_amount: amount,
        } as any)
        .eq("id", selectedCrediario.id);
      if (error) throw error;

      if (crediarioPayMethod === "dinheiro") {
        const currentDeposits = register.deposits || 0;
        const currentCash = register.cash_sales || 0;
        await supabase
          .from("pos_cash_registers")
          .update({ deposits: currentDeposits + amount, cash_sales: currentCash + amount })
          .eq("id", register.id);
        setRegister(r => r ? { ...r, deposits: currentDeposits + amount, cash_sales: currentCash + amount } : r);
      }

      toast.success(`Crediário de R$ ${amount.toFixed(2)} recebido via ${crediarioPayMethod}!`);
      setSelectedCrediario(null);
      setCrediarioPayAmount("");
      setCrediarioPayMethod("pix");
      if (crediarioSearch.trim()) searchCrediario();
      else loadAllPendingCrediarios();
    } catch (e: any) {
      toast.error("Erro ao receber: " + (e.message || "Erro desconhecido"));
    } finally {
      setReceivingCrediario(false);
    }
  };

  const methodLabel = (m: string) => {
    switch (m) {
      case 'cartao_credito': return '💳 Cartão Crédito';
      case 'cartao_debito': return '💳 Cartão Débito';
      case 'pix': return '📱 PIX';
      default: return m;
    }
  };

  const receiptTotals = receipts.reduce((acc, r) => {
    acc[r.payment_method] = (acc[r.payment_method] || 0) + r.amount;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-pos-white/50">Carregando...</div>;
  }

  const expectedBalance = register
    ? (register.opening_balance || 0) + (register.cash_sales || 0) + (register.deposits || 0) - (register.withdrawals || 0)
    : 0;

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-pos-white">Controle de Caixa</h2>
          <p className="text-sm text-pos-white/50">Dinheiro físico e comprovantes eletrônicos</p>
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
          <div className="h-20 w-20 mx-auto rounded-full bg-pos-orange/10 flex items-center justify-center">
            <DollarSign className="h-10 w-10 text-pos-orange" />
          </div>
          <h3 className="text-xl font-bold text-pos-white">Caixa Fechado</h3>
          <p className="text-pos-white/50">Abra o caixa para começar a registrar vendas</p>
          <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2 h-12 px-8" onClick={() => setShowOpen(true)}>
            <Unlock className="h-5 w-5" /> Abrir Caixa
          </Button>
        </div>
      ) : (
        <Tabs defaultValue="cash" className="space-y-4">
          <TabsList className="bg-pos-white/5 border border-pos-orange/20">
            <TabsTrigger value="cash" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
              <DollarSign className="h-4 w-4" /> Dinheiro (Espécie)
            </TabsTrigger>
            <TabsTrigger value="electronic" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
              <CreditCard className="h-4 w-4" /> Comprovantes Eletrônicos
            </TabsTrigger>
            <TabsTrigger value="providers" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
              <Truck className="h-4 w-4" /> Prestadores
            </TabsTrigger>
          </TabsList>


          {/* ===== TAB: DINHEIRO ===== */}
          <TabsContent value="cash" className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-pos-white/50">
              <Clock className="h-3 w-3" />
              Aberto em: {new Date(register.opened_at).toLocaleString('pt-BR')}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="bg-pos-white/5 border-pos-orange/20">
                <CardContent className="p-4">
                  <p className="text-xs text-pos-white/50">Abertura (troco)</p>
                  <p className="text-lg font-bold text-pos-white">R$ {(register.opening_balance || 0).toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card className="bg-pos-white/5 border-green-500/20">
                <CardContent className="p-4">
                  <p className="text-xs text-pos-white/50">💵 Vendas em Dinheiro</p>
                  <p className="text-lg font-bold text-green-400">R$ {(register.cash_sales || 0).toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card className="bg-pos-white/5 border-pos-orange/20 cursor-pointer hover:border-pos-orange/50 transition-colors" onClick={() => { loadMovements(); setShowMovements(true); }}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-pos-white/50">Sangrias / Reforços</p>
                      <p className="text-lg font-bold text-pos-white">
                        <span className="text-red-400">-{(register.withdrawals || 0).toFixed(2)}</span>
                        {" / "}
                        <span className="text-green-400">+{(register.deposits || 0).toFixed(2)}</span>
                      </p>
                    </div>
                    <List className="h-4 w-4 text-pos-orange/60 flex-shrink-0" />
                  </div>
                  <p className="text-[9px] text-pos-orange/70 mt-1 underline">Ver lista detalhada</p>
                </CardContent>
              </Card>
              <Card className="bg-pos-white/5 border-pos-orange/30">
                <CardContent className="p-4">
                  <p className="text-xs text-pos-white/50">💰 Saldo Esperado em Espécie</p>
                  <p className="text-lg font-bold text-pos-orange">R$ {expectedBalance.toFixed(2)}</p>
                </CardContent>
              </Card>
            </div>

            <Separator className="bg-pos-orange/20" />

            {/* Info about other methods (read-only) */}
            <div className="p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              <p className="text-[10px] text-pos-white/40 mb-2 uppercase tracking-wider">Totais do dia (apenas informativo — não impacta o caixa)</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-[10px] text-pos-white/40">💳 Cartão</p>
                  <p className="font-bold text-sm text-pos-white/60">R$ {(register.card_sales || 0).toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-pos-white/40">📱 PIX</p>
                  <p className="font-bold text-sm text-pos-white/60">R$ {(register.pix_sales || 0).toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-pos-white/40">Outros</p>
                  <p className="font-bold text-sm text-pos-white/60">R$ {(register.other_sales || 0).toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <Button className="flex-1 min-w-[140px] gap-2 border-2 border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20" variant="outline" onClick={() => setShowMovement('withdraw')}>
                <ArrowUp className="h-4 w-4" /> Sangria
              </Button>
              <Button className="flex-1 min-w-[140px] gap-2 border-2 border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20" variant="outline" onClick={() => setShowMovement('deposit')}>
                <ArrowDown className="h-4 w-4" /> Reforço
              </Button>
              <Button className="flex-1 min-w-[140px] gap-2 border-2 border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20" variant="outline" onClick={() => { setShowCrediario(true); loadAllPendingCrediarios(); }}>
                <Receipt className="h-4 w-4" /> Receber Crediário
              </Button>
              <Button className="flex-1 min-w-[140px] gap-2 border-2 border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" variant="outline" onClick={() => { loadMovements(); loadReportSales(); setShowReport(true); }}>
                <FileText className="h-4 w-4" /> Relatório
              </Button>
              <Button className="flex-1 min-w-[140px] gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold" onClick={() => setShowClose(true)}>
                <Lock className="h-4 w-4" /> Fechar Caixa
              </Button>
            </div>
          </TabsContent>

          {/* ===== TAB: COMPROVANTES ELETRÔNICOS ===== */}
          <TabsContent value="electronic" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-pos-white">Comprovantes de Pagamento</h3>
                <p className="text-xs text-pos-white/40">Suba fotos dos comprovantes de cartão, PIX e débito para conferência</p>
              </div>
              <Button className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-2" onClick={() => setShowUploadReceipt(true)}>
                <Camera className="h-4 w-4" /> Subir Comprovante
              </Button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="bg-pos-white/5 border-blue-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-pos-white/40 mb-1">💳 Crédito</p>
                  <p className="text-sm font-bold text-pos-white">R$ {(receiptTotals['cartao_credito'] || 0).toFixed(2)}</p>
                  <p className="text-[9px] text-pos-white/30 mt-0.5">
                    Sistema: R$ {(register.card_sales || 0).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-pos-white/5 border-purple-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-pos-white/40 mb-1">💳 Débito</p>
                  <p className="text-sm font-bold text-pos-white">R$ {(receiptTotals['cartao_debito'] || 0).toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card className="bg-pos-white/5 border-green-500/20">
                <CardContent className="p-4 text-center">
                  <p className="text-[10px] text-pos-white/40 mb-1">📱 PIX</p>
                  <p className="text-sm font-bold text-pos-white">R$ {(receiptTotals['pix'] || 0).toFixed(2)}</p>
                  <p className="text-[9px] text-pos-white/30 mt-0.5">
                    Sistema: R$ {(register.pix_sales || 0).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Separator className="bg-pos-orange/20" />

            {/* Receipts list */}
            {receipts.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <div className="h-14 w-14 mx-auto rounded-full bg-pos-white/5 flex items-center justify-center">
                  <Image className="h-7 w-7 text-pos-white/20" />
                </div>
                <p className="text-sm text-pos-white/40">Nenhum comprovante registrado ainda</p>
                <p className="text-xs text-pos-white/25">Clique em "Subir Comprovante" após cada venda em cartão ou PIX</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {receipts.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10 hover:border-pos-orange/30 transition-colors">
                    <button onClick={() => setPreviewImage(r.receipt_image_url)} className="h-14 w-14 rounded-lg overflow-hidden bg-pos-white/10 flex-shrink-0 hover:ring-2 ring-pos-orange transition-all">
                      <img src={r.receipt_image_url} alt="Comprovante" className="h-full w-full object-cover" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge className="text-[9px] border-0 bg-pos-white/10 text-pos-white/70">{methodLabel(r.payment_method)}</Badge>
                        <span className="text-xs font-bold text-pos-orange">R$ {r.amount.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-pos-white/40">
                        {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {r.notes && ` · ${r.notes}`}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:bg-red-500/10" onClick={() => deleteReceipt(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ===== TAB: PRESTADORES ===== */}
          <TabsContent value="providers" className="space-y-4">
            <ProviderPayablesPanel
              storeId={storeId}
              cashRegisterId={register.id}
              onPaid={loadOpenRegister}
            />
          </TabsContent>
        </Tabs>

      )}

      {/* Open Dialog */}
      <Dialog open={showOpen} onOpenChange={setShowOpen}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><Unlock className="h-5 w-5 text-pos-orange" /> Abrir Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Valor de abertura (fundo de troco)</Label>
              <Input type="number" value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12" onClick={handleOpen}>Abrir Caixa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Close Dialog */}
      <Dialog open={showClose} onOpenChange={setShowClose}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><Lock className="h-5 w-5 text-pos-orange" /> Fechar Caixa (Dinheiro)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-pos-white/5 border border-pos-orange/20 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-pos-white/50">Saldo esperado em espécie:</span>
                <span className="font-bold text-pos-orange">R$ {expectedBalance.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-pos-white/30">Abertura + Vendas em dinheiro + Reforços − Sangrias</p>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Valor contado no caixa (dinheiro)</Label>
              <Input type="number" value={closingBalance} onChange={e => setClosingBalance(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            {closingBalance && (
              <div className="p-3 rounded-xl bg-pos-white/5 border border-pos-orange/20">
                <div className="flex justify-between text-sm">
                  <span className="text-pos-white/50">Diferença:</span>
                  <span className={`font-bold ${(parseFloat(closingBalance) - expectedBalance) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    R$ {(parseFloat(closingBalance) - expectedBalance).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Electronic summary */}
            {receipts.length > 0 && (
              <div className="p-3 rounded-xl bg-pos-white/5 border border-blue-500/20 space-y-1">
                <p className="text-[10px] text-pos-white/40 uppercase tracking-wider">Comprovantes eletrônicos registrados</p>
                {Object.entries(receiptTotals).map(([method, total]) => (
                  <div key={method} className="flex justify-between text-xs">
                    <span className="text-pos-white/50">{methodLabel(method)}</span>
                    <span className="text-pos-white font-medium">R$ {total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12" onClick={handleClose}>Fechar Caixa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={!!showMovement} onOpenChange={() => setShowMovement(null)}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2">
              {showMovement === 'withdraw' ? <ArrowUp className="h-5 w-5 text-red-400" /> : <ArrowDown className="h-5 w-5 text-green-400" />}
              {showMovement === 'withdraw' ? 'Sangria' : 'Reforço'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Valor</Label>
              <Input type="number" value={movementAmount} onChange={e => setMovementAmount(e.target.value)} placeholder="0,00" className="text-lg h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">
                {showMovement === 'withdraw' ? 'Destino do dinheiro' : 'Origem do dinheiro'}
              </Label>
              <Select value={movementCounterpart} onValueChange={setMovementCounterpart}>
                <SelectTrigger className="h-12 bg-pos-white/5 border-pos-orange/30 text-pos-white">
                  <SelectValue placeholder={showMovement === 'withdraw' ? 'Para onde vai? (Cofre, Banco...)' : 'De onde veio? (Cofre, Banco...)'} />
                </SelectTrigger>
                <SelectContent>
                  {counterpartAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.account_type === 'cofre' ? ' 🔒' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-pos-white/40 mt-1">
                {showMovement === 'withdraw'
                  ? 'O valor sai do CAIXA e entra na conta selecionada (transferência).'
                  : 'O valor sai da conta selecionada e entra no CAIXA (transferência).'}
              </p>
            </div>

            <div>
              <Label className="text-pos-white/70 text-xs">Observação</Label>
              <Textarea value={movementNotes} onChange={e => setMovementNotes(e.target.value)} placeholder="Motivo..." className="bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <Button className={`w-full font-bold h-12 ${showMovement === 'withdraw' ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`} onClick={handleMovement}>
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Receipt Dialog */}
      <Dialog open={showUploadReceipt} onOpenChange={(o) => { setShowUploadReceipt(o); if (!o) { setSelectedFile(null); setSelectedFilePreview(null); } }}>
        <DialogContent className="bg-pos-black border-pos-orange/30">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><Camera className="h-5 w-5 text-pos-orange" /> Subir Comprovante</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-pos-white/70 text-xs">Método de pagamento</Label>
              <Select value={receiptMethod} onValueChange={setReceiptMethod}>
                <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cartao_credito">💳 Cartão Crédito</SelectItem>
                  <SelectItem value="cartao_debito">💳 Cartão Débito</SelectItem>
                  <SelectItem value="pix">📱 PIX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Valor (R$)</Label>
              <Input type="number" value={receiptAmount} onChange={e => setReceiptAmount(e.target.value)} placeholder="0,00" className="h-10 bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Foto do comprovante</Label>
              <input ref={receiptFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              {selectedFilePreview ? (
                <div className="relative mt-2">
                  <img src={selectedFilePreview} alt="Preview" className="w-full max-h-48 object-contain rounded-lg border border-pos-orange/20" />
                  <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 bg-pos-black/70 text-red-400" onClick={() => { setSelectedFile(null); setSelectedFilePreview(null); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full mt-1 border-dashed border-2 border-pos-orange/30 bg-pos-white/5 text-pos-white/50 h-20 gap-2" onClick={() => receiptFileRef.current?.click()}>
                  <Camera className="h-5 w-5" /> Tirar foto ou selecionar imagem
                </Button>
              )}
            </div>
            <div>
              <Label className="text-pos-white/70 text-xs">Observação (opcional)</Label>
              <Input value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} placeholder="Ex: venda da cliente Maria" className="h-10 bg-pos-white/5 border-pos-orange/30 text-pos-white focus:border-pos-orange" />
            </div>
            <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-12 gap-2" disabled={uploadingReceipt || !selectedFile} onClick={uploadReceipt}>
              {uploadingReceipt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Salvar Comprovante
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-pos-white">Comprovante</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img src={previewImage} alt="Comprovante" className="w-full max-h-[70vh] object-contain rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Crediário Dialog */}
      <Dialog open={showCrediario} onOpenChange={setShowCrediario}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2">
              <Receipt className="h-5 w-5 text-yellow-400" /> Receber Crediário
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedCrediario ? (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-pos-white/30" />
                    <Input
                      placeholder="Buscar por nome ou telefone..."
                      value={crediarioSearch}
                      onChange={e => setCrediarioSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchCrediario()}
                      className="pl-9 bg-pos-white/5 border-pos-orange/30 text-pos-white h-10"
                    />
                  </div>
                  <Button onClick={searchCrediario} disabled={searchingCrediario} className="bg-pos-orange text-pos-black gap-1">
                    {searchingCrediario ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                {searchingCrediario ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-pos-orange" /></div>
                ) : crediarioResults.length === 0 ? (
                  <p className="text-center text-pos-white/40 text-sm py-4">Nenhum crediário pendente</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {crediarioResults.map(sale => (
                      <button
                        key={sale.id}
                        onClick={() => { setSelectedCrediario(sale); setCrediarioPayAmount(String(sale.total)); }}
                        className="w-full text-left p-3 rounded-lg border border-pos-orange/10 bg-pos-white/5 hover:border-pos-orange/40 transition-all"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-pos-white font-medium">{sale.customer_name || "Sem nome"}</span>
                          <Badge className="bg-yellow-500/20 text-yellow-400 text-[9px] border-0">Pendente</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-pos-white/50">
                            {new Date(sale.created_at).toLocaleDateString("pt-BR")}
                            {sale.customer_phone && ` · ${sale.customer_phone}`}
                          </span>
                          <span className="text-xs text-pos-orange font-bold">R$ {sale.total.toFixed(2)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/20">
                  <p className="text-xs text-pos-white/50">Crediário selecionado</p>
                  <p className="text-sm text-pos-white font-medium">{selectedCrediario.customer_name || "Sem nome"}</p>
                  <p className="text-xs text-pos-orange font-bold">R$ {selectedCrediario.total.toFixed(2)}</p>
                  <p className="text-[10px] text-pos-white/40">{new Date(selectedCrediario.created_at).toLocaleDateString("pt-BR")}</p>
                </div>

                <div>
                  <Label className="text-pos-white/70 text-xs">Valor a receber</Label>
                  <Input
                    type="number"
                    value={crediarioPayAmount}
                    onChange={e => setCrediarioPayAmount(e.target.value)}
                    className="h-10 bg-pos-white/5 border-pos-orange/30 text-pos-white"
                  />
                </div>

                <div>
                  <Label className="text-pos-white/70 text-xs">Forma de pagamento</Label>
                  <Select value={crediarioPayMethod} onValueChange={setCrediarioPayMethod}>
                    <SelectTrigger className="bg-pos-white/5 border-pos-orange/30 text-pos-white h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dinheiro">💵 Dinheiro</SelectItem>
                      <SelectItem value="cartao_credito">💳 Cartão Crédito</SelectItem>
                      <SelectItem value="cartao_debito">💳 Cartão Débito</SelectItem>
                      <SelectItem value="pix">📱 PIX</SelectItem>
                    </SelectContent>
                  </Select>
                  {crediarioPayMethod === "dinheiro" && (
                    <p className="text-[10px] text-yellow-400 mt-1">💰 Pagamento em dinheiro será registrado como reforço de caixa</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 border-pos-orange/30 text-pos-white" onClick={() => setSelectedCrediario(null)}>
                    Voltar
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold"
                    disabled={receivingCrediario}
                    onClick={receiveCrediario}
                  >
                    {receivingCrediario ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <DollarSign className="h-4 w-4 mr-1" />}
                    Confirmar Recebimento
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Movements List Dialog */}
      <Dialog open={showMovements} onOpenChange={setShowMovements}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2">
              <List className="h-5 w-5 text-pos-orange" /> Sangrias e Reforços
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {movements.length === 0 ? (
              <p className="text-center text-pos-white/40 text-sm py-8">Nenhuma movimentação registrada</p>
            ) : (
              movements.map(m => (
                <div key={m.id} className={`p-3 rounded-lg border ${m.type === 'withdraw' ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      {m.type === 'withdraw' ? (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1"><ArrowUp className="h-3 w-3" /> Sangria</Badge>
                      ) : (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1"><ArrowDown className="h-3 w-3" /> Reforço</Badge>
                      )}
                      <span className="text-xs text-pos-white/40">
                        {new Date(m.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <span className={`font-bold text-sm ${m.type === 'withdraw' ? 'text-red-400' : 'text-green-400'}`}>
                      {m.type === 'withdraw' ? '-' : '+'} R$ {Number(m.amount).toFixed(2)}
                    </span>
                  </div>
                  {m.description && (
                    <p className="text-xs text-pos-white/60 italic">"{m.description}"</p>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Report Dialog */}
      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center justify-between gap-2 pr-8">
              <span className="flex items-center gap-2"><FileText className="h-5 w-5 text-pos-orange" /> Relatório do Caixa</span>
              <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted gap-1" onClick={() => printCashReport({ register: register!, movements, sales: reportSales, receipts })}>
                <Printer className="h-4 w-4" /> Imprimir
              </Button>
            </DialogTitle>
          </DialogHeader>
          {loadingReport ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-pos-orange" /></div>
          ) : (
            register && <CashReportContent register={register} movements={movements} sales={reportSales} receipts={receipts} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Cash Report (in-modal preview) ============
function CashReportContent({ register, movements, sales, receipts }: { register: CashRegister; movements: CashMovement[]; sales: any[]; receipts: PaymentReceipt[] }) {
  const grouped = groupSalesByMethod(sales);
  const cashOut = movements.filter(m => m.type === 'withdraw').reduce((s, m) => s + Number(m.amount), 0);
  const cashIn = movements.filter(m => m.type === 'deposit').reduce((s, m) => s + Number(m.amount), 0);
  const expected = (register.opening_balance || 0) + (register.cash_sales || 0) + cashIn - cashOut;

  return (
    <div className="overflow-y-auto space-y-4 text-pos-white text-sm pr-2">
      <div className="text-xs text-pos-white/50">
        Caixa aberto em: {new Date(register.opened_at).toLocaleString('pt-BR')}
      </div>

      {/* DESTAQUE: DINHEIRO */}
      <div className="p-4 rounded-xl border-2 border-pos-orange bg-pos-orange/10 space-y-2">
        <h3 className="font-bold text-pos-orange flex items-center gap-2"><DollarSign className="h-4 w-4" /> DINHEIRO (ESPÉCIE) — Destaque</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between"><span className="text-pos-white/60">Abertura (troco):</span><span className="font-bold">R$ {(register.opening_balance || 0).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-pos-white/60">Vendas em dinheiro:</span><span className="font-bold text-green-400">+ R$ {(register.cash_sales || 0).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-pos-white/60">Reforços:</span><span className="font-bold text-green-400">+ R$ {cashIn.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-pos-white/60">Sangrias:</span><span className="font-bold text-red-400">- R$ {cashOut.toFixed(2)}</span></div>
        </div>
        <Separator className="bg-pos-orange/30" />
        <div className="flex justify-between text-base">
          <span className="font-bold">Saldo Esperado em Espécie:</span>
          <span className="font-bold text-pos-orange">R$ {expected.toFixed(2)}</span>
        </div>
      </div>

      {/* Sangrias detalhadas */}
      {movements.filter(m => m.type === 'withdraw').length > 0 && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 space-y-1">
          <h4 className="font-bold text-red-400 text-xs uppercase">⚠️ Saídas em Dinheiro (Sangrias)</h4>
          {movements.filter(m => m.type === 'withdraw').map(m => (
            <div key={m.id} className="flex justify-between text-xs border-b border-red-500/10 py-1">
              <span className="text-pos-white/70">
                {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — {m.description || 'Sem descrição'}
              </span>
              <span className="font-bold text-red-400">- R$ {Number(m.amount).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reforços */}
      {movements.filter(m => m.type === 'deposit').length > 0 && (
        <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 space-y-1">
          <h4 className="font-bold text-green-400 text-xs uppercase">Entradas em Dinheiro (Reforços)</h4>
          {movements.filter(m => m.type === 'deposit').map(m => (
            <div key={m.id} className="flex justify-between text-xs border-b border-green-500/10 py-1">
              <span className="text-pos-white/70">
                {new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — {m.description || 'Sem descrição'}
              </span>
              <span className="font-bold text-green-400">+ R$ {Number(m.amount).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Vendas por método */}
      <div className="space-y-2">
        <h3 className="font-bold text-pos-white">Vendas por forma de pagamento</h3>
        {Object.entries(grouped).length === 0 && (
          <p className="text-xs text-pos-white/40">Nenhuma venda neste caixa.</p>
        )}
        {Object.entries(grouped).map(([method, list]: [string, any[]]) => {
          const total = list.reduce((s, x) => s + Number(x.total || 0), 0);
          return (
            <div key={method} className="p-3 rounded-lg border border-pos-orange/20 bg-pos-white/5">
              <div className="flex justify-between mb-1">
                <span className="font-bold uppercase text-xs">{method}</span>
                <span className="font-bold text-pos-orange">R$ {total.toFixed(2)} ({list.length})</span>
              </div>
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {list.map(s => (
                  <div key={s.id} className="flex justify-between text-[11px] text-pos-white/60 border-b border-pos-orange/5 py-0.5">
                    <span>{new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — {s.customer_name || 'Cliente avulso'}</span>
                    <span>R$ {Number(s.total).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupSalesByMethod(sales: any[]) {
  const groups: Record<string, any[]> = {};
  for (const s of sales) {
    const m = (s.payment_method || 'outro').toLowerCase();
    if (!groups[m]) groups[m] = [];
    groups[m].push(s);
  }
  return groups;
}

function printCashReport({ register, movements, sales, receipts }: { register: CashRegister; movements: CashMovement[]; sales: any[]; receipts: PaymentReceipt[] }) {
  const grouped = groupSalesByMethod(sales);
  const cashOut = movements.filter(m => m.type === 'withdraw').reduce((s, m) => s + Number(m.amount), 0);
  const cashIn = movements.filter(m => m.type === 'deposit').reduce((s, m) => s + Number(m.amount), 0);
  const expected = (register.opening_balance || 0) + (register.cash_sales || 0) + cashIn - cashOut;
  const fmt = (n: number) => `R$ ${Number(n || 0).toFixed(2)}`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Caixa</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:20px;font-size:12px;}
h1{font-size:16px;margin:0 0 4px;}
h2{font-size:13px;margin:14px 0 6px;border-bottom:1px solid #000;padding-bottom:2px;}
table{width:100%;border-collapse:collapse;margin-top:4px;}
th,td{padding:3px 6px;text-align:left;border-bottom:1px dotted #999;font-size:11px;}
th{border-bottom:1px solid #000;}
.right{text-align:right;}
.cash-highlight{border:2px solid #000;padding:10px;margin:8px 0;background:#fffbe6;}
.cash-highlight h2{margin-top:0;font-size:14px;border:0;}
.row{display:flex;justify-content:space-between;margin:2px 0;}
.bold{font-weight:bold;}
.red{color:#b00;}
.green{color:#080;}
.total-row{border-top:2px solid #000;font-weight:bold;font-size:13px;margin-top:6px;padding-top:6px;}
.muted{color:#666;font-size:10px;}
</style></head><body>
<h1>Relatório de Caixa</h1>
<div class="muted">Aberto em: ${new Date(register.opened_at).toLocaleString('pt-BR')}<br/>Emitido em: ${new Date().toLocaleString('pt-BR')}</div>

<div class="cash-highlight">
  <h2>💰 DINHEIRO (ESPÉCIE)</h2>
  <div class="row"><span>Abertura (troco)</span><span>${fmt(register.opening_balance)}</span></div>
  <div class="row"><span class="green">+ Vendas em dinheiro</span><span class="green">${fmt(register.cash_sales)}</span></div>
  <div class="row"><span class="green">+ Reforços</span><span class="green">${fmt(cashIn)}</span></div>
  <div class="row"><span class="red">- Sangrias</span><span class="red">${fmt(cashOut)}</span></div>
  <div class="row total-row"><span>SALDO ESPERADO EM ESPÉCIE</span><span>${fmt(expected)}</span></div>
</div>

${movements.filter(m => m.type === 'withdraw').length > 0 ? `
<h2>⚠️ Saídas em Dinheiro (Sangrias) — DESTAQUE</h2>
<table><thead><tr><th>Hora</th><th>Descrição</th><th class="right">Valor</th></tr></thead><tbody>
${movements.filter(m => m.type === 'withdraw').map(m => `<tr><td>${new Date(m.created_at).toLocaleTimeString('pt-BR')}</td><td>${m.description || '-'}</td><td class="right red bold">- ${fmt(Number(m.amount))}</td></tr>`).join('')}
<tr class="total-row"><td colspan="2">Total Sangrias</td><td class="right red">- ${fmt(cashOut)}</td></tr>
</tbody></table>` : ''}

${movements.filter(m => m.type === 'deposit').length > 0 ? `
<h2>Entradas em Dinheiro (Reforços)</h2>
<table><thead><tr><th>Hora</th><th>Descrição</th><th class="right">Valor</th></tr></thead><tbody>
${movements.filter(m => m.type === 'deposit').map(m => `<tr><td>${new Date(m.created_at).toLocaleTimeString('pt-BR')}</td><td>${m.description || '-'}</td><td class="right green bold">+ ${fmt(Number(m.amount))}</td></tr>`).join('')}
<tr class="total-row"><td colspan="2">Total Reforços</td><td class="right green">+ ${fmt(cashIn)}</td></tr>
</tbody></table>` : ''}

<h2>Vendas por forma de pagamento</h2>
${Object.entries(grouped).map(([method, list]: [string, any[]]) => {
  const total = list.reduce((s, x) => s + Number(x.total || 0), 0);
  const isCash = method.includes('dinheiro') || method.includes('especie');
  return `
  <div ${isCash ? 'class="cash-highlight"' : ''}>
  <h2>${isCash ? '💵 ' : ''}${method.toUpperCase()} — ${list.length} venda(s) — Total: ${fmt(total)}</h2>
  <table><thead><tr><th>Hora</th><th>Cliente</th><th>Status</th><th class="right">Valor</th></tr></thead><tbody>
  ${list.map(s => `<tr><td>${new Date(s.created_at).toLocaleTimeString('pt-BR')}</td><td>${s.customer_name || 'Avulso'}</td><td>${s.status || '-'}</td><td class="right">${fmt(Number(s.total))}</td></tr>`).join('')}
  <tr class="total-row"><td colspan="3">Total ${method}</td><td class="right">${fmt(total)}</td></tr>
  </tbody></table>
  </div>`;
}).join('')}

<h2>Resumo Geral</h2>
<table><tbody>
<tr><td>Total de vendas</td><td class="right bold">${sales.length}</td></tr>
<tr><td>Faturamento total</td><td class="right bold">${fmt(sales.reduce((s, x) => s + Number(x.total || 0), 0))}</td></tr>
<tr><td>Comprovantes eletrônicos anexados</td><td class="right">${receipts.length}</td></tr>
</tbody></table>

<div class="muted" style="margin-top:30px;">_______________________________<br/>Assinatura do responsável</div>

<script>window.onload=()=>{window.print();};</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('Habilite popups para imprimir'); return; }
  w.document.write(html);
  w.document.close();
}
