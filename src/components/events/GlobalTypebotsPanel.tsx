import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2, ExternalLink, Copy, Files } from 'lucide-react';
import { toast } from 'sonner';
import { RichTextEditor } from '@/components/RichTextEditor';
import { ChoiceStepEditor } from '@/components/events/typebot/ChoiceStepEditor';

interface TB {
  id: string;
  event_id: string | null;
  is_global?: boolean;
  slug: string;
  name: string;
  published: boolean;
  theme_json: any;
  flow_json: any;
  welcome_message: string;
  success_message: string;
  vip_group_link: string | null;
  event_starts_at: string | null;
  prize_description: string | null;
}

const PUBLIC_BASE = 'https://checkout.bananacalcados.com.br';

const DEFAULT_TB_STEPS = [
  { id: '1', type: 'ask_name', text: 'Qual é o seu nome?', placeholder: 'Seu nome' },
  { id: '2', type: 'ask_phone', text: 'Qual seu WhatsApp?', placeholder: '(11) 99999-9999' },
  { id: '3', type: 'final', text: 'Pronto! Estou te cadastrando...' },
];

function cleanSlug(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/** Typebots globais — não pertencem a um evento específico.
 *  Os leads capturados são vinculados automaticamente à live que estiver no ar. */
export function GlobalTypebotsPanel() {
  const [tbs, setTbs] = useState<TB[]>([]);
  const [selected, setSelected] = useState<TB | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('event_typebots')
        .select('*')
        .is('event_id', null)
        .order('created_at', { ascending: false });
      if (error) toast.error(error.message);
      setTbs((data || []) as any);
      setLoading(false);
    })();
  }, []);

  async function createTB() {
    const slug = prompt('Slug do Typebot (ex: cadastro-live):');
    if (!slug) return;
    const { data, error } = await supabase.from('event_typebots').insert({
      event_id: null,
      is_global: true,
      slug: cleanSlug(slug),
      name: 'Novo Typebot',
      flow_json: { steps: DEFAULT_TB_STEPS },
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setTbs([data as any, ...tbs]);
    setSelected(data as any);
  }

  async function duplicateTB(tb: TB) {
    const slug = prompt('Slug do novo Typebot (cópia):', `${tb.slug}-copia`);
    if (!slug) return;
    const { data, error } = await supabase.from('event_typebots').insert({
      event_id: null,
      is_global: true,
      slug: cleanSlug(slug),
      name: `${tb.name} (cópia)`,
      published: false,
      theme_json: tb.theme_json ?? {},
      flow_json: tb.flow_json ?? { steps: DEFAULT_TB_STEPS },
      welcome_message: tb.welcome_message,
      success_message: tb.success_message,
      vip_group_link: tb.vip_group_link,
      event_starts_at: tb.event_starts_at,
      prize_description: tb.prize_description,
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setTbs([data as any, ...tbs]);
    setSelected(data as any);
    toast.success('Typebot duplicado!');
  }

  async function deleteTB(tb: TB) {
    if (!confirm(`Excluir o typebot "${tb.name}"? Os leads já captados são preservados.`)) return;
    const { error } = await supabase.from('event_typebots').delete().eq('id', tb.id);
    if (error) { toast.error(error.message); return; }
    setTbs(tbs.filter((t) => t.id !== tb.id));
    if (selected?.id === tb.id) setSelected(null);
    toast.success('Typebot excluído');
  }

  async function saveTB() {
    if (!selected) return;
    setSaving(true);
    const { error } = await supabase.from('event_typebots').update({
      name: selected.name,
      published: selected.published,
      theme_json: selected.theme_json,
      flow_json: selected.flow_json,
      welcome_message: selected.welcome_message,
      success_message: selected.success_message,
      vip_group_link: selected.vip_group_link,
      event_starts_at: selected.event_starts_at,
      prize_description: selected.prize_description,
    } as any).eq('id', selected.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Typebot salvo!');
    setTbs(tbs.map((t) => (t.id === selected.id ? selected : t)));
  }

  function addStep() {
    if (!selected) return;
    const steps = [...(selected.flow_json?.steps || [])];
    steps.splice(Math.max(steps.length - 1, 0), 0, { id: String(Date.now()), type: 'ask_name', text: 'Pergunta?', placeholder: '' });
    setSelected({ ...selected, flow_json: { ...selected.flow_json, steps } });
  }
  function updateStep(idx: number, patch: any) {
    if (!selected) return;
    const steps = [...(selected.flow_json?.steps || [])];
    steps[idx] = { ...steps[idx], ...patch };
    setSelected({ ...selected, flow_json: { ...selected.flow_json, steps } });
  }
  function removeStep(idx: number) {
    if (!selected) return;
    const steps = [...(selected.flow_json?.steps || [])];
    steps.splice(idx, 1);
    setSelected({ ...selected, flow_json: { ...selected.flow_json, steps } });
  }

  if (loading) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-muted/30">
        <h3 className="font-bold">Typebots reutilizáveis</h3>
        <p className="text-sm text-muted-foreground">
          Esses typebots não pertencem a um evento específico — use o mesmo link em todas as campanhas.
          Cada lead captado é vinculado automaticamente à live que estiver no ar no momento do cadastro
          (ou ao evento mais recente).
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <div className="space-y-2">
          <Button onClick={createTB} className="w-full"><Plus className="h-4 w-4 mr-2" /> Novo Typebot</Button>
          {tbs.map((tb) => (
            <Card
              key={tb.id}
              className={`p-3 cursor-pointer ${selected?.id === tb.id ? 'border-primary' : ''}`}
              onClick={() => setSelected(tb)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{tb.name}</div>
                  <div className="text-xs text-muted-foreground truncate">/typebot/{tb.slug}</div>
                  <div className="text-xs mt-1">{tb.published ? '🟢 Publicado' : '⚪ Rascunho'}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Duplicar"
                    onClick={(e) => { e.stopPropagation(); duplicateTB(tb); }}
                  >
                    <Files className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Excluir"
                    onClick={(e) => { e.stopPropagation(); deleteTB(tb); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {tbs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum typebot criado ainda</p>
          )}
        </div>

        {selected && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Input
                value={selected.name}
                onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                className="text-lg font-bold max-w-md"
              />
              <div className="flex items-center gap-2">
                <Label>Publicado</Label>
                <Switch
                  checked={selected.published}
                  onCheckedChange={(v) => setSelected({ ...selected, published: v })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">URL:</span>
              <code className="bg-muted px-2 py-1 rounded">{PUBLIC_BASE}/typebot/{selected.slug}</code>
              <Button size="icon" variant="ghost" onClick={() => {
                navigator.clipboard.writeText(`${PUBLIC_BASE}/typebot/${selected.slug}`);
                toast.success('Copiado!');
              }}><Copy className="h-3 w-3" /></Button>
              <a href={`/typebot/${selected.slug}`} target="_blank" rel="noreferrer">
                <Button size="icon" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Link do Grupo VIP</Label>
                <Input
                  value={selected.vip_group_link || ''}
                  onChange={(e) => setSelected({ ...selected, vip_group_link: e.target.value })}
                  placeholder="https://chat.whatsapp.com/..."
                />
              </div>
              <div>
                <Label>Descrição do prêmio</Label>
                <Input
                  value={selected.prize_description || ''}
                  onChange={(e) => setSelected({ ...selected, prize_description: e.target.value })}
                />
              </div>
              <div>
                <Label>Cor primária</Label>
                <Input
                  type="color"
                  value={selected.theme_json?.primary || '#facc15'}
                  onChange={(e) => setSelected({ ...selected, theme_json: { ...selected.theme_json, primary: e.target.value } })}
                />
              </div>
              <div>
                <Label>Fundo</Label>
                <Input
                  type="color"
                  value={selected.theme_json?.background || '#0f172a'}
                  onChange={(e) => setSelected({ ...selected, theme_json: { ...selected.theme_json, background: e.target.value } })}
                />
              </div>
            </div>

            <div>
              <Label>Mensagem de boas-vindas</Label>
              <RichTextEditor
                value={selected.welcome_message || ''}
                onChange={(html) => setSelected({ ...selected, welcome_message: html })}
              />
            </div>
            <div>
              <Label>Mensagem de sucesso</Label>
              <RichTextEditor
                value={selected.success_message || ''}
                onChange={(html) => setSelected({ ...selected, success_message: html })}
              />
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold">Fluxo de perguntas</h3>
                <Button size="sm" onClick={addStep}><Plus className="h-4 w-4 mr-1" /> Passo</Button>
              </div>
              <div className="space-y-2">
                {(selected.flow_json?.steps || []).map((step: any, idx: number) => (
                  <Card key={idx} className="p-3 bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <select
                        value={step.type}
                        onChange={(e) => updateStep(idx, { type: e.target.value })}
                        className="text-xs bg-background border rounded px-2 py-1"
                      >
                        <option value="message">Mensagem</option>
                        <option value="ask_name">Pergunta: Nome</option>
                        <option value="ask_phone">Pergunta: WhatsApp</option>
                        <option value="ask_choice">Pergunta: Escolha única</option>
                        <option value="ask_multichoice">Pergunta: Múltipla escolha</option>
                        <option value="final">Final (envia)</option>
                      </select>
                      <Button size="icon" variant="ghost" onClick={() => removeStep(idx)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    <RichTextEditor
                      value={step.text || ''}
                      onChange={(html) => updateStep(idx, { text: html })}
                      minHeight={60}
                    />
                    {(step.type === 'ask_name' || step.type === 'ask_phone') && (
                      <Input
                        className="mt-2"
                        value={step.placeholder || ''}
                        onChange={(e) => updateStep(idx, { placeholder: e.target.value })}
                        placeholder="Placeholder do input"
                      />
                    )}
                    {(step.type === 'ask_choice' || step.type === 'ask_multichoice') && (
                      <ChoiceStepEditor
                        step={step}
                        isSingle={step.type === 'ask_choice'}
                        onChange={(patch) => updateStep(idx, patch)}
                      />
                    )}
                  </Card>
                ))}
              </div>
            </div>

            <Button onClick={saveTB} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

export default GlobalTypebotsPanel;
