import { useEffect, useState } from "react";
import { resolveInstanceByKey, runGroupAction, type InstanceInfo, type GroupAction } from "@/lib/marketing/instanceGroups";
import { toast } from "sonner";
import { Settings, Image, Type, FileText, Users, Shield, UserPlus, UserMinus, Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchGroupSendRoutes } from "@/lib/marketing/groupSendRouting";
import { GroupSendRoutingPanel } from "./GroupSendRoutingPanel";
import { enqueueGroupAdminActions, type GroupAdminActionType } from "@/lib/marketing/groupAdminQueue";

interface GroupSettingsPanelProps {
  group: {
    id: string;
    group_id: string;
    name: string;
    description: string | null;
    photo_url: string | null;
    participant_count: number;
    max_participants: number;
    invite_link: string | null;
    only_admins_send: boolean;
    only_admins_add: boolean;
    is_full: boolean;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

interface Participant {
  phone: string;
  name?: string;
  isAdmin?: boolean;
}

export function GroupSettingsPanel({ group, open, onOpenChange, onUpdate }: GroupSettingsPanelProps) {
  const [photoUrl, setPhotoUrl] = useState("");
  const [newName, setNewName] = useState(group.name);
  const [newDescription, setNewDescription] = useState(group.description || "");
  const [inviteLink, setInviteLink] = useState(group.invite_link || "");
  const [maxParticipants, setMaxParticipants] = useState(group.max_participants);
  const [onlyAdminsSend, setOnlyAdminsSend] = useState(group.only_admins_send);
  const [onlyAdminsAdd, setOnlyAdminsAdd] = useState(group.only_admins_add);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [sendOverrides, setSendOverrides] = useState<Record<string, string>>({});

  // Instância do grupo (resolvida por whatsapp_groups.instance_id) → roteia pelo provedor real.
  const [inst, setInst] = useState<InstanceInfo | null>(null);
  const [instState, setInstState] = useState<'loading' | 'ok' | 'missing'>('loading');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setInstState('loading');
    (async () => {
      const { data } = await supabase.from('whatsapp_groups').select('instance_id').eq('id', group.id).maybeSingle();
      const original = await resolveInstanceByKey((data as any)?.instance_id);
      const routes = await fetchGroupSendRoutes([group.id], original?.id || null);
      const info = routes[0]?.instance_id ? await resolveInstanceByKey(routes[0].instance_id) : original;
      if (!alive) return;
      setInst(info);
      setInstState(info ? 'ok' : 'missing');
    })();
    return () => { alive = false; };
  }, [open, group.id]);
  const disabled = instState !== 'ok';

  const callGroupSettings = async (action: string, extraParams: Record<string, string> = {}) => {
    if (!inst) return { success: false, error: 'Instância do grupo não encontrada' };
    return runGroupAction(inst, group.group_id, action as GroupAction, extraParams.phone ?? extraParams.value);
  };

  // Ações de escrita passam pela FILA de ações de grupo (ritmo anti-ban no
  // servidor). Leitura de participantes continua direta.
  const enqueueAction = async (actionType: GroupAdminActionType, payload: Record<string, unknown>) => {
    if (!inst) { toast.error('Instância do grupo não encontrada'); return false; }
    try {
      await enqueueGroupAdminActions([{
        whatsapp_number_id: inst.id,
        fallback_number_id: inst.id,
        override_number_id: sendOverrides[group.group_id.replace(/\D/g, "")] || null,
        group_db_id: group.id,
        group_jid: group.group_id,
        group_name_snapshot: group.name,
        action_type: actionType,
        payload,
        requested_by: 'user',
      }]);
      toast.success('Ação adicionada à fila — executa em instantes, respeitando o ritmo anti-ban.');
      return true;
    } catch {
      toast.error('Erro ao enfileirar ação');
      return false;
    }
  };

  const loadParticipants = async () => {
    setIsLoadingParticipants(true);
    try {
      const data = await callGroupSettings('get-participants');
      if (data.success && Array.isArray(data.data)) setParticipants(data.data);
      else toast.error(data.error || "Erro ao carregar participantes");
    } catch { toast.error("Erro ao carregar participantes"); }
    finally { setIsLoadingParticipants(false); }
  };

  const handleUpdatePhoto = async () => {
    if (!photoUrl.trim()) return;
    setActionLoading('photo');
    await enqueueAction('set_photo', { photo_url: photoUrl });
    setActionLoading('');
  };

  const handleUpdateName = async () => {
    setActionLoading('name');
    if (await enqueueAction('rename', { name: newName })) onUpdate();
    setActionLoading('');
  };

  const handleUpdateDescription = async () => {
    setActionLoading('desc');
    await enqueueAction('set_description', { description: newDescription });
    setActionLoading('');
  };

  const handleToggleAdminsSend = async (val: boolean) => {
    setOnlyAdminsSend(val);
    const ok = await enqueueAction('set_only_admins_send', { enabled: val });
    if (!ok) { setOnlyAdminsSend(!val); return; }
  };

  const handleToggleAdminsAdd = async (val: boolean) => {
    setOnlyAdminsAdd(val);
    const ok = await enqueueAction('set_only_admins_add', { enabled: val });
    if (!ok) { setOnlyAdminsAdd(!val); return; }
  };

  const handleSaveLocal = async () => {
    setIsSaving(true);
    await supabase.from('whatsapp_groups').update({
      invite_link: inviteLink || null,
      max_participants: maxParticipants,
      is_full: group.participant_count >= maxParticipants,
    }).eq('id', group.id);
    toast.success("Configurações salvas!");
    onUpdate();
    setIsSaving(false);
  };

  const handleParticipantAction = async (phone: string, action: string) => {
    setActionLoading(`${action}-${phone}`);
    const map: Record<string, GroupAdminActionType> = {
      'promote-admin': 'promote_admin',
      'demote-admin': 'demote_admin',
      'remove-participant': 'remove_participant',
    };
    const t = map[action];
    if (t) await enqueueAction(t, { phone });
    setActionLoading('');
  };

  const handleAddParticipant = async () => {
    if (!newPhone.trim()) return;
    setActionLoading('add');
    if (await enqueueAction('add_participant', { phone: newPhone.replace(/\D/g, '') })) setNewPhone("");
    setActionLoading('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" /> Configurações: {group.name}
          </DialogTitle>
        </DialogHeader>
        {open && <GroupSendRoutingPanel groupIds={[group.id]} fallback={inst?.id || null} overrides={sendOverrides} onChange={setSendOverrides} />}

        {instState === 'missing' && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Não achei a instância de WhatsApp deste grupo. Sincronize os grupos da instância e tente de novo. As ações no WhatsApp estão desativadas.
          </div>
        )}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <fieldset disabled={disabled} className="space-y-6 pb-4 disabled:opacity-60">
            {/* Photo */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs font-medium"><Image className="h-3.5 w-3.5" /> Foto do Grupo</Label>
              <div className="flex gap-2">
                <Input placeholder="URL da imagem" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={handleUpdatePhoto} disabled={actionLoading === 'photo'}>
                  {actionLoading === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Alterar"}
                </Button>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs font-medium"><Type className="h-3.5 w-3.5" /> Nome</Label>
              <div className="flex gap-2">
                <Input value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={handleUpdateName} disabled={actionLoading === 'name'}>
                  {actionLoading === 'name' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                </Button>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-xs font-medium"><FileText className="h-3.5 w-3.5" /> Descrição</Label>
              <Textarea value={newDescription} onChange={e => setNewDescription(e.target.value)} rows={3} />
              <Button size="sm" onClick={handleUpdateDescription} disabled={actionLoading === 'desc'}>
                {actionLoading === 'desc' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Atualizar Descrição"}
              </Button>
            </div>

            <Separator />

            {/* Local settings */}
            <div className="space-y-3">
              <Label className="text-xs font-medium">Configurações Locais</Label>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Link de Convite</Label>
                  <Input placeholder="https://chat.whatsapp.com/..." value={inviteLink} onChange={e => setInviteLink(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Máx. Participantes</Label>
                  <Input type="number" value={maxParticipants} onChange={e => setMaxParticipants(Number(e.target.value))} />
                </div>
                <Button size="sm" onClick={handleSaveLocal} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar Configurações"}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Permissions */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1 text-xs font-medium"><Shield className="h-3.5 w-3.5" /> Permissões</Label>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Somente admins enviam mensagens</Label>
                <Switch checked={onlyAdminsSend} onCheckedChange={handleToggleAdminsSend} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Somente admins adicionam pessoas</Label>
                <Switch checked={onlyAdminsAdd} onCheckedChange={handleToggleAdminsAdd} />
              </div>
            </div>

            <Separator />

            {/* Participants */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1 text-xs font-medium">
                  <Users className="h-3.5 w-3.5" /> Participantes ({group.participant_count})
                </Label>
                <Button variant="outline" size="sm" onClick={loadParticipants} disabled={isLoadingParticipants}>
                  {isLoadingParticipants ? <Loader2 className="h-3 w-3 animate-spin" /> : "Carregar"}
                </Button>
              </div>

              {/* Add participant */}
              <div className="flex gap-2">
                <Input placeholder="5511999999999" value={newPhone} onChange={e => setNewPhone(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={handleAddParticipant} disabled={actionLoading === 'add'}>
                  {actionLoading === 'add' ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {participants.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-auto">
                  {participants.map(p => (
                    <div key={p.phone} className="flex items-center justify-between py-1 px-2 rounded text-xs bg-muted/50">
                      <div className="flex items-center gap-2">
                        <span>{p.name || p.phone}</span>
                        {p.isAdmin && <Badge variant="secondary" className="text-[9px]">Admin</Badge>}
                      </div>
                      <div className="flex gap-1">
                        {!p.isAdmin && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => handleParticipantAction(p.phone, 'promote-admin')}
                            disabled={actionLoading === `promote-admin-${p.phone}`}>
                            <Crown className="h-3 w-3" />
                          </Button>
                        )}
                        {p.isAdmin && (
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => handleParticipantAction(p.phone, 'demote-admin')}
                            disabled={actionLoading === `demote-admin-${p.phone}`}>
                            <Crown className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                          onClick={() => handleParticipantAction(p.phone, 'remove-participant')}
                          disabled={actionLoading === `remove-participant-${p.phone}`}>
                          <UserMinus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </fieldset>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
