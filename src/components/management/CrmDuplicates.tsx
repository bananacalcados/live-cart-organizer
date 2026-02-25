import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Search, Merge, Loader2, AlertTriangle, CheckCircle2, Phone } from "lucide-react";
import { toast } from "sonner";

interface DuplicateGroup {
  phone: string;
  entries: CrmEntry[];
}

interface CrmEntry {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  source: string;
  sourceLabel: string;
  extra?: string;
}

export function CrmDuplicates() {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [search, setSearch] = useState("");
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [primaryId, setPrimaryId] = useState<string>("");
  const [merging, setMerging] = useState(false);

  const findDuplicates = async () => {
    setLoading(true);
    try {
      // Fetch from all 3 CRM tables in parallel
      const [posRes, zoppyRes, customersRes] = await Promise.all([
        supabase.from("pos_customers").select("id, name, whatsapp, email, cpf").not("whatsapp", "is", null),
        supabase.from("zoppy_customers").select("id, first_name, last_name, phone, email" as any).not("phone", "is", null),
        supabase.from("customers").select("id, instagram_handle, whatsapp").not("whatsapp", "is", null),
      ]);

      const entries: CrmEntry[] = [];

      // pos_customers
      for (const row of (posRes.data || []) as any[]) {
        if (!row.whatsapp) continue;
        const suffix = row.whatsapp.replace(/\D/g, "").slice(-8);
        if (suffix.length < 8) continue;
        entries.push({
          id: `pos_${row.id}`,
          name: row.name || "Sem nome",
          phone: suffix,
          email: row.email,
          source: "pos_customers",
          sourceLabel: "PDV",
          extra: row.cpf ? `CPF: ${row.cpf}` : undefined,
        });
      }

      // zoppy_customers
      for (const row of (zoppyRes.data || []) as any[]) {
        if (!row.phone) continue;
        const suffix = row.phone.replace(/\D/g, "").slice(-8);
        if (suffix.length < 8) continue;
        entries.push({
          id: `zoppy_${row.id}`,
          name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Sem nome",
          phone: suffix,
          email: row.email,
          source: "zoppy_customers",
          sourceLabel: "Zoppy",
        });
      }

      // customers (live)
      for (const row of (customersRes.data || []) as any[]) {
        if (!row.whatsapp) continue;
        const suffix = row.whatsapp.replace(/\D/g, "").slice(-8);
        if (suffix.length < 8) continue;
        entries.push({
          id: `cust_${row.id}`,
          name: row.instagram_handle || "Sem nome",
          phone: suffix,
          email: undefined,
          source: "customers",
          sourceLabel: "Live/Instagram",
        });
      }

      // Group by phone suffix
      const phoneMap = new Map<string, CrmEntry[]>();
      for (const entry of entries) {
        const list = phoneMap.get(entry.phone) || [];
        list.push(entry);
        phoneMap.set(entry.phone, list);
      }

      // Only keep groups with 2+ entries (duplicates)
      const duplicateGroups: DuplicateGroup[] = [];
      for (const [phone, entryList] of phoneMap) {
        if (entryList.length >= 2) {
          duplicateGroups.push({ phone, entries: entryList });
        }
      }

      duplicateGroups.sort((a, b) => b.entries.length - a.entries.length);
      setGroups(duplicateGroups);

      if (duplicateGroups.length === 0) {
        toast.info("Nenhum duplicado encontrado!");
      } else {
        toast.success(`${duplicateGroups.length} grupos de duplicados encontrados`);
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao buscar duplicados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    findDuplicates();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(g =>
      g.phone.includes(q) ||
      g.entries.some(e => e.name.toLowerCase().includes(q) || (e.email && e.email.toLowerCase().includes(q)))
    );
  }, [groups, search]);

  const handleMerge = async () => {
    if (!mergeGroup || !primaryId) return;
    setMerging(true);
    try {
      const primary = mergeGroup.entries.find(e => e.id === primaryId);
      if (!primary) throw new Error("Registro principal não encontrado");

      // For each non-primary entry, null out their phone to "merge" into primary
      const toRemove = mergeGroup.entries.filter(e => e.id !== primaryId);

      for (const entry of toRemove) {
        const realId = entry.id.split("_").slice(1).join("_");
        if (entry.source === "pos_customers") {
          await supabase.from("pos_customers").update({ whatsapp: null } as any).eq("id", realId);
        } else if (entry.source === "zoppy_customers") {
          await supabase.from("zoppy_customers").update({ phone: null } as any).eq("id", realId);
        } else if (entry.source === "customers") {
          await supabase.from("customers").update({ whatsapp: null }).eq("id", realId);
        }
      }

      toast.success(`Merge concluído! ${toRemove.length} registros limpos, mantido: ${primary.sourceLabel}`);
      setMergeGroup(null);
      setPrimaryId("");
      findDuplicates();
    } catch (e: any) {
      console.error(e);
      toast.error("Erro no merge: " + (e.message || ""));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Duplicados no CRM — Identificar e Mesclar
        </h3>
        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={findDuplicates} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Reescanear
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Grupos Duplicados</span>
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            </div>
            <p className="text-lg font-bold text-destructive">{groups.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Registros Afetados</span>
              <Users className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{groups.reduce((s, g) => s + g.entries.length, 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">Economia Potencial</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold">{groups.reduce((s, g) => s + g.entries.length - 1, 0)} registros</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, telefone ou e-mail..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Buscando duplicados...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-primary" />
          <p className="text-sm font-medium">Nenhum duplicado encontrado</p>
          <p className="text-xs">Seu CRM está limpo!</p>
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Telefone</TableHead>
                <TableHead>Registros</TableHead>
                <TableHead className="w-[80px]">Qtd</TableHead>
                <TableHead className="w-[100px]">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(group => (
                <TableRow key={group.phone}>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      ...{group.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {group.entries.map(e => (
                        <Badge key={e.id} variant="secondary" className="text-[10px]">
                          {e.sourceLabel}: {e.name.substring(0, 20)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive" className="text-[10px]">{group.entries.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => { setMergeGroup(group); setPrimaryId(group.entries[0].id); }}
                    >
                      <Merge className="h-3 w-3" /> Mesclar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {/* Merge Dialog */}
      <Dialog open={!!mergeGroup} onOpenChange={open => { if (!open) { setMergeGroup(null); setPrimaryId(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Merge className="h-4 w-4 text-primary" />
              Mesclar Duplicados — ...{mergeGroup?.phone}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Selecione o registro principal. Os demais terão o telefone removido.
          </p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {mergeGroup?.entries.map(entry => (
              <div
                key={entry.id}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  primaryId === entry.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
                onClick={() => setPrimaryId(entry.id)}
              >
                <div className="flex items-center gap-3">
                  <Checkbox checked={primaryId === entry.id} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{entry.name}</span>
                      <Badge variant="outline" className="text-[10px]">{entry.sourceLabel}</Badge>
                      {primaryId === entry.id && <Badge className="text-[10px] bg-primary text-primary-foreground">Principal</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {entry.email && <span>📧 {entry.email} • </span>}
                      {entry.extra && <span>{entry.extra} • </span>}
                      <span>Fonte: {entry.source}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMergeGroup(null)}>Cancelar</Button>
            <Button onClick={handleMerge} disabled={!primaryId || merging} className="gap-1">
              {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
              {merging ? "Mesclando..." : "Mesclar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
