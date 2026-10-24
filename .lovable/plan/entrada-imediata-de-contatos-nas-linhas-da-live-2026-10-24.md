# Entrada imediata de contatos nas linhas da live

## Resultado
- Ao terminar de digitar um WhatsApp válido na primeira etapa, guardar o contato sem exigir o cadastro completo nem clicar em Continuar.
- Sem pedido: mostrar o card em **Novos Contatos**. Criar lead somente para quem ainda não comprou, preservando a origem de leads anteriores.
- Com exatamente um pedido compatível na mesma live pelo final de quatro dígitos: mostrar esse pedido com o telefone em **Aguardando Pagamento**.
- Empate de finais ou telefone já vinculado a outra pessoa: não associar automaticamente.

## Proteções
- O telefone digitado aparece para a equipe como ainda não confirmado. O cadastro definitivo do pedido só recebe o número após a mensagem real no WhatsApp.
- Capturar o número não confirma cadastro, pagamento nem participação no sorteio, e não dispara mensagens.
- Não alterar os outros modos de live, `/zap` nem o overlay. Não publicar o site.

## Detalhes técnicos
- Reutilizar acessos e leads existentes, com captura idempotente no servidor e correspondência limitada ao evento.
- Uma chamada após uma pausa na digitação de um número completo; sem chamadas por tecla.
- Para os contatos adicionais das linhas: uma consulta inicial paginada em 100 registros, avisos em tempo real com debounce e conferência por minuto somente com a aba visível.
- Projetar o telefone não confirmado no card sem sobrescrever a ficha oficial; revalidar a associação no cadastro e na confirmação.
- Testar prospect, cliente anterior, pedido único, empate, conflito, repetição e preservação dos estados de cadastro/pagamento.