# Destravar o envio de mensagens (itens 1 e 2) — sem parar o sistema

Objetivo: reduzir o tempo de gravação de mensagem no WhatsApp (hoje média 1,28 s, pico 7,7 s) sem downtime, sem perder dado e sem mudar nada visível para quem usa.

Regra de ouro deste plano: nenhuma etapa derruba o sistema. Índices são criados/removidos em modo concorrente (o banco continua lendo e escrevendo durante a operação) e cada etapa é reversível em segundos.

---

## Etapa 1 — Remover os 3 índices que nunca foram usados

`whatsapp_messages` tem 13 índices (~265 MB). Toda mensagem gravada precisa atualizar os 13. Três deles nunca foram lidos uma única vez desde que o banco subiu:

| Índice | Tamanho | Situação |
|---|---|---|
| `idx_wm_phone_number_created` | 35 MB | duplicata exata de um índice que é usado |
| `idx_whatsapp_messages_mass_dispatch_message_id` | 25 MB | leituras zeradas |
| `uniq_incoming_message_per_channel` | 10 MB | leituras zeradas |

O que será feito:
- Antes de remover, reconfirmar o contador de uso de cada um (leitura = 0) na hora da execução.
- Remoção com `DROP INDEX CONCURRENTLY` — não trava a tabela, o chat segue funcionando.
- Ganho esperado: ~3 escritas de índice a menos por mensagem e 70 MB liberados.

Ponto de atenção honesto: `uniq_incoming_message_per_channel` é um índice de unicidade — ele não é usado para busca, mas pode estar servindo de trava contra mensagem duplicada. Antes de removê-lo vou verificar se alguma função depende dele (`ON CONFLICT`). Se depender, ele fica; a dedupe hoje já é feita pela função `dedup_outgoing_message`.

Como reverter: recriar o índice (também em modo concorrente). Zero perda de dado.

---

## Etapa 2 — Corrigir o gatilho que varre a tabela a cada mensagem

O gatilho `auto_reopen_finished_conversation_on_message` roda em **toda** mensagem e apaga registros em `chat_finished_conversations` comparando o telefone com uma expressão de regex. Como não existe índice para essa expressão, o banco lê a tabela inteira a cada mensagem enviada ou recebida.

O que será feito, em duas partes:

1. **Criar o índice que falta** para a expressão usada pelo gatilho (`CREATE INDEX CONCURRENTLY` — sem travar nada). A partir daí a busca vira consulta direta em vez de varredura.
2. **Sair cedo do gatilho**: hoje ele executa a limpeza sempre. Passa a verificar primeiro se existe conversa finalizada para aquele telefone; se não existir (o caso da esmagadora maioria das mensagens), o gatilho termina imediatamente.

O comportamento visível continua idêntico: conversa finalizada que recebe mensagem nova continua reabrindo automaticamente.

Como reverter: restaurar a versão anterior da função do gatilho (guardo o texto original antes de alterar).

---

## Verificação depois de cada etapa

Depois da Etapa 1 e depois da Etapa 2, separadamente:
- Medir de novo o tempo médio de gravação em `whatsapp_messages` nas consultas lentas.
- Enviar uma mensagem real pelo chat e confirmar entrega e reabertura de conversa finalizada.
- Só avanço para a próxima etapa com a anterior confirmada.

---

## O que este plano NÃO faz agora

Ficam para depois, em plano próprio, porque exigem mudança de código do app e mais cuidado:
- Item 3: limpar o inchaço de armazenamento (`whatsapp_messages_archive` com 340 MB para 11 mil linhas).
- Item 4: parar a tempestade de requisições do frontend (`chat_contacts` baixada inteira, polling de `orders` e `customers`).
- Item 5: remover a duplicidade entre Realtime nativo e o gatilho de broadcast.

Itens 1 e 2 são banco puro, sem alteração de tela — por isso são os primeiros: maior ganho por unidade de risco.
