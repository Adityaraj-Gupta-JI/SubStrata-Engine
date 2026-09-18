
<div align="center">

# SubStrata Engine

### Serverless-First Multi-Tenant EAV Database and AI Orchestration Platform

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&duration=3000&pause=900&color=7C3AED&center=true&vCenter=true&width=680&lines=Natural+language+%E2%86%92+EAV+JSON+%E2%86%92+executable+PostgreSQL;Zero-DDL+schema+evolution%2C+per-tenant%2C+in+real+time;Bring+your+own+key.+Bring+your+own+database." alt="Typing tagline" />

<br/>

<img src="https://img.shields.io/badge/Domain-DBMS_%2F_Agentic_AI-7C3AED?style=for-the-badge&labelColor=0F172A" alt="Domain" />
<img src="https://img.shields.io/badge/Architecture-Monorepo-06B6D4?style=for-the-badge&labelColor=0F172A" alt="Architecture" />
<img src="https://img.shields.io/badge/Status-Capstone_Project-F59E0B?style=for-the-badge&labelColor=0F172A" alt="Status" />

<br/>

<img src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 15" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/FastAPI-Python_3.11%2F3.14-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
<img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 16" />
<img src="https://img.shields.io/badge/asyncpg-async_driver-336791?style=flat-square" alt="asyncpg" />
<img src="https://img.shields.io/badge/Tailwind-Cyberpunk_Theme-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/license-Owner--Licensed-64748B?style=flat-square" alt="Owner-Licensed" />

</div>

<img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" width="100%" alt="" />


<div align="center">
<sub>📌 <a href="#-overview">Overview</a> · <a href="#-the-problem">Problem</a> · <a href="#-competitor-benchmark">Benchmark</a> · <a href="#%EF%B8%8F-system-architecture">Architecture</a> · <a href="#-tech-stack">Stack</a> · <a href="#-quick-start">Quick Start</a> · <a href="#-team">Team</a></sub>
</div>

--- 

## 📌 Overview

**SubStrata Engine** is a serverless-first, multi-tenant database orchestration platform that parses natural-language queries into structured **Entity-Attribute-Value (EAV)** JSON models and executes them as valid PostgreSQL SQL. It sits between non-deterministic LLM reasoning and deterministic relational persistence — enabling schema evolution without a single `ALTER TABLE`.

It runs a dual **BYOK** (Bring-Your-Own-Key) and **BYODB** (Bring-Your-Own-Database) hybrid model: users supply their own OpenRouter credentials and choose between SubStrata's managed Postgres cluster or their own external database (Supabase, Neon, AWS RDS) — giving full data sovereignty with zero-configuration onboarding.

### Overview Flow

```mermaid
flowchart LR
    U[Natural Language Interface] --> A[SubStrata Agentic Engine]
    K[BYOK OpenRouter Gateway] --> A
    A --> P[Schema & EAV Parsing Pipeline]
    P --> R{Database Route}
    R --> M[Managed PostgreSQL<br/>Multi-Tenant Database]
    R --> B[BYODB Database<br/>Supabase / Neon / AWS RDS]
```

---

## 🎯 The Problem

Modern SaaS applications hit four structural bottlenecks when handling polymorphic user data:

- **Schema rigidity** — traditional RDBMS require explicit `ALTER TABLE` operations for new attributes, causing lockups and downtime at scale.
- **Tenant isolation overhead** — dedicated database instances per tenant are cost-prohibitive; shared multi-tenant tables risk cross-tenant data leaks.
- **Vendor lock-in & LLM cost explosion** — centralized AI platforms force fixed pricing and hardcoded model choices, leading to credit depletion and privacy non-compliance.
- **Data sovereignty violations** — enterprise users won't store proprietary relational data in third-party-hosted DB SaaS without explicit control.

Existing tooling forces a trade-off between **static rigidity** (traditional RDBMS, DB admin UIs) and **non-deterministic insecurity** (raw text-to-SQL generators, which produce invalid queries and offer no live inspection layer).

## 💡 The Solution

SubStrata resolves this with three mechanisms:

- ** Dynamic EAV persistence pipeline ** — entity schemas stored via normalized `entities` / `attributes` / `entity_values` tables, eliminating runtime migrations.
- ** Strict tenant scoping ** — every natural-language query and SQL execution is bound to an immutable `tenant_id` context.
- ** BYOK + BYODB federated runtime ** — users supply OpenRouter credentials and pick between SubStrata's managed instance or their own external database.

It functions as **a deterministic execution boundary around LLM output** — the model reasons freely, but nothing reaches Postgres without passing through validation, tenant scoping, and SSRF checks.

## 🔄 Solution Flow

```mermaid
flowchart LR
    U[User / Natural Language] --> A[SubStrata Agentic Engine]
    A --> P[EAV Parsing + SQL Extraction]
    P --> V[Validation + Tenant Scope + SSRF Checks]
    V --> R{Database Route}
    R --> M[Managed PostgreSQL]
    R --> B[BYODB]
    M --> O[Result]
    B --> O
    O --> I[Live EAV Inspector]
```

---

## 🏆 Competitor Benchmark

<table>
<tr><th>Capability</th><th>Traditional RDBMS<br/>(PostgreSQL)</th><th>DB Admin UI<br/>(Retool / Supabase Studio)</th><th>Raw LLM Text-to-SQL</th><th>SubStrata Engine</th></tr>
<tr><td><b>Dynamic schema expansion</b></td><td>❌ DDL locks required</td><td>❌ Manual DDL editing</td><td>❌ Generates static SQL</td><td>✅ Zero-DDL EAV pipeline</td></tr>
<tr><td><b>BYOK (model choice)</b></td><td>❌ N/A</td><td>❌ N/A</td><td>❌ Fixed model backend</td><td>✅ Dynamic OpenRouter routing</td></tr>
<tr><td><b>BYODB (database choice)</b></td><td>❌ Fixed host</td><td>⚠️ Complex config</td><td>❌ No native execution</td><td>✅ Dual-track: Managed vs BYODB</td></tr>
<tr><td><b>Multi-tenant isolation</b></td><td>⚠️ Manual RLS rules</td><td>⚠️ Manual filtering</td><td>❌ High hallucination risk</td><td>✅ Programmatic tenant scope</td></tr>
<tr><td><b>Live visual EAV inspector</b></td><td>❌ Relational viewer only</td><td>❌ Relational viewer only</td><td>❌ Terminal text only</td><td>✅ Live inspector table</td></tr>
</table>

## ⚡ Novelty & Technical Innovation

<table>
<tr><td width="50%" valign="top">

#### 🧩 Deterministic EAV Parsing Layer
Transforms arbitrary natural-language input into structured EAV JSON before translating it into execution-safe PostgreSQL — the LLM never talks to the database directly.

</td><td width="50%" valign="top">

#### 🔀 Federated Execution Engine
Hot-swaps target async database drivers (`asyncpg`) at request time without requiring an application container restart.

</td></tr>
<tr><td width="50%" valign="top">

#### 🛡️ SSRF Guardrail Isolation
Network sanitization blocks internal endpoints (`127.0.0.1`, AWS metadata endpoints) when a user-supplied BYODB connection string is used.

</td><td width="50%" valign="top">

#### ♾️ Zero-DDL Attribute Mutation
Infinite attributes can be attached to entities dynamically, per tenant, without table lockups.

</td></tr>
</table>

---

## 🏗️ System Architecture

```mermaid
flowchart LR
    F[Frontend<br/>Next.js 15 + React 19]
    G[FastAPI<br/>API Gateway]
    A[Agentic Layer<br/>OpenRouter + EAV/SQL]
    E[Execution<br/>SSRF + SQL Checks]
    D[(PostgreSQL<br/>EAV)]
    F --> G --> A --> E --> D
```

| Layer | Key Components | Responsibility |
|---|---|---|
| **Frontend** | Next.js 15, React 19 | Key management, model selection, query terminal, live EAV inspection |
| **Gateway** | FastAPI | Router handling, tenant ID injection and header extraction |
| **Agentic** | OpenRouter | Prompt generation, model querying, EAV JSON and SQL extraction |
| **Execution** | SSRF checks, `asyncpg` | Security verification, forbidden-statement checks and database routing |
| **Persistence** | PostgreSQL | `entities`, `attributes`, and `entity_values` persistence |

### Core Modules

| Module | Responsibility |
|---|---|
| `app.routers.api` | Orchestrates key verification, model choice, dynamic prompt generation, and chat endpoints |
| `app.tools.db_tools` | Executes sanitized SQL, enforces forbidden-statement checks (`DROP DATABASE`, `TRUNCATE`), manages tenant filters |
| `app.database.connection` | Async session factories, connection pooling, `.env` parsing |
| `frontend/src/app/page.tsx` | Single-page dashboard — key management, model selection, query terminal, live DB inspection |

### Runtime Paths

| Mode | User Provides | Destination |
|---|---|---|
| **BYOK** | Personal OpenRouter API key | OpenRouter model runtime |
| **BYODB** | Database connection string | User's external database |
| **Managed SaaS** | Managed option | SubStrata multi-tenant PostgreSQL |

### Request Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as FastAPI
    participant L as OpenRouter
    participant D as Target DB

    U->>F: Natural-language query
    F->>A: Query + tenant context + API key
    A->>L: Prompt + tenant boundary
    L-->>A: EAV JSON + SQL
    A->>A: Security + validation checks
    A->>D: Execute via asyncpg
    D-->>A: Result
    A-->>F: Parsed output
    F-->>U: Live EAV Inspector
```

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend framework** | Next.js 15 (Turbopack, React 19 Client Components) |
| **Styling** | Tailwind CSS — Cyberpunk / Brutalist theme |
| **Icons** | Lucide React |
| **State management** | React Hooks (`useState`, `useEffect`, `useRef`) |
| **Backend framework** | FastAPI (Python 3.11 / 3.14 compatible) |
| **ASGI server** | Uvicorn (hot-reloading enabled) |
| **Async DB driver** | `asyncpg` + `psycopg2-binary` |
| **ORM / query builder** | SQLAlchemy (async extension) |
| **HTTP client** | `httpx` (async OpenRouter communication) |
| **Env management** | `python-dotenv` |
| **Database** | PostgreSQL 16 |
| **Schema layout** | Entity-Attribute-Value (EAV) standard |

**Deployment compatibility:** Cloudflare Pages/Workers · Edge runtimes · Docker containerization
**Target audience:** Database administrators, DevOps, enterprise system architects, rapid-prototyping developers

---

## 🚀 Quick Start

**Prerequisites:** Node.js ≥ 18 · Python ≥ 3.10 · PostgreSQL (local instance or Supabase/Neon cloud URL)

### Step 1 — Database setup

```sql
CREATE DATABASE substrata_db;
\c substrata_db;

CREATE TABLE IF NOT EXISTS entities (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attributes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_values (
    id SERIAL PRIMARY KEY,
    entity_id INT REFERENCES entities(id) ON DELETE CASCADE,
    attribute_id INT REFERENCES attributes(id) ON DELETE CASCADE,
    value_text TEXT NOT NULL
);
```

### Step 2 — Backend configuration

```bash
cd backend
python -m venv venv

# Windows
.\venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

pip install -r requirements.txt
```

Create `.env` in `/backend`:

```env
DATABASE_URL=postgresql+asyncpg://postgres:YOUR_PASSWORD@localhost:5432/substrata_db
```

```bash
uvicorn app.main:app --reload --port 8000
```

### Step 3 — Frontend configuration

```bash
cd ../frontend
npm install
npm run dev
```

Open **http://localhost:3000** (or `:3001`).

### Step 4 — System usage

```console
1. Paste your OpenRouter API Key into the top header bar → click SAVE
2. Select a target model (e.g. Mistral Small 24B [FREE] or Qwen 2.5 72B)
3. Select your active Tenant Isolation Context (TENANT_ALPHA, TENANT_BETA)
4. Type a query in the Query Terminal:

   > Create entity Laptop with price = 1200 and ram = 16GB

5. Review the parsed EAV/SQL output → click EXECUTE ON DB
6. Watch the change land in the Live DB Inspector panel
```

---

## ⚠️ Known Limitations


- Text-to-SQL parsing depends on the selected OpenRouter model's reasoning quality; free-tier models may need stricter prompt guardrails.
- BYODB mode is only as secure as the SSRF checks cover — connection strings pointing at non-standard internal ranges should be reviewed before production use.

## 🗺️ Roadmap

- [ ] **Web services integration** — WebGL and 3D schema topology visualization
- [ ] **Edge execution** — full deployment to Cloudflare Workers with Hyperdrive DB routing
- [ ] **Vector search EAV hybrid** — `pgvector` integration for semantic querying over entity values
- [ ] **Auto-migration utility** — one-click conversion of standard relational schemas into SubStrata EAV structures

---

## 👥 Team

| Member | Role | Primary Contribution |
|---|---|---|
| **Adityaraj Gupta** | **Backend Systems & Database Infrastructure Engineer** | Designed and implemented the backend services, PostgreSQL EAV persistence layer, asynchronous database runtime, and database connectivity workflow. |
| **A. N. Yashas Kiran** | **Frontend Architecture & User Experience Engineer** | Designed and implemented the frontend dashboard, query-terminal experience, model-selection interface, and live EAV inspection workflow. |
| **Krishna Agrawal** | **Full-Stack Integration & AI Systems Engineer** | Integrated the frontend, backend, OpenRouter-based agentic workflow, tenant context, SQL execution path, and database routing components. |

## 📚 Technical References

The following references provide the official documentation or scholarly background for the technologies, services, and data-modeling approach identified in this project. They are included for technical context and implementation reference; the project’s architecture and feature descriptions remain specific to SubStrata Engine.

1. [Next.js Documentation][1] — framework documentation for the Next.js application layer.
2. [FastAPI Documentation][2] — framework documentation for the Python API layer.
3. [PostgreSQL 16 Documentation][3] — database documentation for the PostgreSQL persistence layer.
4. [SQLAlchemy Documentation][4] — documentation for the ORM and query-builder layer, including asynchronous support.
5. [Tailwind CSS Documentation][5] — styling and utility-class documentation.
6. [Lucide Documentation][6] — documentation for the icon library used by the frontend.
7. [OpenRouter Documentation][7] — API and model-routing documentation for the BYOK integration.
8. [Guidelines for the Effective Use of Entity-Attribute-Value Modeling for Biomedical Databases][8] — scholarly reference discussing appropriate use and implementation considerations for EAV modeling.

## 🙏 Acknowledgments

The SubStrata Engine team gratefully acknowledges the open-source ecosystem and technical communities whose software, documentation, and engineering practices supported this project. The project builds on the work of the Next.js, React, FastAPI, PostgreSQL, SQLAlchemy, Tailwind CSS, Lucide, and asyncpg communities, as well as the OpenRouter service used for model access and routing.

We also acknowledge the researchers and database practitioners whose work on Entity-Attribute-Value modeling provides useful context for designing systems that manage sparse, heterogeneous, and evolving data. Their published guidance helped inform the project’s use of an EAV-oriented persistence layout and the importance of considering metadata and implementation complexity when applying the model.

The team further recognizes the value of official documentation, open-source licensing, community-maintained examples, and the broader developer community. These resources supported the project’s learning, implementation, integration, testing, and documentation activities.

This acknowledgment does not imply endorsement of SubStrata Engine by any referenced project, organization, service, author, or research group.

## 📄 License

SubStrata Engine is proprietary project material and is licensed to its owner. Copyright, ownership, and all rights not expressly granted in writing remain with the owner of the project.

Unless the owner provides prior written permission, no person or organization may copy, reproduce, modify, adapt, publish, distribute, sublicense, sell, lease, commercialize, or create derivative works from the project’s source code, documentation, architecture, interface design, database design, branding, or other original materials.

Access to, viewing of, or reference to this repository does not transfer ownership or grant an automatic license to use the project. Any permitted use must remain within the scope defined by the owner and must preserve all applicable ownership notices and attribution requirements.

Third-party frameworks, libraries, services, icons, documentation, and other external resources used by the project remain subject to their respective owners’ licenses and terms. This owner license applies only to the original SubStrata Engine materials and does not replace or override the license of any third-party dependency.

The project is provided for its stated development and academic purposes. It is provided **“as is”**, without warranties or guarantees unless otherwise agreed in writing. The owner is not responsible for unauthorized use, redistribution, modification, deployment, or claims arising from use of the project outside the permission granted by the owner.

For permission requests, redistribution rights, commercial usage, academic reuse beyond ordinary reference, or other licensing arrangements, contact the project owner directly.

## 📌 Ownership Notice

SubStrata Engine, including its project-specific documentation, architecture, implementation, and original materials, remains the property of its owner. Third-party frameworks, libraries, services, and reference materials remain subject to their respective licenses and ownership terms.

## Conclusion

SubStrata Engine blends agentic AI with strict relational boundaries and federated cloud storage choice — showing that speed, flexibility, and data control can coexist in modern database architecture.

> *"The future of persistent systems lies not in rigid schemas or unpredictable models, but in deterministic execution boundaries that make dynamic intelligence foundational."*
> — **SubStrata Core Engineering Team**

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:06B6D4,50:7C3AED,100:0F172A&height=120&section=footer" width="100%" alt="" />

[1]: https://nextjs.org/docs "Next.js Documentation"
[2]: https://fastapi.tiangolo.com/ "FastAPI Documentation"
[3]: https://www.postgresql.org/docs/16/ "PostgreSQL 16 Documentation"
[4]: https://docs.sqlalchemy.org/ "SQLAlchemy Documentation"
[5]: https://tailwindcss.com/docs "Tailwind CSS Documentation"
[6]: https://lucide.dev/guide/ "Lucide Documentation"
[7]: https://openrouter.ai/docs "OpenRouter Documentation"
[8]: https://pmc.ncbi.nlm.nih.gov/articles/PMC2110957/ "Guidelines for the Effective Use of Entity-Attribute-Value Modeling for Biomedical Databases"
