"""
Rolling Style — Coming Soon launch email to VIP customers.

Reuses the Brevo SMTP setup from pinterest-bot/repeat_customers_email.py
and the customer log it produces. Sends the HTML in email_vip_launch.html
to all repeat customers (orders_count >= 2).

Usage:
  python send_launch_email.py --dry-run          # preview only
  python send_launch_email.py                    # actually send
  python send_launch_email.py --max 50           # cap (test batch)
  python send_launch_email.py --min-orders 3     # only 3+ orders
"""

import sys, os, json, time, argparse, smtplib, io
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Reuse the existing pinterest-bot infrastructure
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "pinterest-bot"))
import config
from repeat_customers_email import fetch_repeat_customers, _load_customer_log, _save_customer_log

HERE = os.path.dirname(os.path.abspath(__file__))
HTML_TEMPLATE_PATH = os.path.join(HERE, "email_vip_launch.html")

SUBJECT = "🚀 {name}, יש לי משהו מיוחד בשבילך — האפליקציה החדשה שלנו!"
FROM_NAME = "סטייל מתגלגל"
LANDING = "https://rollingstyle.org/coming-soon.html?utm_source=email&utm_medium=vip&utm_campaign=launch"


def build_html(first_name, unsub_url):
    with open(HTML_TEMPLATE_PATH, "r", encoding="utf-8") as f:
        html = f.read()
    return (html
            .replace("{{FIRST_NAME}}", first_name or "חברה")
            .replace("{{UNSUBSCRIBE_URL}}", unsub_url))


def build_text(first_name):
    return f"""היי {first_name or "חברה"} 👋

רצינו אותך הראשונה לדעת — האפליקציה שלנו לקנייה ומכירה של בגדים יד שנייה משיקה בקרוב ב-Google Play!

בגלל שאת לקוחה מיוחדת, שמרנו לך 3 חודשי VIP חינם:
✓ אפס עמלות מכירה
✓ חשיפה מוגברת לפריטים
✓ עדיפות בתמיכה

הצטרפי לרשימת ההמתנה:
{LANDING}

תודה שאת איתנו 💕
— צוות סטייל מתגלגל
"""


def send_one(email, first_name, dry_run=False):
    if not email:
        return False
    unsub_url = f"mailto:{config.SMTP_FROM_EMAIL}?subject=unsubscribe"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = SUBJECT.format(name=first_name or "חברה")
    msg["From"] = f"{FROM_NAME} <{config.SMTP_FROM_EMAIL}>"
    msg["To"] = email
    msg["Reply-To"] = config.SMTP_FROM_EMAIL
    msg["List-Unsubscribe"] = f"<{unsub_url}>"
    msg["Precedence"] = "bulk"
    msg.attach(MIMEText(build_text(first_name), "plain", "utf-8"))
    msg.attach(MIMEText(build_html(first_name, unsub_url), "html", "utf-8"))

    if dry_run:
        print(f"  [DRY RUN] -> {email} ({first_name})")
        return True
    try:
        if config.SMTP_USE_SSL:
            srv = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT)
        else:
            srv = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT)
            if config.SMTP_USE_TLS:
                srv.starttls()
        srv.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
        srv.sendmail(config.SMTP_FROM_EMAIL, email, msg.as_string())
        srv.quit()
        print(f"  ✅ {email} ({first_name})")
        return True
    except Exception as e:
        print(f"  ❌ {email} — {e}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max", type=int, default=None)
    ap.add_argument("--min-orders", type=int, default=2)
    ap.add_argument("--delay", type=float, default=2.0, help="seconds between sends")
    ap.add_argument("--use-cache", action="store_true",
                    help="use cached customers from previous run instead of refetching")
    args = ap.parse_args()

    if args.use_cache:
        cached = _load_customer_log()
        customers = cached.get("customers", [])
        print(f"Loaded {len(customers)} customers from cache.")
    else:
        customers = fetch_repeat_customers(min_orders=args.min_orders)
        _save_customer_log({"customers": customers, "fetched_at": time.time()})

    if args.max:
        customers = customers[:args.max]

    print(f"\nReady to send to {len(customers)} VIP customers (dry_run={args.dry_run})")
    if not args.dry_run:
        ans = input("Type YES to confirm: ").strip()
        if ans != "YES":
            print("Cancelled.")
            return

    sent = failed = 0
    for i, c in enumerate(customers, 1):
        email = c.get("email")
        if not email:
            continue
        first = c.get("first_name", "") or ""
        print(f"[{i}/{len(customers)}]", end=" ")
        if send_one(email, first, dry_run=args.dry_run):
            sent += 1
        else:
            failed += 1
        if not args.dry_run and args.delay:
            time.sleep(args.delay)

    print(f"\nDone. Sent: {sent}, failed: {failed}")


if __name__ == "__main__":
    main()
