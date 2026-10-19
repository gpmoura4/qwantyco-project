# Requisitos

Fonte: `docs/references/qwantyco-desafio-tecnico.pdf` (fora do git). Cada passo de `docs/plano.md` indica quais IDs atende.

Status: ⬜ pendente · 🟨 parcial · ✅ atendido

## Núcleo (obrigatório)

| ID  | Requisito | Passo | Status |
|-----|-----------|-------|--------|
| R01 | Assistente de suporte da empresa fictícia **Aurora**: consulta chamados, lista os abertos e prepara escalonamento para revisão humana. | 3–7 | ⬜ |
| R02 | Fluxo: solicitação → consulta → proposta (resumo + justificativa) → aprovação → registro → resultado. Rejeição encerra sem registrar; consulta simples termina após a resposta. | 4 | ⬜ |
| R03 | Tool `listar_chamados` com filtro pelo argumento `situacao` (nomes obrigatórios). | 2, 3 | 🟨 |
| R04 | Tool de consulta de chamado por identificador (nome livre). | 2, 3 | 🟨 |
| R05 | Tool de registro de escalonamento (chamado, resumo, justificativa), simulado, somente após aprovação (nome livre). | 2, 4 | 🟨 |
| R06 | Mocks e testes próprios; massa com CH-101 e CH-103 abertos e CH-102 resolvido. Sem API HTTP. | 2 | ✅ |
| R07 | **Regra:** só chamado aberto pode ser escalonado. Nunca inventar dados nem confirmar operação que não ocorreu. | 2, 4 | 🟨 |
| R08 | O modelo emite a tool call com argumentos; o executor valida e executa a função mockada; a resposta usa o retorno. Nada de resposta fixa. | 3 | ⬜ |
| R09 | Orquestração em LangGraph, estado tipado e contratos validados. | 3 | ⬜ |
| R10 | Contexto mantido entre requisições; sessões diferentes separadas. Checkpoint em memória basta. | 3 | ⬜ |
| R11 | Interrupção e retomada do LangGraph; UI Next.js mostra a proposta exata com aprovar/rejeitar. | 4, 6, 7 | ⬜ |
| R12 | Aprovação validada no backend e vinculada à proposta; repeti-la não duplica o registro. | 4, 6 | ⬜ |
| R13 | Falhas simuladas nas tools; tratar chamado inexistente, entrada/saída inválida e ferramenta desconhecida. | 3, 5 | ⬜ |
| R14 | Timeout, tentativas limitadas e limite total de execução ativa (espera humana não conta). Não depender só do prompt para bloquear ações. | 5 | ⬜ |
| R15 | LangSmith obrigatório: chamadas ao modelo, nós, tools, argumentos, resultados, erros, aprovação/retomada; correlação por sessão e execução; sem segredos. | 8 | ⬜ |
| R16 | Evaluation: dataset com o caso obrigatório + ≥1 caso próprio; avaliador automático por código; experimento visível no LangSmith. | 9a, 9b | ⬜ |
| R17 | Caso obrigatório "Liste todos os chamados abertos.": executar `listar_chamados` com `{"situacao":"aberto"}`, sucesso na consulta, responder CH-101 e CH-103 sem omissões, extras ou dados inventados. | 9a, 9b | ⬜ |
| R18 | Avaliador verifica a execução real da tool e a correspondência com o retorno; demonstrar que reprova resposta que pula a consulta ou inventa chamado. | 9a | ⬜ |
| R19 | Modelo real (local ou API) em ≥1 execução da avaliação; identificar o modelo e documentar a configuração; conta própria do LangSmith, recursos gratuitos. | 9b | ⬜ |

## Testes offline (doubles do modelo, mesmo grafo e executor; separados da avaliação com modelo real; sem exigir redação exata)

| ID  | Cenário | Comportamento esperado | Passo | Status |
|-----|---------|------------------------|-------|--------|
| T01 | Consulta e listagem | Executa a tool com argumentos e usa o retorno mockado; trata identificador inexistente. | 3 | ⬜ |
| T02 | Chamado resolvido | Impede escalonamento de CH-102, inclusive no backend. | 4 | ⬜ |
| T03 | Aprovação e rejeição | Aguarda decisão; rejeitar não escreve; aprovar executa a proposta exibida. | 4 | ⬜ |
| T04 | Aprovação repetida | Cria apenas um registro para a mesma operação. | 4 | ⬜ |
| T05 | Falha transitória | Erro simulado na tool e recuperação dentro do limite de tentativas. | 5 | ⬜ |
| T06 | Saída inválida e limites | Não executa ferramenta indevida; encerra com erro controlado ao atingir o limite. | 3, 5 | ⬜ |
| T07 | Contexto e sessões | Continua a mesma conversa sem misturar o contexto de outra sessão. | 3 | ⬜ |

## Entregáveis

| ID  | Entregável | Passo | Status |
|-----|------------|-------|--------|
| E01 | Repositório no GitHub com código, lockfile, versão do Node e `.env.example` sem segredos. | 1, 10 | 🟨 |
| E02 | README com instalação, comandos, testes offline, avaliação, fluxo, decisões e limitações. | 1 (esqueleto), 10 | 🟨 |
| E03 | Projeto, dataset e experimento mantidos na conta própria do LangSmith. | 8, 9b | ⬜ |
| E04 | Apresentação: navegar no LangSmith (fluxo, falha, aprovação, avaliação), discutir decisões e o caso adicional, alteração ao vivo, possível explicação em inglês. | — | ⬜ |
| E05 | Só dados fictícios; interface simples; deploy público não é necessário. | todos | ⬜ |

## Bônus (opcional)

| ID | Requisito | Status |
|----|-----------|--------|
| B1 | Base local fictícia sobre visto/documentação para França e ≥1 outro país, explicitando nacionalidade/passaporte, finalidade e duração. | ⬜ |
| B2 | RAG como tool (ex.: `call_rag`), com citação de fontes; sem evidência, pedir esclarecimento ou admitir que a base não responde. | ⬜ |
| B3 | Um único grafo com Assistants (system prompt + tools configurados em execução); restrição no backend (suporte sem RAG, viagens sem tools de chamados); histórico separado por assistente e sessão. | ⬜ |
| B4 | Testes e traces mostrando a separação (recuperação com fonte, pergunta sem evidência, tentativas cruzadas bloqueadas). | ⬜ |
