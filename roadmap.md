# Remoção do Tiny — Fase 2, primeiro lote
- [x] Item 1: retirar Tiny da exclusão do PDV, manter devolução única e classificar ajustes; testar, implantar e commitar
- [x] Item 2: validar lista guardada e vendas recentes; usar somente formas locais; testar, implantar e commitar
- [x] Item 3: retirar ações Tiny do detalhe da venda, preservar exclusão normal; testar e commitar
- [ ] Conferir prévia e registros finais, sem vendas reais nem publicação

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
