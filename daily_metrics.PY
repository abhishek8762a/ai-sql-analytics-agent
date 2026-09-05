from datetime import datetime
from sqlagent import get_yesterday_sales, get_top_products_yesterday, client

def generate_daily_report():
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    yesterday_sales = get_yesterday_sales()
    top_products = get_top_products_yesterday(5)

    report_lines = []
    report_lines.append(f"Daily Report - {timestamp}")
    report_lines.append("=" * 40)
    report_lines.append(f"Yesterday's Sales: {yesterday_sales}")
    report_lines.append("Top 5 Products (Yesterday):")

    if not top_products:
        report_lines.append("  (No products sold yesterday)")
    else:
        for name, revenue in top_products:
            report_lines.append(f"  - {name}: {revenue}")

    raw_report = "\n".join(report_lines)

    summary_prompt = f"""Here is today's e-commerce daily report:

{raw_report}

In 2 short sentences, summarize this in plain business language. Mention anything that looks notably high or low, if relevant."""

    summary_response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": summary_prompt}]
    )
    ai_summary = summary_response.choices[0].message.content

    final_report = raw_report + "\n\nAI Summary:\n" + ai_summary + "\n" + ("=" * 40) + "\n\n"

    with open("daily_report.log", "a", encoding="utf-8") as f:
        f.write(final_report)

    print(final_report)


if __name__ == "__main__":
    generate_daily_report()