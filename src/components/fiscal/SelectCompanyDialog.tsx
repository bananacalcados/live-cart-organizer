import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Building2, Loader2 } from 'lucide-react';

const LS_KEY = 'expedition_beta_last_company_id';

interface Company {
  id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  ambiente_nfe: string | null;
  brasilnfe_token: string | null;
  is_active: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (companyId: string) => void;
  loading?: boolean;
  title?: string;
}

function formatCnpj(c: string) {
  const d = (c || '').replace(/\D/g, '');
  if (d.length !== 14) return c;
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

export function SelectCompanyDialog({ open, onClose, onConfirm, loading, title = 'Selecionar CNPJ emissor' }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    supabase
      .from('companies')
      .select('id, legal_name, trade_name, cnpj, ambiente_nfe, brasilnfe_token, is_active')
      .eq('is_active', true)
      .not('brasilnfe_token', 'is', null)
      .order('legal_name')
      .then(({ data }) => {
        const list = (data || []) as Company[];
        setCompanies(list);
        const last = localStorage.getItem(LS_KEY);
        if (last && list.find(c => c.id === last)) setSelectedId(last);
        else if (list.length === 1) setSelectedId(list[0].id);
        setFetching(false);
      });
  }, [open]);

  const handleConfirm = () => {
    if (!selectedId) return;
    if (remember) localStorage.setItem(LS_KEY, selectedId);
    onConfirm(selectedId);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>
            Escolha qual empresa (CNPJ) deve emitir a NF-e deste pedido.
          </DialogDescription>
        </DialogHeader>

        {fetching ? (
          <div className="py-8 text-center text-muted-foreground">Carregando empresas...</div>
        ) : companies.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            Nenhuma empresa ativa com BrasilNFe configurada.
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {companies.map(c => {
              const active = selectedId === c.id;
              const amb = (c.ambiente_nfe || 'homologacao') === 'producao';
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    active ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {c.trade_name || c.legal_name}
                      </div>
                      {c.trade_name && (
                        <div className="text-xs text-muted-foreground truncate">{c.legal_name}</div>
                      )}
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">
                        {formatCnpj(c.cnpj)}
                      </div>
                    </div>
                    <Badge variant={amb ? 'default' : 'secondary'} className="shrink-0">
                      {amb ? 'Produção' : 'Homologação'}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Checkbox id="remember-co" checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
          <label htmlFor="remember-co" className="text-sm text-muted-foreground cursor-pointer">
            Lembrar essa escolha para os próximos pedidos
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!selectedId || loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Emitir NF-e
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
