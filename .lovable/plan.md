# Plano 2 — Notificações discretas no atendimento

Dois tipos de aviso, cada um no seu formato, sem nunca bloquear o envio:

1. **Barra de regra acima do input** (enquanto digita) — ex.: "Sua mensagem não termina com pergunta. Que tal puxar uma resposta da cliente?"
2. **Card flutuante no canto do chat** — contadores da vendedora logada: "X clientes aguardando sua resposta" e "Y follow-ups pra fazer hoje".

Tudo é camada de UI por cima do que já existe. Não mexe em `handleSend`, `useChatSender`, roteamento de instância nem nas tabelas de mensagens.

---

## Parte A — Regra "terminar com pergunta" (enquanto digita)

### Como funciona
- Avalia o rascunho atual a cada digitação (debounce ~400ms, igual à barra de ortografia).
- Se a mensagem tem conteúdo e **não** termina com `?`, mostra a barra de aviso acima do input.
- **Exceções** (não mostra o aviso):
  - Mensagem contém frase de fechamento (lista pré-cadastrada).
  - Conversa está marcada como paga/finalizada (status já existente no enriquecimento da conversa).
  - Mensagem muito curta (ex.: "ok", "👍") ou só emoji/link.
- É só lembrete visual com botão "ok, ignorar" — **nunca** impede o envio nem altera o texto.

### Lista inicial de frases de fechamento (já entregue no código)
`obrigada`, `obrigado`, `agradeço`, `pedido enviado`, `pedido a caminho`, `enviado pelos correios`, `código de rastreio`, `até logo`, `até mais`, `volte sempre`, `qualquer coisa estou à disposição`, `estou à disposição`, `tenha um ótimo dia`, `boa compra`, `seja bem-vinda de volta`, `finalizado`, `pagamento confirmado`, `compra concluída`.

---

## Parte B — Card flutuante de contadores (por vendedora logada)

### Conteúdo
- **"X clientes aguardando você"** → conversas atribuídas à vendedora logada cuja última mensagem é da cliente (estado `awaiting_reply` que o app já calcula).
- **"Y follow-ups pra fazer"** → follow-ups agendados/de pagamento vencidos atribuídos a ela.

### Comportamento
- Card discreto no canto inferior da área de chat, recolhível, com badge de total.
- Atualiza ao abrir o chat e a cada ~60s (e no realtime que já existe).
- Clicar num contador filtra/destaca as conversas correspondentes na lista.
- Escopo sempre a vendedora logada, usando o sistema de atribuição que já criamos (`chat_conversation_assignments`).

---

## Parte C — Tela de configuração de regras

Nova aba em configurações do chat (admin) para ligar/desligar e ajustar sem mexer em código:

- Ativar/desativar a regra "terminar com pergunta".
- Editar a **lista de frases de fechamento** (exceções) — já vem populada com a lista acima.
- Ativar/desativar e configurar os contadores (limite de follow-ups considerado "do dia", on/off do card).
- Estrutura pensada para receber **novas regras** no futuro (ex.: tempo de resposta), sem refatorar.

---

## Detalhes técnicos

### Banco (1 migração)
- Tabela `chat_attendance_rules` (config global do tenant):
  - `id`, `rule_key` (ex.: `end_with_question`), `enabled` (bool), `config` (jsonb — guarda a lista de frases, limites etc.), `updated_at`.
  - GRANT para `authenticated`/`service_role`; RLS com leitura para usuários autenticados e escrita para admin (`has_role`).
  - Seed inicial da regra `end_with_question` com `enabled=true` e a lista de frases no `config`.

### Frontend
- `src/lib/attendance/closingPhrases.ts` — lista padrão + normalização (sem acento/minúsculo).
- `src/lib/attendance/rules.ts` — engine puro: `evaluateDraft(text, ctx, config)` → retorna avisos. Fácil de adicionar regras novas.
- `src/hooks/useAttendanceRules.ts` — carrega config de `chat_attendance_rules` (cache), expõe regras ativas.
- `src/hooks/useComposerNudges.ts` — debounce do rascunho + `evaluateDraft`, devolve avisos da conversa aberta.
- `src/components/chat/ComposerRuleBar.tsx` — barra discreta acima do input (mesmo padrão visual da barra de ortografia), com "ignorar".
- `src/hooks/useAttendantWorkload.ts` — calcula contadores da vendedora logada a partir do enriquecimento de conversas já existente + `chat_scheduled_followups`/`chat_payment_followups`.
- `src/components/chat/AttendantNudgeCard.tsx` — card flutuante recolhível.
- `src/components/settings/AttendanceRulesSettings.tsx` — tela de configuração (admin).

### Integração
- `ChatView.tsx` (POS) e `Chat.tsx` (geral): renderizar `ComposerRuleBar` acima do input (junto da barra de ortografia) e `AttendantNudgeCard` no canto.
- Reaproveitar `awaiting_reply` do enriquecimento atual; **nenhuma** mudança no fluxo de envio.

### Fora de escopo (fases futuras)
- Avaliação de qualidade do atendimento.
- Revisão de texto com IA.
- Regras subjetivas (tom de voz, empatia).

---

## Riscos e mitigação
- **Quebrar o envio:** nada toca em `handleSend`/`useChatSender` — só leitura e UI.
- **Falso positivo na regra:** lista de exceções editável + botão ignorar + nunca bloqueia.
- **Performance dos contadores:** usa dados já carregados + intervalo de 60s, sem queries pesadas por tecla.
