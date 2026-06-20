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
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";

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
    const { data: groups } = await supabase
      .from('whatsapp_groups')
      .select('id, group_id, name, instance_id')
      .in('id', targetGroups);
    if (!groups || groups.length === 0) return [];

    // Candidatos a instância: UUIDs válidos gravados nos grupos + nº da campanha + nº selecionado no topo.
    // (instance_id pode ser um token cru antigo, ex.: instância Z-API desativada — esses são ignorados no roteamento)
    const candidateIds = [...new Set([
      ...groups.map((g: any) => g.instance_id).filter(isUuid),
      campaignWhatsappNumberId,
      selectedNumberId,
    ].filter(Boolean))] as string[];

    const numbersMap = new Map<string, { provider: string; active: boolean }>();
    if (candidateIds.length > 0) {
      const { data: nums } = await supabase
        .from('whatsapp_numbers')
        .select('id, provider, is_active')
        .in('id', candidateIds);
      (nums || []).forEach((n: any) => numbersMap.set(n.id, { provider: n.provider, active: !!n.is_active }));
    }

    // Instância "operante": prioriza o número ATIVO da campanha; senão, o número ATIVO selecionado no topo.
    const operating =
      (campaignWhatsappNumberId && numbersMap.get(campaignWhatsappNumberId)?.active ? campaignWhatsappNumberId : null) ||
      (selectedNumberId && numbersMap.get(selectedNumberId)?.active ? selectedNumberId : null);

    const mapped: GroupRow[] = groups.map((g: any) => {
      // Só confia no instance_id do grupo se for um UUID de instância ATIVA. Caso contrário usa a operante.
      const storedActive = isUuid(g.instance_id) && numbersMap.get(g.instance_id)?.active;
      const effectiveInstanceId = storedActive ? g.instance_id : operating;
      const provider = effectiveInstanceId ? (numbersMap.get(effectiveInstanceId)?.provider || 'zapi') : 'zapi';
      return {
        id: g.id,
        group_id: g.group_id,
        name: g.name,
        storedInstanceId: g.instance_id ?? null,
        effectiveInstanceId: effectiveInstanceId ?? null,
        provider,
      };
    });

    // Deduplica por grupo FÍSICO (dígitos do JID). O mesmo grupo aparece várias vezes
    // (1 linha por instância + registro legado "-group" de instância morta). Mantemos
    // apenas o melhor registro: prioriza JID moderno "@g.us" com instância UUID ativa
    // sobre registros legados/token cru — evita renomear o mesmo grupo 2x ou via instância errada.
    const score = (g: GroupRow): number => {
      let s = 0;
      if (isUuid(g.storedInstanceId) && numbersMap.get(g.storedInstanceId!)?.active) s += 4; // instância própria ativa
      if (/@g\.us$/i.test(g.group_id)) s += 2; // formato moderno
      if (!/-group$/i.test(g.group_id)) s += 1; // não é legado
      return s;
    };
    const bestByDigits = new Map<string, GroupRow>();
    for (const g of mapped) {
      const key = groupDigits(g.group_id);
      if (!key) continue;
      const cur = bestByDigits.get(key);
      if (!cur || score(g) > score(cur)) bestByDigits.set(key, g);
    }
    return Array.from(bestByDigits.values());
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


  const invokeFn = async (fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return { ok: false, error: error.message };
    if (data && (data as any).success === true) return { ok: true };
    const err = (data as any)?.error;
    return { ok: false, error: err ? (typeof err === 'string' ? err : JSON.stringify(err)) : 'Falha desconhecida' };
  };

  // Aplica uma ação lógica a UM grupo, roteando pelo provider real da instância.
  const applyActionToGroup = async (
    g: GroupRow,
    action: 'name' | 'photo' | 'description' | 'permissions' | 'pin' | 'promote',
    idx: number,
    extra?: { phone?: string },
  ): Promise<{ ok: boolean; error?: string }> => {
    const wid = g.effectiveInstanceId || undefined;
    if (!wid) return { ok: false, error: 'Sem número de WhatsApp ativo. Atribua um número à campanha ou selecione um número ativo no topo.' };

    if (g.provider === 'uazapi') {
      switch (action) {
        case 'name':
          return invokeFn('uazapi-groups', { action: 'updateName', groupJid: g.group_id, name: `${bulkName} #${idx + 1}`, whatsapp_number_id: wid });
        case 'photo':
          return invokeFn('uazapi-groups', { action: 'updateImage', groupJid: g.group_id, image: bulkPhotoUrl, whatsapp_number_id: wid });
        case 'description':
          return invokeFn('uazapi-groups', { action: 'updateDescription', groupJid: g.group_id, description: bulkDescription, whatsapp_number_id: wid });
        case 'permissions': {
          const r1 = await invokeFn('uazapi-groups', { action: 'updateAnnounce', groupJid: g.group_id, announce: onlyAdminsSend, whatsapp_number_id: wid });
          const r2 = await invokeFn('uazapi-groups', { action: 'updateMemberAddMode', groupJid: g.group_id, adminsOnly: onlyAdminsAdd, whatsapp_number_id: wid });
          return r1.ok && r2.ok ? { ok: true } : { ok: false, error: r1.error || r2.error };
        }
        case 'pin':
          return invokeFn('uazapi-groups', { action: 'pinMessage', groupJid: g.group_id, message: pinMessageText, pinDuration, whatsapp_number_id: wid });
        case 'promote':
          return invokeFn('uazapi-groups', { action: 'updateParticipants', groupJid: g.group_id, participantAction: 'promote', participants: [extra?.phone], whatsapp_number_id: wid });
      }
    }

    if (g.provider === 'wasender') {
      switch (action) {
        case 'permissions':
          return invokeFn('wasender-groups', { action: 'settings', groupJid: g.group_id, settings: { announce: onlyAdminsSend, restrict: onlyAdminsAdd }, whatsapp_number_id: wid });
        case 'promote':
          return invokeFn('wasender-groups', { action: 'updateParticipants', groupJid: g.group_id, participantAction: 'promote', participants: [extra?.phone], whatsapp_number_id: wid });
        case 'pin':
          return invokeFn('wasender-groups', { action: 'sendMessage', groupJid: g.group_id, message: pinMessageText, whatsapp_number_id: wid });
        default:
          return { ok: false, error: `Ação "${action}" não suportada pelo provedor WaSender` };
      }
    }

    // Padrão: Z-API
    switch (action) {
      case 'name':
        return invokeFn('zapi-group-settings', { groupId: g.group_id, action: 'update-name', value: `${bulkName} #${idx + 1}`, whatsapp_number_id: wid });
      case 'photo':
        return invokeFn('zapi-group-settings', { groupId: g.group_id, action: 'update-photo', value: bulkPhotoUrl, whatsapp_number_id: wid });
      case 'description':
        return invokeFn('zapi-group-settings', { groupId: g.group_id, action: 'update-description', value: bulkDescription, whatsapp_number_id: wid });
      case 'permissions': {
        const r1 = await invokeFn('zapi-group-settings', { groupId: g.group_id, action: 'set-messages-admins-only', value: String(onlyAdminsSend), whatsapp_number_id: wid });
        const r2 = await invokeFn('zapi-group-settings', { groupId: g.group_id, action: 'set-add-admins-only', value: String(onlyAdminsAdd), whatsapp_number_id: wid });
        return r1.ok && r2.ok ? { ok: true } : { ok: false, error: r1.error || r2.error };
      }
      case 'promote':
        return invokeFn('zapi-group-settings', { action: 'promote-admin', groupId: g.group_id, phone: extra?.phone, whatsapp_number_id: wid });
      case 'pin': {
        const send = await supabase.functions.invoke('zapi-send-group-message', {
          body: { groupId: g.group_id, message: pinMessageText, type: 'text', whatsapp_number_id: wid },
        });
        if (send.error) return { ok: false, error: send.error.message };
        const sd: any = send.data;
        const messageId = sd?.messageId || sd?.data?.messageId || sd?.data?.zapiMessageId || sd?.data?.zaapId || sd?.data?.id || null;
        if (!messageId) return { ok: false, error: 'Mensagem enviada sem ID para fixar' };
        await new Promise(r => setTimeout(r, 2000));
        return invokeFn('zapi-group-settings', { action: 'pin-message', groupId: g.group_id, messageId, pinDuration, whatsapp_number_id: wid });
      }
    }
    return { ok: false, error: 'Ação não suportada' };
  };

  const runOnAllGroups = async (
    action: 'name' | 'photo' | 'description' | 'permissions' | 'pin' | 'promote',
    delayMs: number,
    extra?: { phone?: string },
    preGroups?: GroupRow[],
  ): Promise<{ success: number; total: number; errors: string[] } | null> => {
    const groups = preGroups ?? await fetchGroupsWithProvider();
    if (groups.length === 0) { toast.error('Nenhum grupo encontrado'); return null; }
    let success = 0;
    let repointed = 0;
    const errors: string[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const res = await applyActionToGroup(g, action, i, extra);
      if (res.ok) {
        success++;
        // Auto-cura: se o grupo apontava para uma instância morta/diferente, grava a que FUNCIONOU.
        // Nunca adivinha — só persiste a instância que acabou de aplicar com sucesso.
        if (g.effectiveInstanceId && g.effectiveInstanceId !== g.storedInstanceId) {
          const { error: upErr } = await supabase
            .from('whatsapp_groups')
            .update({ instance_id: g.effectiveInstanceId })
            .eq('id', g.id);
          if (!upErr) repointed++;
        }
      } else {
        errors.push(`${g.name}: ${res.error || 'falha'}`);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    if (repointed > 0) console.info(`[CampaignBulkSettings] ${repointed} grupo(s) repontados para a instância ativa.`);
    return { success, total: groups.length, errors };
  };

  const reportResult = (label: string, r: { success: number; total: number; errors: string[] }) => {
    if (r.errors.length === 0) {
      toast.success(`${label}: ${r.success}/${r.total} grupos`);
    } else {
      console.error('[CampaignBulkSettings] falhas:', r.errors);
      toast.error(`${label}: ${r.success}/${r.total}. Falhas: ${r.errors.slice(0, 2).join(' | ')}${r.errors.length > 2 ? '…' : ''}`);
    }
  };

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

  // Executa a ação confirmada usando exatamente os grupos pré-visualizados.
  const executeConfirmed = async () => {
    if (!pendingAction) return;
    const { action, label, delayMs, groups } = pendingAction;
    setPendingAction(null);
    setIsApplying(action);
    try {
      const r = await runOnAllGroups(action, delayMs, undefined, groups);
      if (r) reportResult(label, r);
    } catch (e) {
      toast.error(`Erro ao aplicar: ${(e as Error).message}`);
    } finally {
      setIsApplying(null);
    }
  };

  const handlePromoteInAllGroups = async () => {
    if (!promotePhone.trim()) return;
    const cleanPhone = promotePhone.replace(/\D/g, '');
    setIsApplying('promote');
    try {
      const r = await runOnAllGroups('promote', 1000, { phone: cleanPhone });
      if (!r) return;

      if (!adminPhones.includes(cleanPhone)) {
        const newAdmins = [...adminPhones, cleanPhone];
        setAdminPhones(newAdmins);
        await supabase.from('group_campaigns').update({ group_admin_phones: newAdmins } as any).eq('id', campaignId);
      }

      reportResult('Admin promovido', r);
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
            <Button size="sm" disabled={isApplying === 'permissions'} className="gap-1"
              onClick={() => applyToAllGroups('permissions')}>
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
