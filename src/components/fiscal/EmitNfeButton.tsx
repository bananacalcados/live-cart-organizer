import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2, Download, FileCode2, XCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SelectCompanyDialog } from './SelectCompanyDialog';
import { extractEdgeError } from '@/lib/edgeFunctionError';

interface Props {
  /** Use either betaOrderId OR orderId. betaOrderId = expedition_beta_orders.id */
  betaOrderId?: string;
  orderId?: string;
  onSuccess?: () => void;
  size?: 'sm' | 'default';
}

interface FiscalDoc {
  id: string;
  status: string;
  numero: number | null;
  serie: number | null;
  chave_acesso: string | null;
  danfe_url: string | null;
  xml_url: string | null;
  xml_content: string | null;
  rejection_message: string | null;
}

export function EmitNfeButton({ betaOrderId, orderId, onSuccess, size = 'sm' }: Props) {
  const targetId = betaOrderId || orderId;
  const [doc, setDoc] = useState<FiscalDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    const { data } = await supabase
      .from('fiscal_documents')
      .select('id, status, numero, serie, chave_acesso, danfe_url, xml_url, xml_content, rejection_message')
      .eq('order_id', targetId)
      .eq('modelo', 55)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setDoc(data as any);
    setLoading(false);
  }, [targetId]);

  useEffect(() => { load(); }, [load]);

  const handleEmit = async (companyId: string) => {
    setEmitting(true);
    try {
      const body: any = { company_id: companyId };
      if (betaOrderId) body.beta_order_id = betaOrderId;
      else body.order_id = orderId;

      const { data, error } = await supabase.functions.invoke('nfe-emitir', { body });
      if (error) {
        toast.error(`Erro ao emitir NF-e: ${await extractEdgeError(error, 'Falha na emissão')}`, { duration: 12000 });
        return;
      }
      if (data?.contingencia) {
        toast.warning('SEFAZ indisponível — NF-e em fila de contingência. Será reemitida automaticamente.');
      } else if (data?.ok) {
        toast.success(`NF-e ${data.numero} autorizada!`);
      } else {
        toast.error(`Erro ao emitir NF-e: ${data?.error || data?.rejection_message || 'Falha na emissão'}`, { duration: 12000 });
      }
      setShowDialog(false);
      await load();
      onSuccess?.();
    } catch (e: any) {
      toast.error(`Erro ao emitir NF-e: ${await extractEdgeError(e, 'Falha na emissão')}`, { duration: 12000 });
    } finally {
      setEmitting(false);
    }
  };

  const downloadXml = () => {
    if (!doc?.xml_content) { toast.error('XML não disponível'); return; }
    const blob = new Blob([doc.xml_content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NFe-${doc.chave_acesso || doc.numero}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Button size={size} variant="ghost" disabled><Loader2 className="h-4 w-4 animate-spin" /></Button>;
  }

  // Authorized — show actions
  if (doc?.status === 'authorized') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3" /> NF-e {doc.numero}
        </Badge>
        {doc.danfe_url && (
          <Button size={size} variant="outline" className="gap-1" onClick={() => window.open(doc.danfe_url!, '_blank')}>
            <Download className="h-3 w-3" /> DANFE
          </Button>
        )}
        {doc.xml_content && (
          <Button size={size} variant="outline" className="gap-1" onClick={downloadXml}>
            <FileCode2 className="h-3 w-3" /> XML
          </Button>
        )}
      </div>
    );
  }

  if (doc?.status === 'pending_sefaz') {
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertCircle className="h-3 w-3" /> NF-e em contingência (SEFAZ offline)
      </Badge>
    );
  }

  if (doc?.status === 'pending') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Emitindo NF-e...
      </Badge>
    );
  }

  // Not emitted or rejected
  const isRejected = doc?.status === 'rejected';
  return (
    <>
      <div className="flex flex-col gap-1">
        <Button size={size} variant={isRejected ? 'destructive' : 'default'} className="gap-1" onClick={() => setShowDialog(true)}>
          {isRejected ? <XCircle className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
          {isRejected ? 'Reemitir NF-e' : 'Emitir NF-e'}
        </Button>
        {isRejected && doc?.rejection_message && (
          <span className="text-[10px] text-destructive max-w-xs truncate" title={doc.rejection_message}>
            ⚠️ {doc.rejection_message}
          </span>
        )}
      </div>
      <SelectCompanyDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onConfirm={handleEmit}
        loading={emitting}
      />
    </>
  );
}
