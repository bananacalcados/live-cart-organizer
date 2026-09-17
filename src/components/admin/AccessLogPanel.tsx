import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface AccessRow {
  id: string;
  user_email: string | null;
  user_id: string;
  module: string;
  route: string | null;
  event_id: string | null;
  ip: string | null;
  user_agent: string | null;
  hits: number;
  created_at: string;
}

const MODULE_LABELS: Record<string, string> = {
  events: "Eventos / Live",
  chat: "Chat",
  pos: "PDV",
  marketing: "Marketing",
  expedition: "Expedição",
  inventory: "Estoque",
  management: "Gestão",
  admin: "Administração",
  dashboard: "Dashboard",
};

const PERIODS = [
  { value: "1", label: "Hoje (24h)" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
];

const deviceOf = (ua: string | null) => {
  if (!ua) return "—";
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Outro";
};

const isOffHours = (iso: string) => {
  const h = new Date(iso).getHours();
  return h >= 0 && h < 7;
};

export function AccessLogPanel() {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [events, setEvents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState("7");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
      let query = supabase
        .from("module_access_log")
        .select("id,user_id,user_email,module,route,event_id,ip,user_agent,hits,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (moduleFilter !== "all") query = query.eq("module", moduleFilter);
      const { data, error } = await query;
      if (error) throw error;
      const list = (data || []) as AccessRow[];
      setRows(list);

      const ids = Array.from(new Set(list.map((r) => r.event_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: evs } = await supabase.from("events").select("id,name").in("id", ids);
        const map: Record<string, string> = {};
        (evs || []).forEach((e: any) => (map[e.id] = e.name));
        setEvents(map);
      } else {
        setEvents({});
      }
    } catch (e: any) {
      toast.error("Não foi possível carregar os acessos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, moduleFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        (r.user_email || "").toLowerCase().includes(term) ||
        (r.route || "").toLowerCase().includes(term) ||
        (r.event_id ? (events[r.event_id] || "").toLowerCase().includes(term) : false)
    );
  }, [rows, search, events]);

  const liveToday = useMemo(() => {
    const dayAgo = Date.now() - 86400000;
    const set = new Set(
      rows
        .filter((r) => r.module === "events" && new Date(r.created_at).getTime() >= dayAgo)
        .map((r) => r.user_email || r.user_id)
    );
    return set.size;
  }, [rows]);

  const liveWeek = useMemo(() => {
    const set = new Set(
      rows.filter((r) => r.module === "events").map((r) => r.user_email || r.user_id)
    );
    return set.size;
  }, [rows]);

  const offHoursCount = useMemo(
    () => filtered.filter((r) => isOffHours(r.created_at)).length,
    [filtered]
  );

  const exportCsv = () => {
    const header = ["Data/Hora", "Pessoa", "Módulo", "Tela", "Evento", "IP", "Aparelho", "Aberturas"];
    const lines = filtered.map((r) =>
      [
        new Date(r.created_at).toLocaleString("pt-BR"),
        r.user_email || r.user_id,
        MODULE_LABELS[r.module] || r.module,
        r.route || "",
        r.event_id ? events[r.event_id] || r.event_id : "",
        r.ip || "",
        deviceOf(r.user_agent),
        String(r.hits),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";")
    );
    const blob = new Blob(["\uFEFF" + [header.join(";"), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acessos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Pessoas na Live (24h)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{liveToday}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">
              Pessoas na Live (período)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{liveWeek}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">
              Acessos em horário atípico (00h–07h)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-destructive">{offHoursCount}</CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os módulos</SelectItem>
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Buscar por pessoa, tela ou evento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[280px]"
        />

        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Exportar CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Data / Hora</th>
                  <th className="px-3 py-2 font-semibold">Pessoa</th>
                  <th className="px-3 py-2 font-semibold">Módulo</th>
                  <th className="px-3 py-2 font-semibold">Tela</th>
                  <th className="px-3 py-2 font-semibold">Evento</th>
                  <th className="px-3 py-2 font-semibold">IP</th>
                  <th className="px-3 py-2 font-semibold">Aparelho</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const off = isOffHours(r.created_at);
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className={`px-3 py-2 whitespace-nowrap ${off ? "text-destructive font-semibold" : ""}`}>
                        <span className="inline-flex items-center gap-1">
                          {off && <ShieldAlert className="h-3.5 w-3.5" />}
                          {new Date(r.created_at).toLocaleString("pt-BR")}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.user_email || r.user_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{MODULE_LABELS[r.module] || r.module}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.route || "—"}</td>
                      <td className="px-3 py-2">
                        {r.event_id ? events[r.event_id] || r.event_id.slice(0, 8) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.ip || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{deviceOf(r.user_agent)}</td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      {loading ? "Carregando..." : "Nenhum acesso registrado no período."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
