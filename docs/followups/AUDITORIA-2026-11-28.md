# Auditoria dos follow-ups da live e filas de envio — 28/11/2026

Somente leitura até a seção "Construído". Números do banco de produção, 28/11/2026.

## 1. Como o motor dos follow-ups funciona
- Pedidos/acessos que mudam entram em `live_followup_sources`.
- **Agendador** `event-followup-scheduler` (cron a cada 1 min) cria os jobs A/B/C/D/E/F em `live_followup_jobs` (único por cliente+sequência+etapa).
- **Enviador** `event-followup-dispatcher` (cron a cada 1 min). Antes (v1): reservava até 20 jobs (`live_followup_claim`) e enviava **um depois do outro**; cada envio espera checagem do número, "digitando" 2–5 s e o provedor (até 20 s).
- Ritmo anti-ban por instância: 20–60 s entre envios, 80/h por instância, 6/dia por cliente; prioridades `live_followup_priority`; 3 variações por etapa sem repetir para a mesma cliente.
- Regras que cancelam/pulam/adiam: global/live/tipo desligado, pago, pedido encerrado/cancelado, opt-out, cadastro concluído (A), cliente respondeu (D/E/F), D atrasado >15 min (`late_step`), carrinho já contatado (B/C, só aquele job), atendimento humano (adiado; cancelado após 3h), instância desconectada (pausa), janela Meta fechada, Instagram sem janela, limite diário, variações esgotadas.

### Últimos 30 dias (live_followup_jobs)
| Tipo | Enviados | Principais cancelamentos |
|---|---|---|
| A | 77 | 346 cadastro concluído (correto); 5 adiados por humano |
| B | 16 | 89 pago; 69 carrinho já contatado |
| C | 0 | 86 pago; 37 carrinho já contatado |
| D | 56 / 20 / 9 (10/25/45 min) | ~1.190 pago; 204 cliente respondeu; 196 pedido fechado |

Últimos 10 dias (medição do Matthews, conferida): enviados A 36, B 8, C 0, D 49 (85% até 2 min do horário). D: 802 pago, 124 pedido fechado, 89 cliente respondeu.

## 2. O que realmente falhou
- **19 a 24/11: zero envios.** 37 jobs descartados com `fila_travada_21_11_descartado` e 1 `processing_expirado`. Causa: um envio preso em "processando/incerto" segurava a instância inteira (corrigido em 25/11 com expiração de 10/60 min).
- Atrasos em dia de live: 42 min (09/11), **4h12 (12/11)**, 54 min (16/11 e 25/11), 37 min (18/11).
- Por que voltava a acontecer: (1) nenhum alarme; (2) o lote era enviado em sequência — uma instância lenta atrasava a outra; (3) envio incerto **pausava a instância** até alguém liberar; (4) o cron reservava no máximo 1 por instância por minuto.
- Por que a fila do carrinho é robusta: reserva só a primeira mensagem de cada instância, retomada automática armada ao enfileirar, nunca reenvia na dúvida e não pausa por incerteza.

## 3. Regras × intenção (decisões de 28/11)
- **C e B:** ficam como estão ("carrinho já contatado" continua cancelando). Na prática o C quase nunca sai porque o link do carrinho sai antes — comportamento mantido por decisão.
- **D (aprovado e aplicado no v2):** cada etapa confere se a cliente mandou mensagem desde o envio anterior (ou desde o link, na 1ª). Se mandou, pula **só aquela etapa** (motivo `respondeu_desde_envio_anterior`); as seguintes continuam. Pago, pedido fechado, opt-out e atendimento humano iguais.

## 4. Mapa de todas as filas de envio
Vencidas = pendentes há mais de 10 min agora. Falhas = últimos 7 dias.

| Fila | O que envia | Worker / gatilho | Contra travar | Contra duplicar | Vencidas hoje | Falhas 7d |
|---|---|---|---|---|---|---|
| live_followup_jobs | Follow-ups A–F da live | event-followup-scheduler + dispatcher, cron 1 min | expira processing 10 min / incerto 60 min; **v2: laço por instância** | chave única cliente+sequência+etapa; incerto nunca reenvia | 0 | 1 pulado; 78 enviados, 1.291 cancelados por regra |
| selfservice_message_queue | Link do carrinho, confirmação de pagamento, convites | selfservice-message-worker; recuperação por minuto armada ao enfileirar e removida ao esvaziar | reserva só a cabeça FIFO por instância; recupera reservas após 2 min | `message_key` única; incerto não reenvia | 0 | 1 falha / 1.834 enviados |
| event_followup_dispatches | Follow-ups antigos por evento (legado) | event-followup-dispatcher (só quando o global está desligado) | volta processing >10 min para pendente; >6h vira pulado | reserva atômica por linha | 0 | sem uso (global ligado) |
| automation_message_queue | Automações de botão | automation-queue-worker, cron 1 min | `locked_until` | pacing por contato + reserva | 0 | 10 falhas / 217 enviados |
| automation_pos_followups | Pós-venda do PDV | automation-pos-followups-cron, 15 min | sem reserva (marca sent/cancelled) | uma linha por venda+etapa | 0 | — |
| chat_payment_followups | Lembrete de pagamento do chat | chat-payment-followup, cron 1 min | nenhum além de `is_active` | contador de lembretes | **87 ativos vencidos, o mais antigo de 23/07** (lixo antigo; fora do alarme) | — |
| chat_scheduled_followups | Retorno agendado do chat | send-scheduled-messages, cron 1 min | sem reserva | `is_sent` | 0 | — |
| meta_message_queue | Templates Meta enfileirados | consumidor sob demanda | tentativas máx. | tentativas | 0 | — (informativa na saúde) |
| support_outbox | Respostas da IA de suporte | worker do outbox (cron existente) | pausa por instância, reserva com prazo | `idempotency_key` | 0 | 21 falhas / 222 enviados |
| dispatch_recipients (disparos) | Disparos em massa | dispatch-orchestrator, cron 1 min | `lease_until` | reserva por destinatário + `message_wamid` | 16.810 pendentes, todos de disparos **agendados/pausados** (não é travamento) | 509 falhas |
| group_campaign_scheduled_messages (VIP) | Mensagens dos grupos VIP | dispatch-scheduled-group-messages + vip-group-dispatch-worker, 1 min | `locked_until`, lease por instância | `sent_group_ids` | 0 (4 "sending") | — |

## 5. IA de atendimento (14 dias) — resumo
3.698 casos; 1.475 ignorados corretamente; 211 respondidos. Falhas: 642 respostas vazias do motor (190 em 16/11), 219 barradas pelo teto diário, 36 erros no Instagram Direct + 34 presas em erro de envio. Reserva Claude quase não entrou (2 chamadas). Decisão: aumentar o teto (fase futura).

## 6. Construído em 28/11 (Fases 1 e 2)
- Batimento do agendador e do enviador a cada execução; consulta de saúde `queue_health` (contagens/tempos, índices parciais).
- Alarme a cada 2 min (`queue-health`), um aviso por incidente, reaviso a cada 30 min, "normalizou" ao voltar; envio direto pelo provedor e por instância fora do problema; faixa vermelha para admin em Eventos > Follow-up.
- Ponto do vigia externo — contrato em `VIGIA-EXTERNO.md`.
- Enviador v2 com interruptor `live_followup_settings.sender` (`v1`/`v2`).

## 7. Teste de carga (simulação, 300 jobs em 1h, 2 instâncias, ritmo 20–60 s, 80/h)
| | Enviados | D pulados por atraso >15 min | Atraso mediano | Atraso máximo |
|---|---|---|---|---|
| v2 | 191 | 109 | 16,3 min | 27,3 min |
| v1 (mesma carga) | 178 | 122 | 18,0 min | 33,4 min |
Conclusão honesta: com 300/h o limite é o **ritmo anti-ban** (~80–90 por instância/hora), não o enviador. O v2 elimina o efeito cascata (instância lenta, envio incerto) e ganha pouco em volume.

## 8. Proposta de validade por tipo (NÃO aplicada — decisão do Matthews)
| Tipo | Hoje | Proposta |
|---|---|---|
| A cadastro (5 min) | sem limite | descartar se passar de 30 min |
| B/C link do carrinho (5 min) | sem limite | 30 min |
| D 10/25/45 min | pula se >15 min atrasado | manter 15 min |
| E cross-sell (3h/6h/24h) | sem limite | 3 h |
| F Instagram | sem limite | igual ao A/D conforme etapa |
