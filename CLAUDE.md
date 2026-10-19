# CLAUDE.md — Aurora (desafio técnico Qwantyco)

## Objetivo
Assistente de suporte para a empresa fictícia Aurora. Ele consulta chamados, lista os abertos e prepara escalonamentos que só são registrados após aprovação humana. O foco é correção, tools, controle de execução, testes e observabilidade (LangSmith). O Guilherme precisa conseguir explicar cada parte na apresentação.
- Especificação: `docs/references/qwantyco-desafio-tecnico.pdf` (fora do git)
- Requisitos com IDs: `docs/requisitos.md`

## Stack (versões fixadas)
- Node **24 LTS** (`.nvmrc`, `engines`), npm, TypeScript 5.9 `strict`
- Next.js 16.4.2 (App Router, `src/`), React 19.3
- Vitest 5
- `@langchain/core` 1.2, `@langchain/langgraph` 1.5 (`StateSchema`, `MemorySaver`), `@langchain/ollama` 1.3, Zod 4. Modelo falso: `fakeModel()` de `@langchain/core/testing`.
- LangSmith (tracing + evaluation)
- LLM local via Ollama (`ChatOllama`, `temperature: 0`); modelo em `OLLAMA_MODEL` (ver D25)
- APIs atuais apenas. Proibido: `AgentExecutor`, `LLMChain`, `@langchain/classic`. Em dúvida, consultar docs.langchain.com antes de escrever código.
- Next.js: ler o guia da versão instalada em `node_modules/next/dist/docs/` (ver `AGENTS.md`).

## Regras de colaboração
1. **O Guilherme tem a palavra final.** O Claude recomenda e ele decide. Se a decisão for contra a recomendação, registrar o risco em `docs/decisoes.md` e seguir.
2. **Nenhuma decisão relevante sem ele.** Vale para biblioteca, padrão de arquitetura, pastas e formato de estado. Apresentar 2–3 opções, os trade-offs, a recomendação com motivo, e **parar e esperar**.
3. Detalhes triviais (nome de variável local, ordem de imports) o Claude decide sozinho.
4. **Um passo por vez.** Só o passo atual do plano, sem adiantar código. Ao terminar, parar e esperar o OK.
5. **Simplicidade.** A solução mais simples que atende ao PDF. Sem abstrações "para o futuro". Cada arquivo e cada dependência precisa de um motivo explicável em uma frase. **Nenhuma dependência nova sem aprovação.**
6. Comunicação em português, clara e objetiva.
7. **Relatório ao fim de cada passo:** o que foi feito · decisões (e quem decidiu) · como verificar (comandos e o que ver) · o que saber para a entrevista (3–5 bullets) · próximo passo.
8. **Log de decisões:** toda decisão relevante vai para `docs/decisoes.md` com data, contexto, opções, decisão e motivo (e o risco, se a decisão for contra a recomendação).
9. **Nunca dizer que algo funciona sem verificar.** Teste falhou, comando deu erro ou não deu para verificar: dizer claramente.
10. **Segredos** só no `.env` (fora do git). Nunca em código, logs, traces ou commits. O `.env.example` não tem valores.

## Comandos
```bash
npm install        # instalar dependências
npm run dev        # Next.js em http://localhost:3000
npm run build      # build de produção (inclui typecheck)
npm test           # testes offline (Vitest, modelo falso, sem rede)
npm run test:watch # testes em modo watch
npm run lint       # ESLint
npm run smoke      # smoke manual com o modelo real (Ollama); não faz parte do npm test
# npm run eval     # avaliação no LangSmith — criado no Passo 9
```

## Estrutura de pastas
```
src/app/     Next.js: UI e rotas de API finas, que só chamam o core
src/agent/   Core do agente (domínio, mocks, tools, grafo, modelo). NUNCA importa `next`
evals/       Dataset, avaliador por código e runner do LangSmith (Passo 9)
tests/       Testes offline (Vitest). Usam modelo falso e passam pelo mesmo grafo/executor
scripts/     Scripts manuais com modelo real (smoke), rodados com tsx
docs/        requisitos.md, plano.md, decisoes.md; references/ fica fora do git
```
`src/agent/` e `evals/` são criados nos passos em que forem necessários.

## Regras de negócio invioláveis (PDF)
- **Só chamados abertos podem ser escalonados.** A checagem fica no backend (na proposta e de novo no registro), não só no prompt.
- **Nunca inventar dados** nem confirmar uma operação que não ocorreu. A resposta usa o retorno real da tool.
- **Aprovação validada no backend**, vinculada à proposta pendente (id da proposta). Repetir a aprovação **não duplica** o registro, e um chamado já escalonado não é escalonado de novo (D11).
- Rejeição encerra sem registrar.
- **Não depender só do prompt para bloquear ações.** O executor valida a allowlist de tools, os argumentos (Zod) e as regras de negócio.
- O modelo emite a tool call; o executor valida e executa. Nada de resposta fixa.
- Massa obrigatória: CH-101 e CH-103 abertos, CH-102 resolvido. Nenhum outro chamado aberto (quebraria a avaliação).
- Só dados fictícios.

## Convenções de código
- **Idioma:** código, identificadores, comentários e commits em inglês. Texto ao usuário (UI, respostas, erros), system prompt e docs em português.
- **Nomes obrigatórios do PDF:** tool `listar_chamados`, argumento `situacao`, valor `"aberto"`. As outras tools têm nome em inglês (`get_ticket`, `register_escalation`).
- **Campos de domínio em PT** (D20): chamado `{ id, titulo, descricao, cliente, situacao }`, escalonamento `{ id, chamado_id, resumo, justificativa }`, e os argumentos das tools. Envelope técnico (`ok`, `data`, `error`, `code`, `message`) e códigos de erro ficam em EN.
- O escalonamento **não altera** o chamado: fica numa coleção separada (D19).
- TypeScript `strict`. Contratos de entrada e saída das tools validados com Zod.
- Imports do core via alias `@/` (ex.: `@/agent/...`).
- Testes em `tests/**/*.test.ts`, offline, determinísticos, sem rede e sem LLM real. Falhas simuladas são injetáveis, não aleatórias.
- Variáveis de ambiente lidas só na borda (configuração do modelo e LangSmith), nunca hardcoded.
- Commits em inglês no formato Conventional Commits (`feat:`, `test:`, `docs:`, `chore:`).

## Documentos vivos
Ao fim de **cada passo**, atualizar:
- `docs/plano.md` (status do passo)
- `docs/requisitos.md` (status dos IDs atendidos)
- `docs/decisoes.md` (novas decisões e propostas em aberto resolvidas)
- `docs/fluxo.md` (diagramas Mermaid de quem chama quem; refletir o código real, nunca o planejado)

## Git: quando commitar e fazer push
- **Commit** ao fim de cada passo, somente após o OK do Guilherme. O Claude nunca commita sem pedir.
- **Push** ao fim dos passos 1, 3, 5, 7, 9b, 10 e 11 (marcos), ou quando o Guilherme pedir.
- Antes de commitar: rodar `npm test` e `npm run build`, e conferir no `git status` que `.env`, PDFs e `docs/references/` não aparecem.
