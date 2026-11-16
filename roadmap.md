# Cinco correções de pagamento/pedido da live (16/11)
- [x] Bloquear exclusão de pedido aberto com cobrança e preservar o log existente
- [x] Conciliar pagamento de pedido excluído/mesclado ou registrar órfão com resolução segura
- [x] Avisar pedido aberto duplicado na mesma live antes de salvar
- [x] Deixar erro genérico da AppMax seguir a cascata e remover duplicidade de fallback
- [x] Mostrar somente mensagem amigável à cliente; testar sem cobrança real
- [ ] Concluir varredura dos caminhos relacionados e conferência visual sem alterar dados

# Quatro correções de cadastro, trocas e chat (16/11)
- [ ] Preencher WhatsApp vazio da ficha de todos os pedidos identificados no cadastro
- [ ] Validar endereço no navegador e no servidor, sem recusar endereços comuns
- [ ] Registrar no chat os avisos automáticos de troca/devolução enviados com sucesso
- [ ] Avisar e permitir abrir histórico do mesmo telefone em outra instância
- [ ] Rodar testes simulados e revisar as telas sem envios ou alterações reais
