# Fluxo de execução

Mostra **quem chama quem** entre os arquivos quando o assistente roda. Atualizado ao fim de cada passo.
Os diagramas são Mermaid (renderizam no GitHub e no preview de Markdown do VS Code).

**Estado atual:** Passo 3. O grafo consulta chamados; o escalonamento com aprovação entra no Passo 4.

---

## 1. Mapa de arquivos (quem importa/chama quem)

```mermaid
flowchart TD
    subgraph Entrada["Pontos de entrada"]
        SMOKE["scripts/smoke.ts<br/>(modelo real)"]
        TEST["tests/graph.test.ts<br/>(fakeModel)"]
    end

    subgraph Core["src/agent — core (nunca importa next)"]
        MODEL["model.ts<br/>createChatModel() → ChatOllama"]
        GRAPH["graph.ts<br/>buildGraph() · callModel · executeTools · routeAfterModel"]
        PROMPT["prompt.ts<br/>SYSTEM_PROMPT"]
        EXEC["executor.ts<br/>executeToolCall()"]
        TOOLS["tools.ts<br/>listar_chamados · get_ticket · READ_ONLY_TOOLS"]
        subgraph Domain["domain/ — funções puras"]
            TICKETS["tickets.ts<br/>listTickets() · getTicket() · mocks"]
            SCHEMAS["schemas.ts<br/>contratos Zod · ToolResult · ok/fail"]
            ESC["escalations.ts<br/>createEscalationStore() · registerEscalation()"]
        end
    end

    OLLAMA[("Ollama local<br/>qwen2.5:7b-instruct")]
    SAVER[("MemorySaver<br/>checkpoint por thread_id")]

    SMOKE --> MODEL
    SMOKE --> GRAPH
    TEST --> GRAPH
    MODEL -.->|HTTP| OLLAMA
    GRAPH --> PROMPT
    GRAPH --> TOOLS
    GRAPH --> EXEC
    GRAPH <-.->|"lê e grava o estado"| SAVER
    EXEC --> TOOLS
    EXEC --> SCHEMAS
    TOOLS --> TICKETS
    TOOLS --> SCHEMAS
    TICKETS --> SCHEMAS
    ESC --> TICKETS
    ESC --> SCHEMAS

    classDef pending stroke-dasharray: 5 5
    class ESC pending
```

> `escalations.ts` (tracejado) existe e é testado em `tests/domain.test.ts`, mas **ainda não é chamado pelo grafo**. Ele entra no Passo 4, com a aprovação humana.
>
> O teste não usa `model.ts`: injeta o `fakeModel()` direto no `buildGraph`. O grafo e o executor são os mesmos nos dois casos.

---

## 2. O grafo (nós e arestas do LangGraph)

```mermaid
flowchart LR
    START((START)) --> CM["callModel<br/>(LLM decide)"]
    CM --> R{"routeAfterModel<br/>última AIMessage<br/>tem tool_calls?"}
    R -- sim --> ET["executeTools<br/>(valida e executa)"]
    R -- não --> END((END))
    ET --> CM
```

O loop `callModel → executeTools → callModel` se repete até o modelo responder sem pedir tools.

---

## 3. Sequência completa: "Liste todos os chamados abertos."

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant E as smoke.ts / teste
    participant G as graph.ts
    participant S as MemorySaver
    participant M as Modelo (ChatOllama ou fakeModel)
    participant X as executor.ts
    participant T as tools.ts
    participant D as domain/tickets.ts
    participant Z as domain/schemas.ts

    U->>E: "Liste todos os chamados abertos."
    E->>G: graph.invoke({ messages: [HumanMessage] }, { thread_id })
    G->>S: carrega o histórico do thread_id
    S-->>G: mensagens anteriores (vazio na 1ª vez)

    Note over G: nó callModel
    G->>M: invoke([SystemMessage(prompt.ts), ...messages]) com tools vinculadas (bindTools)
    M-->>G: AIMessage com tool_call listar_chamados { situacao: "aberto" }
    G->>S: checkpoint

    Note over G: routeAfterModel → tem tool_calls → executeTools
    G->>X: executeToolCall(toolCall, allowlist)
    X->>X: 1. allowlist tem "listar_chamados"? sim
    X->>Z: 2. ListTicketsInputSchema.safeParse(args)
    Z-->>X: válido
    X->>T: 3. tool.invoke({ situacao: "aberto" })
    T->>D: listTickets({ situacao: "aberto" })
    D-->>T: { ok: true, data: [CH-101, CH-103] }
    T-->>X: ToolResult
    X-->>G: ToolMessage (JSON do resultado, status "success")
    G->>S: checkpoint

    Note over G: volta para callModel
    G->>M: invoke([System, Human, AIMessage(tool_call), ToolMessage])
    M-->>G: AIMessage "Chamados abertos: CH-101 e CH-103"
    Note over G: routeAfterModel → sem tool_calls → END
    G->>S: checkpoint final
    G-->>E: estado final (messages)
    E-->>U: resposta do assistente
```

Pontos-chave:
- O **modelo nunca executa nada**: ele só devolve uma `AIMessage` com a intenção (nome + argumentos).
- Quem executa é o **executor**, depois de validar. O resultado volta ao modelo como `ToolMessage`, e a resposta final é baseada nele.
- O **MemorySaver** guarda o estado por `thread_id`. Na próxima mensagem da mesma sessão, o histórico é carregado no início do `invoke`.

---

## 4. Decisões dentro do executor (`executeToolCall`)

```mermaid
flowchart TD
    A["tool_call do modelo<br/>{ name, args, id }"] --> B{"name está na<br/>allowlist?"}
    B -- não --> E1["ToolMessage status=error<br/>UNKNOWN_TOOL"]
    B -- sim --> C{"args passam no<br/>schema Zod?"}
    C -- não --> E2["ToolMessage status=error<br/>INVALID_ARGS<br/>(nada é executado)"]
    C -- sim --> D["tool.invoke(args normalizados)<br/>→ função do domínio"]
    D --> F{"ToolResult.ok?"}
    F -- sim --> OK["ToolMessage status=success<br/>{ ok: true, data }"]
    F -- não --> E3["ToolMessage status=error<br/>ex.: TICKET_NOT_FOUND"]
    E1 & E2 & E3 & OK --> G["volta ao grafo → callModel"]
```

Allowlist atual: `listar_chamados`, `get_ticket`. O `register_escalation` **não** está nela até o Passo 4, então chamá-lo hoje retorna `UNKNOWN_TOOL`.

---

## Histórico de atualizações

| Passo | O que mudou no fluxo |
|-------|----------------------|
| 2 | Domínio isolado: `tickets.ts`, `escalations.ts` e `schemas.ts`, chamados só pelos testes. |
| 3 | Grafo `callModel ⇄ executeTools`, executor com allowlist + Zod, tools do LangChain, checkpointer por `thread_id`, entradas `smoke.ts` e testes. |
