# ExpenseSplitter v15 — Archived Partner Cleanup

This update changes partner handling:

## New expenses

Archived partners are excluded from:

- Paid-by selection
- Expense-sharing selection
- Active partner count

Their old expense history remains visible until it is permanently deleted.

## Permanent deletion after settlement

Only the workspace owner can permanently delete an archived partner.

The **Delete data** action removes:

- The archived partner
- Every expense where that partner was the payer
- Every expense where that partner was a participant
- The related participant rows

This may change historical totals for other partners. Use it only after the final
settlement is complete and after exporting any reports you want to keep.

## Step 1 — Run the Supabase SQL

1. Open Supabase.
2. Open **SQL Editor → New query**.
3. Open `ADD_ARCHIVED_PARTNER_CLEANUP_TO_SUPABASE.sql`.
4. Copy all SQL into Supabase.
5. Click **Run**.
6. `Success. No rows returned` is correct.

The earlier `is_active` archive-column update must already be installed.

## Step 2 — Deploy to Cloudflare

Upload `ExpenseSplitter_Partner_Cleanup_v15.zip` as a new Production deployment
inside the existing Cloudflare Pages project.

The navigation tab is now named **Add Expense**.
