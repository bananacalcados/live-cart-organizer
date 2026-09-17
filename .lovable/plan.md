# Registro de acessos à Live (e aos demais módulos)

## Objetivo
Saber quem da equipe abriu a Live (e outras telas sensíveis), em que horário, de qual aparelho — para identificar acessos fora de hora ou de quem não deveria estar ali.

## O que será criado

**1. Registro automático de acesso**
Toda vez que alguém abre uma tela protegida (Live/Eventos, Apresentadora, Chat, PDV, Marketing, Expedição, Estoque, Gestão, Admin), o sistema grava:
- quem (nome e e-mail da pessoa logada)
- qual tela e qual live/evento, quando houver
- data e hora exatas
- endereço de rede e navegador/aparelho usado

Sem sessão nova a cada clique: um mesmo acesso contínuo é agrupado por janela de 5 minutos, para não inflar a lista.

**2. Painel "Acessos" em Administração**
Nova aba com:
- lista dos acessos mais recentes (pessoa, tela, evento, horário, aparelho)
- filtros por pessoa, por módulo, por período e por evento da Live
- destaque em vermelho para acessos em horário atípico (00h–07h)
- resumo do topo: quantas pessoas distintas acessaram a Live hoje e nos últimos 7 dias
- exportar a lista em CSV

Só quem tem o módulo Admin vê esse painel.

## Detalhes técnicos

- Tabela `module_access_log` (id, user_id, user_email, module, route, event_id, ip, user_agent, created_at) com RLS: leitura só para admin (`has_role`), escrita só via função.
- Função `log_module_access(p_module, p_route, p_event_id)` SECURITY DEFINER: resolve `auth.uid()`, busca e-mail em `auth.users`, e faz *upsert* na janela de 5 minutos (evita duplicar em re-render/navegação interna). GRANT EXECUTE para `authenticated`.
- IP e user agent capturados no servidor a partir dos cabeçalhos da requisição quando disponíveis; caso contrário, gravados como nulos.
- Índices em `(created_at desc)`, `(user_id, created_at desc)` e `(event_id)`.
- Chamada disparada no `ProtectedRoute` após a verificação de permissão (só quando o acesso é concedido), com o módulo exigido e a rota atual; falha de log nunca bloqueia a tela.
- Rotas de Live enviam também o `eventId` da URL (`/presenter/:eventId`, `/events/:eventId/...`).
- Novo componente `src/components/admin/AccessLogPanel.tsx` + aba em `src/pages/Admin.tsx`.

## Fora do escopo
- Não registra ações dentro da tela (edições, exclusões) — apenas abertura de módulo. Se quiser auditoria de ações, é uma etapa seguinte.
