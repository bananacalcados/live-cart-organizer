import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2, ExternalLink, Upload, ArrowLeft, Copy } from 'lucide-react';
import { toast } from 'sonner';
import LeadCohortPanel from '@/components/events/LeadCohortPanel';
import { RichTextEditor } from '@/components/RichTextEditor';

interface LP {
  id: string;
  event_id: string;
  slug: string;
  title: string;
  published: boolean;
  hero_image_url: string | null;
  theme_json: any;
  config_json: any;
  vip_group_link: string | null;
  success_message: string | null;
  prize_description: string | null;
  event_starts_at: string | null;
  require_privacy_consent: boolean;
}

interface TB {
  id: string;
  event_id: string;
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

const DEFAULT_LP_BLOCKS = [
  { type: 'hero', height: 280, overlay: 40, blur: 0, position: 'center', mode: 'cover' },
  { type: 'title', text: 'Live Shopping Exclusivo', subtitle: 'Produtos por R$ 99,99' },
  { type: 'countdown', target: '', label: 'Faltam' },
  { type: 'rules', items: ['Tudo R$ 99,99', 'Quantidade limitada', 'Frete grátis acima de R$ 300'] },
  { type: 'form', cta: 'Garantir meu lugar' },
];

const DEFAULT_TB_STEPS = [
  { id: '1', type: 'ask_name', text: 'Qual é o seu nome?', placeholder: 'Seu nome' },
  { id: '2', type: 'ask_phone', text: 'Qual seu WhatsApp?', placeholder: '(11) 99999-9999' },
  { id: '3', type: 'final', text: 'Pronto! Estou te cadastrando...' },
];

export default function EventCaptureBuilder() {
  const { eventId } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState('');
  const [lps, setLps] = useState<LP[]>([]);
  const [tbs, setTbs] = useState<TB[]>([]);
  const [selectedLP, setSelectedLP] = useState<LP | null>(null);
  const [selectedTB, setSelectedTB] = useState<TB | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      setLoading(true);
      const [{ data: ev }, { data: lpData }, { data: tbData }] = await Promise.all([
        supabase.from('events').select('name').eq('id', eventId).maybeSingle(),
        supabase.from('event_landing_pages').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
        supabase.from('event_typebots').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
      ]);
      if (ev) setEventName(ev.name);
      setLps((lpData || []) as any);
      setTbs((tbData || []) as any);
      setLoading(false);
    })();
  }, [eventId]);

  async function createLP() {
    if (!eventId) return;
    const slug = prompt('Slug da LP (ex: black-friday-2026):');
    if (!slug) return;
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { data, error } = await supabase.from('event_landing_pages').insert({
      event_id: eventId,
      slug: cleanSlug,
      title: 'Nova Landing Page',
      config_json: { blocks: DEFAULT_LP_BLOCKS },
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setLps([data as any, ...lps]);
    setSelectedLP(data as any);
  }

  async function createTB() {
    if (!eventId) return;
    const slug = prompt('Slug do Typebot:');
    if (!slug) return;
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { data, error } = await supabase.from('event_typebots').insert({
      event_id: eventId,
      slug: cleanSlug,
      name: 'Novo Typebot',
      flow_json: { steps: DEFAULT_TB_STEPS },
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    setTbs([data as any, ...tbs]);
    setSelectedTB(data as any);
  }

  async function saveLP() {
    if (!selectedLP) return;
    setSaving(true);
    const { error } = await supabase.from('event_landing_pages').update({
      title: selectedLP.title,
      published: selectedLP.published,
      hero_image_url: selectedLP.hero_image_url,
      theme_json: selectedLP.theme_json,
      config_json: selectedLP.config_json,
      vip_group_link: selectedLP.vip_group_link,
      success_message: selectedLP.success_message,
      prize_description: selectedLP.prize_description,
      event_starts_at: selectedLP.event_starts_at,
      require_privacy_consent: selectedLP.require_privacy_consent,
    } as any).eq('id', selectedLP.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success('LP salva!');
      setLps(lps.map((l) => (l.id === selectedLP.id ? selectedLP : l)));
    }
  }

  async function saveTB() {
    if (!selectedTB) return;
    setSaving(true);
    const { error } = await supabase.from('event_typebots').update({
      name: selectedTB.name,
      published: selectedTB.published,
      theme_json: selectedTB.theme_json,
      flow_json: selectedTB.flow_json,
      welcome_message: selectedTB.welcome_message,
      success_message: selectedTB.success_message,
      vip_group_link: selectedTB.vip_group_link,
      event_starts_at: selectedTB.event_starts_at,
      prize_description: selectedTB.prize_description,
    } as any).eq('id', selectedTB.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success('Typebot salvo!');
      setTbs(tbs.map((t) => (t.id === selectedTB.id ? selectedTB : t)));
    }
  }

  async function uploadHero(file: File) {
    if (!selectedLP) return;
    const path = `${selectedLP.event_id}/${selectedLP.id}/hero-${Date.now()}.${file.name.split('.').pop()}`;
    const { error } = await supabase.storage.from('event-landing-assets').upload(path, file, { upsert: true });
    if (error) { toast.error(error.message); return; }
    const { data } = supabase.storage.from('event-landing-assets').getPublicUrl(path);
    setSelectedLP({ ...selectedLP, hero_image_url: data.publicUrl });
    toast.success('Imagem enviada!');
  }

  function updateBlock(idx: number, patch: any) {
    if (!selectedLP) return;
    const blocks = [...(selectedLP.config_json?.blocks || [])];
    blocks[idx] = { ...blocks[idx], ...patch };
    setSelectedLP({ ...selectedLP, config_json: { ...selectedLP.config_json, blocks } });
  }
  function removeBlock(idx: number) {
    if (!selectedLP) return;
    const blocks = [...(selectedLP.config_json?.blocks || [])];
    blocks.splice(idx, 1);
    setSelectedLP({ ...selectedLP, config_json: { ...selectedLP.config_json, blocks } });
  }
  function addBlock(type: string) {
    if (!selectedLP) return;
    const blocks = [...(selectedLP.config_json?.blocks || [])];
    const defaults: any = {
      hero: { type: 'hero', height: 280, overlay: 40, blur: 0, position: 'center', mode: 'cover' },
      title: { type: 'title', text: 'Título', subtitle: '' },
      countdown: { type: 'countdown', target: '', label: 'Faltam' },
      text: { type: 'text', html: '<p>Texto</p>' },
      rules: { type: 'rules', items: ['Regra 1'] },
      image: { type: 'image', url: '' },
      form: { type: 'form', cta: 'Garantir meu lugar' },
      cta: { type: 'cta', text: 'Saiba mais', url: '' },
    };
    blocks.push(defaults[type]);
    setSelectedLP({ ...selectedLP, config_json: { ...selectedLP.config_json, blocks } });
  }

  function addStep() {
    if (!selectedTB) return;
    const steps = [...(selectedTB.flow_json?.steps || [])];
    steps.splice(steps.length - 1, 0, { id: String(Date.now()), type: 'ask_name', text: 'Pergunta?', placeholder: '' });
    setSelectedTB({ ...selectedTB, flow_json: { ...selectedTB.flow_json, steps } });
  }
  function updateStep(idx: number, patch: any) {
    if (!selectedTB) return;
    const steps = [...(selectedTB.flow_json?.steps || [])];
    steps[idx] = { ...steps[idx], ...patch };
    setSelectedTB({ ...selectedTB, flow_json: { ...selectedTB.flow_json, steps } });
  }
  function removeStep(idx: number) {
    if (!selectedTB) return;
    const steps = [...(selectedTB.flow_json?.steps || [])];
    steps.splice(idx, 1);
    setSelectedTB({ ...selectedTB, flow_json: { ...selectedTB.flow_json, steps } });
  }

  if (loading) return <div className="p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/events"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Captura de Leads — {eventName}</h1>
          <p className="text-sm text-muted-foreground">Gerencie Landing Pages e Typebots deste evento</p>
        </div>
      </div>

      <Tabs defaultValue="lp">
        <TabsList>
          <TabsTrigger value="lp">Landing Pages ({lps.length})</TabsTrigger>
          <TabsTrigger value="tb">Typebots ({tbs.length})</TabsTrigger>
          <TabsTrigger value="leads">Leads Capturados</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4 space-y-4">
          <LeadCohortPanel eventId={eventId!} />
          <LeadsList eventId={eventId!} />
        </TabsContent>

        {/* ============ LANDING PAGES ============ */}
        <TabsContent value="lp" className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 mt-4">
          <div className="space-y-2">
            <Button onClick={createLP} className="w-full"><Plus className="h-4 w-4 mr-2" /> Nova LP</Button>
            {lps.map((lp) => (
              <Card
                key={lp.id}
                onClick={() => setSelectedLP(lp)}
                className={`p-3 cursor-pointer ${selectedLP?.id === lp.id ? 'border-primary' : ''}`}
              >
                <div className="font-medium text-sm">{lp.title}</div>
                <div className="text-xs text-muted-foreground">/live/{lp.slug}</div>
                <div className="text-xs mt-1">{lp.published ? '🟢 Publicada' : '⚪ Rascunho'}</div>
              </Card>
            ))}
          </div>

          {selectedLP && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Input
                  value={selectedLP.title}
                  onChange={(e) => setSelectedLP({ ...selectedLP, title: e.target.value })}
                  className="text-lg font-bold max-w-md"
                />
                <div className="flex items-center gap-2">
                  <Label>Publicada</Label>
                  <Switch
                    checked={selectedLP.published}
                    onCheckedChange={(v) => setSelectedLP({ ...selectedLP, published: v })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">URL pública:</span>
                <code className="bg-muted px-2 py-1 rounded">{PUBLIC_BASE}/live/{selectedLP.slug}</code>
                <Button size="icon" variant="ghost" onClick={() => {
                  navigator.clipboard.writeText(`${PUBLIC_BASE}/live/${selectedLP.slug}`);
                  toast.success('Copiado!');
                }}><Copy className="h-3 w-3" /></Button>
                <a href={`/live/${selectedLP.slug}`} target="_blank" rel="noreferrer">
                  <Button size="icon" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
                </a>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Link do Grupo VIP</Label>
                  <Input
                    value={selectedLP.vip_group_link || ''}
                    onChange={(e) => setSelectedLP({ ...selectedLP, vip_group_link: e.target.value })}
                    placeholder="https://chat.whatsapp.com/..."
                  />
                </div>
                <div>
                  <Label>Data do evento</Label>
                  <Input
                    type="datetime-local"
                    value={selectedLP.event_starts_at ? selectedLP.event_starts_at.slice(0, 16) : ''}
                    onChange={(e) => setSelectedLP({ ...selectedLP, event_starts_at: e.target.value || null })}
                  />
                </div>
                <div>
                  <Label>Cor primária</Label>
                  <Input
                    type="color"
                    value={selectedLP.theme_json?.primary || '#facc15'}
                    onChange={(e) => setSelectedLP({ ...selectedLP, theme_json: { ...selectedLP.theme_json, primary: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Fundo</Label>
                  <Input
                    type="color"
                    value={selectedLP.theme_json?.background || '#0f172a'}
                    onChange={(e) => setSelectedLP({ ...selectedLP, theme_json: { ...selectedLP.theme_json, background: e.target.value } })}
                  />
                </div>
              </div>

              <div>
                <Label>Mensagem de sucesso</Label>
                <Textarea
                  value={selectedLP.success_message || ''}
                  onChange={(e) => setSelectedLP({ ...selectedLP, success_message: e.target.value })}
                />
              </div>
              <div>
                <Label>Descrição do prêmio (indicação)</Label>
                <Input
                  value={selectedLP.prize_description || ''}
                  onChange={(e) => setSelectedLP({ ...selectedLP, prize_description: e.target.value })}
                />
              </div>

              <div>
                <Label>Imagem hero (fundo)</Label>
                <div className="flex items-center gap-2">
                  {selectedLP.hero_image_url && <img src={selectedLP.hero_image_url} className="h-16 w-24 object-cover rounded" />}
                  <label>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadHero(e.target.files[0])} />
                    <Button variant="outline" asChild><span><Upload className="h-4 w-4 mr-2" /> Enviar</span></Button>
                  </label>
                </div>
              </div>

              {/* Blocks editor */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold">Blocos da página</h3>
                  <div className="flex gap-1 flex-wrap">
                    {['hero', 'title', 'countdown', 'text', 'rules', 'image', 'form', 'cta'].map((t) => (
                      <Button key={t} size="sm" variant="outline" onClick={() => addBlock(t)}>+ {t}</Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {(selectedLP.config_json?.blocks || []).map((block: any, idx: number) => (
                    <Card key={idx} className="p-3 bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs uppercase font-bold">{block.type}</span>
                        <Button size="icon" variant="ghost" onClick={() => removeBlock(idx)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                      <BlockEditor block={block} hero={selectedLP.hero_image_url} onChange={(p) => updateBlock(idx, p)} />
                    </Card>
                  ))}
                </div>
              </div>

              <Button onClick={saveLP} disabled={saving} className="w-full">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ============ TYPEBOTS ============ */}
        <TabsContent value="tb" className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 mt-4">
          <div className="space-y-2">
            <Button onClick={createTB} className="w-full"><Plus className="h-4 w-4 mr-2" /> Novo Typebot</Button>
            {tbs.map((tb) => (
              <Card
                key={tb.id}
                onClick={() => setSelectedTB(tb)}
                className={`p-3 cursor-pointer ${selectedTB?.id === tb.id ? 'border-primary' : ''}`}
              >
                <div className="font-medium text-sm">{tb.name}</div>
                <div className="text-xs text-muted-foreground">/typebot/{tb.slug}</div>
                <div className="text-xs mt-1">{tb.published ? '🟢 Publicado' : '⚪ Rascunho'}</div>
              </Card>
            ))}
          </div>

          {selectedTB && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Input
                  value={selectedTB.name}
                  onChange={(e) => setSelectedTB({ ...selectedTB, name: e.target.value })}
                  className="text-lg font-bold max-w-md"
                />
                <div className="flex items-center gap-2">
                  <Label>Publicado</Label>
                  <Switch
                    checked={selectedTB.published}
                    onCheckedChange={(v) => setSelectedTB({ ...selectedTB, published: v })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">URL:</span>
                <code className="bg-muted px-2 py-1 rounded">{PUBLIC_BASE}/typebot/{selectedTB.slug}</code>
                <a href={`/typebot/${selectedTB.slug}`} target="_blank" rel="noreferrer">
                  <Button size="icon" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
                </a>
              </div>

              <div>
                <Label>Link do Grupo VIP</Label>
                <Input
                  value={selectedTB.vip_group_link || ''}
                  onChange={(e) => setSelectedTB({ ...selectedTB, vip_group_link: e.target.value })}
                />
              </div>
              <div>
                <Label>Mensagem de boas-vindas</Label>
                <Textarea
                  value={selectedTB.welcome_message || ''}
                  onChange={(e) => setSelectedTB({ ...selectedTB, welcome_message: e.target.value })}
                />
              </div>
              <div>
                <Label>Mensagem de sucesso</Label>
                <Textarea
                  value={selectedTB.success_message || ''}
                  onChange={(e) => setSelectedTB({ ...selectedTB, success_message: e.target.value })}
                />
              </div>
              <div>
                <Label>Descrição do prêmio</Label>
                <Input
                  value={selectedTB.prize_description || ''}
                  onChange={(e) => setSelectedTB({ ...selectedTB, prize_description: e.target.value })}
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold">Fluxo de perguntas</h3>
                  <Button size="sm" onClick={addStep}><Plus className="h-4 w-4 mr-1" /> Passo</Button>
                </div>
                <div className="space-y-2">
                  {(selectedTB.flow_json?.steps || []).map((step: any, idx: number) => (
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
                          <option value="final">Final (envia)</option>
                        </select>
                        <Button size="icon" variant="ghost" onClick={() => removeStep(idx)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                      <Textarea
                        value={step.text}
                        onChange={(e) => updateStep(idx, { text: e.target.value })}
                        placeholder="Texto da mensagem/pergunta"
                        rows={2}
                      />
                      {(step.type === 'ask_name' || step.type === 'ask_phone') && (
                        <Input
                          className="mt-2"
                          value={step.placeholder || ''}
                          onChange={(e) => updateStep(idx, { placeholder: e.target.value })}
                          placeholder="Placeholder do input"
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LeadsList({ eventId }: { eventId: string }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('event_leads')
        .select('id, name, phone, source, referred_count, prize_unlocked_at, created_at, utm_source, utm_campaign')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(500);
      setLeads(data || []);
      setLoading(false);
    })();
  }, [eventId]);

  const filtered = leads.filter((l) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (l.name || '').toLowerCase().includes(s) || (l.phone || '').includes(s);
  });

  const exportCsv = () => {
    const header = 'Nome,WhatsApp,Origem,Indicações,Prêmio,UTM Source,UTM Campaign,Data\n';
    const rows = filtered.map((l) =>
      `"${l.name}","${l.phone}","${l.source}",${l.referred_count || 0},${l.prize_unlocked_at ? 'Sim' : 'Não'},"${l.utm_source || ''}","${l.utm_campaign || ''}","${new Date(l.created_at).toLocaleString('pt-BR')}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leads-evento-${eventId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div>
          <h3 className="font-bold">{leads.length} leads capturados</h3>
          <p className="text-xs text-muted-foreground">{leads.filter(l => l.prize_unlocked_at).length} desbloquearam o prêmio (3 indicações)</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Buscar nome ou WhatsApp..." value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Button variant="outline" onClick={exportCsv}>Exportar CSV</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground border-b">
            <tr>
              <th className="py-2">Nome</th>
              <th>WhatsApp</th>
              <th>Origem</th>
              <th>Indicações</th>
              <th>Prêmio</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-b hover:bg-muted/30">
                <td className="py-2">{l.name}</td>
                <td className="font-mono text-xs">{l.phone}</td>
                <td><span className="px-2 py-0.5 rounded bg-muted text-xs">{l.source}</span></td>
                <td>{l.referred_count || 0} / 3</td>
                <td>{l.prize_unlocked_at ? '🎁 Sim' : '—'}</td>
                <td className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum lead capturado ainda</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BlockEditor({ block, hero, onChange }: { block: any; hero: string | null; onChange: (p: any) => void }) {
  if (block.type === 'hero') {
    return (
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <Label>Altura (px)</Label>
          <Input type="number" value={block.height || 280} onChange={(e) => onChange({ height: +e.target.value })} />
        </div>
        <div>
          <Label>Overlay escuro (%)</Label>
          <Input type="number" min={0} max={100} value={block.overlay || 0} onChange={(e) => onChange({ overlay: +e.target.value })} />
        </div>
        <div>
          <Label>Desfoque (px)</Label>
          <Input type="number" min={0} max={20} value={block.blur || 0} onChange={(e) => onChange({ blur: +e.target.value })} />
        </div>
        <div>
          <Label>Posição</Label>
          <select value={block.position || 'center'} onChange={(e) => onChange({ position: e.target.value })} className="w-full border rounded h-9 px-2 bg-background">
            <option value="top">Topo</option>
            <option value="center">Centro</option>
            <option value="bottom">Base</option>
          </select>
        </div>
        <div className="col-span-2 text-muted-foreground">Usa a imagem hero da página{hero ? '' : ' (envie uma acima)'}</div>
      </div>
    );
  }
  if (block.type === 'title') {
    return (
      <div className="space-y-2">
        <Input value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Título" />
        <Input value={block.subtitle || ''} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Subtítulo (opcional)" />
      </div>
    );
  }
  if (block.type === 'countdown') {
    return (
      <div className="space-y-2">
        <Input type="datetime-local" value={block.target ? block.target.slice(0, 16) : ''} onChange={(e) => onChange({ target: e.target.value })} />
        <Input value={block.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Rótulo (ex: Faltam)" />
      </div>
    );
  }
  if (block.type === 'text') {
    return <Textarea value={block.html || ''} onChange={(e) => onChange({ html: e.target.value })} placeholder="<p>HTML simples</p>" rows={3} />;
  }
  if (block.type === 'rules') {
    const items: string[] = block.items || [];
    return (
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex gap-1">
            <Input value={it} onChange={(e) => {
              const next = [...items]; next[i] = e.target.value; onChange({ items: next });
            }} />
            <Button size="icon" variant="ghost" onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange({ items: [...items, ''] })}>+ regra</Button>
      </div>
    );
  }
  if (block.type === 'image') {
    return <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="URL da imagem" />;
  }
  if (block.type === 'form') {
    return <Input value={block.cta || ''} onChange={(e) => onChange({ cta: e.target.value })} placeholder="Texto do botão (ex: Garantir lugar)" />;
  }
  if (block.type === 'cta') {
    return (
      <div className="space-y-2">
        <Input value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Texto do botão" />
        <Input value={block.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="URL" />
      </div>
    );
  }
  return null;
}
