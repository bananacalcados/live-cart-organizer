import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Save,
  FileText, Loader2, Target, Calendar as CalendarIcon, Eye, Calculator,
  ShieldAlert, Edit3, Repeat, RotateCcw
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
import { Checkbox } from "@/components/ui/checkbox";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const ENTRY_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"
];

interface CalendarEntry {
  id: string;
  entry_date: string;
  end_date: string | null;
  title: string;
  content: string;
  entry_type: string;
  media_url: string | null;
  media_type: string | null;
  color: string;
}

interface RecurringAction {
  id: string;
  title: string;
  content: string;
  color: string;
  recurrence_type: string;
  recurrence_config: any;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
}

interface MonthGoal {
  id: string;
  year: number;
  month: number;
  goals: any[];
  actions: string;
  notes: string;
}

// Helper: check if a recurring action falls on a given date
function recurringMatchesDate(action: RecurringAction, dateStr: string): boolean {
  const date = new Date(dateStr + 'T12:00:00');
  const startDate = new Date(action.start_date + 'T12:00:00');
  if (date < startDate) return false;
  if (action.end_date) {
    const endDate = new Date(action.end_date + 'T12:00:00');
    if (date > endDate) return false;
  }

  const config = action.recurrence_config || {};
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  const monthOfYear = date.getMonth() + 1;

  switch (action.recurrence_type) {
    case 'daily':
      return true;
    case 'weekly':
      return dayOfWeek === (config.day_of_week ?? 0);
    case 'biweekly': {
      if (dayOfWeek !== (config.day_of_week ?? 0)) return false;
      const diffMs = date.getTime() - startDate.getTime();
      const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      return diffWeeks % 2 === 0;
    }
    case 'monthly':
      return dayOfMonth === (config.day_of_month ?? 1);
    case 'yearly':
      return monthOfYear === (config.month ?? 1) && dayOfMonth === (config.day ?? 1);
    case 'specific_weekdays':
      return (config.days || []).includes(dayOfWeek);
    default:
      return false;
  }
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  yearly: 'Anual',
  specific_weekdays: 'Dias específicos da semana',
};

export function MarketingCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [monthGoal, setMonthGoal] = useState<MonthGoal | null>(null);
  const [loading, setLoading] = useState(false);

  // Recurring actions
  const [recurringActions, setRecurringActions] = useState<RecurringAction[]>([]);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [recurringListOpen, setRecurringListOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringAction | null>(null);
  const [recTitle, setRecTitle] = useState("");
  const [recContent, setRecContent] = useState("");
  const [recColor, setRecColor] = useState("#8b5cf6");
  const [recType, setRecType] = useState("daily");
  const [recDayOfWeek, setRecDayOfWeek] = useState(1);
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recYearMonth, setRecYearMonth] = useState(1);
  const [recYearDay, setRecYearDay] = useState(1);
  const [recSpecificDays, setRecSpecificDays] = useState<number[]>([]);
  const [recStartDate, setRecStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [recEndDate, setRecEndDate] = useState("");

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

  // Campaign Rules (persistent, stored in app_settings)
  const [campaignRules, setCampaignRules] = useState("");
  const [savedRules, setSavedRules] = useState("");
  const [isEditingRules, setIsEditingRules] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);

  // Calculator
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcDisplay, setCalcDisplay] = useState("0");
  const [calcPrev, setCalcPrev] = useState<number | null>(null);
  const [calcOp, setCalcOp] = useState<string | null>(null);
  const [calcReset, setCalcReset] = useState(false);

  const handleCalcKey = useCallback((key: string) => {
    if (key >= '0' && key <= '9' || key === '.') {
      setCalcDisplay(prev => {
        if (calcReset || prev === '0') { setCalcReset(false); return key === '.' ? '0.' : key; }
        if (key === '.' && prev.includes('.')) return prev;
        return prev + key;
      });
    } else if (['+', '-', '*', '/'].includes(key)) {
      setCalcPrev(parseFloat(calcDisplay));
      setCalcOp(key);
      setCalcReset(true);
    } else if (key === '=' || key === 'Enter') {
      if (calcPrev !== null && calcOp) {
        const cur = parseFloat(calcDisplay);
        let result = 0;
        if (calcOp === '+') result = calcPrev + cur;
        else if (calcOp === '-') result = calcPrev - cur;
        else if (calcOp === '*') result = calcPrev * cur;
        else if (calcOp === '/') result = cur !== 0 ? calcPrev / cur : 0;
        setCalcDisplay(String(parseFloat(result.toFixed(8))));
        setCalcPrev(null);
        setCalcOp(null);
        setCalcReset(true);
      }
    } else if (key === 'C') {
      setCalcDisplay('0'); setCalcPrev(null); setCalcOp(null); setCalcReset(false);
    } else if (key === '⌫' || key === 'Backspace') {
      setCalcDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
    }
  }, [calcDisplay, calcPrev, calcOp, calcReset]);

  useEffect(() => {
    if (!calcOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9' || e.key === '.') handleCalcKey(e.key);
      else if (['+', '-', '*', '/'].includes(e.key)) handleCalcKey(e.key);
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); handleCalcKey('='); }
      else if (e.key === 'Backspace') handleCalcKey('Backspace');
      else if (e.key === 'Escape') handleCalcKey('C');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [calcOpen, handleCalcKey]);

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

      const [entriesRes, goalsRes, recurringRes] = await Promise.all([
        supabase.from('marketing_calendar_entries')
          .select('*')
          .gte('entry_date', startDate)
          .lte('entry_date', endDate)
          .order('created_at', { ascending: true }),
        supabase.from('marketing_calendar_goals')
          .select('*')
          .eq('year', year)
          .eq('month', month + 1)
          .maybeSingle(),
        supabase.from('marketing_recurring_actions')
          .select('*')
          .eq('is_active', true)
          .lte('start_date', endDate)
          .order('created_at', { ascending: true })
      ]);

      if (entriesRes.error) throw entriesRes.error;
      setEntries(entriesRes.data || []);

      if (recurringRes.data) {
        // Filter out actions that ended before this month
        const filtered = (recurringRes.data as RecurringAction[]).filter(a => !a.end_date || a.end_date >= startDate);
        setRecurringActions(filtered);
      } else {
        setRecurringActions([]);
      }

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

  // Campaign Rules - persistent across months
  const fetchRules = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'campaign_rules')
        .maybeSingle();
      if (data?.value) {
        const val = typeof data.value === 'string' ? data.value : (data.value as any)?.content || '';
        setCampaignRules(val);
        setSavedRules(val);
      }
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const saveRules = async () => {
    setIsSavingRules(true);
    try {
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'campaign_rules')
        .maybeSingle();
      
      if (existing) {
        const { error } = await supabase
          .from('app_settings')
          .update({ value: { content: campaignRules } as any })
          .eq('key', 'campaign_rules');
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('app_settings')
          .insert({ key: 'campaign_rules', value: { content: campaignRules } as any });
        if (error) throw error;
      }
      setSavedRules(campaignRules);
      setIsEditingRules(false);
      toast.success("Regras salvas!");
    } catch { toast.error("Erro ao salvar regras"); }
    finally { setIsSavingRules(false); }
  };

  // Calendar grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const getEntriesForDay = (day: number) => entries.filter(e => e.entry_date === getDateStr(day));
  
  // Get recurring actions for a specific day
  const getRecurringForDay = (day: number) => {
    const dateStr = getDateStr(day);
    return recurringActions.filter(a => recurringMatchesDate(a, dateStr));
  };

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
  const selectedDateRecurring = selectedDate ? recurringActions.filter(a => recurringMatchesDate(a, selectedDate)) : [];

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

  // ========== Recurring Actions CRUD ==========
  const openNewRecurring = () => {
    setEditingRecurring(null);
    setRecTitle("");
    setRecContent("");
    setRecColor("#8b5cf6");
    setRecType("daily");
    setRecDayOfWeek(1);
    setRecDayOfMonth(1);
    setRecYearMonth(1);
    setRecYearDay(1);
    setRecSpecificDays([]);
    setRecStartDate(new Date().toISOString().split('T')[0]);
    setRecEndDate("");
    setRecurringDialogOpen(true);
  };

  const openEditRecurring = (action: RecurringAction) => {
    setEditingRecurring(action);
    setRecTitle(action.title);
    setRecContent(action.content || "");
    setRecColor(action.color);
    setRecType(action.recurrence_type);
    const cfg = action.recurrence_config || {};
    setRecDayOfWeek(cfg.day_of_week ?? 1);
    setRecDayOfMonth(cfg.day_of_month ?? 1);
    setRecYearMonth(cfg.month ?? 1);
    setRecYearDay(cfg.day ?? 1);
    setRecSpecificDays(cfg.days || []);
    setRecStartDate(action.start_date);
    setRecEndDate(action.end_date || "");
    setRecurringDialogOpen(true);
  };

  const buildRecurrenceConfig = () => {
    switch (recType) {
      case 'daily': return {};
      case 'weekly': return { day_of_week: recDayOfWeek };
      case 'biweekly': return { day_of_week: recDayOfWeek, start_date: recStartDate };
      case 'monthly': return { day_of_month: recDayOfMonth };
      case 'yearly': return { month: recYearMonth, day: recYearDay };
      case 'specific_weekdays': return { days: recSpecificDays };
      default: return {};
    }
  };

  const saveRecurring = async () => {
    if (!recTitle.trim()) { toast.error("Preencha o título"); return; }
    try {
      const payload = {
        title: recTitle,
        content: recContent,
        color: recColor,
        recurrence_type: recType,
        recurrence_config: buildRecurrenceConfig(),
        start_date: recStartDate,
        end_date: recEndDate || null,
        is_active: true,
      };
      if (editingRecurring) {
        const { error } = await supabase.from('marketing_recurring_actions').update(payload).eq('id', editingRecurring.id);
        if (error) throw error;
        toast.success("Ação recorrente atualizada!");
      } else {
        const { error } = await supabase.from('marketing_recurring_actions').insert(payload);
        if (error) throw error;
        toast.success("Ação recorrente criada!");
      }
      setRecurringDialogOpen(false);
      fetchData();
    } catch { toast.error("Erro ao salvar ação recorrente"); }
  };

  const deleteRecurring = async (id: string) => {
    try {
      const { error } = await supabase.from('marketing_recurring_actions').delete().eq('id', id);
      if (error) throw error;
      toast.success("Ação recorrente removida!");
      fetchData();
    } catch { toast.error("Erro ao remover"); }
  };

  const toggleSpecificDay = (day: number) => {
    setRecSpecificDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth} className="border-white/20 text-white hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="text-xl font-bold min-w-[200px] text-center text-white">{MONTHS[month]} {year}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth} className="border-white/20 text-white hover:bg-white/10"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1 border-white/20 text-white hover:bg-white/10" onClick={() => setCalcOpen(!calcOpen)}>
            <Calculator className="h-3.5 w-3.5" />Calculadora
          </Button>
          <Button variant="outline" size="sm" className="gap-1 border-purple-400/40 text-purple-300 hover:bg-purple-500/10" onClick={() => setRecurringListOpen(true)}>
            <Repeat className="h-3.5 w-3.5" />Ações Recorrentes
          </Button>
          <Button variant="outline" size="sm" className="gap-1 border-white/20 text-white hover:bg-white/10" onClick={() => setGoalDialogOpen(true)}>
            <Target className="h-3.5 w-3.5" />Metas do Mês
          </Button>
          <Button variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10" onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}>Hoje</Button>
        </div>
      </div>

      {/* Calculator Widget */}
      {calcOpen && (
        <Card className="bg-card border-white/10 max-w-xs">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold flex items-center gap-1"><Calculator className="h-3.5 w-3.5" /> Calculadora</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setCalcOpen(false)}><X className="h-3 w-3" /></Button>
            </div>
            <div className="bg-black/30 rounded px-3 py-2 text-right text-lg font-mono text-white min-h-[36px]">
              {calcOp && <span className="text-xs text-muted-foreground mr-2">{calcPrev} {calcOp}</span>}
              {calcDisplay}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {['C', '⌫', '/', '*', '7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.'].map((k) => (
                <Button
                  key={k}
                  variant={['/', '*', '-', '+', '='].includes(k) ? 'default' : 'outline'}
                  size="sm"
                  className={`text-sm font-medium ${k === '0' ? 'col-span-2' : k === '=' ? 'row-span-2' : ''}`}
                  onClick={() => handleCalcKey(k)}
                >
                  {k}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground text-center">Use o teclado para digitar</p>
          </CardContent>
        </Card>
      )}

      {/* Campaign Rules - Persistent */}
      {savedRules && !isEditingRules && (
        <Card className="border-2 border-red-500/40 bg-red-500/10 shadow-lg shadow-red-500/5">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-500" />
                <h3 className="font-bold text-sm text-red-500 uppercase tracking-wide">⚠️ Regras Obrigatórias de Campanha</h3>
              </div>
              <Button size="sm" variant="ghost" className="gap-1 text-xs h-7" onClick={() => setIsEditingRules(true)}>
                <Edit3 className="h-3 w-3" />Editar
              </Button>
            </div>
            <RichTextPreview content={savedRules} />
          </CardContent>
        </Card>
      )}

      {isEditingRules && (
        <Card className="border-red-500/30 bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-semibold">Regras Obrigatórias de Campanha</h3>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setCampaignRules(savedRules); setIsEditingRules(false); }}>
                  Cancelar
                </Button>
                <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={saveRules} disabled={isSavingRules}>
                  {isSavingRules ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Salvar Regras
                </Button>
              </div>
            </div>
            <RichTextEditor
              value={campaignRules}
              onChange={setCampaignRules}
              placeholder="Escreva aqui as regras obrigatórias que devem ser seguidas em TODAS as campanhas, independente do mês..."
              minRows={5}
            />
          </CardContent>
        </Card>
      )}

      {!savedRules && !isEditingRules && (
        <Button variant="outline" size="sm" className="gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => setIsEditingRules(true)}>
          <ShieldAlert className="h-3.5 w-3.5" />Definir Regras Obrigatórias de Campanha
        </Button>
      )}

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
            const dayRecurring = day ? getRecurringForDay(day) : [];
            const allItems = [...dayEntries.map(e => ({ type: 'entry' as const, ...e })), ...dayRecurring.map(r => ({ type: 'recurring' as const, ...r }))];
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
                        isToday(day) ? 'bg-primary text-primary-foreground' : ''
                      }`} style={{ color: isToday(day) ? undefined : 'hsl(0 0% 15%)' }}>{day}</span>
                      {allItems.length > 0 && (
                        <span className="text-[10px]" style={{ color: 'hsl(0 0% 35%)' }}>{allItems.length}</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {allItems.slice(0, 3).map((item, i) => (
                        <div key={item.id + '-' + i}
                          className="text-[10px] leading-tight px-1 py-0.5 rounded truncate flex items-center gap-0.5"
                          style={{ backgroundColor: item.color + '20', color: item.color, borderLeft: `2px solid ${item.color}` }}>
                          {item.type === 'recurring' && <RotateCcw className="h-2 w-2 shrink-0" />}
                          {item.type === 'entry' && (item as any).entry_type !== 'text' && (
                            <span className="mr-0.5">
                              {(item as any).entry_type === 'image' ? '📷' : (item as any).entry_type === 'audio' ? '🎵' : (item as any).entry_type === 'video' ? '🎥' : '📎'}
                            </span>
                          )}
                          {item.title || (item as any).content?.substring(0, 20) || 'Sem título'}
                        </div>
                      ))}
                      {allItems.length > 3 && (
                        <span className="text-[10px] text-muted-foreground px-1">+{allItems.length - 3} mais</span>
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
      <Card className="bg-card border-white/10">
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

          {/* Recurring actions for this day */}
          {selectedDateRecurring.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-purple-400 flex items-center gap-1"><Repeat className="h-3 w-3" /> Ações Recorrentes</p>
              {selectedDateRecurring.map(action => (
                <Card key={action.id} className="overflow-hidden border-purple-500/20" style={{ borderLeftColor: action.color, borderLeftWidth: '3px' }}>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" style={{ color: action.color }} />
                      <span className="font-semibold text-sm flex-1">{action.title}</span>
                      <Badge variant="outline" className="text-[10px]">{RECURRENCE_LABELS[action.recurrence_type]}</Badge>
                    </div>
                    {action.content && (
                      <div className="mt-1">
                        <RichTextPreview content={action.content} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {selectedDateEntries.length === 0 && selectedDateRecurring.length === 0 ? (
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

      {/* Recurring Actions List Dialog */}
      <Dialog open={recurringListOpen} onOpenChange={setRecurringListOpen}>
        <DialogContent className="max-w-lg max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Repeat className="h-4 w-4" /> Ações Recorrentes</span>
              <Button size="sm" className="gap-1" onClick={() => { setRecurringListOpen(false); openNewRecurring(); }}>
                <Plus className="h-3.5 w-3.5" /> Nova
              </Button>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {recurringActions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Repeat className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhuma ação recorrente criada</p>
                <p className="text-xs mt-1">Crie ações que se repetem automaticamente no calendário</p>
                <Button size="sm" className="mt-3 gap-1" onClick={() => { setRecurringListOpen(false); openNewRecurring(); }}>
                  <Plus className="h-3.5 w-3.5" /> Criar primeira ação
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pr-2">
                {recurringActions.map(action => (
                  <Card key={action.id} className="overflow-hidden" style={{ borderLeftColor: action.color, borderLeftWidth: '3px' }}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm flex items-center gap-1.5">
                            <RotateCcw className="h-3 w-3 shrink-0" style={{ color: action.color }} />
                            {action.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px]">{RECURRENCE_LABELS[action.recurrence_type]}</Badge>
                            <span className="text-[10px] text-muted-foreground">
                              A partir de {new Date(action.start_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                              {action.end_date && ` até ${new Date(action.end_date + 'T12:00:00').toLocaleDateString('pt-BR')}`}
                            </span>
                          </div>
                          {action.content && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{action.content.replace(/\*\*/g, '').substring(0, 80)}</p>}
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setRecurringListOpen(false); openEditRecurring(action); }}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteRecurring(action.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Recurring Action Create/Edit Dialog */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Repeat className="h-4 w-4" />
              {editingRecurring ? 'Editar Ação Recorrente' : 'Nova Ação Recorrente'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Título da ação" value={recTitle} onChange={e => setRecTitle(e.target.value)} />

            <div>
              <label className="text-sm font-medium mb-1 block">Descrição / Conteúdo</label>
              <RichTextEditor
                value={recContent}
                onChange={setRecContent}
                placeholder="Descreva a ação recorrente..."
                minRows={3}
              />
            </div>

            {/* Recurrence Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequência</label>
              <Select value={recType} onValueChange={setRecType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Diária</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="biweekly">Quinzenal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="yearly">Anual</SelectItem>
                  <SelectItem value="specific_weekdays">Dias específicos da semana</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Recurrence config */}
            {(recType === 'weekly' || recType === 'biweekly') && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Dia da semana</label>
                <Select value={String(recDayOfWeek)} onValueChange={v => setRecDayOfWeek(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAY_NAMES.map((name, i) => (
                      <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {recType === 'monthly' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Dia do mês</label>
                <Select value={String(recDayOfMonth)} onValueChange={v => setRecDayOfMonth(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>Dia {i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {recType === 'yearly' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Mês</label>
                  <Select value={String(recYearMonth)} onValueChange={v => setRecYearMonth(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((name, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Dia</label>
                  <Select value={String(recYearDay)} onValueChange={v => setRecYearDay(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>Dia {i + 1}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {recType === 'specific_weekdays' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Selecione os dias</label>
                <div className="grid grid-cols-4 gap-2">
                  {WEEKDAY_NAMES.map((name, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={recSpecificDays.includes(i)}
                        onCheckedChange={() => toggleSpecificDay(i)}
                      />
                      {name.substring(0, 3)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Data início</label>
                <Input type="date" value={recStartDate} onChange={e => setRecStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Data fim (opcional)</label>
                <Input type="date" value={recEndDate} onChange={e => setRecEndDate(e.target.value)} />
              </div>
            </div>

            {/* Color */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Cor</label>
              <div className="flex gap-2">
                {ENTRY_COLORS.map(c => (
                  <button key={c}
                    className={`h-6 w-6 rounded-full border-2 transition-transform ${recColor === c ? 'border-foreground scale-125' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setRecColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-between">
              {editingRecurring && (
                <Button variant="destructive" size="sm" onClick={() => { deleteRecurring(editingRecurring.id); setRecurringDialogOpen(false); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Excluir
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setRecurringDialogOpen(false)}>Cancelar</Button>
                <Button onClick={saveRecurring} className="gap-1"><Save className="h-3.5 w-3.5" />Salvar</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
