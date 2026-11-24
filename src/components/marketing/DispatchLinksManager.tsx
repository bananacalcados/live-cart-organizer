// Links de Disparo — gestão (só admin). Fala apenas com a função dispatch-link-admin.
// Carrega lista/histórico só quando a sub-aba abre ou ao tocar em "Atualizar" (sem polling).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CATEGORY_INFO, brl, COMM_LABELS } from "@/lib/dispatchLinkPublic";
import { Copy, Eye, EyeOff, History, KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, ShieldOff } from "lucide-react";

const ORIGIN = "https://checkout.bananacalcados.com.br";
type Aud = { key: string; kind: "ravena" | "saved"; label: string; publico_id?: string; filters?: Record<string, unknown> };
type Link = {
  id: string; code: string; name: string; description: string | null; allowed_instance_ids: string[]; instance_labels: string[];
  template_mode: "all_approved" | "list"; allowed_templates: { name: string; language?: string }[]; allowed_audiences: Aud[];
  allow_send_now: boolean; allow_schedule: boolean; max_recipients: number; expires_at: string | null; is_active: boolean;
  revoked_at: string | null; simulate_only: boolean; stats?: { dispatches: number; sent: number; last_used_at: string | null };
};
type TplInfo = { name: string; language: string; category: string; unit_cost_brl: number | null; supported: boolean; carousel: boolean };

async function admin<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("dispatch-link-admin", { body: { action, ...body } });
  if (error) {
    let msg = "Algo deu errado.";
    try { msg = (await (error as any).context?.json())?.error || msg; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || "Algo deu errado.");
  return data as T;
}

export const linkUrl = (code: string) => `${ORIGIN}/d/${code}`;
export const linkInstructions = (l: { name: string; code: string }) =>
  `Link de disparo: ${l.name}\n${linkUrl(l.code)}\n\n1. Abra no celular.\n2. Digite a senha que eu te passo separado.\n3. Siga os passos e faça o teste no SEU número antes de enviar.\n4. Só confirme depois que o teste chegar certinho.`;

function status(l: Link) {
  if (l.revoked_at) return { t: "Revogado", v: "destructive" as const };
  if (l.expires_at && new Date(l.expires_at) < new Date()) return { t: "Vencido", v: "secondary" as const };
  return l.is_active ? { t: "Ativo", v: "default" as const } : { t: "Desativado", v: "outline" as const };
}
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

function CatBadge({ c, cost }: { c: string; cost: number | null }) {
  const i = CATEGORY_INFO[c] || { label: c, cls: "bg-muted text-foreground" };
  return <span className="inline-flex items-center gap-1"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${i.cls}`}>{i.label}</span>{cost != null && <span className="text-xs font-semibold">{brl(cost)}/msg</span>}</span>;
}

function PasswordFields({ onChange }: { onChange: (p: string | null) => void }) {
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [show, setShow] = useState(false);
  useEffect(() => { onChange(a.length >= 6 && a === b ? a : null); }, [a, b, onChange]);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input aria-label="Senha" type={show ? "text" : "password"} placeholder="Senha (mín. 6)" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" />
        <Button type="button" variant="outline" size="icon" onClick={() => setShow(!show)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
      </div>
      <Input aria-label="Confirmar senha" type={show ? "text" : "password"} placeholder="Repita a senha" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />
      {a && a.length < 6 && <p className="text-xs text-destructive">Mínimo de 6 caracteres.</p>}
      {b && a !== b && <p className="text-xs text-destructive">As senhas não batem.</p>}
    </div>
  );
}

function LinkForm({ initial, onSaved, onClose }: { initial: Link | null; onSaved: (l: Link) => void; onClose: () => void }) {
  const { toast } = useToast();
  const [cat, setCat] = useState<{ instances: { id: string; label: string }[]; saved_audiences: { id: string; nome: string }[] } | null>(null);
  const [name, setName] = useState(initial?.name || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [inst, setInst] = useState<string[]>(initial?.allowed_instance_ids || []);
  const [mode, setMode] = useState<"all_approved" | "list">(initial?.template_mode || "all_approved");
  const [picked, setPicked] = useState<string[]>((initial?.allowed_templates || []).map((t) => `${t.name}|${t.language || ""}`));
  const [tpls, setTpls] = useState<Record<string, TplInfo[] | "loading" | string>>({});
  const [auds, setAuds] = useState<Aud[]>(initial?.allowed_audiences || []);
  const [now, setNow] = useState(initial?.allow_send_now ?? true);
  const [sched, setSched] = useState(initial?.allow_schedule ?? false);
  const [max, setMax] = useState(String(initial?.max_recipients ?? 3000));
  const [exp, setExp] = useState(initial?.expires_at ? initial.expires_at.slice(0, 10) : "");
  const [sim, setSim] = useState(initial?.simulate_only ?? false);
  const [pwd, setPwd] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { admin("catalog").then(setCat).catch((e) => toast({ title: e.message, variant: "destructive" })); }, [toast]);
  useEffect(() => {
    for (const id of inst) if (!tpls[id]) {
      setTpls((p) => ({ ...p, [id]: "loading" }));
      admin<{ templates: TplInfo[] }>("templates", { instance_id: id })
        .then((r) => setTpls((p) => ({ ...p, [id]: r.templates })))
        .catch((e) => setTpls((p) => ({ ...p, [id]: e.message })));
    }
  }, [inst, tpls]);

  const toggleInst = (id: string, label: string, on: boolean) => {
    setInst((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
    if (on && /ravena/i.test(label) && !auds.some((a) => a.kind === "ravena")) {
      setAuds((p) => [...p, { key: "ravena", kind: "ravena", label: "Clientes Ravena" }]);
      toast({ title: "Público Clientes Ravena sugerido para a Ravena" });
    }
  };
  const hasAud = (k: string) => auds.some((a) => a.key === k);
  const toggleAud = (a: Aud, on: boolean) => setAuds((p) => (on ? [...p, a] : p.filter((x) => x.key !== a.key)));

  const valid = name.trim().length >= 3 && inst.length > 0 && auds.length > 0 && (now || sched) && Number(max) > 0
    && (mode === "all_approved" || picked.length > 0) && (initial ? true : !!pwd);

  async function save() {
    setSaving(true);
    try {
      const body = {
        name: name.trim(), description: desc.trim() || null, allowed_instance_ids: inst, template_mode: mode,
        allowed_templates: mode === "list" ? picked.map((k) => { const [n, l] = k.split("|"); return { name: n, ...(l ? { language: l } : {}) }; }) : [],
        allowed_audiences: auds, allow_send_now: now, allow_schedule: sched, max_recipients: Number(max),
        expires_at: exp ? new Date(`${exp}T23:59:59-03:00`).toISOString() : null, simulate_only: sim,
      };
      const r = initial ? await admin<{ link: Link }>("update", { id: initial.id, ...body }) : await admin<{ link: Link }>("create", { ...body, password: pwd });
      onSaved(r.link);
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } finally { setSaving(false); }
  }

  if (!cat) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <label className="text-sm font-medium" htmlFor="lk-nome">Nome</label>
        <Input id="lk-nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ravena — Clientes" />
        <Textarea aria-label="Descrição" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)" rows={2} />
      </section>

      <section className="space-y-2">
        <div className="text-sm font-medium">WhatsApp API permitidos</div>
        {cat.instances.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm"><Checkbox checked={inst.includes(i.id)} onCheckedChange={(v) => toggleInst(i.id, i.label, !!v)} />{i.label}</label>
        ))}
      </section>

      <section className="space-y-2">
        <div className="text-sm font-medium">Modelos</div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={mode === "all_approved" ? "default" : "outline"} onClick={() => setMode("all_approved")}>Todos os aprovados</Button>
          <Button type="button" size="sm" variant={mode === "list" ? "default" : "outline"} onClick={() => setMode("list")}>Escolher lista</Button>
        </div>
        {inst.map((id) => {
          const t = tpls[id]; const label = cat.instances.find((i) => i.id === id)?.label;
          return (
            <div key={id} className="rounded-lg border p-2">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
              {t === "loading" || !t ? <Loader2 className="h-4 w-4 animate-spin" /> : typeof t === "string" ? <p className="text-xs text-destructive">{t}</p> : t.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum modelo aprovado.</p> : (
                <div className="space-y-1">
                  {t.map((x) => {
                    const k = `${x.name}|${x.language}`; const off = !x.supported;
                    return (
                      <label key={k} className={`flex flex-wrap items-center gap-2 text-sm ${off ? "opacity-50" : ""}`}>
                        {mode === "list" && <Checkbox disabled={off} checked={picked.includes(k)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, k] : p.filter((y) => y !== k)))} />}
                        <span>{x.name}</span><span className="text-xs text-muted-foreground">{x.language}</span><CatBadge c={x.category} cost={x.unit_cost_brl} />
                        {off && <span className="text-xs italic">{x.carousel ? "carrossel — em breve" : "formato ainda não suportado"}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="text-sm font-medium">Públicos permitidos</div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={hasAud("ravena")} onCheckedChange={(v) => toggleAud({ key: "ravena", kind: "ravena", label: "Clientes Ravena" }, !!v)} />Clientes Ravena (base da Ravena)</label>
        {cat.saved_audiences.map((p) => {
          const k = `saved_${p.id.slice(0, 8)}`;
          return <label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={auds.some((a) => a.publico_id === p.id)} onCheckedChange={(v) => v ? toggleAud({ key: k, kind: "saved", label: p.nome, publico_id: p.id }, true) : setAuds((x) => x.filter((a) => a.publico_id !== p.id))} />{p.nome} <span className="text-xs text-muted-foreground">(público salvo)</span></label>;
        })}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm"><Switch checked={now} onCheckedChange={setNow} />Permitir “Enviar agora”</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={sched} onCheckedChange={setSched} />Permitir “Agendar”</label>
        {!now && !sched && <p className="col-span-2 text-xs text-destructive">Ligue pelo menos um.</p>}
        <div><label className="text-sm" htmlFor="lk-max">Máximo de pessoas por disparo</label><Input id="lk-max" type="number" min={1} max={50000} value={max} onChange={(e) => setMax(e.target.value)} /></div>
        <div><label className="text-sm" htmlFor="lk-exp">Validade (opcional)</label><Input id="lk-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={sim} onCheckedChange={setSim} />Modo treino (não envia nada de verdade)</label>
      </section>

      {!initial && <section className="space-y-2"><div className="text-sm font-medium">Senha do link</div><PasswordFields onChange={setPwd} /></section>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={!valid || saving} onClick={save}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>
      </div>
    </div>
  );
}

function HistoryView({ link }: { link: Link }) {
  const [h, setH] = useState<{ dispatches: any[]; tests: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setBusy(true); try { setH(await admin("history", { id: link.id })); } finally { setBusy(false); } }, [link.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <Button size="sm" variant="outline" onClick={load} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />Atualizar</Button>
      <div>
        <div className="mb-1 text-sm font-semibold">Disparos</div>
        {!h ? <Loader2 className="h-4 w-4 animate-spin" /> : h.dispatches.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum disparo por este link ainda.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="p-1">Data</th><th>Modelo</th><th>Público</th><th>Qtd</th><th>Enviadas</th><th>Falhas</th><th>Situação</th><th>Tipo</th><th>Custo est.</th></tr></thead>
            <tbody>{h.dispatches.map((d) => {
              const unit = d.unit_cost_at_send != null ? Number(d.unit_cost_at_send) : null;
              return <tr key={d.id} className="border-t"><td className="p-1">{fmt(d.created_at)}</td><td>{d.template_name}</td><td>{d.audience_filters?.label || "—"}</td><td>{d.total_recipients}</td><td>{d.sent_count ?? 0}</td><td>{d.failed_count ?? 0}</td>
                <td>{d.scheduled_at && d.status === "scheduled" ? `Agendado ${fmt(d.scheduled_at)}` : d.status}</td><td>{COMM_LABELS[d.tipo_comunicacao] || d.tipo_comunicacao || "—"}</td>
                <td>{unit != null ? brl(unit * Number(d.total_recipients || 0)) : "—"}</td></tr>;
            })}</tbody></table></div>
        )}
      </div>
      <div>
        <div className="mb-1 text-sm font-semibold">Testes enviados</div>
        {h && (h.tests.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum teste.</p> : (
          <ul className="space-y-1 text-xs">{h.tests.map((t) => <li key={t.id} className="flex justify-between border-t py-1"><span>{fmt(t.created_at)} · {t.phone_masked}</span><span>{t.status === "simulated" ? "treino" : t.status === "sent" ? "enviado" : "falhou"}{t.used_at ? " · usado no disparo" : ""}</span></li>)}</ul>
        ))}
      </div>
    </div>
  );
}

export function DispatchLinksManager() {
  const { isAdmin, ready } = useIsAdmin();
  const { toast } = useToast();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ open: boolean; link: Link | null }>({ open: false, link: null });
  const [saved, setSaved] = useState<Link | null>(null);
  const [pwdFor, setPwdFor] = useState<Link | null>(null);
  const [newPwd, setNewPwd] = useState<string | null>(null);
  const [hist, setHist] = useState<Link | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setLinks((await admin<{ links: Link[] }>("list")).links); } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } finally { setBusy(false); }
  }, [toast]);
  useEffect(() => { if (ready && isAdmin) load(); }, [ready, isAdmin, load]);

  const copy = async (t: string, msg: string) => { await navigator.clipboard.writeText(t).catch(() => {}); toast({ title: msg }); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast({ title: msg }); load(); } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } };

  if (!ready) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!isAdmin) return <p className="text-sm text-muted-foreground">Só administradores podem ver os Links de Disparo.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-bold">Links de Disparo</h2><p className="text-sm text-muted-foreground">Links com senha para a equipe disparar pelo celular, só com o que você liberar.</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />Atualizar</Button>
          <Button onClick={() => setForm({ open: true, link: null })}><Plus className="mr-1 h-4 w-4" />Novo link</Button>
        </div>
      </div>

      {!links ? <Loader2 className="h-5 w-5 animate-spin" /> : links.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum link criado ainda.</p> : (
        <div className="space-y-2">
          {links.map((l) => {
            const s = status(l); const dead = !!l.revoked_at;
            return (
              <div key={l.id} className="rounded-xl border bg-card p-3" data-testid="link-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.name}</span><Badge variant={s.v}>{s.t}</Badge>{l.simulate_only && <Badge variant="secondary">Treino</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {l.instance_labels.join(", ")} · {l.allowed_audiences.map((a) => a.label).join(", ")} · último uso {fmt(l.stats?.last_used_at ?? null)} · {l.stats?.dispatches ?? 0} disparo(s) · {(l.stats?.sent ?? 0).toLocaleString("pt-BR")} enviadas
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => copy(linkUrl(l.code), "Link copiado")}><Copy className="mr-1 h-3.5 w-3.5" />Copiar link</Button>
                  <Button size="sm" variant="outline" disabled={dead} onClick={() => setForm({ open: true, link: l })}><Pencil className="mr-1 h-3.5 w-3.5" />Editar</Button>
                  <Button size="sm" variant="outline" disabled={dead} onClick={() => { setNewPwd(null); setPwdFor(l); }}><KeyRound className="mr-1 h-3.5 w-3.5" />Trocar senha</Button>
                  <Button size="sm" variant="outline" disabled={dead} onClick={() => act(() => admin("set_active", { id: l.id, active: !l.is_active }), l.is_active ? "Link desativado" : "Link ativado")}><Power className="mr-1 h-3.5 w-3.5" />{l.is_active ? "Desativar" : "Ativar"}</Button>
                  <Button size="sm" variant="outline" disabled={dead} onClick={() => confirm("Revogar de vez? Não dá para desfazer.") && act(() => admin("revoke", { id: l.id }), "Link revogado")}><ShieldOff className="mr-1 h-3.5 w-3.5" />Revogar</Button>
                  <Button size="sm" variant="outline" onClick={() => setHist(l)}><History className="mr-1 h-3.5 w-3.5" />Histórico</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={form.open} onOpenChange={(o) => !o && setForm({ open: false, link: null })}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{form.link ? "Editar link" : "Novo link"}</DialogTitle></DialogHeader>
          {form.open && <LinkForm initial={form.link} onClose={() => setForm({ open: false, link: null })}
            onSaved={(l) => { setForm({ open: false, link: null }); setSaved(l); load(); }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!saved} onOpenChange={(o) => !o && setSaved(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Link salvo</DialogTitle></DialogHeader>
          {saved && <div className="space-y-3">
            <Input readOnly value={linkUrl(saved.code)} aria-label="Endereço do link" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copy(linkUrl(saved.code), "Link copiado")}><Copy className="mr-1 h-4 w-4" />Copiar link</Button>
              <Button variant="outline" onClick={() => copy(linkInstructions(saved), "Link e instruções copiados")}><Copy className="mr-1 h-4 w-4" />Copiar link + instruções</Button>
            </div>
            <p className="text-xs text-muted-foreground">A senha não vai junto. Passe ela para a pessoa separado.</p>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pwdFor} onOpenChange={(o) => !o && setPwdFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Trocar senha — {pwdFor?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Quem estiver usando o link agora vai precisar entrar de novo com a senha nova.</p>
          {pwdFor && <PasswordFields onChange={setNewPwd} />}
          <div className="flex justify-end"><Button disabled={!newPwd} onClick={() => { const l = pwdFor!; setPwdFor(null); act(() => admin("reset_password", { id: l.id, password: newPwd }), "Senha trocada"); }}>Salvar senha</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!hist} onOpenChange={(o) => !o && setHist(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico — {hist?.name}</DialogTitle></DialogHeader>
          {hist && <HistoryView link={hist} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
