import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, ListChecks, CheckCircle2 } from "lucide-react";

export interface ChannelPlan {
  channel_type: string;
  strategy: string;
  tone_of_voice: string;
  key_messages?: string[];
  goals?: string[];
  team_instructions?: string;
  content_plan: Array<{
    day_offset: number;
    title: string;
    description: string;
    content_type: string;
    content_suggestion: string;
    target_segment?: string;
    expected_result?: string;
    send_time?: string;
  }>;
  tasks: Array<{
    title: string;
    description?: string;
    due_day_offset?: number;
    responsible?: string;
  }>;
}

interface Props {
  plan: ChannelPlan;
  onUpdateContentSuggestion?: (index: number, value: string) => void;
}

export function ChannelPlanResult({ plan, onUpdateContentSuggestion }: Props) {
  return (
    <div className="space-y-4">
      {/* Strategy & Tone */}
      <Card>
        <CardContent className="pt-4 pb-4 px-5 space-y-3">
          <p className="text-sm leading-relaxed">{plan.strategy}</p>
          <Badge variant="secondary">🎤 Tom: {plan.tone_of_voice}</Badge>
        </CardContent>
      </Card>

      {/* Goals */}
      {plan.goals && plan.goals.length > 0 && (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="pt-4 pb-4 px-5 space-y-2">
            <h5 className="text-sm font-semibold">🎯 Metas do Canal</h5>
            <ul className="space-y-1">
              {plan.goals.map((g, i) => (
                <li key={i} className="text-sm flex gap-2"><span className="text-emerald-600">✓</span>{g}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Team Instructions */}
      {plan.team_instructions && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 px-5 space-y-2">
            <h5 className="text-sm font-semibold">👥 Instruções para a Equipe</h5>
            <p className="text-sm leading-relaxed whitespace-pre-line">{plan.team_instructions}</p>
          </CardContent>
        </Card>
      )}

      {/* Key Messages */}
      {plan.key_messages && plan.key_messages.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-semibold">💬 Mensagens-Chave / Copies</h5>
          {plan.key_messages.map((msg, i) => (
            <Card key={i}>
              <CardContent className="pt-3 pb-3 px-4">
                <p className="text-sm italic leading-relaxed">"{msg}"</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Content Plan */}
      <div className="space-y-2">
        <h5 className="text-sm font-semibold flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />Cronograma ({plan.content_plan.length} ações)
        </h5>
        {plan.content_plan.map((cp, i) => (
          <Card key={i}>
            <CardContent className="pt-3 pb-3 px-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                  <Badge variant="outline">Dia {cp.day_offset}</Badge>
                  {cp.send_time && <span className="text-xs text-muted-foreground">{cp.send_time}</span>}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{cp.title}</p>
                    <Badge variant="secondary" className="text-xs">{cp.content_type}</Badge>
                    {cp.target_segment && <Badge variant="outline" className="text-xs">🎯 {cp.target_segment}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{cp.description}</p>
                  {cp.content_suggestion && (
                    <div className="bg-muted/50 rounded-md p-3 mt-1">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">📝 Copy / Texto:</p>
                      {onUpdateContentSuggestion ? (
                        <Textarea
                          value={cp.content_suggestion}
                          onChange={e => onUpdateContentSuggestion(i, e.target.value)}
                          rows={4}
                          className="text-sm"
                        />
                      ) : (
                        <p className="text-sm whitespace-pre-line">{cp.content_suggestion}</p>
                      )}
                    </div>
                  )}
                  {cp.expected_result && (
                    <p className="text-xs text-muted-foreground">📊 {cp.expected_result}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tasks */}
      <div className="space-y-2">
        <h5 className="text-sm font-semibold flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5" />Checklist ({plan.tasks.length})
        </h5>
        {plan.tasks.map((t, i) => (
          <div key={i} className="flex items-start gap-2 text-sm border rounded-lg p-3">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{t.title}</p>
                {t.responsible && <Badge variant="outline" className="text-xs">👤 {t.responsible}</Badge>}
              </div>
              {t.description && <p className="text-muted-foreground mt-0.5">{t.description}</p>}
              {t.due_day_offset != null && <Badge variant="outline" className="text-xs mt-1">Dia {t.due_day_offset}</Badge>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
