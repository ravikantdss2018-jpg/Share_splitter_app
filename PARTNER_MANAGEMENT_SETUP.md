# Enable Partner Delete, Archive and Restore

## Why a used partner cannot be permanently deleted

Expense records refer to the partner who paid and the partners who shared each
expense. Permanently deleting a used partner would break old reports,
settlements and audit history.

ExpenseSplitter v14 uses this safe behavior:

- Partner with no expense history: **Delete permanently**
- Partner used in expense history: **Archive**
- Archived partner: **Restore**

Archived partners are hidden from new expense forms, but remain visible in old
history and monthly calculations.

## Step 1 — Run the Supabase update

1. Open Supabase.
2. Open **SQL Editor → New query**.
3. Open `ADD_PARTNER_ARCHIVE_TO_SUPABASE.sql`.
4. Copy all SQL into Supabase.
5. Click **Run**.
6. `Success. No rows returned` is correct.

## Step 2 — Deploy the app update

Upload `ExpenseSplitter_Partner_Management_v14.zip` as a new Production
deployment in the existing Cloudflare Pages project.

After deployment, close and reopen the installed app. Refresh or reinstall only
if the older cached version is still displayed.
