import { useState } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type PushItem = { color: string; size: string | null; sku: string; gtin: string | null; price: number };
type PushPreview = {
  code: string;
  color: string;
  shopify_product_name: string;
  admin_url: string;
  to_create: PushItem[];
  existing_to_link: number;
};
type PushResult = PushPreview & { created: number; linked_existing: number; errors: string[]; message: string };

async function invokePush(code: string, dryRun: boolean) {
  const { data, error } = await supabase.functions.invoke("push-color-to-shopify", {
    body: { code, dry_run: dryRun },
  });
  if (error) {
    let message = error.message;
    try {
      const body = await (error as any).context?.json();
      if (body?.error) message = body.error;
    } catch { /* mantém o erro original */ }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export function PushColorToShopifyButton({ code, onDone, className }: {
  code: string;
  onDone?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);

  const prepare = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await invokePush(code, true);
      setPreview(data);
      setOpen(true);
    } catch (error: any) {
      toast.error(`Não foi possível simular: ${error?.message || error}`, { duration: 10000 });
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!preview?.to_create.length) return;
    setConfirming(true);
    try {
      const data = await invokePush(code, false);
      setResult(data);
      if (data.created > 0 || data.linked_existing > 0) onDone?.();
      if (data.errors?.length) toast.warning("Envio concluído com pendências. Confira antes de repetir.");
      else toast.success(`${data.created} variação(ões) criada(s) na Shopify.`);
    } catch (error: any) {
      toast.error(`Não foi possível confirmar: ${error?.message || error}`, { duration: 12000 });
    } finally {
      setConfirming(false);
    }
  };

  const sizes = preview?.to_create.map((item) => item.size || "tamanho único").join(", ") || "";
  const adminLink = (preview || result)?.admin_url;

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => void prepare()} disabled={loading}>
        {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
        Enviar para a Shopify
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!confirming) setOpen(value); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{result ? "Resultado do envio" : `Enviar ${code} para a Shopify`}</DialogTitle>
            <DialogDescription>Confira o produto, a cor e os tamanhos antes de criar.</DialogDescription>
          </DialogHeader>
          {preview && !result && (
            <div className="space-y-3 text-sm">
              <p>Vai criar na Shopify, dentro de <b>{preview.shopify_product_name}</b>: <b>{preview.color}</b> nos tamanhos <b>{sizes}</b>.</p>
              <p>As outras cores e as fotos não serão alteradas. A cor nova ficará sem foto até alguém subir.</p>
              {preview.existing_to_link > 0 && <p className="text-muted-foreground">Também serão reconhecidas {preview.existing_to_link} variação(ões) que já existem lá, sem criar duplicadas.</p>}
              <div className="max-h-40 overflow-auto rounded-md border p-2">
                {preview.to_create.map((item) => <div key={item.sku} className="flex justify-between gap-3 py-1 text-xs"><span>{item.size || "Único"}</span><span className="font-mono">{item.sku}</span></div>)}
              </div>
            </div>
          )}
          {result && (
            <div className="space-y-2 text-sm">
              <p><b>{result.created}</b> criada(s) · <b>{result.linked_existing}</b> já existente(s) vinculada(s).</p>
              <p>{result.message}</p>
              {result.errors?.length > 0 && <ul className="list-disc space-y-1 rounded-md border border-destructive/30 p-3 pl-6 text-destructive">{result.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
            </div>
          )}
          {adminLink && <a href={adminLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline">Abrir produto no admin da Shopify <ExternalLink className="h-4 w-4" /></a>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={confirming}>{result ? "Fechar" : "Cancelar"}</Button>
            {!result && <Button onClick={() => void confirm()} disabled={confirming || !preview?.to_create.length}>{confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar envio</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
