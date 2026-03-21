import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

interface AdKeyword {
  id: string;
  keyword: string;
  campaign_label: string;
  is_active: boolean;
  created_at: string;
}

export default function WhatsAppAdKeywords() {
  const [keywords, setKeywords] = useState<AdKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCampaign, setNewCampaign] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_ad_keywords")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      toast.error("Erro ao carregar keywords");
    } else {
      setKeywords(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchKeywords(); }, [fetchKeywords]);

  const handleCreate = async () => {
    if (!newKeyword.trim() || !newCampaign.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("whatsapp_ad_keywords").insert({
      keyword: newKeyword.trim(),
      campaign_label: newCampaign.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao criar keyword");
      console.error(error);
    } else {
      toast.success("Keyword criada!");
      setNewKeyword("");
      setNewCampaign("");
      setDialogOpen(false);
      fetchKeywords();
    }
  };

  const handleToggle = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("whatsapp_ad_keywords")
      .update({ is_active: !current })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar status");
    } else {
      setKeywords(prev => prev.map(k => k.id === id ? { ...k, is_active: !current } : k));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta keyword?")) return;
    const { error } = await supabase
      .from("whatsapp_ad_keywords")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao excluir keyword");
    } else {
      toast.success("Keyword excluída");
      setKeywords(prev => prev.filter(k => k.id !== id));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Megaphone className="h-4 w-4" />
          Keywords de Anúncios WhatsApp
        </CardTitle>
        <Button size="sm" className="gap-1" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Nova Keyword
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma keyword cadastrada. Adicione uma para começar a capturar leads de anúncios.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Keyword</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.map(kw => (
                <TableRow key={kw.id}>
                  <TableCell className="font-medium">{kw.keyword}</TableCell>
                  <TableCell>{kw.campaign_label}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={kw.is_active} onCheckedChange={() => handleToggle(kw.id, kw.is_active)} />
                      <Badge variant={kw.is_active ? "default" : "secondary"} className={kw.is_active ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
                        {kw.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(kw.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Keyword de Anúncio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Keyword</Label>
              <Input
                placeholder='Ex: "página de vendas do tênis débora"'
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Trecho que aparece na mensagem do cliente vinda do anúncio
              </p>
            </div>
            <div className="space-y-2">
              <Label>Label da Campanha</Label>
              <Input
                placeholder='Ex: "LP Tênis Débora"'
                value={newCampaign}
                onChange={e => setNewCampaign(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Nome para identificar a campanha nos relatórios de leads
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
