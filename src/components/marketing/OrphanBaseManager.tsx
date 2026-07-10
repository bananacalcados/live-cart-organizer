import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Users, UserX, UserCheck, Download,
  Search, Ban, Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OrphanDispatchPanel } from "./OrphanDispatchPanel";

interface GroupStat {
  group_id: string;
  group_name: string;
  total_members: number;
  customers: number;
  leads: number;
  orphans: number;
}

interface OrphanContact {
  id: string;
  phone: string;
  display_name: string | null;
  group_names: string[];
  status: string;
  opted_out: boolean;
  last_seen_at: string;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function OrphanBaseManager() {
  const [stats, setStats] = useState<GroupStat[]>([]);
  const [orphans, setOrphans] = useState<OrphanContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const loadStats = useCallback(async () => {
    const { data } = await supabase
      .from("vip_group_membership_stats")
      .select("*")
      .order("orphans", { ascending: false });
    setStats((data as GroupStat[]) || []);
  }, []);

  const loadOrphans = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("vip_orphan_contacts")
      .select("id, phone, display_name, group_names, status, opted_out, last_seen_at")
      .eq("status", "orphan")
      .order("last_seen_at", { ascending: false })
      .limit(5000);
    setOrphans((data as OrphanContact[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadOrphans();
  }, [loadStats, loadOrphans]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc("refresh_vip_orphans");
      if (error) throw error;
      const res = data as { upserted: number; promoted: number; active_orphans: number };
      toast.success(
        `Base atualizada: ${res.active_orphans} órfãos ativos (${res.promoted} promovidos a cliente/lead).`
      );
      await Promise.all([loadStats(), loadOrphans()]);
    } catch (e) {
      toast.error("Falha ao atualizar: " + (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleOptOut = async (o: OrphanContact) => {
    const next = !o.opted_out;
    const { error } = await supabase
      .from("vip_orphan_contacts")
      .update({ opted_out: next, status: next ? "opted_out" : "orphan" })
      .eq("id", o.id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    if (next) setOrphans((prev) => prev.filter((x) => x.id !== o.id));
    toast.success(next ? "Contato descadastrado" : "Contato reativado");
  };

  const exportCsv = () => {
    const header = ["Nome", "Telefone", "Grupos", "Visto por último"];
    const rows = filtered.map((o) => [
      csvEscape(o.display_name || ""),
      csvEscape(o.phone),
      csvEscape((o.group_names || []).join(" | ")),
      csvEscape(new Date(o.last_seen_at).toLocaleString("pt-BR")),
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orfaos_grupos_vip_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = orphans.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (o.display_name || "").toLowerCase().includes(q) ||
      o.phone.includes(q.replace(/\D/g, "")) ||
      (o.group_names || []).some((g) => g.toLowerCase().includes(q))
    );
  });

  const totals = stats.reduce(
    (acc, s) => ({
      members: acc.members + Number(s.total_members),
      customers: acc.customers + Number(s.customers),
      leads: acc.leads + Number(s.leads),
      orphans: acc.orphans + Number(s.orphans),
    }),
    { members: 0, customers: 0, leads: 0, orphans: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Contatos que entraram nos grupos VIP mas <strong>não são clientes nem leads</strong>.
          Base persistente para disparo em massa e análise de ROAS.
        </p>
        <Button onClick={handleRefresh} disabled={refreshing} size="sm">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar base
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="Membros" value={totals.members} />
        <StatCard icon={<UserCheck className="h-4 w-4 text-emerald-500" />} label="Clientes" value={totals.customers} />
        <StatCard icon={<UserCheck className="h-4 w-4 text-blue-500" />} label="Leads" value={totals.leads} />
        <StatCard icon={<UserX className="h-4 w-4 text-amber-500" />} label="Órfãos" value={totals.orphans} />
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" className="gap-1"><Users className="h-3.5 w-3.5" />Por grupo</TabsTrigger>
          <TabsTrigger value="orphans" className="gap-1"><UserX className="h-3.5 w-3.5" />Órfãos</TabsTrigger>
          <TabsTrigger value="dispatch" className="gap-1"><Send className="h-3.5 w-3.5" />Disparos & ROAS</TabsTrigger>
        </TabsList>

        {/* POR GRUPO */}
        <TabsContent value="members" className="space-y-2">
          <ScrollArea className="h-[520px] rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left">
                  <th className="p-2">Grupo</th>
                  <th className="p-2 text-right">Membros</th>
                  <th className="p-2 text-right">Clientes</th>
                  <th className="p-2 text-right">Leads</th>
                  <th className="p-2 text-right">Órfãos</th>
                </tr>
              </thead>
              <tbody>
                {stats.filter((s) => s.total_members > 0).map((s) => (
                  <tr key={s.group_id} className="border-t hover:bg-muted/40">
                    <td className="p-2">{s.group_name}</td>
                    <td className="p-2 text-right font-medium">{s.total_members}</td>
                    <td className="p-2 text-right text-emerald-600">{s.customers}</td>
                    <td className="p-2 text-right text-blue-600">{s.leads}</td>
                    <td className="p-2 text-right text-amber-600 font-medium">{s.orphans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>

        {/* ÓRFÃOS */}
        <TabsContent value="orphans" className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, telefone ou grupo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} contatos {search && `(de ${orphans.length})`}
          </p>
          <ScrollArea className="h-[460px] rounded-md border">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="p-2">Nome</th>
                    <th className="p-2">Telefone</th>
                    <th className="p-2">Grupos</th>
                    <th className="p-2 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr key={o.id} className="border-t hover:bg-muted/40">
                      <td className="p-2">{o.display_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2 font-mono text-xs">{o.phone}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {(o.group_names || []).slice(0, 2).map((g, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{g}</Badge>
                          ))}
                          {(o.group_names || []).length > 2 && (
                            <Badge variant="outline" className="text-[10px]">+{o.group_names.length - 2}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => toggleOptOut(o)} title="Descadastrar">
                          <Ban className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ScrollArea>
        </TabsContent>

        {/* DISPAROS & ROAS */}
        <TabsContent value="dispatch" className="space-y-3">
          <OrphanDispatchPanel onChanged={loadOrphans} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {icon} {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value.toLocaleString("pt-BR")}</p>
      </CardContent>
    </Card>
  );
}
