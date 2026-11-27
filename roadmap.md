# Remoção do Tiny — Fase 2, primeiro lote
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
