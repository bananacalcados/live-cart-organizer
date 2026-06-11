import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock, Plus, Trash2, ClipboardList, Users, Send, ShieldCheck, Hand } from "lucide-react";

const TASK_PASSWORD = "3021";

const CATEGORIES: { value: string; label: string; auto?: boolean }[] = [
  { value: "contact_old_customers", label: "Falar com clientes antigos", auto: true },
  { value: "post_sale", label: "Pós-venda (clientes de ontem)", auto: true },
  { value: "cold_leads", label: "Leads frios (7 dias atrás)", auto: true },
  { value: "vip_capture", label: "Captar pessoas pro grupo VIP" },
  { value: "status_upload", label: "Subir fotos/vídeos no Status" },
  { value: "vip_post", label: "Postar nos grupos VIP" },
  { value: "som_car", label: "Contratar carro de som" },
  { value: "size_offer", label: "Separar produtos p/ oferta por numeração" },
  { value: "conditional", label: "Fazer condicional" },
  { value: "referrals", label: "Pedir indicações de clientes" },
  { value: "google_reviews", label: "Coletar avaliações no Google" },
  { value: "custom", label: "Personalizada" },
];

const RECURRENCES = [
  { value: "daily", label: "Todo dia" },
  { value: "weekly", label: "Semanal (dia da semana)" },
  { value: "weekly_specific", label: "Semana específica do mês" },
  { value: "monthly", label: "Mensal (dia do mês)" },
  { value: "monthly_specific", label: "Mês específico" },
  { value: "once", label: "Uma vez (data única)" },
];

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

interface Props {
  open: boolean;
  onClose: () => void;
  stores: { id: string; name: string }[];
}

export function POSTaskManagerDialog({ open, onClose, stores }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUnlocked(sessionStorage.getItem("pos_task_cfg_unlocked") === "1");
      setPwd("");
      setStoreId((prev) => prev || stores[0]?.id || null);
    }
  }, [open, stores]);


  const tryUnlock = () => {
    if (pwd === TASK_PASSWORD) {
      sessionStorage.setItem("pos_task_cfg_unlocked", "1");
      setUnlocked(true);
    } else {
      toast.error("Senha incorreta");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl w-[96vw] max-h-[90vh] bg-zinc-950 border-zinc-800 text-zinc-100 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ClipboardList className="h-5 w-5 text-orange-400" />
            Tarefas das Vendedoras
          </DialogTitle>
        </DialogHeader>

        {!unlocked ? (
          <div className="px-6 py-12 flex flex-col items-center gap-4">
            <Lock className="h-10 w-10 text-orange-400" />
            <p className="text-sm text-zinc-400">Área protegida. Digite a senha para editar.</p>
            <div className="flex gap-2 w-full max-w-xs">
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
                placeholder="Senha"
                className="bg-zinc-900 border-zinc-700 text-zinc-100"
                autoFocus
              />
              <Button onClick={tryUnlock} className="bg-orange-500 hover:bg-orange-600 text-white">Entrar</Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="defs" className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 pt-3 flex items-center gap-2">
              <Label className="text-xs text-zinc-400">Loja:</Label>
              <Select value={storeId || ""} onValueChange={setStoreId}>
                <SelectTrigger className="w-56 h-8 bg-zinc-900 border-zinc-700"><SelectValue placeholder="Selecione a loja" /></SelectTrigger>
                <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <TabsList className="mx-6 mt-3 bg-zinc-900 border border-zinc-800">
              <TabsTrigger value="defs" className="gap-1"><ClipboardList className="h-3.5 w-3.5" /> Tarefas</TabsTrigger>
              <TabsTrigger value="sellers" className="gap-1"><Users className="h-3.5 w-3.5" /> Vendedoras</TabsTrigger>
              <TabsTrigger value="dispatch" className="gap-1"><Send className="h-3.5 w-3.5" /> Disparos</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 max-h-[68vh] px-6 py-4">
              <TabsContent value="defs" className="mt-0"><DefinitionsTab storeId={storeId} /></TabsContent>
              <TabsContent value="sellers" className="mt-0"><SellersTab storeId={storeId} /></TabsContent>
              <TabsContent value="dispatch" className="mt-0"><DispatchTab storeId={storeId} /></TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Definições ----------------
function DefinitionsTab({ storeId }: { storeId: string | null }) {
  const [defs, setDefs] = useState<any[]>([]);
  const [sellers, setSellers] = useState<any[]>([]);
  const blank = {
    title: "", description: "", category: "custom", verification_mode: "manual",
    target_count: 1, recurrence: "daily", recurrence_config: {} as any,
    assignment: "all", assigned_seller_ids: [] as string[], points_reward: 0, auto_config: {} as any,
  };
  const [form, setForm] = useState<any>(blank);

  const load = useCallback(async () => {
    if (!storeId) return;
    const [d, s] = await Promise.all([
      supabase.from("pos_task_definitions" as any).select("*").eq("store_id", storeId).order("created_at", { ascending: false }),
      supabase.from("pos_sellers").select("id, name").eq("store_id", storeId).eq("is_active", true).order("name"),
    ]);
    setDefs((d.data as any[]) || []);
    setSellers((s.data as any[]) || []);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const cat = CATEGORIES.find((c) => c.value === form.category);
  const canAuto = !!cat?.auto;

  const save = async () => {
    if (!storeId || !form.title.trim()) { toast.error("Informe o título"); return; }
    const { error } = await supabase.from("pos_task_definitions" as any).insert({
      store_id: storeId,
      title: form.title.trim(),
      description: form.description || null,
      category: form.category,
      verification_mode: canAuto ? form.verification_mode : "manual",
      target_count: Math.max(1, Number(form.target_count) || 1),
      recurrence: form.recurrence,
      recurrence_config: form.recurrence_config,
      assignment: form.assignment,
      assigned_seller_ids: form.assignment === "specific" ? form.assigned_seller_ids : [],
      points_reward: Number(form.points_reward) || 0,
      auto_config: form.auto_config,
    });
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Tarefa criada");
    setForm(blank);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("pos_task_definitions" as any).delete().eq("id", id);
    load();
  };
  const toggleActive = async (id: string, val: boolean) => {
    await supabase.from("pos_task_definitions" as any).update({ is_active: val }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Plus className="h-4 w-4 text-orange-400" /> Nova tarefa</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs text-zinc-400">Título</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-zinc-900 border-zinc-700" placeholder="Ex.: Falar com 5 clientes antigas" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs text-zinc-400">Descrição (opcional)</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-zinc-900 border-zinc-700 min-h-[60px]" />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Categoria</Label>
            <Select value={form.category} onValueChange={(v) => {
              const c = CATEGORIES.find((x) => x.value === v);
              setForm({ ...form, category: v, verification_mode: c?.auto ? form.verification_mode : "manual" });
            }}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Meta (quantidade)</Label>
            <Input type="number" min={1} value={form.target_count} onChange={(e) => setForm({ ...form, target_count: e.target.value })} className="bg-zinc-900 border-zinc-700" />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Verificação</Label>
            <Select value={form.verification_mode} onValueChange={(v) => setForm({ ...form, verification_mode: v })} disabled={!canAuto}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (vendedora marca)</SelectItem>
                <SelectItem value="auto" disabled={!canAuto}>Automática (sistema confirma)</SelectItem>
              </SelectContent>
            </Select>
            {!canAuto && <p className="text-[10px] text-zinc-500 mt-1">Categoria só suporta verificação manual.</p>}
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Pontos</Label>
            <Input type="number" min={0} value={form.points_reward} onChange={(e) => setForm({ ...form, points_reward: e.target.value })} className="bg-zinc-900 border-zinc-700" />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Recorrência</Label>
            <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v, recurrence_config: {} })}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>{RECURRENCES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <RecurrenceConfig form={form} setForm={setForm} />
          <div>
            <Label className="text-xs text-zinc-400">Atribuição</Label>
            <Select value={form.assignment} onValueChange={(v) => setForm({ ...form, assignment: v })}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as vendedoras</SelectItem>
                <SelectItem value="managers">Somente gerentes</SelectItem>
                <SelectItem value="specific">Vendedoras específicas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {form.assignment === "specific" && (
          <div className="flex flex-wrap gap-2">
            {sellers.map((s) => {
              const on = form.assigned_seller_ids.includes(s.id);
              return (
                <button key={s.id} onClick={() => {
                  const set = new Set(form.assigned_seller_ids);
                  on ? set.delete(s.id) : set.add(s.id);
                  setForm({ ...form, assigned_seller_ids: Array.from(set) });
                }} className={`px-2.5 py-1 rounded-full text-xs border ${on ? "bg-orange-500 border-orange-500 text-white" : "border-zinc-700 text-zinc-300"}`}>
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
        <Button onClick={save} className="bg-orange-500 hover:bg-orange-600 text-white gap-2"><Plus className="h-4 w-4" /> Criar tarefa</Button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {defs.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">Nenhuma tarefa cadastrada.</p>}
        {defs.map((d) => (
          <div key={d.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{d.title}</span>
                {d.verification_mode === "auto"
                  ? <Badge variant="outline" className="border-orange-500/40 text-orange-400 text-[10px] gap-1"><ShieldCheck className="h-2.5 w-2.5" /> Auto</Badge>
                  : <Badge variant="outline" className="border-zinc-600 text-zinc-400 text-[10px] gap-1"><Hand className="h-2.5 w-2.5" /> Manual</Badge>}
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">{RECURRENCES.find((r) => r.value === d.recurrence)?.label}</Badge>
                {d.target_count > 1 && <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">Meta {d.target_count}</Badge>}
              </div>
              {d.description && <p className="text-xs text-zinc-500 mt-0.5">{d.description}</p>}
            </div>
            <Switch checked={d.is_active} onCheckedChange={(v) => toggleActive(d.id, v)} />
            <Button size="icon" variant="ghost" onClick={() => remove(d.id)} className="h-8 w-8 text-red-400 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecurrenceConfig({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const r = form.recurrence;
  const cfg = form.recurrence_config || {};
  const set = (patch: any) => setForm({ ...form, recurrence_config: { ...cfg, ...patch } });
  if (r === "daily") return <div />;
  if (r === "once") return (
    <div><Label className="text-xs text-zinc-400">Data</Label>
      <Input type="date" value={cfg.date || ""} onChange={(e) => set({ date: e.target.value })} className="bg-zinc-900 border-zinc-700" /></div>
  );
  if (r === "weekly") return (
    <div><Label className="text-xs text-zinc-400">Dia da semana</Label>
      <Select value={String(cfg.weekday ?? "")} onValueChange={(v) => set({ weekday: Number(v) })}>
        <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue placeholder="Escolher" /></SelectTrigger>
        <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}</SelectContent>
      </Select></div>
  );
  if (r === "weekly_specific") return (
    <div><Label className="text-xs text-zinc-400">Semana do mês (1-5)</Label>
      <Input type="number" min={1} max={5} value={cfg.week_of_month || ""} onChange={(e) => set({ week_of_month: Number(e.target.value) })} className="bg-zinc-900 border-zinc-700" /></div>
  );
  if (r === "monthly") return (
    <div><Label className="text-xs text-zinc-400">Dia do mês (1-31)</Label>
      <Input type="number" min={1} max={31} value={cfg.day_of_month || ""} onChange={(e) => set({ day_of_month: Number(e.target.value) })} className="bg-zinc-900 border-zinc-700" /></div>
  );
  if (r === "monthly_specific") return (
    <div><Label className="text-xs text-zinc-400">Mês (1-12)</Label>
      <Input type="number" min={1} max={12} value={cfg.month || ""} onChange={(e) => set({ month: Number(e.target.value) })} className="bg-zinc-900 border-zinc-700" /></div>
  );
  return <div />;
}

// ---------------- Vendedoras ----------------
function SellersTab({ storeId }: { storeId: string | null }) {
  const [sellers, setSellers] = useState<any[]>([]);
  const load = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabase.from("pos_sellers").select("id, name, is_manager, whatsapp_phone").eq("store_id", storeId).eq("is_active", true).order("name");
    setSellers((data as any[]) || []);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const update = async (id: string, patch: any) => {
    await supabase.from("pos_sellers").update(patch).eq("id", id);
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 mb-2">Marque gerentes (veem tarefas das outras) e cadastre o WhatsApp pessoal para receber os lembretes.</p>
      {sellers.map((s) => (
        <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 flex items-center gap-3 flex-wrap">
          <span className="font-medium text-sm flex-1 min-w-[120px]">{s.name}</span>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-zinc-400">Gerente</Label>
            <Switch checked={s.is_manager} onCheckedChange={(v) => update(s.id, { is_manager: v })} />
          </div>
          <Input
            defaultValue={s.whatsapp_phone || ""}
            onBlur={(e) => update(s.id, { whatsapp_phone: e.target.value || null })}
            placeholder="WhatsApp (ex: 5533999998888)"
            className="bg-zinc-900 border-zinc-700 w-56"
          />
        </div>
      ))}
      {sellers.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">Nenhuma vendedora ativa.</p>}
    </div>
  );
}

// ---------------- Disparos ----------------
function DispatchTab({ storeId }: { storeId: string | null }) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [form, setForm] = useState({ template_name: "", template_language: "pt_BR", target: "all_sellers", send_times: "", variables: "{{nome}}, {{tarefas_do_dia}}" });

  const load = useCallback(async () => {
    if (!storeId) return;
    const { data } = await supabase.from("pos_task_dispatch_schedules" as any).select("*").eq("store_id", storeId).order("created_at", { ascending: false });
    setSchedules((data as any[]) || []);
  }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!storeId || !form.template_name.trim()) { toast.error("Informe o nome do template"); return; }
    const times = form.send_times.split(",").map((t) => t.trim()).filter(Boolean);
    const body = form.variables.split(",").map((v) => v.trim()).filter(Boolean);
    const { error } = await supabase.from("pos_task_dispatch_schedules" as any).insert({
      store_id: storeId,
      template_name: form.template_name.trim(),
      template_language: form.template_language,
      target: form.target,
      send_times: times,
      template_variables: { body },
    });
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Disparo criado");
    setForm({ template_name: "", template_language: "pt_BR", target: "all_sellers", send_times: "", variables: "{{nome}}, {{tarefas_do_dia}}" });
    load();
  };
  const remove = async (id: string) => { await supabase.from("pos_task_dispatch_schedules" as any).delete().eq("id", id); load(); };
  const toggle = async (id: string, v: boolean) => { await supabase.from("pos_task_dispatch_schedules" as any).update({ is_active: v }).eq("id", id); load(); };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Send className="h-4 w-4 text-orange-400" /> Novo disparo automático</h3>
        <p className="text-[11px] text-zinc-500">Use a variável <code className="text-orange-400">{"{{tarefas_do_dia}}"}</code> para inserir a lista de pendências da vendedora, e <code className="text-orange-400">{"{{nome}}"}</code> para o nome.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-zinc-400">Nome do template (Meta)</Label>
            <Input value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} className="bg-zinc-900 border-zinc-700" placeholder="ex.: tarefas_diarias" />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Idioma</Label>
            <Input value={form.template_language} onChange={(e) => setForm({ ...form, template_language: e.target.value })} className="bg-zinc-900 border-zinc-700" />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Público</Label>
            <Select value={form.target} onValueChange={(v) => setForm({ ...form, target: v })}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_sellers">Todas as vendedoras</SelectItem>
                <SelectItem value="managers">Somente gerentes (mais frequência)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Horários (HH:MM, separados por vírgula)</Label>
            <Input value={form.send_times} onChange={(e) => setForm({ ...form, send_times: e.target.value })} className="bg-zinc-900 border-zinc-700" placeholder="09:00, 13:00, 17:00" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs text-zinc-400">Variáveis do corpo (ordem dos {"{{N}}"})</Label>
            <Input value={form.variables} onChange={(e) => setForm({ ...form, variables: e.target.value })} className="bg-zinc-900 border-zinc-700" />
          </div>
        </div>
        <Button onClick={save} className="bg-orange-500 hover:bg-orange-600 text-white gap-2"><Plus className="h-4 w-4" /> Criar disparo</Button>
      </div>

      <div className="space-y-2">
        {schedules.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">Nenhum disparo configurado.</p>}
        {schedules.map((s) => (
          <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{s.template_name}</span>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-[10px]">{s.target === "managers" ? "Gerentes" : "Vendedoras"}</Badge>
                {(s.send_times || []).map((t: string, i: number) => <Badge key={i} variant="outline" className="border-orange-500/40 text-orange-400 text-[10px]">{t}</Badge>)}
              </div>
            </div>
            <Switch checked={s.is_active} onCheckedChange={(v) => toggle(s.id, v)} />
            <Button size="icon" variant="ghost" onClick={() => remove(s.id)} className="h-8 w-8 text-red-400 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
