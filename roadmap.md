# Remoção do Tiny — Fase 2, primeiro lote
## PDV mobile — ajustes após teste publicado (28/11 16:39 UTC)
- [x] 1: endereço completo e diagnóstico de dados por etapa, sem alterar desktop; 10 testes passaram
- [x] 2: destaque TROCA com o mesmo critério desktop e trava de conclusão preservada
- [x] 3: apenas lojas ativas não simuladas, inclusive contagens e lista no servidor
- [x] 4: envio/conferência/emissão confirmada/documentos existentes; mesma gravação e testes sem operação real
- [ ] 4: compra de nova etiqueta bloqueada — timeout externo pode liberar recompra no caminho desktop; corrigir exige autorização fora do escopo
- [x] 5: Instagram Direct apenas, filtros e contadores no servidor mobile; arquivo e cursor preservados
- [x] Verificar 360–412px, 1.326 testes sem nota/etiqueta/mensagem real; entregas em commits separados
## PDV mobile — melhorias Expedição/WhatsApp (Matthews 28/11)
- [x] Parte A: todas as lojas, filtros, seleção múltipla, frete/origem/dados, detalhe e edição (commit separado)
- [x] Parte B: aparência WhatsApp na lista, conversa e barra de escrever (commit separado)
- [ ] Teste no aparelho Android: gravação, câmera, arrastar para responder e avanço em lote real
## Follow-ups — próximas entregas (na ordem)
- [ ] Validade dos follow-ups (implantar só sem live)
- [ ] Lembretes de pagamento do PDV: investigar causa (pode com live); implantar só sem live
- [ ] Tela Fila de disparos só leitura
## Prioridade D aplicada com live (autorizado 28/11 15:37 UTC)
- [x] Aplicada a ordem nova, interruptor v2, rollback salvo em docs/followups/PRIORIDADE-V2-ROLLBACK.sql; observado 10 min sem anomalias
- [ ] Entregas seguintes (validade, lembretes PDV, Fila de disparos): só implantar sem live, salvo nova liberação
## Prioridade — NF-e 4060 pendente (Matthews 28/11)
- [x] Consultar o provedor antes de qualquer retomada; preservar documento, número e empresa
- [x] Inexistência confirmada por identificador e número/série; 4060 autorizada no documento original, XML e DANFE PDF verificados
- [x] Retomada manual segura de NF-e 55, classificação de falha do provedor e aviso correto na conferência
- [x] 1.289 testes Vitest + 3 Deno, simulação dos dois botões, deploy do emissor e diagnóstico temporário apagado; sem cron/publicação
## PDV mobile — Fase 2 WhatsApp (Matthews 28/11)
- [x] Decisão Opção A: envio intacto, trava síncrona, tentativa incerta sem repetição automática; Opção B fora desta fase
- [x] Conferir caminho de envio intacto e prioridades/paginação por testes isolados; nenhuma tela/regra desktop alterada
- [x] Construir WhatsApp mobile com lista/histórico paginados, Opção A, catálogo e ações compartilhadas
- [x] Suíte 1.277 testes, 30 focados, navegador simulado/leituras reais, medições e relatório; sem publicação
- [ ] Homologação integral mobile: catálogo/mídias e fluxos completos troca/estorno ainda não exercitados no contexto mobile; aparelho e operação de teste autorizada necessários para validar efeitos reais
- [ ] Paridade exaustiva/filtros legados, reconexão real e EXPLAIN/carga concorrente ainda não comprovados; não tratar Fase 2 como integralmente homologada
- [x] Proposta preliminar da Fase 3 documentada sem implementação; aguarda conclusão da Fase 2 e aprovação
## PDV — desempenho desktop e Expedição mobile (Matthews 28/11)
- [x] Entrega 1: Envios paginados/eventos, cartões live por eventos; paridade, medições, commit 6b4b48f3b
- [x] Entrega 2: Expedição mobile, câmera/leitor/fila offline, avanço concorrente compartilhado; testes isolados e commit separado
- [x] Conferir navegador 390×844 sem escritas reais; suíte completa e validação automática; relatório sem publicação
- [ ] Tipos e build de produção separados: execução manual vedada pelo ambiente; validação automática só expõe build OK
- [ ] Câmera/leitor/impressão e eventos reais: aguardam aparelho e operação legítima do Matthews

- [x] Item 1: retirar Tiny da exclusão do PDV, manter devolução única e classificar ajustes; testar, implantar e commitar
- [x] Item 2: validar lista guardada e vendas recentes; usar somente formas locais; testar, implantar e commitar
- [x] Item 3: retirar ações Tiny do detalhe da venda, preservar exclusão normal; testar e commitar
- [x] Conferir prévia e registros finais, sem vendas reais nem publicação

# Fase 3 do estoque — Inventário
## Identificação segura do cadastro da live
- [x] Resolver pedidos incompletos pelo final do WhatsApp, preservando o @ da equipe
- [x] Exibir escolha com @, produtos, foto e valor quando houver pessoas diferentes
- [x] Revalidar seleção no cadastro e testar sem mensagens ou mudanças em clientes reais

## Pares disponíveis no painel da apresentadora
- [x] Auditar estoque compartilhado e baixas anteriores ao balanço
- [x] Criar leitura agregada por evento e mostrar pares sem limitar venda
- [x] Testar cálculo, desempenho e tela; informar exemplos sem publicar

- [x] Criar a aba Inventário com abertura, histórico, resumo e relatório paginado
- [x] Adicionar exportação CSV, zeramento sequencial com parada e encerramento
- [x] Exibir lotes de zeramento no histórico, sem reimpressão
- [x] Testar com RPCs simuladas, sem alterar estoque real, e revisar a prévia

# Fase 4 do estoque — códigos novos no balanço
- [x] Aceitar códigos de variação na bipagem sem alterar os caminhos atuais
- [x] Evitar itens duplicados e reaproveitar a clonagem para variação sem cadastro
- [x] Confirmar CODE128 na câmera e testar somente com RPCs simuladas
- [x] Listar os demais pontos de bipagem, sem alterá-los
- [x] Auditar todos os formatos e caminhos no computador/celular, nos dois temas

## Troca após reversa (aprovado, em fases)
- [x] Fase 1: trava na Expedição (tag TROCA, concluir travado, não excluir)
- [x] Fase 2: cartão "Troca em andamento" no modal + adicionar produto + cancelar troca
- [x] Fase 3: diferença (link com frete grátis/cotado/valor fixo, voucher sem validade)
- [x] Fase 4: "Novo envio" na finalização do PDV

# Etiquetas novas — parte 2
- [x] Aceitar códigos novos na conferência, separação e embalagem da Expedição
- [x] Aceitar códigos novos em transferências, trocas e entrada por grade
- [x] Testar todas as telas com RPC simulada e auditar a conferência na prévia
- [x] Responder como a conferência pode ser concluída, o que é registrado e quais itens não têm etiqueta

# Registro silencioso da conferência — passo 1
- [x] Registrar método, código e quantidade nos cinco fluxos de conferência
- [x] Garantir que falha do registro não interfira na conferência
- [x] Testar todos os métodos com inserção simulada e manter os testes anteriores
- [x] Conferir na prévia sem gravar registros ou concluir pedidos reais

# Voucher da troca na live e nos modais de WhatsApp
- [x] Mostrar voucher disponível e permitir aplicar o desconto nos modais do PDV e da live
- [x] Aplicar voucher na live com validação e baixa transacional de uso único no servidor
- [x] Impedir reutilização, preservar cashback/regras de pagamento e testar sem cobrança real

# Ressarcimento padrão na devolução
- [x] Devolução sem escolha começa com estorno; troca mantém o comportamento atual
- [x] Respeitar voucher/estorno já salvo, inclusive após converter troca em devolução
- [x] Testar a regra e conferir a prévia sem finalizar registros reais

# Remoção do Tiny — NF-e e auditoria dos assistentes
- [x] Remover somente o fallback Tiny da NF-e, preservando payload e validações
- [x] Testar dados completos e CPF ausente sem chamar emissor; implantar e commitar
- [x] Explicar canais, gatilhos e fontes de pedido/rastreio dos assistentes sem alterá-los

# Retirada do concierge desligado
- [x] Etapa 1: remover o concierge do roteador mantendo exatamente as decisões atuais
- [x] Comparar antes/depois com concierge desligado, humano recente e pausas; implantar e commitar
- [x] Etapa 2: remover função implantada/código, telas e referências mortas sem apagar histórico
- [x] Listar configurações/tabelas sem uso, validar e commitar separadamente

# Porta de leitura da VPS
- [x] Banco, função vps-reader (IP fixo, chave por hash, interruptor desligado), testes e conferência do cabeçalho de IP

# Entrega por retirada na loja
- [x] Confirmar localização, vínculo de troca e mensagens posteriores dos candidatos retroativos
- [x] Aplicar entrega por retirada segura e elegibilidade de 7 dias corridos; testar sem mensagens
- [x] Conferir total aplicado, exclusões e ausência de mudança na tela

# Estorno com devolução e NF-e no próprio modal
- [x] Reutilizar NF-e autorizada somente quando outra troca/devolução encerrada tem exatamente os mesmos itens e quantidades
- [x] Abrir a finalização já na devolução da venda e permitir emitir a NF-e de devolução pelo modal do estorno
- [x] Testar travas e fluxo no navegador sem emitir nota, estornar pagamento ou enviar mensagens reais

# Final do WhatsApp persistente por Instagram
- [x] Guardar o final no cadastro e recuperar em próximos carrinhos, incluindo cancelados
- [x] Preservar edição manual e aceitar novo final informado nos comentários
- [x] Testar em ambiente isolado sem mensagens e conferir os dígitos recuperados

# Estoque — Legacy e fotos compactas
- [x] Comparar 30 produtos antes de substituir o resumo, preservando regra e permissões
- [x] Liberar lista antes do resumo/PDV, tratar falha e buscar miniaturas em lote com interruptor
- [x] Compactar fotos por cor e manter ações acessíveis por toque
- [x] Testar regras e prévia desktop/celular com gravações simuladas; conferir validação automática sem publicar

# Estoque no celular + editor de foto
- [x] A) Convite no lugar do desvio (chave invite/auto/off)
- [x] B) Fotos por cor na ficha do celular
- [x] Editor de foto no "Fotos por cor" do computador

# Estoque no celular — Fase 3: balanço por bipagem
- [x] Conferir regra de vendas durante contagem (ajuste B) e prazo de 12h (ajuste C)
- [x] Contagem somada por aparelho (ajuste A), conferência, zerar (b)/(a), desfazer 2 dias
- [x] Testes em rollback + celular 390x844; desktop sem mudança

# Estoque no celular — criar produto e variações
- [x] Novo produto (todos os campos do computador, saldo inicial por loja, PDF de etiquetas)
- [x] Adicionar cor/tamanho e editar dados na ficha
- [x] Testes em rollback + comparação com o computador + celular 390x844

# Produtos do ERP na live (aprovado, em fases)
- [x] Fase 0: conferências, busca do ERP, adaptador, comparação ERP x Shopify
- [x] Fase A: seletores da live usando o ERP com interruptor (nasce em shopify)
- [ ] Ligar product_source_live='erp' após teste do Matthews (aguarda ele)
- [ ] Correção do espelho ao criar variação pela edição do Legacy (aguarda autorização, fora da live)
- [ ] Fases B, C, D (aguardam autorização)

# Troca com diferença paga por fora e pedido pago antes do envio
- [x] Marcar link da diferença como pago por fora, com valor conferido no servidor e registro da forma recebida
- [x] Testar travas sem alterar pagamentos, estoque ou trocas reais
- [x] Desenhar troca de item pago antes do despacho, com cobrança da diferença e Expedição atualizada
  - Valor menor: escolher crédito ou estorno no modal; depois de despachado, usar troca/devolução normal
- [ ] Implementar a troca rápida de pedido pago antes do despacho (aguarda aprovação do desenho)

# Diagnóstico do rastreio Jadlog
- [x] Consultar os dois códigos reais em todos os formatos pedidos e cotar serviços da conta
- [x] Nenhum formato trouxe eventos; manter o rastreio inalterado e apagar o diagnóstico temporário
- [x] Testar JADLOG.PACKAGE, CarrierCode e formatos GET na API oficial
- [x] Inspecionar a página pública e testar uma eventual fonte pública estável
- [x] Se houver fonte utilizável, adicionar fallback só Jadlog, testes e deploy; apagar o diagnóstico temporário
- [x] Atualizar um envio antigo entregue e um recente, conferindo os eventos gravados

# Resumo diário de envios com problema
- [x] Criar leitura em lotes, classificação exclusiva e texto limitado; reutilizar envio interno
- [x] Testar categorias, prioridade e modo sem envio; implantar função
- [x] Configurar destino e agenda gerenciada de dias úteis às 12h; executar uma simulação e apresentar texto

# Chamados Correios — Pedido de Informação
- [x] Confirmar manual V2.4, criar registro protegido e função isolada; 12 testes Deno aprovados
- [x] Adicionar bloco e lista paginada no PDV; conferir sessão real em desktop e 390×844, sem publicar
- [x] Implantar e agendar consulta gerenciada a cada 6h; verificar acesso, simulação e consulta vazia
- [ ] Abrir somente AP696380658BR e consultar — bloqueado: Correios HTTP 403 GTW-012 (API 577 restrita) e e-mail do remetente vazio
- [ ] Confirmar timeout de 120000 da agenda — ferramenta gerenciada não expõe esse ajuste; chamadas de teste usaram 120000
- [ ] Verificação Deno completa — erros preexistentes nos helpers compartilhados de autenticação/log; mantidos fora do escopo

# Correções da verificação antes de publicar (Matthews, sem publicação)
- [x] Preservar caminho Shopify em fotos VIP, identificadores e promoções; 20 testes antes/depois de 89e788d95
- [x] Corrigir somente os 12 testes antigos; 1195 Vitest + 295 Deno + 21 AustPay passaram
- [x] Diagnosticar os HTTP 400/404; remover consulta de e-mail em UUID; tabela de reclamações ausente relatada, sem alterar
- [x] Relatar origem das mudanças de troca e inventário completo desde o commit público 1f084258d
- [x] Reexecutar suítes e cinco telas com gravações bloqueadas; Venda abre com caixa fechado, sem abrir caixa real
- [ ] Obter evidência separada de tipos e build de produção — validação automática só expõe build OK; execução manual vedada pelo ambiente
- [x] Dar veredito não, diferenças remanescentes e roteiro posterior; manter fontes Shopify e dados reais intactos

## Follow-ups (28/11/2026)
- [ ] Pré-requisito das três entregas: concluir implantação da prioridade D; bloqueado por live em andamento (75 comentários nos últimos 30 min, último às 15:17:59 UTC em 28/11).
- [ ] Entrega 1 (commit próprio): validade v2 A/B/C >30 min, D >15 min, cross-sell >3 h; motivo distinto e implantação só sem live. Aguarda o pré-requisito.
- [ ] Entrega 2 (commit próprio): auditar causa/data/impacto de 30 dias dos lembretes PDV, corrigir reserva/incerteza/motivos, propor validade e incluir saúde; não disparar backlog nem mensagens de teste. Aguarda Entrega 1.
- [ ] Entrega 3 (commit próprio): Fila de Disparos somente leitura, consulta única paginada de 50, filtros/traduções/métricas, realtime sem polling, acesso Eventos/PDV e medição <300 ms; sem publicar. Aguarda Entrega 2.
- [x] Prioridade v2 preparada: D 10 min primeiro, D 25/45 só com folga; v1 intacto e motivo próprio de congestionamento.
- [x] Carga de 300 jobs/1h em 1 e 2 números independentes: 75/75 D iniciais, 5,10/1,06 min de atraso; limite e folga no SQL real, sem mensagens.
- [ ] Implantar prioridade v2: bloqueada por comentários recentes (checagem de live); não aplicar nem agendar durante live.
- [ ] Garantia de 100% em pico prolongado: limite nominal 80/h, simulação de 6h perde validade a partir de 76/h; ajustar janela útil do worker/reserva de capacidade exige aprovação fora deste escopo.
- [x] Fase 1 — saúde das filas, alarme e ponto do vigia externo.
- [x] Fase 2 — enviador v2 por instância + regra nova do D (interruptor em v2).
- [ ] Matthews: preencher o número do alarme e cadastrar o segredo do vigia (QUEUE_WATCH_SECRET).
- [x] Matthews aprovou a validade A/B/C 30 min, D 15 min e cross-sell 3 h; aplicar na Entrega 1 após a prioridade D e sem live em andamento.
- [ ] Futuro aprovado: tela "Fila de Disparos" com "Enviar agora" (equipe toda); aumentar teto diário da IA.
