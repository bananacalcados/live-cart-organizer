# Ponto 3 — Parar de baixar a tabela inteira de conversas finalizadas

## O que acontece hoje (em leigo)

Toda vez que uma tela de chat abre, o sistema pergunta ao banco: "me manda **todas** as conversas que já foram finalizadas, desde sempre". Como são muitas linhas, ele busca de mil em mil, página por página, até acabar. Só depois disso ele consegue pintar a etiqueta "Finalizada" na lista.

Ele faz isso mesmo que a tela mostre apenas 30 conversas. Ou seja: baixa um catálogo telefônico inteiro para conferir 30 nomes.

E não é uma vez só. Isso se repete:
- toda vez que alguém abre o Chat, o PDV > WhatsApp, o chat do Dashboard ou o chat flutuante;
- em **cada** uma dessas telas separadamente (cada uma tem sua própria cópia);
- de novo a cada vez que alguém finaliza/reabre uma conversa em qualquer ponto da loja (o recarregamento é disparado em tempo real para todos os usuários conectados).

Resultado medido: **20.222 chamadas** e cerca de **2,9 minutos** de processamento do banco.

## Impacto prático

- Demora perceptível ao abrir o chat: a lista aparece antes das etiquetas, e as conversas finalizadas "piscam" na aba errada até o download terminar.
- Em horário de pico (várias vendedoras com o chat aberto + live rolando), essas leituras competem com PDV, checkout e envio de mensagem — é parte do que deixa o sistema pesado.
- Piora sozinho com o tempo: quanto mais conversas finalizadas acumulam, maior o download, sem nenhum ganho.
- Consumo de tráfego (egress) desnecessário, multiplicado por usuário e por aba aberta.

## Plano de correção

### Etapa A — Buscar só o que está na tela
Trocar o "baixa tudo" por uma consulta pelos telefones das conversas realmente visíveis na lista, em lotes. Mesma abordagem que já resolveu os contatos do chat (Etapa 3 anterior) e a busca por telefone das vendas.

### Etapa B — Cache compartilhado entre telas
Criar um cache único de "telefone → data de finalização", igual ao de contatos:
- vive fora dos componentes, então as quatro telas de chat compartilham o mesmo resultado;
- telefone já resolvido não é reconsultado enquanto estiver fresco;
- telefone sem registro é marcado como "não finalizada" e também não é reconsultado.

### Etapa C — Atualização em tempo real cirúrgica
Hoje qualquer mudança na tabela dispara um recarregamento completo. Passa a ler o telefone que veio no próprio evento em tempo real e atualizar **apenas aquela** entrada do cache — sem ida ao banco na maioria dos casos.

### Etapa D — Consulta indexada
Garantir que a busca use o índice por sufixo de telefone (DDD + 8 dígitos) já existente, para que cada lote seja resolvido por igualdade indexada e não por varredura.

## Detalhes técnicos

- `src/hooks/useConversationEnrichment.ts`: remover o laço de paginação de `chat_finished_conversations` e substituir por um resolvedor por lote.
- Novo `src/lib/finishedConversationsCache.ts` nos moldes de `src/lib/chatContactsCache.ts` (TTL, de-dupe de chamadas simultâneas, `resolve`/`peek`/`invalidate`).
- `enrichConversations` passa a consultar o cache; as telas (`Chat.tsx`, `GlobalWhatsAppChat.tsx`, `DashboardChatPanel.tsx`, `POSWhatsApp.tsx`, `POSWhatsAppDashboard.tsx`) continuam com a mesma API do hook — sem mudança visual.
- Escritas otimistas de `finishConversation`/`reopenConversation` gravam direto no cache, preservando o comportamento atual de não "voltar" a conversa na próxima atualização.
- Realtime: usar `payload.new`/`payload.old` para atualizar uma chave só; recarregamento completo apenas como fallback.
- Se necessário, criar índice/expressão de sufixo em `chat_finished_conversations.phone` e validar o plano com `EXPLAIN ANALYZE`.

## Verificação

- Contagem de chamadas a `chat_finished_conversations` em `pg_stat_statements` antes/depois.
- Abrir o chat e conferir que finalizadas seguem na aba correta, finalizar e reabrir uma conversa em duas telas ao mesmo tempo.
- Confirmar que a etiqueta não "pisca" mais na abertura da lista.
