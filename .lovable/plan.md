

## Diagnóstico: Disparo Client-Side vs Background

Você está correto. Conforme documentado na arquitetura do sistema, o motor de disparo atual é **100% client-side** — ele roda no navegador, dentro da aba. Quando você sai da página, o JavaScript pausa e o disparo para. Ao voltar, ele "retoma" de onde parou graças ao registro de progresso no banco, mas **nenhuma mensagem é enviada enquanto a aba está fechada**.

## Solução: Mover o Disparo para uma Edge Function em Background

### Como funcionaria

1. **Nova Edge Function `dispatch-mass-send`** — recebe o `dispatch_id`, carrega os destinatários pendentes do banco (`dispatch_recipients` com status != 'sent'), e executa o loop de envio servidor-side com delays entre mensagens.

2. **Controle de tempo** — Edge Functions têm limite de ~50s de execução. A função processaria lotes (ex: 30-50 mensagens por invocação), salvaria progresso, e se auto-invocaria para o próximo lote via `fetch()` encadeado, ou usaria um cron job para verificar dispatches pendentes a cada minuto.

3. **UI permanece igual** — o frontend apenas **inicia** o disparo (chamando a Edge Function) e **monitora** o progresso via polling ou Realtime, mostrando a barra de progresso. O usuário pode fechar a aba tranquilamente.

4. **Cancelamento** — o campo `status` do dispatch no banco serve como flag. A Edge Function verifica antes de cada lote se o status mudou para `cancelled`.

### Arquitetura proposta

```text
┌──────────┐     POST dispatch-mass-send     ┌─────────────────────┐
│ Frontend │ ──────────────────────────────▶  │  Edge Function      │
│ (inicia) │                                  │  (lote de ~40 msgs) │
└──────────┘                                  │  salva progresso    │
     │                                        │  chama próximo lote │
     │  polling / realtime                    └─────────────────────┘
     │  (monitora progresso)                         │
     ▼                                               ▼
┌──────────┐                                  ┌─────────────────────┐
│ UI barra │ ◀── dispatch_recipients table ◀──│  Próximo lote...    │
│ progresso│                                  └─────────────────────┘
└──────────┘
```

### Componentes a criar/modificar

| Componente | Ação |
|---|---|
| `supabase/functions/dispatch-mass-send/index.ts` | Nova Edge Function que processa lotes de ~40 msgs com delay, salva progresso, e encadeia o próximo lote |
| `MassTemplateDispatcher.tsx` | Trocar loop client-side por chamada à Edge Function + polling de progresso via `dispatch_history` |
| `dispatch_history` table | Adicionar campo `processing_batch` para controle de concorrência |

### Limitações e decisões

- **Limite de 50s por invocação**: cada lote processa ~30-40 mensagens (dependendo do delay configurado), depois dispara o próximo lote automaticamente
- **Retry**: se um lote falhar, o cron ou a próxima verificação retoma de onde parou
- **Concorrência**: um lock no banco impede dois lotes rodando ao mesmo tempo para o mesmo dispatch

Deseja que eu implemente essa migração do disparo para background?

