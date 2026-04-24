import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Edit2, Copy, Zap, MessageSquare, TrendingUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';

const COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#6366F1',
];

interface SalesTrigger {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  is_active: boolean;
  color: string;
  sort_order: number;
  ad_campaign_id: string | null;
  created_at: string;
}

interface TriggerMessage {
  id: string;
  trigger_id: string;
  sort_order: number;
  delay_seconds: number;
  content: string;
  media_type: string | null;
  media_url: string | null;
  is_active: boolean;
}

interface ConversionStats {
  trigger_id: string;
  total_conversions: number;
  total_value: number;
}

export function TriggersManager() {
  const [triggers, setTriggers] = useState<SalesTrigger[]>([]);
  const [stats, setStats] = useState<Record<string, ConversionStats>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SalesTrigger | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showMessages, setShowMessages] = useState<SalesTrigger | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: trigs }, { data: convs }] = await Promise.all([
      supabase.from('sales_triggers' as any).select('*').order('sort_order').order('created_at'),
      supabase.from('trigger_conversions' as any).select('trigger_id, sale_value'),
    ]);
    setTriggers((trigs as unknown as SalesTrigger[]) || []);
    const map: Record<string, ConversionStats> = {};
    ((convs as unknown as { trigger_id: string | null; sale_value: number }[]) || []).forEach(c => {
      if (!c.trigger_id) return;
      const key = c.trigger_id;
      if (!map[key]) map[key] = { trigger_id: key, total_conversions: 0, total_value: 0 };
      map[key].total_conversions += 1;
      map[key].total_value += Number(c.sale_value) || 0;
    });
    setStats(map);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSave = async (form: Partial<SalesTrigger>) => {
    const payload: any = {
      name: form.name?.trim(),
      description: form.description ?? null,
      keywords: form.keywords ?? [],
      is_active: form.is_active ?? true,
      color: form.color ?? '#3B82F6',
      sort_order: form.sort_order ?? 0,
      ad_campaign_id: form.ad_campaign_id ?? null,
    };
    if (!payload.name) {
      toast.error('Nome do trigger é obrigatório');
      return;
    }
    if (editing?.id) {
      const { error } = await supabase.from('sales_triggers' as any).update(payload).eq('id', editing.id);
      if (error) return toast.error(error.message);
      toast.success('Trigger atualizado');
    } else {
      const { error } = await supabase.from('sales_triggers' as any).insert(payload);
      if (error) return toast.error(error.message);
      toast.success('Trigger criado');
    }
    setShowForm(false);
    setEditing(null);
    loadAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este trigger? As mensagens vinculadas também serão removidas.')) return;
    const { error } = await supabase.from('sales_triggers' as any).delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Trigger removido');
    loadAll();
  };

  const handleToggle = async (t: SalesTrigger) => {
    await supabase.from('sales_triggers' as any).update({ is_active: !t.is_active }).eq('id', t.id);
    loadAll();
  };

  const handleCopyMessages = async (sourceId: string) => {
    const targetId = prompt(
      'Cole o ID do trigger destino (ou clique em "Copiar mensagens" no card destino):'
    );
    if (!targetId) return;
    const { data, error } = await supabase.rpc('copy_trigger_messages' as any, {
      p_source_trigger_id: sourceId,
      p_target_trigger_id: targetId,
    });
    if (error) return toast.error(error.message);
    toast.success(`${data} mensagens copiadas`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Triggers de Venda
          </h2>
          <p className="text-xs text-muted-foreground">
            Gatilhos por palavra-chave com sequência de mensagens e tracking de conversão.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Trigger
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : triggers.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhum trigger criado ainda.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {triggers.map(t => {
            const s = stats[t.id];
            return (
              <Card key={t.id} className="border-l-4" style={{ borderLeftColor: t.color }}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <Switch checked={t.is_active} onCheckedChange={() => handleToggle(t)} />
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {t.keywords.slice(0, 4).map(k => (
                      <Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>
                    ))}
                    {t.keywords.length > 4 && (
                      <Badge variant="outline" className="text-[10px]">+{t.keywords.length - 4}</Badge>
                    )}
                  </div>
                  {s && (
                    <div className="flex items-center gap-3 text-xs pt-1 border-t">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-green-600" />
                        <strong>{s.total_conversions}</strong> conv.
                      </span>
                      <span className="text-green-700 font-medium">
                        R$ {s.total_value.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-1 pt-1">
                    <Button variant="outline" size="sm" className="flex-1 h-7 text-xs"
                      onClick={() => setShowMessages(t)}>
                      <MessageSquare className="h-3 w-3 mr-1" /> Sequência
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2"
                      onClick={() => { setEditing(t); setShowForm(true); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2"
                      onClick={() => handleCopyMessages(t.id)} title="Copiar sequência para outro trigger">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive"
                      onClick={() => handleDelete(t.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-[9px] text-muted-foreground/70 font-mono break-all">
                    ID: {t.id}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Trigger form dialog */}
      <TriggerFormDialog
        open={showForm}
        onOpenChange={(o) => { setShowForm(o); if (!o) setEditing(null); }}
        editing={editing}
        onSave={handleSave}
      />

      {/* Messages dialog */}
      {showMessages && (
        <TriggerMessagesDialog
          trigger={showMessages}
          open={!!showMessages}
          onOpenChange={(o) => { if (!o) setShowMessages(null); }}
        />
      )}
    </div>
  );
}

// ============= Form Dialog =============
function TriggerFormDialog({
  open, onOpenChange, editing, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: SalesTrigger | null;
  onSave: (form: Partial<SalesTrigger>) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setDescription(editing?.description ?? '');
      setKeywords(editing?.keywords ?? []);
      setKeywordInput('');
      setColor(editing?.color ?? COLORS[0]);
      setIsActive(editing?.is_active ?? true);
    }
  }, [open, editing]);

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (!v || keywords.includes(v)) return;
    setKeywords([...keywords, v]);
    setKeywordInput('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Trigger' : 'Novo Trigger'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Live Verão 2026" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Palavras-chave</Label>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                placeholder="Digite e pressione Enter"
              />
              <Button type="button" onClick={addKeyword} size="sm">Add</Button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {keywords.map(k => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {k}
                  <button onClick={() => setKeywords(keywords.filter(x => x !== k))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label>Ativo</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSave({ name, description, keywords, color, is_active: isActive })}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= Messages Sequence Dialog =============
function TriggerMessagesDialog({
  trigger, open, onOpenChange,
}: {
  trigger: SalesTrigger;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [messages, setMessages] = useState<TriggerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMsg, setEditingMsg] = useState<Partial<TriggerMessage> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('trigger_messages' as any)
      .select('*')
      .eq('trigger_id', trigger.id)
      .order('sort_order');
    setMessages((data as unknown as TriggerMessage[]) || []);
    setLoading(false);
  }, [trigger.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const saveMessage = async () => {
    if (!editingMsg?.content?.trim()) return toast.error('Conteúdo é obrigatório');
    const payload: any = {
      trigger_id: trigger.id,
      sort_order: editingMsg.sort_order ?? messages.length,
      delay_seconds: editingMsg.delay_seconds ?? 0,
      content: editingMsg.content,
      media_type: editingMsg.media_type ?? null,
      media_url: editingMsg.media_url ?? null,
      is_active: editingMsg.is_active ?? true,
    };
    if (editingMsg.id) {
      await supabase.from('trigger_messages' as any).update(payload).eq('id', editingMsg.id);
    } else {
      await supabase.from('trigger_messages' as any).insert(payload);
    }
    setEditingMsg(null);
    load();
  };

  const deleteMessage = async (id: string) => {
    if (!confirm('Remover esta mensagem da sequência?')) return;
    await supabase.from('trigger_messages' as any).delete().eq('id', id);
    load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Sequência: <span style={{ color: trigger.color }}>{trigger.name}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma mensagem. Clique em "Adicionar mensagem" abaixo.
              </p>
            ) : messages.map((m, idx) => (
              <Card key={m.id} className="border">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      Msg {idx + 1} · após {m.delay_seconds}s
                    </Badge>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-6 px-2"
                        onClick={() => setEditingMsg(m)}>
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive"
                        onClick={() => deleteMessage(m.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs whitespace-pre-wrap">{m.content}</p>
                  {m.media_url && (
                    <p className="text-[10px] text-muted-foreground">
                      📎 {m.media_type}: {m.media_url.slice(0, 60)}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        {editingMsg ? (
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input type="number" value={editingMsg.sort_order ?? messages.length}
                  onChange={(e) => setEditingMsg({ ...editingMsg, sort_order: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <Label className="text-xs">Atraso (segundos)</Label>
                <Input type="number" value={editingMsg.delay_seconds ?? 0}
                  onChange={(e) => setEditingMsg({ ...editingMsg, delay_seconds: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Conteúdo</Label>
              <Textarea rows={3} value={editingMsg.content ?? ''}
                onChange={(e) => setEditingMsg({ ...editingMsg, content: e.target.value })}
                placeholder="Mensagem que será enviada..." />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Tipo de mídia (opcional)</Label>
                <Select
                  value={editingMsg.media_type ?? 'none'}
                  onValueChange={(v) => setEditingMsg({ ...editingMsg, media_type: v === 'none' ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem mídia</SelectItem>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="audio">Áudio</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">URL da mídia</Label>
                <Input value={editingMsg.media_url ?? ''}
                  onChange={(e) => setEditingMsg({ ...editingMsg, media_url: e.target.value })}
                  placeholder="https://..." />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditingMsg(null)}>Cancelar</Button>
              <Button size="sm" onClick={saveMessage}>Salvar mensagem</Button>
            </div>
          </div>
        ) : (
          <div className="border-t pt-3 flex justify-end">
            <Button size="sm" onClick={() => setEditingMsg({ sort_order: messages.length, delay_seconds: 0, content: '' })}>
              <Plus className="h-3 w-3 mr-1" /> Adicionar mensagem
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
