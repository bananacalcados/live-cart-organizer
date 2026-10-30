# Grupos — Fase C: envio pela responsável

## Resultado
Cada grupo recebe pela sua responsável, com texto e ritmo atuais preservados. A instância da campanha serve somente para grupos sem responsável. Não publicar o site; não alterar atendimento VIP privado nem disparos para órfãos.

## Implementação
1. **Campanhas e agendamentos:** separar a fila por instância efetiva, permitindo Pérola, Centro e Carol em paralelo, cada uma com seus intervalos e limites atuais. Registrar a instância efetiva no histórico de cada grupo/bloco.
2. **Administração:** resolver antes de reservar a ação, para aplicar os limites da instância correta. Sem permissão de admin, falhar com “instância responsável não é admin”, sem tentar outra.
3. **Criação e convite:** preservar criação na instância da campanha; buscar convite na participação da responsável do grupo escolhido.
4. **Avulsos e telas:** sem escolha explícita, usar responsável. Exceção escolhida vale só naquele envio. Mostrar responsável por grupo e resumo antes de disparar; não alterar a responsável permanente.
5. **Desconexão e travas:** manter pendente quando responsável desconectada, mostrar alerta com quantidade aguardando e retomar após reconexão. Marcar início/fim por grupo e preservar bloqueio de troca enquanto houver fila ou envio.
6. **Reversão:** `app_settings.group_send_via_responsible` com padrão `true`; `false` restaura instância da campanha. Sem interface para a chave.

## Consultas e atualização
- Grupos: preservar busca paginada do panorama e uma busca de até 50 alertas; alertas atualizam a cada 60 segundos somente com aba visível.
- Nas telas de envio, acrescentar no máximo uma consulta em lote dos grupos selecionados para responsáveis/resumo, sem consulta por linha e sem atualização periódica nova.
- Reusar os trabalhadores e agendas existentes; não criar rotina permanente por minuto. Resolver apenas filas ativas, em lotes limitados, com índices conferidos.

## Detalhes técnicos
- Os nomes citados na auditoria são agendas: os arquivos reais principais são `group-dispatch-worker`, `zapi-group-scheduled-send`, `cron-scheduled-group-messages` e `group-admin-worker`.
- Corrigir o claim e o avanço da fila para isolar instâncias e impedir dois processos da mesma instância enviarem simultaneamente.
- Reconciliar contadores/histórico de forma atômica: envios paralelos não podem perder grupos concluídos.
- Reusar `whatsapp_group_responsible`, participações, alertas e filas existentes; campos adicionais somente quando necessários para distinguir fallback, exceção e instância efetiva.
- Preservar formatos originais por participação, normalizando a resolução por `group_jid_base`.

## Validação e entrega
- Testes de responsável/fallback/exceção/chave desligada, paralelo entre instâncias e exclusividade na mesma instância, espera de troca, desconexão/reconexão e admin ausente.
- Conferir telas autenticadas e persistência das escolhas sem alterar responsáveis.
- Um único envio real no **Teste 235**, identificado atualmente com responsável **Whats Carol**, online. Usar texto curto de teste, sem disparar campanhas existentes.
- Entregar relatório com arquivos por itens 1–6 e telas, instância real/histórico do teste e limitações do que não foi verificado.