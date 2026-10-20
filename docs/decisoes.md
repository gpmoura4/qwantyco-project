# Log de decisões

Formato: data · contexto · opções · decisão · motivo (e risco, quando a decisão foi contra a recomendação).

---

## D01 — Stack: PDF + LangChain JS
- **Data:** 2026-10-19
- **Contexto:** o PDF exige TypeScript + Next.js + LangGraph + LangSmith.
- **Opções:** (a) só LangGraph, com chamadas de modelo e tools escritas à mão; (b) LangGraph como orquestrador + LangChain JS para modelo de chat, mensagens, tools (Zod) e `bindTools`.
- **Decisão:** (b). Usar apenas APIs atuais (LangChain/LangGraph 1.x); proibido `AgentExecutor`, `LLMChain`, `@langchain/classic`. Em dúvida, consultar docs.langchain.com.
- **Motivo:** LangChain padroniza modelo, mensagens e tools; tools definidas com Zod dão validação de contrato e aparecem automaticamente como runs no LangSmith.

## D02 — Gerenciador de pacotes: npm
- **Data:** 2026-10-19
- **Opções:** npm (já instalado, `package-lock.json`, `npm ci` sem passo extra) · pnpm (mais rápido e estrito, mas exige instalação via corepack).
- **Decisão:** npm.
- **Motivo:** familiaridade (era o padrão na Branddi) e zero instalação extra para quem clonar o repositório.

## D03 — Versão do Node: 24 LTS
- **Data:** 2026-10-19
- **Contexto:** a máquina local roda Node 26.10.0, sem gerenciador de versões (nvm/fnm). Em 2026-10-19, o Node 24 é a LTS ativa ("Krypton") e o 26 ainda não é LTS.
- **Opções:** 24 LTS · 26 (local, ainda "Current") · 22 LTS (mais antiga).
- **Decisão:** `.nvmrc` = `24` e `engines.node` = `>=24`.
- **Motivo:** LTS é a escolha mais previsível para quem clonar e avaliar.
- **Risco/mitigação:** desenvolvimento local acontece no 26. No Passo 1, `npm test` e `npm run build` foram validados nas duas versões (24.22.0 e 26.10.0). Repetir a validação no 24 antes da entrega final.

## D04 — Framework de testes: Vitest
- **Data:** 2026-10-19
- **Opções:** Vitest (TS/ESM nativos, quase sem configuração) · Jest (mais conhecido, exige ts-jest/SWC e tem atrito com ESM dos pacotes LangChain).
- **Decisão:** Vitest 5.
- **Motivo:** mais rápido, sem configuração de transpilação, e o SDK do LangSmith tem integração com Vitest.

## D05 — Estrutura de pastas: projeto Next único com core isolado
- **Data:** 2026-10-19
- **Contexto:** testes offline e avaliação no LangSmith precisam rodar o mesmo grafo sem subir o Next.
- **Opções:** (A) um projeto Next com `src/agent/` como core, que nunca importa `next` · (B) monorepo com workspaces (`packages/agent` + `apps/web`).
- **Decisão:** (A). Estrutura:
  - `src/app/` — Next.js (UI e rotas de API finas, só chamam o core)
  - `src/agent/` — core sem dependência do Next (domínio, grafo, modelo)
  - `evals/` — dataset, avaliador e runner do LangSmith
  - `tests/` — testes offline (Vitest)
  - `docs/` — requisitos, plano, decisões (`docs/references/` fora do git)
- **Motivo:** um único `package.json`, simples de explicar. A fronteira entre core e Next é por convenção (regra no CLAUDE.md), não imposta por ferramenta.
- **Consequência:** scripts TS fora do Next (eval) vão precisar de um executor (`tsx`), que só será instalado no Passo 9a.

## D06 — Convenção de idioma
- **Data:** 2026-10-19
- **Opções:** (a) PT na fronteira com o modelo (nomes de tools e campos) e EN no resto · (b) PT apenas no texto ao usuário e na documentação, EN em todo o resto.
- **Decisão:** (b).
  - **PT:** texto ao usuário (UI, respostas, mensagens de erro), system prompt e documentação.
  - **EN:** código, identificadores, comentários e commits.
  - **Exceções obrigatórias do PDF:** a tool `listar_chamados`, o argumento `situacao` e o valor `"aberto"` (exigido literalmente no critério da avaliação).
  - As duas tools de nome livre terão nomes em inglês (definidos no Passo 2).
- **Risco registrado:** a lista de tools que o modelo vê mistura idiomas (`listar_chamados` em PT, as outras em EN), o que pode parecer inconsistente na apresentação. O impacto no modelo deve ser baixo, porque ele escolhe a tool pela descrição. **Mitigação:** descrições de tools claras e padronizadas. Explicar na entrevista que os nomes em PT são exigência do contrato de avaliação.
- **A definir no Passo 2:** idioma das descrições das tools e dos campos que o modelo vê.

## D07 — Provedor de LLM: modelo local via Ollama
- **Data:** 2026-10-19
- **Contexto:** o PDF exige um modelo real (local ou via API) em pelo menos uma execução da avaliação, com o modelo identificado e a configuração documentada.
- **Opções:** (a) API de provedor (Anthropic, OpenAI, Google): tool-calling mais confiável e avaliação estável, mas com custo/cota e dados saindo da máquina · (b) modelo local via Ollama (`@langchain/ollama`): sem custo e dados locais, mas modelos menores erram mais em tool-calling e consomem hardware.
- **Decisão:** (b), modelo local via Ollama (v0.33.0 já instalado). O modelo específico será escolhido no fim do Passo 3, com um smoke de tool-calling.
- **Motivo (Guilherme):**
  1. **Soberania de dados:** o PDF diz que a Qwantyco cria "IA proprietária com soberania de dados". Rodar local mantém dados e prompts na máquina.
  2. **Controle da execução:** com um modelo local sabemos exatamente qual modelo, versão e parâmetros estão rodando, e observamos seu comportamento real, em vez de chamar um serviço externo e torcer pelo melhor.
  3. **Escopo:** o teste usa 3 tools e dados mockados, e um modelo menor tende a ser suficiente.
  4. **Custo:** evita pagar API externa.
  5. **Hardware:** MacBook M2 com 24 GB de RAM roda modelos de porte médio com folga razoável.
- **Riscos e mitigações:**
  - Modelos pequenos podem errar a tool ou os argumentos. É exatamente o cenário que o executor (allowlist + validação Zod) e as guardas de negócio no backend precisam cobrir, e o PDF pede que o bloqueio não dependa só do prompt.
  - O resultado da avaliação pode variar entre execuções. Os testes offline usam modelo falso (determinístico), e a avaliação real é separada.
  - Latência maior que a de uma API. O timeout por tool e o limite de execução ativa precisam considerar isso (Passo 5).
- **Implementação:** um único provedor, sem fábrica multi-provedor. Variáveis `OLLAMA_BASE_URL` e `OLLAMA_MODEL` no `.env`.

## D08 — Opções do esqueleto Next.js
- **Data:** 2026-10-19
- **Decisão:** `create-next-app@16.4.2` com App Router, `src/`, TypeScript `strict`, ESLint, alias `@/*`.
  - **Sem:** Tailwind, React Compiler, Cache Components.
  - **Removidos do template:** Google Fonts (o build não depende de rede) e os assets de demonstração.
- **Motivo:** UI simples e o mínimo de dependências que preciso explicar.

## D09 — Manter o `AGENTS.md` gerado pelo Next
- **Data:** 2026-10-19
- **Contexto:** o `next dev` (16.4) cria e recria um `AGENTS.md` que orienta agentes de código a ler a documentação da versão instalada em `node_modules/next/dist/docs/`.
- **Opções:** manter e versionar · desligar com `agentRules: false` no `next.config.ts`.
- **Decisão:** manter e versionar; o CLAUDE.md aponta para ele.
- **Motivo:** reforça a regra de consultar documentação atual em vez de memória. Se não for versionado, o arquivo reaparece como alteração pendente a cada `next dev`.

## D10 — Segredos e materiais fora do git
- **Data:** 2026-10-19
- **Decisão:**
  - `.env*` ignorado, exceto `.env.example` (só nomes de variáveis, sem valores).
  - `docs/references/` e `*.pdf` ignorados.
  - Chaves nunca em código, logs, traces ou commits.
- **Motivo:** o PDF proíbe enviar segredos; o material de apoio do desafio não deve ser publicado.

## D11 — Duplicidade de escalonamento: idempotência por proposta + bloqueio por chamado
- **Data:** 2026-10-19
- **Contexto:** o PDF diz que "repetir a aprovação não pode duplicar o registro". Falta definir o que é a "mesma operação".
- **Opções:**
  1. Chave por conteúdo: hash de (chamado + resumo + justificativa).
  2. Chave por **id da proposta** (só resolve aprovações repetidas da mesma proposta).
  3. Id da proposta **e** bloqueio de um segundo escalonamento para um chamado que já foi escalonado.
- **Decisão:** (3).
- **Explicação, em duas camadas:**

  **Camada 1 — idempotência por proposta (o que o PDF pede).** Cada proposta recebe um id único quando é criada, por exemplo `prop-7f3a`. O botão "Aprovar" envia esse id. O backend:
  1. confere se ele corresponde à proposta pendente daquela sessão;
  2. registra o escalonamento associado ao id;
  3. se a mesma aprovação chegar de novo, devolve o registro que já existe em vez de criar outro.

  > *Exemplo:* o usuário clica duas vezes em "Aprovar" na proposta `prop-7f3a` do CH-101, ou a rede reenvia a requisição. Resultado: um único registro `ESC-001`. A segunda resposta diz que a operação já foi registrada e aponta o mesmo `ESC-001`.

  **Camada 2 — bloqueio por chamado (proteção extra).** Se o CH-101 já tem um escalonamento registrado, uma nova tentativa de escalonar o CH-101 é recusada. A recusa acontece antes de virar proposta e de novo no momento do registro.

  > *Exemplo:* de manhã o CH-101 foi escalonado (`ESC-001`). À tarde, na mesma sessão ou em outra, alguém pede "escalone o CH-101". O modelo gera uma proposta nova, com outro id e um resumo escrito de outro jeito. Sem a camada 2, isso viraria `ESC-002`, e a equipe receberia dois alertas para o mesmo problema. Com a camada 2, a resposta é: "O CH-101 já foi escalonado (ESC-001)".

  **Por que não usar hash do conteúdo (opção 1)?** O LLM reescreve o texto a cada vez. "Cliente sem acesso ao sistema" e "Cliente não consegue acessar o sistema" geram hashes diferentes, e a duplicata passaria. O conteúdo gerado por modelo não serve como chave de identidade; ids e regras de negócio servem.
- **Trade-off aceito:** não é possível reescalonar legitimamente um chamado (por exemplo, se o problema piorou). Fica fora do escopo e vai para as limitações do README.

## D12 — Plano incremental e cadência de git
- **Data:** 2026-10-19
- **Decisão:** plano de 11 passos em `docs/plano.md`. Mudanças em relação ao rascunho:
  - o Passo 6 foi dividido em API (6) e UI (7);
  - a avaliação foi dividida em offline (9a) e modelo real (9b);
  - a validação de tool desconhecida e de argumentos inválidos foi antecipada para o Passo 3;
  - foi incluído um smoke com o modelo real no fim do Passo 3.

  Git: commit ao fim de cada passo após o OK; push nos passos 1, 3, 5, 7, 9b, 10 e 11.
- **Motivo:** cada passo termina com algo verificável. Os riscos maiores (tool-calling do modelo local, avaliação) aparecem cedo.

## D13 — Validação de contratos com Zod 4
- **Data:** 2026-10-19
- **Opções:** Zod 4 · validação manual.
- **Decisão:** `zod@^4` (4.6.7). Compatível com `@langchain/core` 1.2 (`^3.25.76 || ^4`) e `@langchain/langgraph` 1.5 (`^4.2.0`).
- **Motivo:** um schema serve ao mesmo tempo como validação em tempo de execução, tipo TypeScript (`z.infer`) e JSON Schema da tool para o modelo (Passo 3). Validação manual seria mais código e perderia essa integração.

## D14 — Nomes das tools e dos argumentos
- **Data:** 2026-10-19
- **Opções:** `get_ticket` + `register_escalation` · `get_ticket` + `escalate_ticket`.
- **Decisão:** `listar_chamados(situacao)` (obrigatório pelo PDF), `get_ticket(chamado_id)` e `register_escalation(chamado_id, resumo, justificativa)`. Tudo que o modelo vê fica em snake_case. (Argumentos em PT desde a D20.)
- **Motivo:** `register_escalation` traduz literalmente "Registrar escalonamento" do PDF e deixa explícito que é uma operação de escrita.

## D15 — Descrições das tools e dos campos em português
- **Data:** 2026-10-19
- **Opções:** PT · EN.
- **Decisão:** PT (fecha o ponto pendente da D06).
- **Motivo:** as descrições são instruções ao modelo, da mesma natureza do system prompt (PT pela D06). Também ficam coerentes com as mensagens do usuário em PT.

## D16 — Formato do chamado e massa de dados
- **Data:** 2026-10-19
- **Opções:** campo de estado `situacao` · `status`.
- **Decisão:**
  - Chamado = `{ id, titulo, descricao, cliente, situacao }` (campos em PT desde a D20), com `situacao` no enum fechado `"aberto" | "resolvido"`.
  - Massa: CH-101 e CH-103 abertos, CH-102 e CH-104 resolvidos. **Nenhum outro aberto.**
  - O `chamado_id` é normalizado (`" ch-101 "` vira `"CH-101"`) e validado no formato `CH-<número>`.
  - Os mocks são validados pelo schema no carregamento, e as funções devolvem cópias (ninguém altera os mocks).
- **Motivo:** o campo de estado tem o mesmo nome do filtro, então o modelo não precisa mapear `situacao` para `status`. Um terceiro chamado aberto quebraria o critério "sem registros extras" do caso obrigatório. (Resolve P1 e P2.)

## D17 — Erros de negócio como dado, não como exceção
- **Data:** 2026-10-19
- **Opções:** (a) retorno `{ ok: true, data } | { ok: false, error: { code, message } }` · (b) lançar exceções tipadas.
- **Decisão:** (a) para erros de negócio. Os códigos atuais são `TICKET_NOT_FOUND`, `TICKET_NOT_OPEN` e `ALREADY_ESCALATED`, e as mensagens ficam em PT. Exceção fica reservada para falha técnica (por exemplo, a falha transitória do Passo 5, que terá retry).
- **Motivo:** o modelo recebe o erro como resultado da tool e não tem como entender que a operação ocorreu. O teste checa o `code`, e o trace mostra o erro estruturado. Separar o erro esperado (negócio) da falha técnica deixa claro o que deve ter retry.

## D18 — Store de escalonamentos em memória e injetável (sem banco)
- **Data:** 2026-10-19
- **Opções:** (a) `createEscalationStore()` injetado nas funções · (b) variável global do módulo com `reset()` para os testes · (c) banco de dados (SQLite/Postgres).
- **Decisão:** (a).
  - `registerEscalation(store, input)` aplica as guardas: chamado existe, está aberto e ainda não foi escalonado (camada 2 da D11).
  - A idempotência por id da proposta (camada 1) fica para o Passo 4.
- **Motivo:**
  - Cada teste cria o seu store, sem contaminação entre testes.
  
- **Trade-off aceito:** reiniciar o servidor apaga os escalonamentos. Vai para as limitações do README.

## D19 — O escalonamento não muda a situação do chamado
- **Data:** 2026-10-19
- **Contexto:** depois de escalonado, o chamado deveria mudar de situação (por exemplo, para "escalonado")?
- **Opções:** (a) mudar a `situacao` do chamado · (b) manter o chamado intacto e guardar os escalonamentos numa coleção separada, ligada pelo `chamado_id`.
- **Decisão:** (b).
- **Motivo:**
  - Os chamados são a massa mockada de leitura, e o escalonamento é um registro novo e independente, como "registrar" sugere no PDF.
  - Mudar a situação teria dois efeitos ruins:
    - criaria um terceiro valor no enum de `situacao`;
    - faria o CH-101 sumir de `listar_chamados({situacao:"aberto"})` depois de escalonado, e o caso obrigatório da avaliação ("CH-101 e CH-103") passaria a depender da ordem em que os testes rodam.
  - "Já foi escalonado?" é respondido consultando a coleção de escalonamentos (`findByTicketId`), não o chamado.
- **Verificação:** teste "keeps the ticket untouched" em `tests/domain.test.ts`.

## D20 — Campos de domínio em português
- **Data:** 2026-10-19
- **Contexto:** `situacao` é obrigatório pelo PDF. Com os outros campos em inglês, o mesmo objeto misturava idiomas (`{ title, customer, situacao }`).
- **Opções:** (a) campos de domínio em EN, com exceção de `situacao` · (b) todos os campos de domínio em PT.
- **Decisão:** (b). Ajusta a D06, a D14 e a D16.
  - **Chamado:** `{ id, titulo, descricao, cliente, situacao }`.
  - **Escalonamento:** `{ id, chamado_id, resumo, justificativa }`.
  - **Argumentos das tools:** `get_ticket(chamado_id)` e `register_escalation(chamado_id, resumo, justificativa)`.
  - **Continuam em EN:** nomes das tools (`get_ticket`, `register_escalation`, D14), identificadores de código (funções, tipos, variáveis), o envelope técnico do resultado (`ok`, `data`, `error`, `code`, `message`) e os códigos de erro (`TICKET_NOT_FOUND` etc.).
- **Motivo:** coerência com o campo obrigatório `situacao` e com o vocabulário do PDF ("chamado, resumo e justificativa"). O modelo vê dados e argumentos no mesmo idioma das mensagens do usuário.

## D21 — Dependências do grafo
- **Data:** 2026-10-19
- **Decisão:**
  - **Runtime:** `@langchain/core` 1.2.18, `@langchain/langgraph` 1.5.1 e `@langchain/ollama` 1.3.0.
  - **Dev:** `tsx` 4.23, antecipado do Passo 9a para rodar `scripts/smoke.ts`. Ele entende o alias `@/`, que o type-stripping nativo do Node não aceita.
  - **Ajuste depois da aprovação:** o `fakeModel()` que a documentação mostra importado de `langchain` é só um re-export de `@langchain/core/testing`. Por isso o pacote `langchain` foi **desinstalado**: é o mesmo modelo falso, com uma dependência a menos.
- **Motivo:** o mínimo da stack definida (D01). Uma única cópia do `@langchain/core` na árvore (verificado com `npm ls`).

## D22 — Estado do grafo com `StateSchema`
- **Data:** 2026-10-19
- **Opções:** (a) `StateSchema` + `MessagesValue` · (b) `Annotation.Root` / `MessagesAnnotation`.
- **Decisão:** (a), começando só com `messages`. Os campos da proposta (Passo 4) e do orçamento de execução (Passo 5) entram quando forem necessários.
- **Motivo:** é a forma atual da documentação do LangGraph JS 1.x (consultada em 2026-10-19), usa Zod e o `MessagesValue` já traz o reducer que acrescenta mensagens. `Annotation.Root` ainda funciona, mas a documentação atual não o mostra mais.

## D23 — Executor próprio em vez de `ToolNode` ou `createAgent`
- **Data:** 2026-10-19
- **Opções:** (a) `StateGraph` + nó executor próprio · (b) `StateGraph` + `ToolNode` pronto · (c) `createAgent` com middlewares.
- **Decisão:** (a). O grafo é `callModel → (executeTools → callModel)* → END`. Para cada tool call, `executeToolCall` (em `src/agent/executor.ts`):
  1. confere a **allowlist** (nome desconhecido → `UNKNOWN_TOOL`);
  2. valida os argumentos com o **schema Zod** da tool (inválido → `INVALID_ARGS`, nada é executado);
  3. executa via `tool.invoke()`, que aparece como run de tool no LangSmith;
  4. devolve um `ToolMessage` com o `ToolResult` em JSON e `status` `success` ou `error`.
- **Motivo:** cada regra fica visível num arquivo só, que é a frase do PDF "o executor valida e executa a função mockada". Aprovação (Passo 4) e retry/timeout (Passo 5) entram no mesmo nó. O `ToolNode` deixaria allowlist e validação implícitas, e o `createAgent` esconderia o grafo.
- **Segurança incremental:** no Passo 3 a allowlist tem só `listar_chamados` e `get_ticket`. O `register_escalation` só entra no Passo 4, junto com o `interrupt`, então nunca existiu um caminho em que o registro rode sem aprovação (há um teste que prova isso).

## D24 — Modelo injetável e modelo falso nos testes
- **Data:** 2026-10-19
- **Decisão:**
  - `buildGraph({ model, checkpointer })`: o app e o smoke passam o `ChatOllama` (`src/agent/model.ts`, configurado só por variável de ambiente, `temperature: 0`), e os testes passam o `fakeModel()` de `@langchain/core/testing`.
  - O `escalationStore` só entra no `buildGraph` no Passo 4, quando houver tool de escrita.
  - O checkpointer é o `MemorySaver`, com uma `thread_id` por sessão.
- **Opções do modelo falso:** `fakeModel()` (recomendado pela documentação, fila de respostas e registro das chamadas em `model.calls`) · `FakeStreamingChatModel` (semântica pouco clara) · fake escrito à mão (mais código).
- **Motivo:** o PDF exige que os testes offline passem "pelo mesmo grafo e executor". O `model.calls` permite provar o T07: a sessão B não recebeu as mensagens da sessão A.

## D25 — Escolha do modelo local: smoke comparativo
- **Data:** 2026-10-19
- **Contexto:** `npm run smoke` roda 4 conversas (listar abertos, consultar o CH-102, consultar o CH-999, consultar o CH-101 + follow-up) com cada modelo já instalado.
- **Resultado:**

  | Modelo (Ollama) | Tool calls | Fidelidade | Observação |
  |---|---|---|---|
  | `qwen2.5:7b-instruct-q4_K_M` | 5/5 corretas | fiel em todos | objetivo; usou o contexto no follow-up |
  | `llama3.1:8b-instruct-q4_K_M` | 5/5 corretas | especulou no CH-999 ("pode ter sido cancelado…") | erros de português |
  | `gemma2:9b-instruct-q4_K_M` | — | — | o Ollama retorna "does not support tools" |
- **Decisão:** `qwen2.5:7b-instruct-q4_K_M`, configurado em `OLLAMA_MODEL`.
- **Motivo:** único modelo fiel ao retorno das tools nos 5 turnos; o llama3.1 especulou num chamado inexistente, o que vai contra a regra "nunca inventar dados".

## D26 — Aprovação humana num nó dedicado (`humanApproval`)
- **Data:** 2026-10-19
- **Contexto:** a documentação do `interrupt` (consultada em 2026-10-19) avisa que, na retomada, **o nó roda de novo desde o começo**. Qualquer efeito colateral antes do `interrupt` se repetiria.
- **Opções:** (a) `interrupt` dentro do executor · (b) nó dedicado `humanApproval`.
- **Decisão:** (b).
  - O `executeTools` valida a tool call `register_escalation` (allowlist, Zod e regras de negócio via `checkEscalationAllowed`) e, se passar, grava `pendingProposal` no estado **sem registrar nada**.
  - O grafo segue para `humanApproval`, que chama `interrupt(proposta)`. Nada com efeito colateral roda antes desse ponto.
  - Depois da decisão, o nó registra (ou não) e o fluxo vai para END.
  - Novo campo no estado: `pendingProposal: { proposal, toolCallId } | null`. O id da proposta é `prop-<uuid>`, gerado no `executeTools` (que não roda de novo na retomada).
  - O `register_escalation` está na allowlist com `requiresApproval: true`. A função da tool lança erro se for executada direto.
- **Motivo:** segue a recomendação da documentação (efeito colateral fora do trecho re-executado), e o LangSmith mostra um nó "humanApproval" pausado e retomado. O chamado resolvido é barrado **antes** de virar proposta (T02), então ninguém aprova algo inválido.
- **Resolve:** P3 (com um ajuste: o `interrupt` fica no nó dedicado, não no executor) e P4 (guarda na proposta e de novo no registro).

## D27 — Validação da aprovação no backend: três barreiras
- **Data:** 2026-10-19
- **Decisão:**
  1. **`decideProposal()`** (`src/agent/approval.ts`): antes de retomar, lê a proposta pendente da sessão (`getPendingProposal`).
     - Sem proposta pendente: devolve o registro existente, se a proposta já foi aprovada (idempotente), ou `NO_PENDING_PROPOSAL`.
     - Id diferente: `PROPOSAL_MISMATCH`, sem tocar no grafo.
     - Só retoma com `Command({ resume })` se o id bater.
  2. **`responseSchema` Zod no `interrupt`:** o valor de retomada precisa ser `{ proposta_id, decisao: "aprovar" | "rejeitar" }`. Fora disso, o LangGraph lança erro e o grafo continua pausado. O nó também confere o `proposta_id` (defesa caso alguém retome o grafo sem passar pela função).
  3. **Store idempotente por proposta:** o escalonamento guarda `proposta_id`, e `registerEscalation` devolve o registro existente se a mesma proposta chegar de novo. É a garantia final, mesmo com dois cliques simultâneos.
- **Nomes:** o payload de decisão usa campos em PT (`proposta_id`, `decisao`, `"aprovar"`/`"rejeitar"`), por coerência com a D20. Na proposta da conversa estava escrito `{ proposalId, decision }`.
- **Motivo:** o PDF exige que a aprovação seja "validada no backend e vinculada à proposta" e que repeti-la "não duplique o registro". Defesa em camadas: na mutação que removeu a barreira 1, a barreira do nó ainda impediu o registro.

## D28 — Confirmação de escrita determinística (não escrita pelo LLM)
- **Data:** 2026-10-19
- **Opções:** (a) o LLM escreve a mensagem depois de aprovar ou rejeitar · (b) rejeitar é determinístico, aprovar passa pelo LLM · (c) as duas são determinísticas.
- **Decisão:** (c). O `humanApproval` grava o `ToolMessage` com o resultado real e uma `AIMessage` montada pelo código (`confirmationText`), e vai para END:
  - "Escalonamento ESC-001 registrado para o chamado CH-101."
  - "Escalonamento rejeitado. Nada foi registrado."
  - "Não foi possível registrar o escalonamento: …"
- **Motivo:** "nunca confirmar operação que não ocorreu" vale **por construção**: a confirmação de uma escrita nunca depende de um modelo probabilístico. Também cumpre ao pé da letra "se a pessoa rejeitar, encerre sem registrar". A conversa continua normalmente com o LLM na mensagem seguinte, e o histórico contém o resultado.
- **Verificação com o modelo real (smoke):** o qwen2.5 consultou o CH-101, propôs, foi aprovado e virou ESC-001; o CH-103 foi rejeitado sem registro; no CH-102 o modelo nem propôs. Observação: o modelo acrescentou uma inferência na justificativa ("afetando a operação diária"), o que reforça o valor de a pessoa ver a proposta exata antes de aprovar.

---

## Propostas em aberto (confirmar no passo indicado)

| # | Proposta | Passo |
|---|----------|-------|
| P6 | Falha transitória determinística e injetável (por exemplo, falhar as N primeiras chamadas), nunca aleatória. | 5 |
| P7 | Checkpointer e registros em memória ancorados em `globalThis`, para sobreviver ao HMR do `next dev`. | 6 |
| P8 | Garantir o envio dos traces antes de a resposta da rota Next terminar (confirmar na documentação do LangSmith). | 8 |
| P9 | Como o runner da avaliação trata um `interrupt` (casos da avaliação devem ficar em consulta). | 9a |
| Q2 | Definição do "limite total de execução ativa": orçamento de tempo de relógio por execução, pausado durante o `interrupt`, mais um máximo de voltas modelo↔tool. | 5 |
