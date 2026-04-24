import { useState, useEffect, useMemo } from "react";
import { Zap, Plus, Trash2, Pencil, Search, Folder, FolderPlus, ChevronLeft, Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuickReply {
  id: string;
  title: string;
  message: string;
  category: string | null;
  folder_id: string | null;
  sort_order: number;
}

interface QuickReplyFolder {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  parent_id: string | null;
}

interface QuickReplyPickerProps {
  onSelect: (text: string) => void;
}

const FOLDER_COLORS = [
  { value: "bg-blue-500", label: "Azul", dot: "bg-blue-500" },
  { value: "bg-emerald-500", label: "Verde", dot: "bg-emerald-500" },
  { value: "bg-amber-500", label: "Amarelo", dot: "bg-amber-500" },
  { value: "bg-rose-500", label: "Vermelho", dot: "bg-rose-500" },
  { value: "bg-purple-500", label: "Roxo", dot: "bg-purple-500" },
  { value: "bg-pink-500", label: "Rosa", dot: "bg-pink-500" },
  { value: "bg-cyan-500", label: "Ciano", dot: "bg-cyan-500" },
  { value: "bg-orange-500", label: "Laranja", dot: "bg-orange-500" },
  { value: "bg-slate-500", label: "Cinza", dot: "bg-slate-500" },
];

const NO_FOLDER_VALUE = "__none__";
const NO_PARENT_VALUE = "__root__";

export function QuickReplyPicker({ onSelect }: QuickReplyPickerProps) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [folders, setFolders] = useState<QuickReplyFolder[]>([]);
  const [search, setSearch] = useState("");
  // null = todas; "__none__" = sem pasta; id = filtro por pasta (raiz ou sub)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  // Quando o usuário clicou numa pasta-pai, ele "entrou" nela (mostra sub-pastas)
  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "folders" | "addReply" | "addFolder">("list");

  // form state - reply
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formFolderId, setFormFolderId] = useState<string>(NO_FOLDER_VALUE);

  // form state - folder
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [formFolderName, setFormFolderName] = useState("");
  const [formFolderColor, setFormFolderColor] = useState(FOLDER_COLORS[0].value);
  const [formFolderParentId, setFormFolderParentId] = useState<string>(NO_PARENT_VALUE);

  const fetchAll = async () => {
    const [{ data: r }, { data: f }] = await Promise.all([
      supabase
        .from("quick_replies")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("title", { ascending: true }),
      supabase
        .from("quick_reply_folders")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);
    if (r) setReplies(r as QuickReply[]);
    if (f) setFolders(f as QuickReplyFolder[]);
  };

  useEffect(() => {
    if (open) fetchAll();
  }, [open]);

  const rootFolders = useMemo(
    () => folders.filter((f) => !f.parent_id),
    [folders]
  );

  const subFoldersByParent = useMemo(() => {
    const map: Record<string, QuickReplyFolder[]> = {};
    for (const f of folders) {
      if (f.parent_id) {
        if (!map[f.parent_id]) map[f.parent_id] = [];
        map[f.parent_id].push(f);
      }
    }
    return map;
  }, [folders]);

  // Conta replies por pasta — pasta-pai inclui replies das sub-pastas
  const folderCounts = useMemo(() => {
    const direct: Record<string, number> = {};
    let none = 0;
    for (const r of replies) {
      if (r.folder_id) direct[r.folder_id] = (direct[r.folder_id] || 0) + 1;
      else none++;
    }
    // Total agregado (pai + filhos)
    const total: Record<string, number> = { ...direct };
    for (const root of rootFolders) {
      const subs = subFoldersByParent[root.id] || [];
      total[root.id] = (direct[root.id] || 0) + subs.reduce((s, sub) => s + (direct[sub.id] || 0), 0);
    }
    return { direct, total, none };
  }, [replies, rootFolders, subFoldersByParent]);

  const filtered = useMemo(() => {
    let list = replies;
    if (activeFolderId === NO_FOLDER_VALUE) {
      list = list.filter((r) => !r.folder_id);
    } else if (activeFolderId) {
      // Se for pasta-pai, inclui replies das sub-pastas
      const subs = subFoldersByParent[activeFolderId] || [];
      const ids = new Set([activeFolderId, ...subs.map((s) => s.id)]);
      list = list.filter((r) => r.folder_id && ids.has(r.folder_id));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.title.toLowerCase().includes(q) || r.message.toLowerCase().includes(q)
      );
    }
    return list;
  }, [replies, activeFolderId, search, subFoldersByParent]);

  const handleSelect = (reply: QuickReply) => {
    onSelect(reply.message);
    setOpen(false);
    setSearch("");
  };

  // ===== Replies CRUD =====
  const openAddReply = () => {
    setEditingReplyId(null);
    setFormTitle("");
    setFormMessage("");
    setFormFolderId(activeFolderId && activeFolderId !== NO_FOLDER_VALUE ? activeFolderId : NO_FOLDER_VALUE);
    setView("addReply");
  };

  const startEditReply = (reply: QuickReply) => {
    setEditingReplyId(reply.id);
    setFormTitle(reply.title);
    setFormMessage(reply.message);
    setFormFolderId(reply.folder_id || NO_FOLDER_VALUE);
    setView("addReply");
  };

  const handleSaveReply = async () => {
    if (!formTitle.trim() || !formMessage.trim()) return;
    const folder_id = formFolderId === NO_FOLDER_VALUE ? null : formFolderId;
    if (editingReplyId) {
      const { error } = await supabase
        .from("quick_replies")
        .update({ title: formTitle.trim(), message: formMessage.trim(), folder_id })
        .eq("id", editingReplyId);
      if (error) { toast.error("Erro ao salvar"); return; }
      toast.success("Mensagem atualizada");
    } else {
      const { error } = await supabase
        .from("quick_replies")
        .insert({ title: formTitle.trim(), message: formMessage.trim(), folder_id });
      if (error) { toast.error("Erro ao criar"); return; }
      toast.success("Mensagem criada");
    }
    setView("list");
    fetchAll();
  };

  const handleDeleteReply = async (id: string) => {
    await supabase.from("quick_replies").delete().eq("id", id);
    fetchAll();
    toast.success("Mensagem removida");
  };

  // ===== Folders CRUD =====
  const openAddFolder = () => {
    setEditingFolderId(null);
    setFormFolderName("");
    setFormFolderColor(FOLDER_COLORS[0].value);
    setFormFolderParentId(NO_PARENT_VALUE);
    setView("addFolder");
  };

  const startEditFolder = (folder: QuickReplyFolder) => {
    setEditingFolderId(folder.id);
    setFormFolderName(folder.name);
    setFormFolderColor(folder.color);
    setFormFolderParentId(folder.parent_id || NO_PARENT_VALUE);
    setView("addFolder");
  };

  const handleSaveFolder = async () => {
    if (!formFolderName.trim()) return;
    const parent_id = formFolderParentId === NO_PARENT_VALUE ? null : formFolderParentId;

    // Bloqueio: pasta editada não pode virar sub se já tem sub-pastas
    if (editingFolderId && parent_id) {
      const hasChildren = (subFoldersByParent[editingFolderId] || []).length > 0;
      if (hasChildren) {
        toast.error("Esta pasta possui sub-pastas. Mova-as primeiro.");
        return;
      }
    }

    if (editingFolderId) {
      const { error } = await supabase
        .from("quick_reply_folders")
        .update({ name: formFolderName.trim(), color: formFolderColor, parent_id })
        .eq("id", editingFolderId);
      if (error) { toast.error("Erro ao salvar pasta"); return; }
      toast.success("Pasta atualizada");
    } else {
      const { error } = await supabase
        .from("quick_reply_folders")
        .insert({ name: formFolderName.trim(), color: formFolderColor, parent_id });
      if (error) { toast.error("Erro ao criar pasta"); return; }
      toast.success("Pasta criada");
    }
    setView("folders");
    fetchAll();
  };

  const handleDeleteFolder = async (id: string) => {
    const subCount = (subFoldersByParent[id] || []).length;
    const msg = subCount > 0
      ? `Esta pasta possui ${subCount} sub-pasta(s) que também serão removidas. Continuar?`
      : "Remover esta pasta? As mensagens dentro dela ficarão sem pasta.";
    if (!confirm(msg)) return;
    await supabase.from("quick_reply_folders").delete().eq("id", id);
    if (activeFolderId === id) setActiveFolderId(null);
    if (expandedRootId === id) setExpandedRootId(null);
    fetchAll();
    toast.success("Pasta removida");
  };

  // Quando clicar numa pasta-pai, expande mostrando sub-pastas e filtra por ela
  const handleClickRootFolder = (folderId: string) => {
    setActiveFolderId(folderId);
    setExpandedRootId(folderId);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          title="Mensagens rápidas"
        >
          <Zap className="h-5 w-5 text-amber-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start" side="top">
        {/* Header */}
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {view !== "list" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setView("list")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <span className="text-sm font-semibold truncate">
              {view === "list" && "Mensagens Rápidas"}
              {view === "folders" && "Gerenciar Pastas"}
              {view === "addReply" && (editingReplyId ? "Editar mensagem" : "Nova mensagem")}
              {view === "addFolder" && (editingFolderId ? "Editar pasta" : "Nova pasta")}
            </span>
          </div>
          {view === "list" && (
            <div className="flex gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setView("folders")}
                title="Gerenciar pastas"
              >
                <Folder className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={openAddReply}
              >
                <Plus className="h-3 w-3" />
                Nova
              </Button>
            </div>
          )}
        </div>

        {/* ===== VIEW: LIST ===== */}
        {view === "list" && (
          <>
            {/* Folder chips - pastas raiz */}
            {(rootFolders.length > 0 || folderCounts.none > 0) && (
              <div className="px-3 pt-2 pb-1 border-b">
                <ScrollArea className="w-full">
                  <div className="flex gap-1.5 pb-1.5">
                    <button
                      onClick={() => { setActiveFolderId(null); setExpandedRootId(null); }}
                      className={cn(
                        "shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                        activeFolderId === null
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent border-border"
                      )}
                    >
                      Todas ({replies.length})
                    </button>
                    {folderCounts.none > 0 && (
                      <button
                        onClick={() => { setActiveFolderId(NO_FOLDER_VALUE); setExpandedRootId(null); }}
                        className={cn(
                          "shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                          activeFolderId === NO_FOLDER_VALUE
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-accent border-border"
                        )}
                      >
                        Sem pasta ({folderCounts.none})
                      </button>
                    )}
                    {rootFolders.map((f) => {
                      const subCount = (subFoldersByParent[f.id] || []).length;
                      const isActive = activeFolderId === f.id || expandedRootId === f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => handleClickRootFolder(f.id)}
                          className={cn(
                            "shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1.5",
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background hover:bg-accent border-border"
                          )}
                        >
                          <span className={cn("h-2 w-2 rounded-full", f.color)} />
                          {f.name} ({folderCounts.total[f.id] || 0})
                          {subCount > 0 && <ChevronRight className="h-2.5 w-2.5 opacity-60" />}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Sub-pastas da pasta-pai expandida */}
                {expandedRootId && (subFoldersByParent[expandedRootId] || []).length > 0 && (
                  <ScrollArea className="w-full">
                    <div className="flex gap-1.5 pb-1.5 pl-3 border-l-2 border-muted ml-1">
                      <button
                        onClick={() => setActiveFolderId(expandedRootId)}
                        className={cn(
                          "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                          activeFolderId === expandedRootId
                            ? "bg-secondary text-secondary-foreground border-secondary"
                            : "bg-background hover:bg-accent border-border"
                        )}
                      >
                        Tudo ({folderCounts.total[expandedRootId] || 0})
                      </button>
                      {(subFoldersByParent[expandedRootId] || []).map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => setActiveFolderId(sub.id)}
                          className={cn(
                            "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors flex items-center gap-1",
                            activeFolderId === sub.id
                              ? "bg-secondary text-secondary-foreground border-secondary"
                              : "bg-background hover:bg-accent border-border"
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", sub.color)} />
                          {sub.name} ({folderCounts.direct[sub.id] || 0})
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Search */}
            {replies.length > 3 && (
              <div className="px-3 pt-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 text-xs pl-7"
                  />
                </div>
              </div>
            )}

            {/* List with FIXED height for proper scroll */}
            <ScrollArea className="h-[340px]">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {replies.length === 0
                    ? 'Nenhuma mensagem rápida. Clique em "Nova" para criar.'
                    : "Nenhum resultado encontrado."}
                </div>
              ) : (
                <div className="p-1">
                  {filtered.map((reply) => {
                    const folder = reply.folder_id ? folders.find((f) => f.id === reply.folder_id) : null;
                    const parent = folder?.parent_id ? folders.find((f) => f.id === folder.parent_id) : null;
                    return (
                      <div
                        key={reply.id}
                        className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer"
                        onClick={() => handleSelect(reply)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {folder && (
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full shrink-0", folder.color)}
                                title={parent ? `${parent.name} › ${folder.name}` : folder.name}
                              />
                            )}
                            <div className="text-xs font-medium truncate">{reply.title}</div>
                          </div>
                          <div className="text-[11px] text-muted-foreground line-clamp-2">
                            {reply.message}
                          </div>
                        </div>
                        <div className="hidden group-hover:flex gap-0.5 shrink-0 pt-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={(e) => { e.stopPropagation(); startEditReply(reply); }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleDeleteReply(reply.id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </>
        )}

        {/* ===== VIEW: ADD/EDIT REPLY ===== */}
        {view === "addReply" && (
          <div className="p-3 space-y-2">
            <Input
              placeholder="Título (ex: Saudação)"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Mensagem..."
              value={formMessage}
              onChange={(e) => setFormMessage(e.target.value)}
              rows={5}
              className="text-xs"
            />
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Pasta (opcional)</label>
              <Select value={formFolderId} onValueChange={setFormFolderId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER_VALUE}>Sem pasta</SelectItem>
                  {rootFolders.map((root) => {
                    const subs = subFoldersByParent[root.id] || [];
                    return (
                      <div key={root.id}>
                        <SelectItem value={root.id}>
                          <span className="flex items-center gap-2">
                            <span className={cn("h-2 w-2 rounded-full", root.color)} />
                            {root.name}
                          </span>
                        </SelectItem>
                        {subs.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id}>
                            <span className="flex items-center gap-2 pl-3">
                              <span className={cn("h-2 w-2 rounded-full", sub.color)} />
                              <span className="text-muted-foreground">↳</span>
                              {sub.name}
                            </span>
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1"
              onClick={handleSaveReply}
              disabled={!formTitle.trim() || !formMessage.trim()}
            >
              <Check className="h-3 w-3" />
              {editingReplyId ? "Atualizar" : "Salvar"}
            </Button>
          </div>
        )}

        {/* ===== VIEW: FOLDERS LIST ===== */}
        {view === "folders" && (
          <>
            <div className="px-3 py-2 border-b">
              <Button
                size="sm"
                className="w-full h-8 text-xs gap-1"
                onClick={openAddFolder}
              >
                <FolderPlus className="h-3 w-3" />
                Nova pasta
              </Button>
            </div>
            <ScrollArea className="h-[300px]">
              {folders.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Nenhuma pasta criada.
                </div>
              ) : (
                <div className="p-1">
                  {rootFolders.map((root) => {
                    const subs = subFoldersByParent[root.id] || [];
                    return (
                      <div key={root.id}>
                        <FolderRow
                          folder={root}
                          count={folderCounts.total[root.id] || 0}
                          onEdit={startEditFolder}
                          onDelete={handleDeleteFolder}
                        />
                        {subs.map((sub) => (
                          <div key={sub.id} className="pl-5">
                            <FolderRow
                              folder={sub}
                              count={folderCounts.direct[sub.id] || 0}
                              onEdit={startEditFolder}
                              onDelete={handleDeleteFolder}
                              isSub
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </>
        )}

        {/* ===== VIEW: ADD/EDIT FOLDER ===== */}
        {view === "addFolder" && (
          <div className="p-3 space-y-3">
            <Input
              placeholder="Nome da pasta (ex: Vendas)"
              value={formFolderName}
              onChange={(e) => setFormFolderName(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Pasta pai (opcional)</label>
              <Select value={formFolderParentId} onValueChange={setFormFolderParentId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT_VALUE}>Pasta raiz (sem pai)</SelectItem>
                  {rootFolders
                    .filter((f) => f.id !== editingFolderId)
                    .map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", f.color)} />
                          {f.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Apenas 1 nível de aninhamento é permitido.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Cor</label>
              <div className="grid grid-cols-9 gap-1.5">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFormFolderColor(c.value)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-all flex items-center justify-center",
                      c.dot,
                      formFolderColor === c.value
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105"
                    )}
                    title={c.label}
                  >
                    {formFolderColor === c.value && <Check className="h-3 w-3 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1"
              onClick={handleSaveFolder}
              disabled={!formFolderName.trim()}
            >
              <Check className="h-3 w-3" />
              {editingFolderId ? "Atualizar pasta" : "Criar pasta"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface FolderRowProps {
  folder: QuickReplyFolder;
  count: number;
  onEdit: (folder: QuickReplyFolder) => void;
  onDelete: (id: string) => void;
  isSub?: boolean;
}

function FolderRow({ folder, count, onEdit, onDelete, isSub }: FolderRowProps) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent">
      {isSub && <span className="text-muted-foreground text-[10px]">↳</span>}
      <span className={cn("h-3 w-3 rounded-full shrink-0", folder.color)} />
      <span className="flex-1 text-xs font-medium truncate">{folder.name}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {count} msg
      </span>
      <div className="hidden group-hover:flex gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onEdit(folder)}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive"
          onClick={() => onDelete(folder.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
