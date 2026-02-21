import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Trash2, ChevronRight, ChevronDown, GripVertical,
  Store, Globe, Loader2, Check, X, Edit2
} from "lucide-react";
import { toast } from "sonner";

interface StrategyTask {
  id: string;
  store_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  scope: string;
  created_at: string;
  children?: StrategyTask[];
}

interface StoreRow {
  id: string;
  name: string;
}

export function StrategyManager({ stores }: { stores: StoreRow[] }) {
  const [tasks, setTasks] = useState<StrategyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [activeScope, setActiveScope] = useState<string>("global");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");

  const activeStoreId = activeScope === "global" ? null : activeScope;

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("strategy_tasks")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (activeScope === "global") {
      query = query.eq("scope", "global");
    } else {
      query = query.eq("store_id", activeScope);
    }

    const { data, error } = await query;
    if (error) {
      toast.error("Erro ao carregar tarefas");
      setLoading(false);
      return;
    }

    // Build tree
    const map = new Map<string, StrategyTask>();
    const roots: StrategyTask[] = [];
    for (const t of (data || [])) {
      map.set(t.id, { ...t, children: [] });
    }
    for (const t of map.values()) {
      if (t.parent_id && map.has(t.parent_id)) {
        map.get(t.parent_id)!.children!.push(t);
      } else {
        roots.push(t);
      }
    }
    setTasks(roots);
    setLoading(false);
  }, [activeScope]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    const { error } = await supabase.from("strategy_tasks").insert({
      title: newTaskTitle.trim(),
      scope: activeScope === "global" ? "global" : "store",
      store_id: activeStoreId,
      sort_order: tasks.length,
    });
    if (error) {
      toast.error("Erro ao criar tarefa");
      return;
    }
    setNewTaskTitle("");
    fetchTasks();
  };

  const addSubtask = async (parentId: string) => {
    if (!subtaskTitle.trim()) return;
    const parent = findTask(tasks, parentId);
    const { error } = await supabase.from("strategy_tasks").insert({
      title: subtaskTitle.trim(),
      parent_id: parentId,
      scope: activeScope === "global" ? "global" : "store",
      store_id: activeStoreId,
      sort_order: (parent?.children?.length || 0),
    });
    if (error) {
      toast.error("Erro ao criar subtarefa");
      return;
    }
    setSubtaskTitle("");
    setAddingSubtaskFor(null);
    setExpandedTasks(prev => new Set(prev).add(parentId));
    fetchTasks();
  };

  const toggleComplete = async (task: StrategyTask) => {
    const newCompleted = !task.is_completed;
    await supabase.from("strategy_tasks").update({
      is_completed: newCompleted,
      completed_at: newCompleted ? new Date().toISOString() : null,
    }).eq("id", task.id);
    fetchTasks();
  };

  const deleteTask = async (id: string) => {
    await supabase.from("strategy_tasks").delete().eq("id", id);
    fetchTasks();
  };

  const saveEdit = async (id: string) => {
    await supabase.from("strategy_tasks").update({
      title: editTitle.trim(),
      description: editDescription.trim() || null,
    }).eq("id", id);
    setEditingId(null);
    fetchTasks();
  };

  const toggleExpand = (id: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  function findTask(list: StrategyTask[], id: string): StrategyTask | null {
    for (const t of list) {
      if (t.id === id) return t;
      if (t.children) {
        const found = findTask(t.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  const completedCount = (list: StrategyTask[]): { done: number; total: number } => {
    let done = 0, total = 0;
    for (const t of list) {
      total++;
      if (t.is_completed) done++;
      if (t.children?.length) {
        const sub = completedCount(t.children);
        done += sub.done;
        total += sub.total;
      }
    }
    return { done, total };
  };

  const renderTask = (task: StrategyTask, depth: number = 0) => {
    const hasChildren = task.children && task.children.length > 0;
    const isExpanded = expandedTasks.has(task.id);
    const isEditing = editingId === task.id;

    return (
      <div key={task.id} className="group">
        <div
          className={`flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors ${depth > 0 ? "ml-6" : ""}`}
        >
          {/* Expand/collapse */}
          <button
            onClick={() => hasChildren && toggleExpand(task.id)}
            className="mt-0.5 p-0.5 text-muted-foreground hover:text-foreground shrink-0"
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <div className="w-3.5" />
            )}
          </button>

          {/* Checkbox */}
          <Checkbox
            checked={task.is_completed}
            onCheckedChange={() => toggleComplete(task)}
            className="mt-0.5 shrink-0"
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-1">
                <Input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="h-7 text-sm"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && saveEdit(task.id)}
                />
                <Textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  className="min-h-[60px] text-xs"
                />
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => saveEdit(task.id)}>
                    <Check className="h-3 w-3" /> Salvar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setEditingId(null)}>
                    <X className="h-3 w-3" /> Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <span
                  className={`text-sm cursor-pointer ${task.is_completed ? "line-through text-muted-foreground" : ""}`}
                  onClick={() => {
                    setEditingId(task.id);
                    setEditTitle(task.title);
                    setEditDescription(task.description || "");
                  }}
                >
                  {task.title}
                </span>
                {task.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                )}
                {hasChildren && (
                  <span className="text-[10px] text-muted-foreground">
                    {completedCount(task.children!).done}/{completedCount(task.children!).total} concluídas
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => {
                setAddingSubtaskFor(addingSubtaskFor === task.id ? null : task.id);
                setSubtaskTitle("");
              }}
              title="Adicionar subtarefa"
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-destructive"
              onClick={() => deleteTask(task.id)}
              title="Excluir"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Add subtask input */}
        {addingSubtaskFor === task.id && (
          <div className="flex gap-2 ml-12 mt-1 mb-1">
            <Input
              value={subtaskTitle}
              onChange={e => setSubtaskTitle(e.target.value)}
              placeholder="Nova subtarefa..."
              className="h-7 text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") addSubtask(task.id);
                if (e.key === "Escape") setAddingSubtaskFor(null);
              }}
            />
            <Button size="sm" className="h-7 text-xs" onClick={() => addSubtask(task.id)}>
              Adicionar
            </Button>
          </div>
        )}

        {/* Children */}
        {hasChildren && isExpanded && (
          <div>
            {task.children!.map(child => renderTask(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const stats = completedCount(tasks);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Estratégia — Tarefas e Metas</h3>
        {stats.total > 0 && (
          <Badge variant="secondary" className="text-xs">
            {stats.done}/{stats.total} concluídas ({stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0}%)
          </Badge>
        )}
      </div>

      {/* Scope tabs */}
      <Tabs value={activeScope} onValueChange={setActiveScope}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="global" className="gap-1 text-xs">
            <Globe className="h-3 w-3" /> Geral
          </TabsTrigger>
          {stores.map(s => (
            <TabsTrigger key={s.id} value={s.id} className="gap-1 text-xs">
              <Store className="h-3 w-3" /> {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-4">
          {/* Add task */}
          <div className="flex gap-2 mb-4">
            <Input
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              placeholder="Nova tarefa estratégica..."
              className="h-8 text-sm"
              onKeyDown={e => e.key === "Enter" && addTask()}
            />
            <Button size="sm" className="h-8 gap-1 text-xs shrink-0" onClick={addTask}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          </div>

          {/* Task list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma tarefa estratégica ainda. Adicione a primeira acima.
            </p>
          ) : (
            <div className="space-y-0.5">
              {tasks.map(t => renderTask(t))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
