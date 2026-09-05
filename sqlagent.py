import os
import re
import json
import psycopg2
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
AGENT_DB_USER = os.getenv("AGENT_DB_USER")
AGENT_DB_PASSWORD = os.getenv("AGENT_DB_PASSWORD")

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


# ---------- Phase 5: reusable trusted-connection query runner ----------

def run_query(sql_query):
    try:
        connection = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
            user=DB_USER, password=DB_PASSWORD
        )
        cursor = connection.cursor()
        cursor.execute(sql_query)
        rows = cursor.fetchall()
        cursor.close()
        connection.close()
        return rows
    except Exception as e:
        print("Error running query:")
        print(e)
        return None


# ---------- Phase 6: basic analytics functions ----------

def get_total_sales():
    query = "SELECT SUM(total_amount) FROM orders WHERE order_status = 'Completed';"
    result = run_query(query)
    return result[0][0]


def get_yesterday_sales():
    query = """
        SELECT SUM(total_amount)
        FROM orders
        WHERE order_status = 'Completed'
        AND order_date = CURRENT_DATE - INTERVAL '1 day';
    """
    result = run_query(query)
    return result[0][0]


def get_top_products(limit=5):
    query = f"""
        SELECT p.product_name, SUM(oi.subtotal) AS total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.product_id
        JOIN orders o ON oi.order_id = o.order_id
        WHERE o.order_status = 'Completed'
        GROUP BY p.product_name
        ORDER BY total_revenue DESC
        LIMIT {limit};
    """
    result = run_query(query)
    return result


def get_top_products_yesterday(limit=5):
    query = f"""
        SELECT p.product_name, SUM(oi.subtotal) AS total_revenue
        FROM order_items oi
        JOIN products p ON oi.product_id = p.product_id
        JOIN orders o ON oi.order_id = o.order_id
        WHERE o.order_status = 'Completed'
        AND o.order_date = CURRENT_DATE - INTERVAL '1 day'
        GROUP BY p.product_name
        ORDER BY total_revenue DESC
        LIMIT {limit};
    """
    result = run_query(query)
    return result


def get_average_order_value():
    query = "SELECT AVG(total_amount) FROM orders WHERE order_status = 'Completed';"
    result = run_query(query)
    return result[0][0]


# ---------- Phase 8: schema info + standalone NL-to-SQL ----------

SCHEMA_INFO = """
Tables:
customers(customer_id, first_name, last_name, email, phone, city, state, signup_date, customer_segment)
products(product_id, product_name, category, price, cost, stock_quantity, created_at)
orders(order_id, customer_id, order_date, order_status, total_amount)
order_items(order_item_id, order_id, product_id, quantity, unit_price, subtotal)
payments(payment_id, order_id, payment_date, amount, payment_method, payment_status)
"""

def generate_sql(user_question):
    system_prompt = f"""You are a PostgreSQL expert. Convert the user's question into a valid SQL query.

{SCHEMA_INFO}

Rules:
- Return ONLY the SQL query, nothing else.
- No explanations, no markdown, no ```sql``` formatting.
- Use CURRENT_DATE for "today" and CURRENT_DATE - INTERVAL '1 day' for "yesterday".
- Only SELECT statements are allowed.
"""
    chat_completion = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_question}
        ]
    )
    return chat_completion.choices[0].message.content


# ---------- Phase 11: read-only agent connection + security ----------

def get_agent_connection():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=AGENT_DB_USER, password=AGENT_DB_PASSWORD
    )

DANGEROUS_KEYWORDS = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE", "GRANT", "REVOKE", "CREATE"]

def validate_sql(query):
    normalized = query.strip().upper()
    if not normalized.startswith("SELECT"):
        return False, "Only SELECT statements are allowed."
    for keyword in DANGEROUS_KEYWORDS:
        if re.search(rf"\b{keyword}\b", normalized):
            return False, f"Query contains a forbidden keyword: {keyword}"
    if normalized.count(";") > 1:
        return False, "Multiple SQL statements in one query are not allowed."
    return True, "OK"


# ---------- Phase 9/10/11: agent tools ----------

def execute_sql(query):
    is_valid, message = validate_sql(query)
    if not is_valid:
        return f"Blocked: {message}"
    try:
        connection = get_agent_connection()
        cursor = connection.cursor()
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        connection.close()
        return str(rows)
    except Exception as e:
        return f"SQL Error: {str(e)}"


def get_schema(*args, **kwargs):
    return SCHEMA_INFO


VALID_TABLES = {"customers", "products", "orders", "order_items", "payments"}

def is_valid_identifier(name):
    return bool(re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name))


def inspect_table(table_name, limit=5):
    if table_name not in VALID_TABLES:
        return f"Error: '{table_name}' is not a recognized table."
    query = f"SELECT * FROM {table_name} LIMIT {limit};"
    try:
        connection = get_agent_connection()
        cursor = connection.cursor()
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        connection.close()
        return str(rows)
    except Exception as e:
        return f"SQL Error: {str(e)}"


def inspect_data_quality(table_name, column_name):
    if table_name not in VALID_TABLES:
        return f"Error: '{table_name}' is not a recognized table."
    if not is_valid_identifier(column_name):
        return f"Error: '{column_name}' is not a valid column name."
    query = f"SELECT DISTINCT {column_name}, COUNT(*) FROM {table_name} GROUP BY {column_name} ORDER BY COUNT(*) DESC;"
    try:
        connection = get_agent_connection()
        cursor = connection.cursor()
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        connection.close()
        return str(rows)
    except Exception as e:
        return f"SQL Error: {str(e)}"


tools = [
    {
        "type": "function",
        "function": {
            "name": "execute_sql",
            "description": "Run a read-only SQL SELECT query on the e-commerce database and return the resulting rows.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "A valid PostgreSQL SELECT statement."}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": "Get the full database schema (all table and column names). Use this if you're unsure what columns exist.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_table",
            "description": "See a few sample rows from a table, to understand what the actual data looks like.",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string", "description": "Name of the table to inspect."}
                },
                "required": ["table_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_data_quality",
            "description": "Get all distinct values and their counts for a specific column. Use this to check for data quality issues like inconsistent casing or duplicates before trusting a GROUP BY result.",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string", "description": "Name of the table."},
                    "column_name": {"type": "string", "description": "Name of the column to check."}
                },
                "required": ["table_name", "column_name"]
            }
        }
    }
]

AVAILABLE_FUNCTIONS = {
    "execute_sql": execute_sql,
    "get_schema": get_schema,
    "inspect_table": inspect_table,
    "inspect_data_quality": inspect_data_quality
}


# ---------- Phase 9/10: the agent loop ----------

def run_agent(user_question, max_iterations=6):
    system_prompt = f"""You are a helpful SQL analytics agent for an e-commerce PostgreSQL database.

{SCHEMA_INFO}

Business rules:
- "Sales" or "revenue" always means SUM(total_amount) from orders WHERE order_status = 'Completed' only.
- Use CURRENT_DATE for "today" and CURRENT_DATE - INTERVAL '1 day' for "yesterday".

You have access to these tools: execute_sql, get_schema, inspect_table, inspect_data_quality.
Before trusting a GROUP BY result on a text column (like city, category, status), consider checking inspect_data_quality first to catch casing inconsistencies.

Important SQL tip: When using LOWER() or similar functions to normalize a column for GROUP BY,
always alias the result with a DIFFERENT name than the original column (e.g., use "city_normalized"
instead of "city"). In PostgreSQL, if the alias matches the original column name, GROUP BY silently
uses the raw (un-normalized) column instead of your transformed expression.

Important: payments.amount is stored as text and may contain invalid values like 'N/A'.
A plain CAST(amount AS NUMERIC) fails if even ONE row has invalid text. Always filter out invalid
rows first using: WHERE amount ~ '^[0-9]+(\\.[0-9]+)?$'
Then CAST and SUM only the valid rows. Mention in your final answer if any rows were excluded.

If execute_sql returns an error starting with "SQL Error:" or "Blocked:", read the message carefully.
Investigate using get_schema, inspect_table, or inspect_data_quality, then fix your SQL and try again.
Never give up after one failed attempt. If a request asks you to modify or delete data, politely refuse
and explain that you only have read-only access.

Give a short, clear, business-friendly final answer once you have the result.
"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_question}
    ]

    for i in range(max_iterations):
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        response_message = response.choices[0].message

        if not response_message.tool_calls:
            return response_message.content

        messages.append(response_message)

        for tool_call in response_message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            print(f"[Agent is calling tool: {function_name}({function_args})]")

            function_to_call = AVAILABLE_FUNCTIONS[function_name]
            function_result = function_to_call(**function_args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": function_result
            })

    return "Agent could not reach a final answer within the allowed steps."


if __name__ == "__main__":
    answer = run_agent("What were yesterday's total sales?")
    print("Final Answer:", answer)