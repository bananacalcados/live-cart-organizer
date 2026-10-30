import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchGroupSendRoutes } from "@/lib/marketing/groupSendRouting";
import { GroupSendRoutingPanel } from "./GroupSendRoutingPanel";
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
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { enqueueGroupAdminActions, estimateBatchMinutes, newBatchCode, type EnqueueGroupActionInput } from "@/lib/marketing/groupAdminQueue";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CampaignBulkSettingsProps {
  campaignId: string;
  targetGroups: string[];
  onBack: () => void;
}

export function CampaignBulkSettings({ campaignId, targetGroups, onBack }: CampaignBulkSettingsProps) {
  const { selectedNumberId } = useWhatsAppNumberStore();
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
  const [campaignWhatsappNumberId, setCampaignWhatsappNumberId] = useState<string | null>(null);
  const [sendOverrides, setSendOverrides] = useState<Record<string, string>>({});

  // Confirmação/pré-visualização antes de aplicar ações que alteram os grupos reais
  type PendingAction = {
    action: 'name' | 'photo' | 'description' | 'permissions' | 'pin';
    label: string;
    delayMs: number;
    groups: GroupRow[];
    crossWarnings: { campaignName: string; groupName: string }[];
  };
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isPreparing, setIsPreparing] = useState<string | null>(null);



  // Load saved settings from campaign
  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from('group_campaigns')
      .select('group_name_template, group_photo_url, group_description, group_only_admins_send, group_only_admins_add, group_admin_phones, group_pin_message_text, group_pin_duration, whatsapp_number_id')
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
      setCampaignWhatsappNumberId((data as any).whatsapp_number_id || null);
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

  // ---- Roteamento de grupos por provider (uazapi / Z-API / WaSender) ----
  // storedInstanceId = valor gravado no grupo (pode ser um token antigo/morto)
  // effectiveInstanceId = instância ATIVA real usada para rotear (nº da campanha ou o selecionado no topo)
  type GroupRow = { id: string; group_id: string; name: string; storedInstanceId: string | null; effectiveInstanceId: string | null; provider: string };

  const isUuid = (v: string | null | undefined): boolean =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // Apenas os dígitos do JID identificam o grupo FÍSICO (ignora "@g.us" vs "-group" e instância).
  const groupDigits = (raw: string | null | undefined): string => (raw || '').replace(/\D/g, '');

  const fetchGroupsWithProvider = async (): Promise<GroupRow[]> => {
    const routes = await fetchGroupSendRoutes(targetGroups, campaignWhatsappNumberId || selectedNumberId, sendOverrides);
    return routes.map(route => ({ id: route.target_id, group_id: route.group_jid, name: route.name, storedInstanceId: route.instance_id, effectiveInstanceId: route.instance_id, provider: route.provider }));
  };

  // Verifica se algum dos grupos físicos também pertence a OUTRA campanha,
  // para avisar antes de renomear/alterar e evitar tocar grupo de outra live.
  const findCrossCampaignGroups = async (
    rows: GroupRow[],
  ): Promise<{ campaignName: string; groupName: string }[]> => {
    const digits = [...new Set(rows.map(r => groupDigits(r.group_id)).filter(Boolean))];
    if (digits.length === 0) return [];

    // Todos os registros (qualquer instância/formato) desses grupos físicos.
    const candidates = digits.flatMap(d => [`${d}@g.us`, `${d}-group`]);
    const { data: allRows } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name')
      .in('group_id', candidates);
    const idToDigits = new Map<string, string>();
    const idToName = new Map<string, string>();
    (allRows || []).forEach((r: any) => {
      idToDigits.set(r.id, groupDigits(r.group_id));
      idToName.set(r.id, r.name);
    });
    const allIds = new Set(idToDigits.keys());

    const { data: others } = await supabase
      .from('group_campaigns')
      .select('id, name, target_groups')
      .neq('id', campaignId);

    const warnings: { campaignName: string; groupName: string }[] = [];
    const seen = new Set<string>();
    (others || []).forEach((c: any) => {
      (c.target_groups || []).forEach((gid: string) => {
        if (!allIds.has(gid)) return;
        const dkey = `${c.id}:${idToDigits.get(gid)}`;
        if (seen.has(dkey)) return;
        seen.add(dkey);
        warnings.push({ campaignName: c.name, groupName: idToName.get(gid) || idToDigits.get(gid) || '' });
      });
    });
    return warnings;
  };


  // As ações em massa não rodam mais no navegador: são ENFILEIRADAS em
  // group_admin_actions e o worker do servidor executa com ritmo anti-ban.
  // A pré-visualização (grupos físicos deduplicados + avisos de campanhas
  // cruzadas) continua igual antes de confirmar.

  // Monta a pré-visualização (grupos físicos deduplicados + avisos de campanhas cruzadas) e abre confirmação.
  const prepareAction = async (
    action: 'name' | 'photo' | 'description' | 'permissions' | 'pin',
    label: string,
    delayMs: number,
  ) => {
    setIsPreparing(action);
    try {
      const groups = await fetchGroupsWithProvider();
      if (groups.length === 0) { toast.error('Nenhum grupo encontrado'); return; }
      const crossWarnings = await findCrossCampaignGroups(groups);
      setPendingAction({ action, label, delayMs, groups, crossWarnings });
    } catch (e) {
      toast.error(`Erro ao preparar: ${(e as Error).message}`);
    } finally {
      setIsPreparing(null);
    }
  };

  // Monta as linhas da fila (uma por grupo físico) para a ação confirmada.
  const buildQueueItems = (
    groups: GroupRow[],
    action: 'name' | 'photo' | 'description' | 'permissions' | 'pin' | 'promote',
    batch: string,
    extra?: { phone?: string },
  ): EnqueueGroupActionInput[] => {
    const items: EnqueueGroupActionInput[] = [];
    let seq = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!g.effectiveInstanceId) continue;
      const base = {
        whatsapp_number_id: g.effectiveInstanceId,
        fallback_number_id: campaignWhatsappNumberId || selectedNumberId,
        override_number_id: sendOverrides[groupDigits(g.group_id)] || null,
        group_db_id: g.id,
        group_jid: g.group_id,
        group_name_snapshot: g.name,
        campaign_id: campaignId,
        batch,
        requested_by: 'user',
      };
      switch (action) {
        case 'name':
          items.push({ ...base, action_type: 'rename', payload: { name: `${bulkName} #${i + 1}` }, seq: ++seq });
          break;
        case 'photo':
          items.push({ ...base, action_type: 'set_photo', payload: { photo_url: bulkPhotoUrl }, seq: ++seq });
          break;
        case 'description':
          items.push({ ...base, action_type: 'set_description', payload: { description: bulkDescription }, seq: ++seq });
          break;
        case 'permissions':
          items.push({ ...base, action_type: 'set_only_admins_send', payload: { enabled: onlyAdminsSend }, seq: ++seq });
          items.push({ ...base, action_type: 'set_only_admins_add', payload: { enabled: onlyAdminsAdd }, seq: ++seq });
          break;
        case 'pin':
          items.push({ ...base, action_type: 'pin_message', payload: { text: pinMessageText, duration: pinDuration }, seq: ++seq });
          break;
        case 'promote':
          items.push({ ...base, action_type: 'promote_admin', payload: { phone: extra?.phone }, seq: ++seq });
          break;
      }
    }
    return items;
  };

  // Executa a ação confirmada: ENFILEIRA na fila de ações de grupo (worker no
  // servidor executa com ritmo anti-ban), em vez de rodar em laço no navegador.
  const executeConfirmed = async () => {
    if (!pendingAction) return;
    const { action, groups } = pendingAction;
    setPendingAction(null);
    setIsApplying(action);
    try {
      const batch = newBatchCode(`campanha-${action}`);
      const items = buildQueueItems(groups, action, batch);
      if (items.length === 0) {
        toast.error('Nenhum grupo com instância ativa para enfileirar');
        return;
      }
      const n = await enqueueGroupAdminActions(items);
      toast.success(`${n} ações adicionadas à fila; previsão de conclusão ~${estimateBatchMinutes(n)} min. Acompanhe na aba "Ações de grupo".`);
    } catch (e) {
      toast.error(`Erro ao enfileirar: ${(e as Error).message}`);
    } finally {
      setIsApplying(null);
    }
  };

  const handlePromoteInAllGroups = async () => {
    if (!promotePhone.trim()) return;
    const cleanPhone = promotePhone.replace(/\D/g, '');
    setIsApplying('promote');
    try {
      const groups = await fetchGroupsWithProvider();
      if (groups.length === 0) { toast.error('Nenhum grupo encontrado'); return; }
      const batch = newBatchCode('campanha-promote');
      const items = buildQueueItems(groups, 'promote', batch, { phone: cleanPhone });
      if (items.length === 0) {
        toast.error('Nenhum grupo com instância ativa para enfileirar');
        return;
      }
      const n = await enqueueGroupAdminActions(items);

      if (!adminPhones.includes(cleanPhone)) {
        const newAdmins = [...adminPhones, cleanPhone];
        setAdminPhones(newAdmins);
        await supabase.from('group_campaigns').update({ group_admin_phones: newAdmins } as any).eq('id', campaignId);
      }

      toast.success(`${n} ações de promoção na fila; previsão ~${estimateBatchMinutes(n)} min.`);
      setPromotePhone('');
    } catch (e) {
      toast.error(`Erro ao promover admin: ${(e as Error).message}`);
    } finally {
      setIsApplying(null);
    }
  };

  const handleRemoveAdmin = (phone: string) => {
    const newAdmins = adminPhones.filter(p => p !== phone);
    setAdminPhones(newAdmins);
    supabase.from('group_campaigns').update({
      group_admin_phones: newAdmins,
    } as any).eq('id', campaignId);
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
        <GroupSendRoutingPanel groupIds={targetGroups} fallback={campaignWhatsappNumberId || selectedNumberId} overrides={sendOverrides} onChange={setSendOverrides} />
        {/* Rename */}
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-1"><Type className="h-3.5 w-3.5" /> Alterar Nome</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            <Input placeholder="Nome base (ex: VIP Banana)" value={bulkName} onChange={e => setBulkName(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">Cada grupo receberá "#1", "#2"... após o nome</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={!bulkName.trim() || isApplying === 'name' || isPreparing === 'name'} className="gap-1"
                onClick={() => prepareAction('name', 'Nome aplicado', 1000)}>
                {isApplying === 'name' || isPreparing === 'name' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Type className="h-3.5 w-3.5" />}
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
                const raw = e.target.files?.[0];
                if (!raw) return;
                setIsUploadingPhoto(true);
                try {
                  const { normalizeImageOrientation } = await import('@/lib/imageOrientation');
                  const file = await normalizeImageOrientation(raw);
                  const ext = file.name.split('.').pop();
                  const path = `group-photos/${Date.now()}.${ext}`;
                  const { error } = await supabase.storage.from('marketing-attachments').upload(path, file, { contentType: file.type });
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
            <Button size="sm" disabled={!bulkPhotoUrl.trim() || isApplying === 'photo' || isPreparing === 'photo'} className="gap-1"
              onClick={() => prepareAction('photo', 'Foto aplicada', 1000)}>
              {isApplying === 'photo' || isPreparing === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Image className="h-3.5 w-3.5" />}
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
            <Button size="sm" disabled={!bulkDescription.trim() || isApplying === 'description' || isPreparing === 'description'} className="gap-1"
              onClick={() => prepareAction('description', 'Descrição aplicada', 1000)}>
              {isApplying === 'description' || isPreparing === 'description' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
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
            <Button size="sm" disabled={!pinMessageText.trim() || isApplying === 'pin' || isPreparing === 'pin'} className="gap-1"
              onClick={() => prepareAction('pin', 'Mensagem fixada', 1500)}>
              {isApplying === 'pin' || isPreparing === 'pin' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
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
            <Button size="sm" disabled={isApplying === 'permissions' || isPreparing === 'permissions'} className="gap-1"
              onClick={() => prepareAction('permissions', 'Permissões aplicadas', 1000)}>
              {isApplying === 'permissions' || isPreparing === 'permissions' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
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

      <AlertDialog open={!!pendingAction} onOpenChange={(o) => { if (!o) setPendingAction(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar: {pendingAction?.label}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-xs">
                <p>
                  Serão enfileiradas ações para <strong>{pendingAction?.groups.length || 0} grupo(s) físico(s)</strong> desta campanha.
                  O servidor executa uma por vez, com pausas anti-ban — previsão de conclusão ~{estimateBatchMinutes(pendingAction?.groups.length || 0)} min.
                  Registros duplicados/legados foram automaticamente unificados.
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                  {pendingAction?.groups.map((g, i) => (
                    <div key={g.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{i + 1}. {g.name}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">{g.provider}</Badge>
                    </div>
                  ))}
                </div>
                {pendingAction && pendingAction.crossWarnings.length > 0 && (
                  <Alert variant="destructive" className="p-2">
                    <AlertDescription className="text-[11px]">
                      <strong>Atenção:</strong> alguns destes grupos também estão em outra(s) campanha(s).
                      Alterá-los aqui mudará o grupo real (compartilhado):
                      <ul className="mt-1 list-disc pl-4">
                        {pendingAction.crossWarnings.slice(0, 6).map((w, idx) => (
                          <li key={idx}>{w.groupName} → <strong>{w.campaignName}</strong></li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirmed}>Confirmar e enfileirar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
