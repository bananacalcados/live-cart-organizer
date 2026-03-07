import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Image, FileText, Shield, UserPlus, Type, Upload, Pin, Crown, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CampaignBulkSettingsProps {
  campaignId: string;
  targetGroups: string[];
  onBack: () => void;
}

interface Participant {
  phone: string;
  name?: string;
  isAdmin?: boolean;
}

export function CampaignBulkSettings({ campaignId, targetGroups, onBack }: CampaignBulkSettingsProps) {
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const [bulkName, setBulkName] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [bulkPhotoUrl, setBulkPhotoUrl] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(false);
  const [onlyAdminsAdd, setOnlyAdminsAdd] = useState(false);
  const [pinMessageId, setPinMessageId] = useState("");
  const [pinDuration, setPinDuration] = useState("7_days");
  const [promotePhone, setPromotePhone] = useState("");
  const [groupParticipants, setGroupParticipants] = useState<Record<string, Participant[]>>({});
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);

  const applyToAllGroups = async (action: string, payload: Record<string, unknown>) => {
    setIsApplying(action);
    try {
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
          if (action === 'permissions') {
            await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
              method: 'POST',
              headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupId: group.group_id, action: 'set-messages-admins-only', value: String(onlyAdminsSend) }),
            });
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
              method: 'POST',
              headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ groupId: group.group_id, action: 'set-add-admins-only', value: String(onlyAdminsAdd) }),
            });
            const data = await res.json();
            if (res.ok && data.success) success++;
            else failed++;
          } else {
            const body: Record<string, unknown> = { groupId: group.group_id, ...payload };
            if (action === 'name' && bulkName) {
              body.action = 'update-name';
              body.value = `${bulkName} #${i + 1}`;
            }
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
              method: 'POST',
              headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.ok && data.success) success++;
            else failed++;
          }
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 1000));
      }

      toast.success(`Aplicado: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
    } catch { toast.error("Erro ao aplicar configurações"); }
    finally { setIsApplying(null); }
  };

  const handlePromoteInAllGroups = async () => {
    if (!promotePhone.trim()) return;
    const cleanPhone = promotePhone.replace(/\D/g, '');
    setIsApplying('promote');
    try {
      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, group_id, name')
        .in('id', targetGroups);

      if (!groups || groups.length === 0) { toast.error("Nenhum grupo encontrado"); return; }

      let success = 0;
      let failed = 0;

      for (const group of groups) {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'promote-admin', groupId: group.group_id, phone: cleanPhone }),
          });
          const data = await res.json();
          if (res.ok && data.success) success++;
          else failed++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 1000));
      }

      toast.success(`Admin promovido: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
      setPromotePhone("");
    } catch { toast.error("Erro ao promover admin"); }
    finally { setIsApplying(null); }
  };

  const handlePinInAllGroups = async () => {
    if (!pinMessageId.trim()) return;
    setIsApplying('pin');
    try {
      const { data: groups } = await supabase
        .from('whatsapp_groups')
        .select('id, group_id, name')
        .in('id', targetGroups);

      if (!groups || groups.length === 0) { toast.error("Nenhum grupo encontrado"); return; }

      let success = 0;
      let failed = 0;

      for (const group of groups) {
        try {
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pin-message', groupId: group.group_id, messageId: pinMessageId, pinDuration }),
          });
          const data = await res.json();
          if (res.ok && data.success) success++;
          else failed++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 1000));
      }

      toast.success(`Mensagem fixada: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
      setPinMessageId("");
    } catch { toast.error("Erro ao fixar mensagem"); }
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
              onClick={() => applyToAllGroups('name', { action: 'update-name' })}>
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
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setIsUploadingPhoto(true);
                try {
                  const ext = file.name.split('.').pop();
                  const path = `group-photos/${Date.now()}.${ext}`;
                  const { error } = await supabase.storage.from('marketing-attachments').upload(path, file);
                  if (error) throw error;
                  const { data: urlData } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
                  setBulkPhotoUrl(urlData.publicUrl);
                  toast.success("Foto carregada!");
                } catch { toast.error("Erro ao fazer upload"); }
                finally { setIsUploadingPhoto(false); }
              }}
            />
            <div className="flex gap-2">
              <Input placeholder="URL da imagem" value={bulkPhotoUrl} onChange={e => setBulkPhotoUrl(e.target.value)} className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={isUploadingPhoto} className="gap-1 shrink-0">
                {isUploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload
              </Button>
            </div>
            {bulkPhotoUrl && (
              <img src={bulkPhotoUrl} alt="Preview" className="h-16 w-16 rounded-lg object-cover" />
            )}
            <Button size="sm" disabled={!bulkPhotoUrl.trim() || isApplying === 'photo'} className="gap-1"
              onClick={() => applyToAllGroups('photo', { action: 'update-photo', value: bulkPhotoUrl })}>
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
              onClick={() => applyToAllGroups('description', { action: 'update-description', value: bulkDescription })}>
              {isApplying === 'description' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Aplicar Descrição
            </Button>
          </CardContent>
        </Card>

        {/* Pin Message */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Pin className="h-3.5 w-3.5" /> Fixar Mensagem (Destaque)</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="ID da mensagem (messageId)" value={pinMessageId} onChange={e => setPinMessageId(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Cole o ID da mensagem que deseja fixar. Obtenha enviando uma mensagem primeiro.</p>
            <div>
              <Label className="text-xs">Duração do destaque</Label>
              <Select value={pinDuration} onValueChange={setPinDuration}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24_hours">24 horas</SelectItem>
                  <SelectItem value="7_days">7 dias</SelectItem>
                  <SelectItem value="30_days">30 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" disabled={!pinMessageId.trim() || isApplying === 'pin'} className="gap-1"
              onClick={handlePinInAllGroups}>
              {isApplying === 'pin' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
              Fixar em Todos os Grupos
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

        {/* Promote Admin */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Crown className="h-3.5 w-3.5" /> Promover Admin em Todos os Grupos</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="Número do telefone (ex: 5511999999999)" value={promotePhone} onChange={e => setPromotePhone(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">O número será promovido a admin em todos os grupos da campanha (precisa ser participante)</p>
            <Button size="sm" disabled={!promotePhone.trim() || isApplying === 'promote'} className="gap-1"
              onClick={handlePromoteInAllGroups}>
              {isApplying === 'promote' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
              Promover Admin
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
