import { useState, useRef } from "react";
import { Camera, Upload, Check, Loader2, Image, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  storeId: string;
  cashRegisterId?: string;
  saleId?: string;
  paymentMethodName: string;
  amount: number;
  onDone: () => void;
}

export function POSReceiptUpload({ storeId, cashRegisterId, saleId, paymentMethodName, amount, onDone }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const classifyMethod = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes('pix')) return 'pix';
    if (lower.includes('débito') || lower.includes('debito')) return 'cartao_debito';
    if (lower.includes('crédito') || lower.includes('credito') || lower.includes('cartão') || lower.includes('cartao')) return 'cartao_credito';
    return 'outro';
  };

  const handleFile = (file: File) => {
    const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
    if (file.size > getMaxSizeForType(file.type)) {
      toast.error(`${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`);
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const uploadReceipt = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const ext = selectedFile.name.split('.').pop() || 'jpg';
      const fileName = `${storeId}/${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-receipts')
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('payment-receipts')
        .getPublicUrl(fileName);

      const method = classifyMethod(paymentMethodName);

      await supabase.from('pos_payment_receipts').insert({
        store_id: storeId,
        cash_register_id: cashRegisterId || null,
        sale_id: saleId || null,
        payment_method: method,
        amount,
        receipt_image_url: urlData.publicUrl,
        uploaded_by: paymentMethodName,
        notes: `Venda: ${paymentMethodName} - R$ ${amount.toFixed(2)}`,
      } as any);

      setUploaded(true);
      toast.success("Comprovante salvo com sucesso!");
    } catch (e) {
      console.error("Receipt upload error:", e);
      toast.error("Erro ao salvar comprovante");
    } finally {
      setUploading(false);
    }
  };

  if (uploaded) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 text-center space-y-3 animate-in fade-in zoom-in duration-500">
        <Check className="h-10 w-10 text-green-400 mx-auto" />
        <p className="text-green-400 font-bold">Comprovante salvo!</p>
        <Button
          onClick={onDone}
          className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold px-8"
        >
          Continuar
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-pos-white/5 border border-pos-orange/30 rounded-2xl p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-1">
        <h4 className="text-lg font-bold text-pos-orange flex items-center justify-center gap-2">
          <Camera className="h-5 w-5" />
          Comprovante de Pagamento
        </h4>
        <p className="text-sm text-pos-white/50">
          {paymentMethodName} — R$ {amount.toFixed(2)}
        </p>
        <p className="text-xs text-pos-white/30">
          Tire uma foto ou anexe o comprovante desta transação
        </p>
      </div>

      {/* Hidden inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleInputChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={handleInputChange}
      />

      {previewUrl ? (
        <div className="relative">
          <img
            src={previewUrl}
            alt="Preview do comprovante"
            className="w-full max-h-48 object-contain rounded-xl border border-pos-orange/20"
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 bg-pos-black/70 text-pos-white hover:bg-pos-black"
            onClick={() => { setPreviewUrl(null); setSelectedFile(null); }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => cameraInputRef.current?.click()}
            className="h-20 flex-col gap-2 bg-pos-orange/10 border-2 border-dashed border-pos-orange/40 text-pos-orange hover:bg-pos-orange/20"
            variant="outline"
          >
            <Camera className="h-6 w-6" />
            <span className="text-xs font-medium">Tirar Foto</span>
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="h-20 flex-col gap-2 bg-pos-white/5 border-2 border-dashed border-pos-white/20 text-pos-white/70 hover:bg-pos-white/10"
            variant="outline"
          >
            <Upload className="h-6 w-6" />
            <span className="text-xs font-medium">Anexar Arquivo</span>
          </Button>
        </div>
      )}

      <div className="flex gap-3">
        {selectedFile && (
          <Button
            onClick={uploadReceipt}
            disabled={uploading}
            className="flex-1 h-12 gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {uploading ? "Salvando..." : "Salvar Comprovante"}
          </Button>
        )}
        <Button
          onClick={onDone}
          variant="ghost"
          className="text-pos-white/50 hover:text-pos-white text-sm"
        >
          Pular
        </Button>
      </div>
    </div>
  );
}
