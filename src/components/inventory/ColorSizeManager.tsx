import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Plus, Pencil, Trash2, Save, GitMerge, Search } from "lucide-react";
import { toast } from "sonner";

type Kind = "color" | "size";

interface ColorRow {
  id: string;
  name: string;
  slug: string;
  hex: string | null;
  usage: number;
}

interface SizeRow {
  id: string;
  label: string;
  slug: string;
  numeric_value: number | null;
  size_group: string;
  usage: number;
}

const SIZE_GROUPS = [
  { value: "adulto", label: "Adulto" },
  { value: "infantil", label: "Infantil" },
  { value: "outro", label: "Outro" },
];

export function ColorSizeManager({ kind }: { kind: Kind }) {
  const [rows, setRows] = useState<Array<ColorRow | SizeRow>>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [merging, setMerging] = useState<any | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const table = kind === "color" ? "product_colors" : "product_sizes";
    const orderCol = kind === "color" ? "name" : "numeric_value";
    const { data: dict, error } = await supabase
      .from(table as any)
      .select("*")
      .order(orderCol as any, { ascending: true, nullsFirst: false });
    if (error) {
      toast.error("Erro ao carregar: " + error.message);
      setLoading(false);
      return;
    }
    // count usage from product_variants
    const idKey = kind === "color" ? "color_id" : "size_id";
    const { data: uses } = await supabase
      .from("product_variants")
      .select(`${idKey}`)
      .not(idKey, "is", null)
      .limit(50000);
    const counts = new Map<string, number>();
    for (const u of (uses as any[]) || []) {
      const id = u[idKey];
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    setRows(
      ((dict as any[]) || []).map((r) => ({ ...r, usage: counts.get(r.id) || 0 })) as any,
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [kind]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r: any) =>
      (r.name || r.label || "").toLowerCase().includes(term) ||
      (r.slug || "").toLowerCase().includes(term),
    );
  }, [rows, q]);

  const startCreate = () => {
    setEditing(
      kind === "color"
        ? { id: null, name: "", hex: "" }
        : { id: null, label: "", numeric_value: null, size_group: "adulto" },
    );
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const table = kind === "color" ? "product_colors" : "product_sizes";
    try {
      if (kind === "color") {
        const payload: any = {
          name: editing.name?.trim(),
          hex: editing.hex?.trim() || null,
        };
        if (!payload.name) {
          toast.error("Nome obrigatório");
          setSaving(false);
          return;
        }
        // slug derived by trigger? no — cliente calcula
        payload.slug = slugify(payload.name);
        if (editing.id) {
          const { error } = await supabase.from("product_colors").update(payload).eq("id", editing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("product_colors").insert(payload);
          if (error) throw error;
        }
      } else {
        const payload: any = {
          label: editing.label?.trim(),
          numeric_value: editing.numeric_value === "" || editing.numeric_value == null ? null : Number(editing.numeric_value),
          size_group: editing.size_group || "outro",
        };
        if (!payload.label) {
          toast.error("Rótulo obrigatório");
          setSaving(false);
          return;
        }
        payload.slug = slugify(payload.label);
        if (editing.id) {
          const { error } = await supabase.from("product_sizes").update(payload).eq("id", editing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("product_sizes").insert(payload);
          if (error) throw error;
        }
      }
      toast.success("Salvo");
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: any) => {
    if (row.usage > 0) {
      toast.error(`Não é possível excluir: ${row.usage} variação(ões) em uso. Faça fusão primeiro.`);
      return;
    }
    if (!confirm("Excluir?")) return;
    const table = kind === "color" ? "product_colors" : "product_sizes";
    const { error } = await supabase.from(table as any).delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    await load();
  };

  const doMerge = async () => {
    if (!merging || !mergeTargetId) return;
    if (mergeTargetId === merging.id) {
      toast.error("Selecione um destino diferente");
      return;
    }
    setSaving(true);
    const fn = kind === "color" ? "merge_product_color" : "merge_product_size";
    const { error } = await supabase.rpc(fn as any, {
      _source_id: merging.id,
      _target_id: mergeTargetId,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro na fusão: " + error.message);
      return;
    }
    toast.success("Fusão concluída");
    setMerging(null);
    setMergeTargetId("");
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={kind === "color" ? "Buscar cor..." : "Buscar tamanho..."}
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          Atualizar
        </Button>
        <Button size="sm" onClick={startCreate}>
          <Plus className="h-4 w-4 mr-1" />
          {kind === "color" ? "Nova cor" : "Novo tamanho"}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nada encontrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {kind === "color" ? (
                    <>
                      <TableHead>Cor</TableHead>
                      <TableHead>Hex</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>Tamanho</TableHead>
                      <TableHead>Numérico</TableHead>
                      <TableHead>Grupo</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">Variações</TableHead>
                  <TableHead className="text-right w-52">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row: any) => (
                  <TableRow key={row.id}>
                    {kind === "color" ? (
                      <>
                        <TableCell className="font-medium flex items-center gap-2">
                          {row.hex && (
                            <span
                              className="inline-block w-4 h-4 rounded-full border"
                              style={{ backgroundColor: row.hex }}
                            />
                          )}
                          {row.name}
                          <span className="text-xs text-muted-foreground">({row.slug})</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{row.hex || "—"}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="font-medium">
                          {row.label}
                          <span className="text-xs text-muted-foreground ml-1">({row.slug})</span>
                        </TableCell>
                        <TableCell>{row.numeric_value ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{row.size_group}</Badge>
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right">{row.usage}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setMerging(row); setMergeTargetId(""); }}
                        title="Fundir em outro registro"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(row)} disabled={row.usage > 0}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Editar" : "Novo"} {kind === "color" ? "cor" : "tamanho"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {kind === "color" ? (
                <>
                  <div>
                    <Label>Nome</Label>
                    <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div>
                    <Label>Hex (opcional)</Label>
                    <Input value={editing.hex || ""} placeholder="#000000" onChange={(e) => setEditing({ ...editing, hex: e.target.value })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>Rótulo</Label>
                    <Input value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                  </div>
                  <div>
                    <Label>Valor numérico (opcional)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={editing.numeric_value ?? ""}
                      onChange={(e) => setEditing({ ...editing, numeric_value: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Grupo</Label>
                    <Select value={editing.size_group || "outro"} onValueChange={(v) => setEditing({ ...editing, size_group: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SIZE_GROUPS.map((g) => (
                          <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1" /> Salvar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge */}
      <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fundir {kind === "color" ? "cor" : "tamanho"}</DialogTitle>
          </DialogHeader>
          {merging && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Todas as {merging.usage} variação(ões) vinculadas a{" "}
                <b>{merging.name || merging.label}</b> serão migradas para o destino escolhido.
                Este registro será excluído em seguida.
              </p>
              <div>
                <Label>Destino</Label>
                <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {rows
                      .filter((r: any) => r.id !== merging.id)
                      .map((r: any) => (
                        <SelectItem key={r.id} value={r.id}>
                          {(r.name || r.label)} {r.usage > 0 && `(${r.usage})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMerging(null)}>Cancelar</Button>
            <Button onClick={doMerge} disabled={saving || !mergeTargetId}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><GitMerge className="h-4 w-4 mr-1" /> Fundir</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function slugify(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
