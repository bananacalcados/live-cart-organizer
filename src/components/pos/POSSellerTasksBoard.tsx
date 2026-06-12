import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, CalendarDays, ClipboardList, MessageCircle, CheckCircle2,
  ShieldCheck, Sparkles, Target, Phone, Users, CalendarClock, Clock,
} from "lucide-react";
import { usePosTasksByDate, type TaskInstanceRow } from "@/hooks/usePosTasksByDate";
import { POSTaskMessageDialog } from "./POSTaskMessageDialog";
import {
  todaySaoPaulo, shiftDate, projectMonth, projectTasks, colorForDefinition,
  isContactCategory, type TaskDefinitionLite, type SellerLite,
} from "@/lib/sellerTasks/recurrence";

interface Props {
  storeId: string;
}

const WEEK_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];
const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Todo dia",
  weekdays: "Dias úteis",
  weekly: "Semanal",
  weekly_specific: "Semana do mês",
  monthly: "Dia do mês",
  monthly_specific: "Mês específico",
  custom_range: "Período",
  once: "Única",
};

function fmtDateBR(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00-03:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function fmtDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00-03:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "long" });
}

export function POSSellerTasksBoard({ storeId }: Props) {
  const today = todaySaoPaulo();
  const [sellers, setSellers] = useState<SellerLite[]>([]);
  const [defs, setDefs] = useState<TaskDefinitionLite[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [compose, setCompose] = useState<{ phone: string; name?: string; contactId: string; sellerName: string } | null>(null);
  const [dayModal, setDayModal] = useState<{ date: string; seller: SellerLite } | null>(null);

  // Mês dos mini-calendários
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-based

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const [s, d] = await Promise.all([
        supabase.from("pos_sellers").select("id, name, is_manager").eq("store_id", storeId).eq("is_active", true).order("name"),
        supabase.from("pos_task_definitions" as any).select("*").eq("store_id", storeId).eq("is_active", true),
      ]);
      setSellers((s.data as any[]) || []);
      setDefs(((d.data as any[]) || []) as TaskDefinitionLite[]);
    })();
  }, [storeId]);

  const { instances, loading, completeManual, uncomplete, markContacted } = usePosTasksByDate(storeId, selectedDate);

  const instancesBySeller = useMemo(() => {
    const map: Record<string, TaskInstanceRow[]> = {};
    for (const i of instances) (map[i.seller_id] ||= []).push(i);
    return map;
  }, [instances]);

  const isFuture = selectedDate > today;

  const monthLabel = new Date(calYear, calMonth, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const shiftMonth = (delta: number) => {
    let m = calMonth + delta;
    let y = calYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCalMonth(m); setCalYear(y);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header + navegação de data */}
      <div className="p-3 border-b flex items-center justify-between flex-shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold">Tarefas das Vendedoras</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate((d) => shiftDate(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center min-w-[112px]">
            <p className="text-xs font-semibold capitalize leading-tight">{fmtDateLong(selectedDate)}</p>
            <p className="text-[10px] text-muted-foreground">
              {selectedDate === today ? "Hoje" : isFuture ? "Tarefa futura" : "Dia passado"}
            </p>
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setSelectedDate((d) => shiftDate(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {selectedDate !== today && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedDate(today)}>Hoje</Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-5">
          {sellers.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" /> Nenhuma vendedora ativa.
            </div>
          ) : (
            <>
              {/* Colunas por vendedora */}
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                {sellers.map((seller) => {
                  const real = instancesBySeller[seller.id] || [];
                  const projected = isFuture ? projectTasks(defs, seller, selectedDate) : [];
                  const count = isFuture ? projected.length : real.length;
                  return (
                    <div key={seller.id} className="flex-shrink-0 w-[260px] snap-start rounded-xl border bg-card">
                      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
                        <p className="text-sm font-bold truncate">{seller.name}</p>
                        <Badge variant="outline" className="text-[10px] flex-shrink-0">{count} tarefa{count !== 1 ? "s" : ""}</Badge>
                      </div>
                      <div className="p-2 space-y-2 min-h-[80px]">
                        {loading && !isFuture ? (
                          <p className="text-xs text-muted-foreground text-center py-4">Carregando…</p>
                        ) : count === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">Sem tarefas.</p>
                        ) : isFuture ? (
                          projected.map((def) => (
                            <ProjectedTaskCard key={def.id} def={def} dueDate={selectedDate} />
                          ))
                        ) : (
                          real.map((inst) => (
                            <RealTaskCard
                              key={inst.id}
                              inst={inst}
                              dueDate={selectedDate}
                              onComplete={() => completeManual(inst.id)}
                              onUncomplete={() => uncomplete(inst.id)}
                              onCompose={(phone, name, contactId) =>
                                setCompose({ phone, name, contactId, sellerName: seller.name })}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mini calendários por vendedora */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-bold capitalize">{monthLabel}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftMonth(-1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => shiftMonth(1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sellers.map((seller) => (
                    <MiniCalendar
                      key={seller.id}
                      seller={seller}
                      defs={defs}
                      year={calYear}
                      month0={calMonth}
                      today={today}
                      onPickDay={(date) => setDayModal({ date, seller })}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {compose && (
        <POSTaskMessageDialog
          open={!!compose}
          onClose={() => setCompose(null)}
          phone={compose.phone}
          name={compose.name}
          sellerName={compose.sellerName}
          onSent={() => { if (compose.contactId) markContacted(compose.contactId); }}
        />
      )}

      {dayModal && (
        <DayTasksModal
          storeId={storeId}
          date={dayModal.date}
          seller={dayModal.seller}
          defs={defs}
          today={today}
          onClose={() => setDayModal(null)}
          onCompose={(phone, name, contactId) =>
            setCompose({ phone, name, contactId, sellerName: dayModal.seller.name })}
        />
      )}
    </div>
  );
}

/* ------------------ Card de tarefa REAL (instância) ------------------ */
function RealTaskCard({
  inst, dueDate, onComplete, onUncomplete, onCompose,
}: {
  inst: TaskInstanceRow;
  dueDate: string;
  onComplete: () => void;
  onUncomplete: () => void;
  onCompose: (phone: string, name: string | undefined, contactId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const done = inst.status === "completed";
  const isAuto = inst.verification_mode === "auto";
  const hasContacts = isContactCategory(inst.category) && inst.contacts.length > 0;
  const contactedCount = inst.contacts.filter((c) => c.contacted).length;

  return (
    <div className={cn(
      "rounded-lg border p-2.5 transition-all",
      done ? "border-green-500/40 bg-green-500/5" : "border-border bg-muted/30",
    )}>
      <div className="flex items-start gap-2">
        {!isAuto ? (
          <Checkbox
            checked={done}
            onCheckedChange={(v) => (v ? onComplete() : onUncomplete())}
            className="mt-0.5 h-4 w-4"
          />
        ) : (
          <div className="mt-0.5">
            {done ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <ShieldCheck className="h-4 w-4 text-primary/70" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-semibold leading-tight", done && "line-through text-muted-foreground")}>
            {inst.title}
          </p>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
              <Clock className="h-2.5 w-2.5" /> {fmtDateBR(dueDate)}
            </Badge>
            {isAuto && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5 border-primary/40 text-primary">
                <Sparkles className="h-2.5 w-2.5" /> Auto
              </Badge>
            )}
            {inst.progress_target > 1 && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
                <Target className="h-2.5 w-2.5" /> {inst.progress_current}/{inst.progress_target}
              </Badge>
            )}
            {inst.points_reward > 0 && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">+{inst.points_reward}pts</Badge>
            )}
          </div>

          {inst.progress_target > 1 && (
            <Progress value={(inst.progress_current / inst.progress_target) * 100} className="h-1 mt-1.5" />
          )}

          {hasContacts && (
            <div className="mt-1.5">
              <button onClick={() => setExpanded((e) => !e)} className="text-[11px] text-primary hover:underline">
                {expanded ? "Ocultar contatos" : `Enviar mensagens (${contactedCount}/${inst.contacts.length})`}
              </button>
              {expanded && (
                <div className="mt-1.5 space-y-1">
                  {inst.contacts.map((c) => (
                    <div key={c.id} className="flex items-center gap-1.5 rounded bg-background border px-2 py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium truncate">{c.customer_name || "Cliente"}</p>
                        <p className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <Phone className="h-2 w-2" /> {c.customer_phone}
                        </p>
                      </div>
                      {c.contacted ? (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/40 text-green-500 gap-0.5">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Falei
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="h-6 bg-[#00a884] hover:bg-[#00916f] text-white text-[10px] gap-1 px-2"
                          onClick={() => c.customer_phone && onCompose(c.customer_phone, c.customer_name || undefined, c.id)}
                        >
                          <MessageCircle className="h-3 w-3" /> Enviar
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------ Card de tarefa PROJETADA (futura) ------------------ */
function ProjectedTaskCard({ def, dueDate }: { def: TaskDefinitionLite; dueDate: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 opacity-90">
      <div className="flex items-start gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-tight">{def.title}</p>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            <Badge variant="outline" className="text-[9px] px-1 py-0 gap-0.5">
              <Clock className="h-2.5 w-2.5" /> {fmtDateBR(dueDate)}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {RECURRENCE_LABELS[def.recurrence] || def.recurrence}
            </Badge>
            {isContactCategory(def.category) && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">Mensagens no dia</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------ Mini calendário por vendedora ------------------ */
function MiniCalendar({
  seller, defs, year, month0, today, onPickDay,
}: {
  seller: SellerLite;
  defs: TaskDefinitionLite[];
  year: number;
  month0: number;
  today: string;
  onPickDay: (date: string) => void;
}) {
  const monthMap = useMemo(() => projectMonth(defs, seller, year, month0), [defs, seller, year, month0]);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const firstWeekday = new Date(year, month0, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="rounded-xl border bg-card p-2.5">
      <p className="text-xs font-bold mb-2 truncate">{seller.name}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK_LABELS.map((w, i) => (
          <span key={i} className="text-[9px] text-muted-foreground font-medium">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />;
          const dateStr = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const tasks = monthMap[dateStr] || [];
          const isToday = dateStr === today;
          return (
            <button
              key={dateStr}
              onClick={() => tasks.length && onPickDay(dateStr)}
              disabled={!tasks.length}
              className={cn(
                "relative h-7 rounded flex flex-col items-center justify-center text-[10px] transition-colors",
                tasks.length ? "hover:bg-muted cursor-pointer font-semibold" : "text-muted-foreground/50",
                isToday && "ring-1 ring-primary",
              )}
            >
              <span>{day}</span>
              {tasks.length > 0 && (
                <span className="flex gap-0.5 mt-0.5">
                  {tasks.slice(0, 3).map((t) => (
                    <span key={t.id} className="h-1 w-1 rounded-full" style={{ backgroundColor: colorForDefinition(t.id) }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------ Modal de tarefas de um dia ------------------ */
function DayTasksModal({
  storeId, date, seller, defs, today, onClose, onCompose,
}: {
  storeId: string;
  date: string;
  seller: SellerLite;
  defs: TaskDefinitionLite[];
  today: string;
  onClose: () => void;
  onCompose: (phone: string, name: string | undefined, contactId: string) => void;
}) {
  const isFuture = date > today;
  const { instances, loading, completeManual, uncomplete } = usePosTasksByDate(storeId, date);
  const sellerInstances = useMemo(
    () => instances.filter((i) => i.seller_id === seller.id),
    [instances, seller.id],
  );
  const projected = useMemo(() => (isFuture ? projectTasks(defs, seller, date) : []), [isFuture, defs, seller, date]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md w-[95vw] max-h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            {seller.name}
          </DialogTitle>
          <p className="text-xs text-muted-foreground capitalize">{fmtDateLong(date)}</p>
        </DialogHeader>
        <ScrollArea className="max-h-[64vh] px-4 py-3">
          <div className="space-y-2">
            {isFuture ? (
              projected.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem tarefas.</p>
              ) : (
                projected.map((def) => <ProjectedTaskCard key={def.id} def={def} dueDate={date} />)
              )
            ) : loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Carregando…</p>
            ) : sellerInstances.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem tarefas.</p>
            ) : (
              sellerInstances.map((inst) => (
                <RealTaskCard
                  key={inst.id}
                  inst={inst}
                  dueDate={date}
                  onComplete={() => completeManual(inst.id)}
                  onUncomplete={() => uncomplete(inst.id)}
                  onCompose={onCompose}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
