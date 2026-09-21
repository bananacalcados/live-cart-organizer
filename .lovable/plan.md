# Avanço da Expedição por produto

## Resultado esperado

- Na Separação, marcar produtos e clicar em **Avançar para Conferência** move somente as unidades marcadas.
- Produtos não marcados permanecem visíveis na Separação; eles não entram automaticamente em Aguardando.
- **Aguardando** vira uma ação manual separada: os produtos marcados são enviados para Aguardando, inclusive quando a seleção foi feita pelo pedido/cliente.
- Em um envio unificado, cada produto mantém sua própria etapa, sem duplicar itens entre Separação, Aguardando e Conferência.
- A Conferência mantém o envio unificado e a tarja de produto faltante, mas lista somente os produtos realmente avançados.

## Implementação

1. Persistir a etapa individual de cada item da venda, com preenchimento inicial compatível com a etapa atual do pedido.
2. Alterar a lista de Separação para selecionar e mover quantidades de itens sem promover automaticamente os demais itens do pedido ou grupo.
3. Fazer os botões **Conferência** e **Aguardando** operarem sobre a seleção atual; a seleção pelo card da cliente selecionará os itens pendentes daquele pedido e permitirá as duas ações.
4. Montar Separação, Aguardando e Conferência considerando a etapa dos itens; manter o pedido principal como agrupador visual do envio.
5. Recalcular a etapa-resumo e a tarja do pedido sem apagar ou duplicar os produtos que ficaram para trás.

## Validação prática

- Reproduzir o caso da Vera: Tamanco Melissa e Sandália Emily em Conferência; Tênis Rebeca ainda em Separação.
- Depois mover manualmente apenas o Tênis Rebeca para Aguardando e confirmar que ele sai da Separação sem aparecer na Conferência.
- Testar também a seleção pelo card da cliente e confirmar que os botões Conferência e Aguardando ficam disponíveis.
