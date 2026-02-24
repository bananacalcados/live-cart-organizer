import { useState } from "react";
import { ScanBarcode, Search, Check, CheckCircle2, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SaleItem {
  sku: string;
  name: string;
  variant?: string;
  quantity: number;
  price: number;
  barcode?: string;
}

interface Props {
  saleId: string;
  storeId: string;
  sellerId: string;
  items: SaleItem[];
  onComplete: () => void;
  onSkip: () => void;
}

interface VerifiedItem extends SaleItem {
  scanned: boolean;
  feetChecked: boolean;
  noDefects: boolean;
}

export function POSOrderVerification({ saleId, storeId, sellerId, items, onComplete, onSkip }: Props) {
  const [verifiedItems, setVerifiedItems] = useState<VerifiedItem[]>(
    items.map(i => ({ ...i, scanned: false, feetChecked: false, noDefects: false }))
  );
  const [scanInput, setScanInput] = useState("");
  const [completing, setCompleting] = useState(false);

  const allVerified = verifiedItems.every(i => i.scanned && i.feetChecked && i.noDefects);
  const verifiedCount = verifiedItems.filter(i => i.scanned && i.feetChecked && i.noDefects).length;

  const handleScan = () => {
    const term = scanInput.trim().toLowerCase();
    if (!term) return;

    const idx = verifiedItems.findIndex(i =>
      !i.scanned && (
        i.sku?.toLowerCase() === term ||
        i.barcode?.toLowerCase() === term ||
        i.name?.toLowerCase().includes(term)
      )
    );

    if (idx >= 0) {
      setVerifiedItems(prev => prev.map((item, i) =>
        i === idx ? { ...item, scanned: true } : item
      ));
      toast.success(`✅ ${verifiedItems[idx].name} - Bipado!`);
    } else {
      toast.error("Produto não encontrado no pedido ou já conferido");
    }
    setScanInput("");
  };

  const toggleCheck = (idx: number, field: "feetChecked" | "noDefects") => {
    setVerifiedItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: !item[field] } : item
    ));
  };

  const handleComplete = async () => {
    if (!allVerified) {
      toast.error("Confira todos os itens antes de concluir");
      return;
    }
    setCompleting(true);
    try {
      const verificationData = verifiedItems.map(i => ({
        sku: i.sku,
        name: i.name,
        feetChecked: i.feetChecked,
        noDefects: i.noDefects,
      }));

      // Update sale with verification
      await supabase
        .from("pos_sales")
        .update({
          verified_at: new Date().toISOString(),
          verified_by: sellerId,
          verification_data: verificationData,
        } as any)
        .eq("id", saleId);

      // Award bonus points to seller
      const { data: existingBonus } = await supabase
        .from("pos_seller_bonus" as any)
        .select("id, points")
        .eq("seller_id", sellerId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (existingBonus) {
        await supabase
          .from("pos_seller_bonus" as any)
          .update({ points: (existingBonus as any).points + 5 })
          .eq("id", (existingBonus as any).id);
      } else {
        await supabase
          .from("pos_seller_bonus" as any)
          .insert({ seller_id: sellerId, store_id: storeId, points: 5 });
      }

      toast.success("✅ Conferência concluída! +5 pontos de bônus");
      onComplete();
    } catch (e: any) {
      console.error("Verification error:", e);
      toast.error("Erro ao salvar conferência");
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-sm">Conferência do Pedido</h3>
        <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
          {verifiedCount}/{verifiedItems.length}
        </Badge>
      </div>

      {/* Scanner input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Bipar código de barras ou buscar produto..."
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScan()}
            className="pl-9 h-9 text-sm"
            autoFocus
          />
        </div>
        <Button size="sm" onClick={handleScan} className="gap-1">
          <Search className="h-3.5 w-3.5" /> Buscar
        </Button>
      </div>

      {/* Items checklist */}
      <div className="space-y-2">
        {verifiedItems.map((item, idx) => {
          const isComplete = item.scanned && item.feetChecked && item.noDefects;
          return (
            <div key={idx} className={`p-3 rounded-lg border transition-all ${isComplete ? "border-green-500/30 bg-green-500/5" : item.scanned ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-card"}`}>
              <div className="flex items-center gap-2 mb-2">
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : item.scanned ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.sku} {item.variant && `· ${item.variant}`} · Qtd: {item.quantity}
                  </p>
                </div>
                {!item.scanned && (
                  <Badge variant="outline" className="text-[10px]">Aguardando bipagem</Badge>
                )}
              </div>

              {item.scanned && (
                <div className="flex gap-4 ml-6">
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`feet-${idx}`}
                      checked={item.feetChecked}
                      onCheckedChange={() => toggleCheck(idx, "feetChecked")}
                    />
                    <Label htmlFor={`feet-${idx}`} className="text-xs cursor-pointer">
                      Pés verificados
                    </Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`defect-${idx}`}
                      checked={item.noDefects}
                      onCheckedChange={() => toggleCheck(idx, "noDefects")}
                    />
                    <Label htmlFor={`defect-${idx}`} className="text-xs cursor-pointer">
                      Sem defeitos
                    </Label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" className="text-xs" onClick={onSkip}>
          Pular conferência
        </Button>
        <Button
          className="flex-1 gap-1"
          size="sm"
          disabled={!allVerified || completing}
          onClick={handleComplete}
        >
          {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Conferência Concluída
        </Button>
      </div>
    </div>
  );
}
