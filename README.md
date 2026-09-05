# AI SQL Analytics Agent

An AI-powered SQL analytics agent that converts natural language business questions into SQL, executes them against a PostgreSQL database, handles errors and data-quality issues autonomously, and returns clear business-friendly answers.

Built with **Python + PostgreSQL + Groq LLM (gpt-oss-20b)** as a portfolio project demonstrating end-to-end AI agent architecture with real production considerations (security, data quality, automation).

---

## What makes this an "Agent" (not a chatbot)

A simple chatbot generates SQL once and executes blindly. This agent has an autonomous loop:

- Detects SQL errors and inspects the schema to understand what went wrong
- Detects data-quality issues (inconsistent casing, invalid text in numeric columns) and rewrites its own queries
- Refuses dangerous operations even when explicitly requested
- Loops through multiple tool calls until it reaches a correct, verifiable answer

---

## Example

**User:** "What is the total amount received from payments?"

**Agent (autonomous chain):**
1. Tries `SELECT SUM(CAST(amount AS NUMERIC)) FROM payments;` -> fails with `invalid input syntax for type numeric: "N/A"`
2. Calls `inspect_data_quality("payments", "amount")` -> discovers 3 rows contain `'N/A'`
3. Rewrites query with a regex filter: `WHERE amount ~ '^[0-9]+(\.[0-9]+)?$'`
4. Executes successfully

**Final Answer:**
> Total payments received: **$3,565,052.75**
> Note: 3 rows containing invalid value `'N/A'` were excluded from the calculation.

---

## Architecture

```
User question (natural language)
        |
     LLM Agent (Groq)
        |
  Decides which tool to call
        |
+--------------+---------------+------------------+--------------------+
| execute_sql  |  get_schema   |  inspect_table   |inspect_data_quality|
+--------------+---------------+------------------+--------------------+
        |
Result -> back to LLM -> loop until final answer
        |
Business-friendly response to user
```

---

## Tech Stack

- **Python 3** - agent orchestration
- **PostgreSQL** - analytics database
- **psycopg2** - Python to PostgreSQL driver
- **Groq API** - LLM inference (`openai/gpt-oss-20b`)
- **python-dotenv** - secure credentials management
- **Windows Task Scheduler / cron** - daily automated reports

---

## Database Schema

5 tables (~2810 rows) modeled on a realistic e-commerce business:

| Table | Rows | Purpose |
|---|---|---|
| customers | 150 | Buyer information (name, city, segment) |
| products | 60 | Product catalog across 10 categories |
| orders | 600 | Order-level facts (date, status, amount) |
| order_items | 1400 | Bridge table (order and product with quantity) |
| payments | 600 | Payment records per order |

The dataset includes **controlled data-quality issues** for testing the agent's self-correction capabilities:
- Inconsistent casing (`'Mumbai'` / `'mumbai'` / `'MUMBAI'`)
- NULL values in phone, email, and total_amount fields
- Invalid text (`'N/A'`) in numeric-looking columns
- Duplicate records
- Invalid dates

---

## Security

Two-layer defense in depth:

1. **Application layer** - `validate_sql()` blocks `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE`, `CREATE` keywords using word-boundary regex, and enforces `SELECT`-only queries.
2. **Database layer** - the agent connects as a dedicated `agent_readonly` PostgreSQL user with only `SELECT` privileges. Even if the application layer were bypassed, PostgreSQL itself would reject any write attempt.

Credentials are never stored in code - they live in a `.env` file (excluded from Git via `.gitignore`).

---

## Getting Started

**1. Clone the repository**

    git clone https://github.com/abhishek8762a/ai-sql-analytics-agent.git
    cd ai-sql-analytics-agent

**2. Install dependencies**

    pip install -r requirements.txt

**3. Set up PostgreSQL**
- Install PostgreSQL locally
- Create a database: `ecommerce_analytics`
- Run the schema and seed SQL scripts
- Create the read-only user

**4. Configure credentials**
- Copy `.env.example` to `.env`
- Fill in your PostgreSQL passwords and Groq API key (get a free one at console.groq.com)

**5. Run the agent**

    python sqlagent.py

**6. (Optional) Enable daily automation**
- On Windows: use Task Scheduler to run `daily_metrics.py` at your preferred time
- On Linux/Mac: add a cron entry

---

## Real Bugs Found & Fixed During Development

The interesting part of this project isn't just that it works - it's the real bugs the agent discovered along the way:

**Bug #1 - Silent wrong answers from data casing**
`GROUP BY city` was silently splitting revenue across `'Mumbai'` / `'MUMBAI'` / `'mumbai'` variants. Ranking was wrong, but no error was raised. Fixed by teaching the agent to call `inspect_data_quality` before trusting any `GROUP BY` on a text column.

**Bug #2 - PostgreSQL alias-collision trap**
Aliasing `LOWER(city) AS city` silently made GROUP BY use the raw column (PostgreSQL prefers the original column when the alias matches its name). Fixed via a system-prompt rule requiring different alias names (`city_normalized`).

**Bug #3 - CAST fails per-row, before aggregation**
`SUM(CAST(amount AS NUMERIC))` fails if even one row contains invalid text - `CAST` runs per-row before `SUM` skips anything. Fixed by filtering with regex before casting.

**Bug #4 - Encoding crash in automated runs**
LLM-generated summaries occasionally contained non-breaking hyphens (U+2011). VS Code terminal (UTF-8) worked fine; Windows Task Scheduler (cp1252) crashed. Fixed by always specifying `encoding="utf-8"` when writing LLM output to disk.

---

## Project Structure

    ai-sql-analytics-agent/
    |-- sqlagent.py             # Main agent (tools, loop, security)
    |-- daily_metrics.py        # Automated daily report script
    |-- database/               # SQL schema & seed scripts
    |-- tests/
    |   |-- test_cases.md       # 12 test categories (A-L)
    |-- .env.example            # Template for credentials
    |-- .gitignore
    |-- requirements.txt
    |-- README.md

---

## Status

Portfolio project - functional end-to-end, thoroughly tested across the 12 test categories.

Built by [Abhi](https://github.com/abhishek8762a) as a hands-on demonstration of AI agent architecture, prompt engineering, and real-world SQL analytics.