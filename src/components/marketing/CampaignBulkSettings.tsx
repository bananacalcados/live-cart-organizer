import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Image, FileText, Shield, UserPlus, Type
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface CampaignBulkSettingsProps {
  campaignId: string;
  targetGroups: string[];
  onBack: () => void;
}

export function CampaignBulkSettings({ campaignId, targetGroups, onBack }: CampaignBulkSettingsProps) {
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const [bulkName, setBulkName] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [bulkPhotoUrl, setBulkPhotoUrl] = useState("");
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(false);
  const [onlyAdminsAdd, setOnlyAdminsAdd] = useState(false);

  const applyToAllGroups = async (action: string, payload: Record<string, unknown>) => {
    setIsApplying(action);
    try {
      // Fetch group details
      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, group_id, name')
        .in('id', targetGroups);

      if (!groups || groups.length === 0) { toast.error("Nenhum grupo encontrado"); return; }

      let success = 0;
      let failed = 0;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        try {
          const body: Record<string, unknown> = { groupId: group.group_id, ...payload };

          // For name with suffix
          if (action === 'name' && bulkName) {
            body.name = `${bulkName} #${i + 1}`;
          }

          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.ok && data.success) success++;
          else failed++;
        } catch { failed++; }
        // Small delay between calls
        await new Promise(r => setTimeout(r, 1000));
      }

      toast.success(`Aplicado: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
    } catch { toast.error("Erro ao aplicar configurações"); }
    finally { setIsApplying(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <h3 className="text-sm font-semibold">Configurar Grupos em Massa</h3>
        <span className="text-xs text-muted-foreground">({targetGroups.length} grupos)</span>
      </div>

      <div className="space-y-3">
        {/* Rename */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Type className="h-3.5 w-3.5" /> Alterar Nome</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="Nome base (ex: VIP Banana)" value={bulkName} onChange={e => setBulkName(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Cada grupo receberá "#1", "#2"... após o nome</p>
            <Button size="sm" disabled={!bulkName.trim() || isApplying === 'name'} className="gap-1"
              onClick={() => applyToAllGroups('name', { action: 'rename' })}>
              {isApplying === 'name' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Type className="h-3.5 w-3.5" />}
              Aplicar Nome
            </Button>
          </CardContent>
        </Card>

        {/* Photo */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Image className="h-3.5 w-3.5" /> Alterar Foto</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="URL da imagem" value={bulkPhotoUrl} onChange={e => setBulkPhotoUrl(e.target.value)} />
            <Button size="sm" disabled={!bulkPhotoUrl.trim() || isApplying === 'photo'} className="gap-1"
              onClick={() => applyToAllGroups('photo', { action: 'photo', photoUrl: bulkPhotoUrl })}>
              {isApplying === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
              Aplicar Foto
            </Button>
          </CardContent>
        </Card>

        {/* Description */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Alterar Descrição</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Textarea placeholder="Nova descrição..." value={bulkDescription} onChange={e => setBulkDescription(e.target.value)} rows={2} />
            <Button size="sm" disabled={!bulkDescription.trim() || isApplying === 'description'} className="gap-1"
              onClick={() => applyToAllGroups('description', { action: 'description', description: bulkDescription })}>
              {isApplying === 'description' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Aplicar Descrição
            </Button>
          </CardContent>
        </Card>

        {/* Permissions */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Permissões</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Apenas admins enviam mensagens</Label>
              <Switch checked={onlyAdminsSend} onCheckedChange={setOnlyAdminsSend} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Apenas admins adicionam membros</Label>
              <Switch checked={onlyAdminsAdd} onCheckedChange={setOnlyAdminsAdd} />
            </div>
            <Button size="sm" disabled={isApplying === 'permissions'} className="gap-1"
              onClick={() => applyToAllGroups('permissions', { action: 'permissions', onlyAdminsSend, onlyAdminsAdd })}>
              {isApplying === 'permissions' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Aplicar Permissões
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
