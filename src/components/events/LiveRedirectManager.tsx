import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import {
  Radio,
  Plus,
  Copy,
  Check,
  Trash2,
  Pause,
  Play,
  BarChart3,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { LiveBroadcastBanner } from "./LiveBroadcastBanner";

interface RedirectLink {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  click_count: number;
  created_at: string;
}

interface ClickRow {
  id: string;
  redirect_id: string;
  event_id: string | null;
  phone: string | null;
  utm_source: string | null;
  target_url: string | null;
  created_at: string;
}

const PUBLIC_HOST = "https://checkout.bananacalcados.com.br";

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function LiveRedirectManager() {
  const [links, setLinks] = useState<RedirectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<RedirectLink | null>(null);

  const fetchLinks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("live_redirect_links")
      .select("id, name, slug, is_active, click_count, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar redirecionadores");
    } else {
      setLinks((data as RedirectLink[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    const slug = (newSlug.trim() || slugify(name));
    if (!name || !slug) {
      toast.error("Informe um nome e um slug.");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      toast.error("Slug só pode ter letras minúsculas, números e hífen.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("live_redirect_links")
      .insert({ name, slug });
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("live_redirect_links_slug_key")
        ? "Já existe um redirecionador com esse slug."
        : `Erro: ${error.message}`);
      return;
    }
    setCreateOpen(false);
    setNewName("");
    setNewSlug("");
    fetchLinks();
    toast.success("Redirecionador criado!");
  };

  const togglePause = async (link: RedirectLink) => {
    const { error } = await supabase
      .from("live_redirect_links")
      .update({ is_active: !link.is_active })
      .eq("id", link.id);
    if (error) toast.error(error.message);
    else fetchLinks();
  };

  const remove = async (link: RedirectLink) => {
    if (!confirm(`Excluir "${link.name}"? Os cliques desse link também serão apagados.`)) return;
    const { error } = await supabase
      .from("live_redirect_links")
      .delete()
      .eq("id", link.id);
    if (error) toast.error(error.message);
    else {
      fetchLinks();
      toast.success("Redirecionador excluído.");
    }
  };

  const copyLink = async (slug: string) => {
    const url = `${PUBLIC_HOST}/ao-vivo/${slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(slug);
    setTimeout(() => setCopied(null), 1500);
    toast.success("Link copiado!");
  };

  return (
    <div className="space-y-4">
      <LiveBroadcastBanner />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold">Redirecionadores de Live</h2>
            <p className="text-xs text-muted-foreground">
              Um link fixo que sempre aponta pro evento marcado como "AO VIVO". Troque o link do
              Instagram dentro do evento — o link público continua o mesmo.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="btn-accent gap-1">
          <Plus className="h-4 w-4" /> Novo redirecionador
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando…
        </div>
      ) : links.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Nenhum redirecionador criado ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {links.map((link) => {
            const publicUrl = `${PUBLIC_HOST}/ao-vivo/${link.slug}`;
            return (
              <Card key={link.id} className="border-border/50">
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{link.name}</span>
                      {link.is_active ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pausado</Badge>
                      )}
                    </div>
                    <button
                      onClick={() => copyLink(link.slug)}
                      className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
                      title="Copiar link"
                    >
                      {publicUrl}
                      {copied === link.slug ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  <div className="text-center px-3">
                    <div className="text-2xl font-bold">{link.click_count}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">cliques</div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSelected(link)} className="gap-1">
                      <BarChart3 className="h-4 w-4" /> Detalhes
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => togglePause(link)} title={link.is_active ? "Pausar" : "Ativar"}>
                      {link.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(link)} title="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-8 w-8 rounded hover:bg-muted"
                      title="Abrir"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo redirecionador</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome interno</Label>
              <Input
                placeholder="Ex: Disparo VIP 18h"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewSlug((prev) => (prev ? prev : slugify(e.target.value)));
                }}
              />
            </div>
            <div>
              <Label className="text-xs">Slug (link público)</Label>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{PUBLIC_HOST}/ao-vivo/</span>
                <Input
                  placeholder="disparo-vip-18h"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Só letras minúsculas, números e hífen. Esse endereço nunca muda.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={saving} className="btn-accent">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {selected && (
        <LiveRedirectDetails link={selected} onClose={() => setSelected(null)} onChanged={fetchLinks} />
      )}
    </div>
  );
}

/* ---------- Details dialog ---------- */

function LiveRedirectDetails({
  link,
  onClose,
  onChanged,
}: {
  link: RedirectLink;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [from, setFrom] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [clicks, setClicks] = useState<ClickRow[]>([]);
  const [eventFilter, setEventFilter] = useState<string>("");
  const [utmFilter, setUtmFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(link.name);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("live_redirect_clicks")
        .select("id, redirect_id, event_id, phone, utm_source, target_url, created_at")
        .eq("redirect_id", link.id)
        .gte("created_at", `${from}T00:00:00Z`)
        .lte("created_at", `${to}T23:59:59Z`)
        .order("created_at", { ascending: false })
        .limit(500);
      setClicks((data as ClickRow[]) || []);
      setLoading(false);
    };
    load();
  }, [link.id, from, to]);

  const filtered = useMemo(() => {
    return clicks.filter((c) => {
      if (eventFilter && c.event_id !== eventFilter) return false;
      if (utmFilter && (c.utm_source || "") !== utmFilter) return false;
      return true;
    });
  }, [clicks, eventFilter, utmFilter]);

  const uniquePhones = useMemo(() => {
    const s = new Set(filtered.map((c) => c.phone).filter(Boolean) as string[]);
    return s.size;
  }, [filtered]);

  const eventOptions = useMemo(() => {
    const s = new Set(clicks.map((c) => c.event_id).filter(Boolean) as string[]);
    return Array.from(s);
  }, [clicks]);

  const utmOptions = useMemo(() => {
    const s = new Set(clicks.map((c) => c.utm_source).filter(Boolean) as string[]);
    return Array.from(s);
  }, [clicks]);

  const saveName = async () => {
    if (!newName.trim() || newName === link.name) {
      setRenaming(false);
      return;
    }
    const { error } = await supabase
      .from("live_redirect_links")
      .update({ name: newName.trim() })
      .eq("id", link.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Nome atualizado");
      setRenaming(false);
      onChanged();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {renaming ? (
              <div className="flex items-center gap-2">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <Button size="sm" onClick={saveName}>Salvar</Button>
              </div>
            ) : (
              <button onClick={() => setRenaming(true)} className="hover:underline text-left">
                {link.name} <span className="text-xs text-muted-foreground">(renomear)</span>
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            {eventOptions.length > 0 && (
              <div>
                <Label className="text-xs">Evento</Label>
                <select
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Todos</option>
                  {eventOptions.map((id) => (
                    <option key={id} value={id}>{id.slice(0, 8)}…</option>
                  ))}
                </select>
              </div>
            )}
            {utmOptions.length > 0 && (
              <div>
                <Label className="text-xs">Origem (utm)</Label>
                <select
                  value={utmFilter}
                  onChange={(e) => setUtmFilter(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Todas</option>
                  {utmOptions.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Cliques no período" value={filtered.length} />
            <MetricCard label="Telefones únicos" value={uniquePhones} />
            <MetricCard label="Total (todo período)" value={link.click_count} />
          </div>

          <div className="border rounded-lg max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2">Quando</th>
                  <th className="px-3 py-2">Telefone</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Evento ativo</th>
                  <th className="px-3 py-2">Destino</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">Carregando…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">Sem cliques no período.</td></tr>
                ) : filtered.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {format(new Date(c.created_at), "dd/MM HH:mm:ss")}
                    </td>
                    <td className="px-3 py-1.5">{c.phone || "—"}</td>
                    <td className="px-3 py-1.5">{c.utm_source || "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{c.event_id ? c.event_id.slice(0, 8) + "…" : "—"}</td>
                    <td className="px-3 py-1.5 max-w-[240px] truncate" title={c.target_url || ""}>
                      {c.target_url ? (
                        <a href={c.target_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {c.target_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      </CardContent>
    </Card>
  );
}
