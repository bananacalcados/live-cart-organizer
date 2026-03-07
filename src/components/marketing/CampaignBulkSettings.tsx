import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Image, FileText, Shield, Type, Upload, Pin, Crown, Save, CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CampaignBulkSettingsProps {
  campaignId: string;
  targetGroups: string[];
  onBack: () => void;
}

export function CampaignBulkSettings({ campaignId, targetGroups, onBack }: CampaignBulkSettingsProps) {
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bulkName, setBulkName] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");
  const [bulkPhotoUrl, setBulkPhotoUrl] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(false);
  const [onlyAdminsAdd, setOnlyAdminsAdd] = useState(false);
  const [pinMessageText, setPinMessageText] = useState("");
  const [pinDuration, setPinDuration] = useState("7_days");
  const [promotePhone, setPromotePhone] = useState("");
  const [adminPhones, setAdminPhones] = useState<string[]>([]);

  // Load saved settings from campaign
  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from('group_campaigns')
      .select('group_name_template, group_photo_url, group_description, group_only_admins_send, group_only_admins_add, group_admin_phones, group_pin_message_id, group_pin_duration')
      .eq('id', campaignId)
      .single();

    if (data) {
      setBulkName((data as any).group_name_template || "");
      setBulkPhotoUrl((data as any).group_photo_url || "");
      setBulkDescription((data as any).group_description || "");
      setOnlyAdminsSend((data as any).group_only_admins_send || false);
      setOnlyAdminsAdd((data as any).group_only_admins_add || false);
      setAdminPhones((data as any).group_admin_phones || []);
      setPinMessageText((data as any).group_pin_message_text || "");
      setPinDuration((data as any).group_pin_duration || "7_days");
    }
    setIsLoaded(true);
  }, [campaignId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Save all settings to campaign
  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase.from('group_campaigns').update({
        group_name_template: bulkName || null,
        group_photo_url: bulkPhotoUrl || null,
        group_description: bulkDescription || null,
        group_only_admins_send: onlyAdminsSend,
        group_only_admins_add: onlyAdminsAdd,
        group_admin_phones: adminPhones,
        group_pin_message_text: pinMessageText || null,
        group_pin_duration: pinDuration,
      } as any).eq('id', campaignId);

      if (error) throw error;
      toast.success("Configurações salvas! Novos grupos herdarão essas configurações.");
    } catch { toast.error("Erro ao salvar configurações"); }
    finally { setIsSaving(false); }
  };

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

      // Save this phone to admin list if not already there
      if (!adminPhones.includes(cleanPhone)) {
        const newAdmins = [...adminPhones, cleanPhone];
        setAdminPhones(newAdmins);
        await supabase.from('group_campaigns').update({
          group_admin_phones: newAdmins,
        } as any).eq('id', campaignId);
      }

      toast.success(`Admin promovido: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
      setPromotePhone("");
    } catch { toast.error("Erro ao promover admin"); }
    finally { setIsApplying(null); }
  };

  const handleRemoveAdmin = (phone: string) => {
    const newAdmins = adminPhones.filter(p => p !== phone);
    setAdminPhones(newAdmins);
    supabase.from('group_campaigns').update({
      group_admin_phones: newAdmins,
    } as any).eq('id', campaignId);
  };

  const handlePinInAllGroups = async () => {
    if (!pinMessageText.trim()) return;
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
          // Step 1: Send the message to the group
          const sendRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-send-group-message`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: group.group_id, message: pinMessageText, type: 'text' }),
          });
          const sendData = await sendRes.json();
          const messageId = sendData?.data?.messageId || sendData?.data?.zapiMessageId;

          if (!sendRes.ok || !messageId) { failed++; continue; }

          // Wait a moment for message to be delivered
          await new Promise(r => setTimeout(r, 2000));

          // Step 2: Pin the sent message
          const pinRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-group-settings`, {
            method: 'POST',
            headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pin-message', groupId: group.group_id, messageId, pinDuration }),
          });
          const pinData = await pinRes.json();
          if (pinRes.ok && pinData.success) success++;
          else failed++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 1500));
      }

      toast.success(`Mensagem fixada: ${success}/${groups.length} grupos${failed > 0 ? ` (${failed} falharam)` : ''}`);
    } catch { toast.error("Erro ao fixar mensagem"); }
    finally { setIsApplying(null); }
  };

  if (!isLoaded) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <h3 className="text-sm font-semibold">Configurar Grupos em Massa</h3>
        <span className="text-xs text-muted-foreground">({targetGroups.length} grupos)</span>
      </div>

      <Alert className="border-primary/30 bg-primary/5">
        <CheckCircle className="h-4 w-4 text-primary" />
        <AlertDescription className="text-xs">
          As configurações são <strong>salvas automaticamente</strong> na campanha. Novos grupos criados automaticamente herdarão nome, foto, descrição, permissões e admins.
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        {/* Rename */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Type className="h-3.5 w-3.5" /> Alterar Nome</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="Nome base (ex: VIP Banana)" value={bulkName} onChange={e => setBulkName(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Cada grupo receberá "#1", "#2"... após o nome</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={!bulkName.trim() || isApplying === 'name'} className="gap-1"
                onClick={() => applyToAllGroups('name', { action: 'update-name' })}>
                {isApplying === 'name' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Type className="h-3.5 w-3.5" />}
                Aplicar Nome
              </Button>
            </div>
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
            <Textarea placeholder="Digite a mensagem que será enviada e fixada em todos os grupos..." value={pinMessageText} onChange={e => setPinMessageText(e.target.value)} rows={3} />
            <p className="text-[10px] text-muted-foreground">A mensagem será enviada e automaticamente fixada (destacada) em todos os grupos.</p>
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
            <Button size="sm" disabled={!pinMessageText.trim() || isApplying === 'pin'} className="gap-1"
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
            <CardTitle className="text-xs flex items-center gap-1"><Crown className="h-3.5 w-3.5" /> Admins dos Grupos</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {adminPhones.length > 0 && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Admins salvos (serão adicionados em novos grupos):</Label>
                <div className="flex flex-wrap gap-1">
                  {adminPhones.map(phone => (
                    <Badge key={phone} variant="secondary" className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20"
                      onClick={() => handleRemoveAdmin(phone)}>
                      {phone} ✕
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Input placeholder="Número (ex: 5511999999999)" value={promotePhone} onChange={e => setPromotePhone(e.target.value)} className="flex-1" />
              <Button size="sm" disabled={!promotePhone.trim() || isApplying === 'promote'} className="gap-1"
                onClick={handlePromoteInAllGroups}>
                {isApplying === 'promote' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
                Promover
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Promove o número a admin em todos os grupos e salva para futuros grupos</p>
          </CardContent>
        </Card>

        {/* Save All */}
        <Button onClick={saveSettings} disabled={isSaving} className="w-full gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Configurações da Campanha
        </Button>
      </div>
    </div>
  );
}
