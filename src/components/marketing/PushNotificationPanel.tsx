import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bell, Send, Users, Clock, Image, Link2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface PushLog {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  click_url: string | null;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export default function PushNotificationPanel() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [clickUrl, setClickUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [totalSubs, setTotalSubs] = useState(0);
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/push-notifications?action=stats`, {
        headers: { 'apikey': apikey },
      });
      const data = await res.json();
      setTotalSubs(data.total_subscribers || 0);
      setLogs(data.recent_logs || []);
    } catch (err) {
      console.error('Error loading push stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStats(); }, []);

  const handleSend = async () => {
    if (!title.trim()) { toast.error('Título é obrigatório'); return; }
    setSending(true);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/push-notifications?action=send`, {
        method: 'POST',
        headers: { 'apikey': apikey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim() || null,
          image_url: imageUrl.trim() || null,
          click_url: clickUrl.trim() || null,
          campaign_tag: 'live-consumidor-mar26',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Push enviado! ✅ ${data.sent} entregues, ${data.failed} falharam`);
        setTitle(''); setBody(''); setImageUrl(''); setClickUrl('');
        loadStats();
      } else {
        toast.error(data.error || 'Erro ao enviar');
      }
    } catch (err) {
      toast.error('Erro de conexão');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : totalSubs}</p>
              <p className="text-xs text-muted-foreground">Inscritos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? '...' : logs.length}</p>
              <p className="text-xs text-muted-foreground">Enviados</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Compose */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> Enviar Notificação Push
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Título *</Label>
            <Input
              placeholder="Ex: 🔴 A live começa em 1 hora!"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mensagem</Label>
            <Textarea
              placeholder="Calçados ortopédicos com até 20% OFF..."
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Image className="h-3 w-3" /> Imagem (URL)</Label>
              <Input
                placeholder="https://..."
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Link2 className="h-3 w-3" /> Link ao clicar</Label>
              <Input
                placeholder="/live-consumidor"
                value={clickUrl}
                onChange={e => setClickUrl(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={handleSend}
            disabled={sending || !title.trim()}
            className="w-full"
          >
            {sending ? '⏳ Enviando...' : `🔔 Enviar para ${totalSubs} inscritos`}
          </Button>
        </CardContent>
      </Card>

      {/* Log */}
      {logs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" /> Histórico de Envios
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{log.title}</p>
                  {log.body && <p className="text-xs text-muted-foreground truncate">{log.body}</p>}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <Badge variant="secondary" className="text-xs">
                    ✅ {log.sent_count}
                  </Badge>
                  {log.failed_count > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      ❌ {log.failed_count}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(log.created_at), 'dd/MM HH:mm')}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
