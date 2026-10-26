<div align="center">

# 🤖 AI SQL Analytics Agent

**Ask a business question in plain English. The agent writes the SQL, runs it on PostgreSQL, fixes its own mistakes and replies with a clear answer.**

![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Groq](https://img.shields.io/badge/LLM-Groq%20(gpt--oss--20b)-F55036?style=flat-square)
![Status](https://img.shields.io/badge/status-working-22C55E?style=flat-square)

</div>

---

## 📌 Overview

A simple chatbot generates SQL once and runs it blindly. This agent works in a loop:

- Detects SQL errors and inspects the schema to understand what went wrong
- Detects data-quality issues (inconsistent casing, text in numeric columns) and rewrites its own query
- Refuses dangerous operations, even when asked directly
- Keeps calling tools until it reaches a correct, checkable answer

## 💬 Example

**User:** "What is the total amount received from payments?"

**Agent (on its own):**
1. Tries `SELECT SUM(CAST(amount AS NUMERIC)) FROM payments;` → fails with `invalid input syntax for type numeric: "N/A"`
2. Calls `inspect_data_quality("payments", "amount")` → finds 3 rows containing `'N/A'`
3. Rewrites the query with a regex filter: `WHERE amount ~ '^[0-9]+(\.[0-9]+)?$'`
4. Runs it successfully

**Final answer:**
> Total payments received: **$3,565,052.75**
> Note: 3 rows containing the invalid value `'N/A'` were excluded from the calculation.

## 🏗️ Architecture

```
User question (natural language)
        │
   LLM agent (Groq)
        │
 Decides which tool to call
        │
┌──────────────┬───────────────┬──────────────────┬──────────────────────┐
│ execute_sql  │  get_schema   │  inspect_table   │ inspect_data_quality │
└──────────────┴───────────────┴──────────────────┴──────────────────────┘
        │
Result → back to LLM → loop until final answer (max 6 rounds)
        │
Business-friendly answer to the user
```

## 🛠️ Tech Stack

| Layer | Tool |
|---|---|
| Agent orchestration | Python 3 |
| Database | PostgreSQL |
| DB driver | psycopg2 |
| LLM | Groq API (`openai/gpt-oss-20b`), tool calling |
| Secrets | python-dotenv |
| Scheduling | Windows Task Scheduler / cron |

## 🗄️ Database

5 tables (~2,810 rows) modelled on an e-commerce business:

| Table | Rows | Purpose |
|---|---|---|
| `customers` | 150 | Buyer information (name, city, segment) |
| `products` | 60 | Product catalogue across 10 categories |
| `orders` | 600 | Order-level facts (date, status, amount) |
| `order_items` | 1,400 | Bridge table (order ↔ product with quantity) |
| `payments` | 600 | Payment records per order |

The data has **deliberate quality issues** to test self-correction:
- Inconsistent casing (`'Mumbai'` / `'mumbai'` / `'MUMBAI'`)
- NULLs in phone, email and total_amount
- Invalid text (`'N/A'`) in numeric-looking columns
- Duplicate records
- Invalid dates

## 🔒 Security

Two layers of defence:

1. **Application layer:** `validate_sql()` blocks `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `GRANT`, `REVOKE` and `CREATE` with word-boundary regex, and allows only `SELECT`.
2. **Database layer:** the agent connects as a dedicated `agent_readonly` PostgreSQL user with `SELECT`-only privileges. Even if the first layer were bypassed, PostgreSQL would reject any write.

Credentials never live in code. They sit in a `.env` file that Git ignores.

## 🐞 Real Bugs Found and Fixed

**1. Silent wrong answers from data casing.**
`GROUP BY city` split revenue across `'Mumbai'` / `'MUMBAI'` / `'mumbai'`. The ranking was wrong but no error was raised. Fixed by having the agent call `inspect_data_quality` before trusting any `GROUP BY` on a text column.

**2. PostgreSQL alias-collision trap.**
Aliasing `LOWER(city) AS city` made `GROUP BY` silently use the raw column, because PostgreSQL prefers the original column when the alias has the same name. Fixed with a system-prompt rule that requires a different alias (`city_normalized`).

**3. CAST fails per row, before aggregation.**
`SUM(CAST(amount AS NUMERIC))` fails if even one row has invalid text, because `CAST` runs on each row before `SUM`. Fixed by filtering with a regex before casting.

**4. Encoding crash in scheduled runs.**
LLM summaries sometimes contained non-breaking hyphens (U+2011). The VS Code terminal (UTF-8) was fine; Windows Task Scheduler (cp1252) crashed. Fixed by always writing LLM output with `encoding="utf-8"`.

## 📁 Repository Structure

```
ai-sql-analytics-agent/
├── sqlagent.py         # agent: tools, tool-calling loop, SQL validation
├── daily_metrics.py    # daily sales report + AI summary (for Task Scheduler / cron)
├── test_llm.py         # quick check that the Groq API key works
├── requirements.txt    # psycopg2-binary, python-dotenv, groq
├── .env.example        # template for database and API credentials
├── .gitignore
└── README.md
```

## ▶️ How to Run

**1. Clone and install**

```bash
git clone https://github.com/abhishek8762a/ai-sql-analytics-agent.git
cd ai-sql-analytics-agent
pip install -r requirements.txt
```

**2. Set up PostgreSQL**
- Create a database named `ecommerce_analytics` with the 5 tables listed above.
- Create a read-only user `agent_readonly` with `SELECT` privileges only.

**3. Add credentials**
- Copy `.env.example` to `.env`.
- Fill in your PostgreSQL passwords and a Groq API key (free at [console.groq.com](https://console.groq.com)).

**4. Run the agent**

```bash
python sqlagent.py
```

**5. (Optional) Daily report**
- Windows: schedule `python daily_metrics.py` in Task Scheduler.
- Linux / Mac: add a cron entry.
- Each run appends the report to `daily_report.log`.

---

## 👤 Author

**Abhishek Kumar** · MIS Data Analyst  
[LinkedIn](https://www.linkedin.com/in/abhikumar8762/) · [GitHub](https://github.com/abhishek8762a) · [Portfolio](https://abhishek-portfolio-8762.vercel.app) · [Email](mailto:abhiyadav8762@gmail.com)
