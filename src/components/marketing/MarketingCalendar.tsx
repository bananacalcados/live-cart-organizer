import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Save,
  FileText, Loader2, Target, Calendar as CalendarIcon, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RichTextEditor, RichTextPreview } from "./RichTextEditor";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const ENTRY_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"
];

interface CalendarEntry {
  id: string;
  entry_date: string;
  title: string;
  content: string;
  entry_type: string;
  media_url: string | null;
  media_type: string | null;
  color: string;
}

interface MonthGoal {
  id: string;
  year: number;
  month: number;
  goals: any[];
  actions: string;
  notes: string;
}

export function MarketingCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [monthGoal, setMonthGoal] = useState<MonthGoal | null>(null);
  const [loading, setLoading] = useState(false);

  // Dialog states
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<CalendarEntry | null>(null);

  // Entry form
  const [entryTitle, setEntryTitle] = useState("");
  const [entryContent, setEntryContent] = useState("");
  const [entryType, setEntryType] = useState("text");
  const [entryColor, setEntryColor] = useState("#3b82f6");
  const [entryMediaUrl, setEntryMediaUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Month notes (inline, below calendar)
  const [monthNotes, setMonthNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Goal form
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalActions, setGoalActions] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [goalsList, setGoalsList] = useState<string[]>([]);
  const [newGoal, setNewGoal] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endDay = new Date(year, month + 1, 0).getDate();
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

      const [entriesRes, goalsRes] = await Promise.all([
        supabase.from('marketing_calendar_entries')
          .select('*')
          .gte('entry_date', startDate)
          .lte('entry_date', endDate)
          .order('created_at', { ascending: true }),
        supabase.from('marketing_calendar_goals')
          .select('*')
          .eq('year', year)
          .eq('month', month + 1)
          .maybeSingle()
      ]);

      if (entriesRes.error) throw entriesRes.error;
      setEntries(entriesRes.data || []);

      if (goalsRes.data) {
        setMonthGoal(goalsRes.data as MonthGoal);
        const goals = Array.isArray(goalsRes.data.goals) ? goalsRes.data.goals : [];
        setGoalsList(goals.map((g: any) => typeof g === 'string' ? g : g.text || ''));
        setGoalActions(goalsRes.data.actions || '');
        setGoalNotes(goalsRes.data.notes || '');
        setMonthNotes(goalsRes.data.notes || '');
      } else {
        setMonthGoal(null);
        setGoalsList([]);
        setGoalActions('');
        setGoalNotes('');
        setMonthNotes('');
      }
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar calendário");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calendar grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const getEntriesForDay = (day: number) => entries.filter(e => e.entry_date === getDateStr(day));

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const today = new Date();
  const isToday = (day: number) => day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // Day detail
  const openDayDetail = (date: string) => {
    setSelectedDate(date);
    setDayDetailOpen(true);
  };

  const selectedDateEntries = selectedDate ? entries.filter(e => e.entry_date === selectedDate) : [];

  // Entry CRUD
  const openNewEntry = (date: string) => {
    setSelectedDate(date);
    setEditingEntry(null);
    setEntryTitle("");
    setEntryContent("");
    setEntryType("text");
    setEntryColor("#3b82f6");
    setEntryMediaUrl("");
    setEntryDialogOpen(true);
  };

  const openEditEntry = (entry: CalendarEntry) => {
    setSelectedDate(entry.entry_date);
    setEditingEntry(entry);
    setEntryTitle(entry.title);
    setEntryContent(entry.content);
    setEntryType(entry.entry_type);
    setEntryColor(entry.color);
    setEntryMediaUrl(entry.media_url || "");
    setEntryDialogOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("Máximo 16MB"); return; }
    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `calendar/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { error } = await supabase.storage.from('marketing-attachments').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
      setEntryMediaUrl(data.publicUrl);
      if (file.type.startsWith('image/')) setEntryType('image');
      else if (file.type.startsWith('audio/')) setEntryType('audio');
      else if (file.type.startsWith('video/')) setEntryType('video');
      else setEntryType('document');
      toast.success("Arquivo enviado!");
    } catch { toast.error("Erro no upload"); }
    finally { setIsUploading(false); e.target.value = ''; }
  };

  const saveEntry = async () => {
    if (!entryTitle.trim() && !entryContent.trim() && !entryMediaUrl) {
      toast.error("Preencha pelo menos o título ou conteúdo"); return;
    }
    try {
      const payload = {
        entry_date: selectedDate!,
        title: entryTitle,
        content: entryContent,
        entry_type: entryType,
        media_url: entryMediaUrl || null,
        media_type: entryType !== 'text' ? entryType : null,
        color: entryColor,
      };
      if (editingEntry) {
        const { error } = await supabase.from('marketing_calendar_entries').update(payload).eq('id', editingEntry.id);
        if (error) throw error;
        toast.success("Entrada atualizada");
      } else {
        const { error } = await supabase.from('marketing_calendar_entries').insert(payload);
        if (error) throw error;
        toast.success("Entrada criada");
      }
      setEntryDialogOpen(false);
      fetchData();
    } catch { toast.error("Erro ao salvar"); }
  };

  const deleteEntry = async (id: string) => {
    try {
      const { error } = await supabase.from('marketing_calendar_entries').delete().eq('id', id);
      if (error) throw error;
      toast.success("Entrada removida");
      fetchData();
    } catch { toast.error("Erro ao excluir"); }
  };

  // Toggle task checkbox in entry content
  const toggleEntryTask = async (entry: CalendarEntry, lineIndex: number) => {
    const lines = entry.content.split('\n');
    const line = lines[lineIndex];
    if (line.trimStart().startsWith('[x] ')) {
      lines[lineIndex] = line.replace('[x] ', '[ ] ');
    } else if (line.trimStart().startsWith('[ ] ')) {
      lines[lineIndex] = line.replace('[ ] ', '[x] ');
    }
    const newContent = lines.join('\n');
    try {
      await supabase.from('marketing_calendar_entries').update({ content: newContent }).eq('id', entry.id);
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, content: newContent } : e));
    } catch { /* silent */ }
  };

  // Goals CRUD
  const saveGoals = async () => {
    try {
      const payload = { year, month: month + 1, goals: goalsList, actions: goalActions, notes: goalNotes };
      if (monthGoal) {
        const { error } = await supabase.from('marketing_calendar_goals').update(payload).eq('id', monthGoal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('marketing_calendar_goals').insert(payload);
        if (error) throw error;
      }
      toast.success("Metas salvas!");
      setGoalDialogOpen(false);
      fetchData();
    } catch { toast.error("Erro ao salvar metas"); }
  };

  const addGoal = () => { if (!newGoal.trim()) return; setGoalsList(prev => [...prev, newGoal.trim()]); setNewGoal(""); };
  const removeGoal = (i: number) => setGoalsList(prev => prev.filter((_, idx) => idx !== i));

  // Month notes save (inline below calendar)
  const saveMonthNotes = async () => {
    setIsSavingNotes(true);
    try {
      const payload = { year, month: month + 1, goals: goalsList, actions: goalActions, notes: monthNotes };
      if (monthGoal) {
        const { error } = await supabase.from('marketing_calendar_goals').update({ notes: monthNotes }).eq('id', monthGoal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('marketing_calendar_goals').insert(payload);
        if (error) throw error;
      }
      toast.success("Notas do mês salvas!");
      fetchData();
    } catch { toast.error("Erro ao salvar notas"); }
    finally { setIsSavingNotes(false); }
  };

  // Toggle task in month notes
  const toggleMonthNoteTask = (lineIndex: number) => {
    const lines = monthNotes.split('\n');
    const line = lines[lineIndex];
    if (line.trimStart().startsWith('[x] ')) {
      lines[lineIndex] = line.replace('[x] ', '[ ] ');
    } else if (line.trimStart().startsWith('[ ] ')) {
      lines[lineIndex] = line.replace('[ ] ', '[x] ');
    }
    setMonthNotes(lines.join('\n'));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="text-xl font-bold min-w-[200px] text-center">{MONTHS[month]} {year}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setGoalDialogOpen(true)}>
            <Target className="h-3.5 w-3.5" />Metas do Mês
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Hoje</Button>
        </div>
      </div>

      {/* Monthly Goals Summary */}
      {monthGoal && goalsList.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Metas de {MONTHS[month]}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {goalsList.map((g, i) => <Badge key={i} variant="secondary" className="text-xs">{g}</Badge>)}
            </div>
            {goalActions && <p className="text-xs text-muted-foreground mt-2">📋 {goalActions}</p>}
          </CardContent>
        </Card>
      )}

      {/* Calendar Grid */}
      <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(48 95% 50% / 0.3)' }}>
        <div className="grid grid-cols-7" style={{ background: 'hsl(48 95% 50%)' }}>
          {WEEKDAYS.map(w => (
            <div key={w} className="py-2 text-center text-xs font-semibold border-b" style={{ color: 'hsl(0 0% 5%)', borderColor: 'hsl(48 85% 40% / 0.3)' }}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const dayEntries = day ? getEntriesForDay(day) : [];
            return (
              <div
                key={idx}
                className={`min-h-[100px] border-b border-r p-1 cursor-pointer ${
                  isToday(day || 0) ? 'ring-2 ring-primary ring-inset' : ''
                }`}
                style={{
                  background: day ? 'hsl(48 100% 85%)' : 'hsl(48 50% 92%)',
                  borderColor: 'hsl(48 80% 70% / 0.4)',
                }}
                onClick={() => day && openDayDetail(getDateStr(day))}
              >
                {day && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        isToday(day) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}>{day}</span>
                      {dayEntries.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">{dayEntries.length}</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayEntries.slice(0, 3).map(e => (
                        <div key={e.id}
                          className="text-[10px] leading-tight px-1 py-0.5 rounded truncate"
                          style={{ backgroundColor: e.color + '20', color: e.color, borderLeft: `2px solid ${e.color}` }}>
                          {e.entry_type !== 'text' && (
                            <span className="mr-0.5">
                              {e.entry_type === 'image' ? '📷' : e.entry_type === 'audio' ? '🎵' : e.entry_type === 'video' ? '🎥' : '📎'}
                            </span>
                          )}
                          {e.title || e.content?.substring(0, 20) || 'Sem título'}
                        </div>
                      ))}
                      {dayEntries.length > 3 && (
                        <span className="text-[10px] text-muted-foreground px-1">+{dayEntries.length - 3} mais</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline Month Notes (below calendar) */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              📋 Informações Gerais — {MONTHS[month]} {year}
            </h3>
            <Button size="sm" variant="outline" className="gap-1" onClick={saveMonthNotes} disabled={isSavingNotes}>
              {isSavingNotes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar
            </Button>
          </div>
          <RichTextEditor
            value={monthNotes}
            onChange={setMonthNotes}
            placeholder="Escreva informações gerais do mês, tarefas, planejamento..."
            minRows={6}
          />
          {monthNotes && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-1">Pré-visualização:</p>
              <RichTextPreview content={monthNotes} onToggleTask={(i) => { toggleMonthNoteTask(i); }} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Day Detail Dialog */}
      <Dialog open={dayDetailOpen} onOpenChange={setDayDetailOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{selectedDate && new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <Button size="sm" className="gap-1" onClick={() => { setDayDetailOpen(false); openNewEntry(selectedDate!); }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </DialogTitle>
          </DialogHeader>
          {selectedDateEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhuma entrada neste dia</p>
              <Button size="sm" className="mt-3 gap-1" onClick={() => { setDayDetailOpen(false); openNewEntry(selectedDate!); }}>
                <Plus className="h-3.5 w-3.5" /> Criar primeira entrada
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedDateEntries.map(entry => (
                <Card key={entry.id} className="overflow-hidden" style={{ borderLeftColor: entry.color, borderLeftWidth: '3px' }}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {entry.title && <h4 className="font-semibold text-sm">{entry.title}</h4>}
                        {entry.entry_type !== 'text' && (
                          <Badge variant="outline" className="text-[10px] mb-1">
                            {entry.entry_type === 'image' ? '📷 Imagem' : entry.entry_type === 'audio' ? '🎵 Áudio' : entry.entry_type === 'video' ? '🎥 Vídeo' : '📎 Documento'}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDayDetailOpen(false); openEditEntry(entry); }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteEntry(entry.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {entry.content && (
                      <RichTextPreview content={entry.content} onToggleTask={(lineIdx) => toggleEntryTask(entry, lineIdx)} />
                    )}
                    {entry.media_url && (
                      <div className="mt-2">
                        {entry.entry_type === 'image' ? (
                          <img src={entry.media_url} alt="" className="max-h-40 rounded object-cover" />
                        ) : entry.entry_type === 'audio' ? (
                          <audio src={entry.media_url} controls className="w-full" />
                        ) : entry.entry_type === 'video' ? (
                          <video src={entry.media_url} controls className="max-h-40 rounded" />
                        ) : (
                          <a href={entry.media_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline flex items-center gap-1">
                            <FileText className="h-4 w-4" /> Ver documento
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              <Button variant="outline" className="w-full gap-1" onClick={() => { setDayDetailOpen(false); openNewEntry(selectedDate!); }}>
                <Plus className="h-3.5 w-3.5" /> Adicionar mais uma entrada
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Entry Create/Edit Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? 'Editar Entrada' : 'Nova Entrada'} — {selectedDate && new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Título" value={entryTitle} onChange={e => setEntryTitle(e.target.value)} />

            {/* Rich text content */}
            <div>
              <label className="text-sm font-medium mb-1 block">Conteúdo</label>
              <RichTextEditor
                value={entryContent}
                onChange={setEntryContent}
                placeholder="Descreva a ação, tarefa ou evento..."
                minRows={4}
              />
            </div>

            {/* Media upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Anexo (foto, áudio, vídeo, documento)</label>
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={handleFileUpload} />
                <Button type="button" variant="outline" size="sm" className="gap-1"
                  onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Upload Arquivo
                </Button>
                {entryMediaUrl && (
                  <Button variant="ghost" size="sm" onClick={() => { setEntryMediaUrl(""); setEntryType("text"); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {entryMediaUrl && (
                <div className="border rounded-lg p-2">
                  {entryType === 'image' ? (
                    <img src={entryMediaUrl} alt="Preview" className="max-h-32 rounded object-cover" />
                  ) : entryType === 'audio' ? (
                    <audio src={entryMediaUrl} controls className="w-full" />
                  ) : entryType === 'video' ? (
                    <video src={entryMediaUrl} controls className="max-h-32 rounded" />
                  ) : (
                    <a href={entryMediaUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline flex items-center gap-1">
                      <FileText className="h-4 w-4" /> Ver documento
                    </a>
                  )}
                </div>
              )}
              {!entryMediaUrl && (
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-muted-foreground">ou</span>
                  <Input placeholder="Cole a URL da mídia" value={entryMediaUrl} onChange={e => setEntryMediaUrl(e.target.value)} className="h-8 text-xs" />
                </div>
              )}
            </div>

            {/* Color picker */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Cor</label>
              <div className="flex gap-2">
                {ENTRY_COLORS.map(c => (
                  <button key={c}
                    className={`h-6 w-6 rounded-full border-2 transition-transform ${entryColor === c ? 'border-foreground scale-125' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setEntryColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-between">
              {editingEntry && (
                <Button variant="destructive" size="sm" onClick={() => { deleteEntry(editingEntry.id); setEntryDialogOpen(false); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setEntryDialogOpen(false)}>Cancelar</Button>
                <Button onClick={saveEntry} className="gap-1"><Save className="h-3.5 w-3.5" />Salvar</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Goals Dialog */}
      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Metas de {MONTHS[month]} {year}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Metas</label>
                <div className="flex gap-2">
                  <Input placeholder="Adicionar meta..." value={newGoal} onChange={e => setNewGoal(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGoal()} />
                  <Button size="sm" onClick={addGoal}><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1">
                  {goalsList.map((g, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1">
                      <Target className="h-3 w-3 text-primary shrink-0" />
                      <span className="text-sm flex-1">{g}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeGoal(i)}><X className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Ações planejadas</label>
                <RichTextEditor value={goalActions} onChange={setGoalActions} placeholder="Descreva as ações do mês..." minRows={3} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setGoalDialogOpen(false)}>Cancelar</Button>
                <Button onClick={saveGoals} className="gap-1"><Save className="h-3.5 w-3.5" />Salvar Metas</Button>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
