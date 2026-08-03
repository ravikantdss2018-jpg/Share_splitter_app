# Enable the ExpenseSplitter Feedback Form

Complete these two steps.

## Step 1 — Create the feedback table

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Select **New query**.
4. Open `ADD_FEEDBACK_TO_SUPABASE.sql`.
5. Copy all SQL and paste it into Supabase.
6. Select **Run**.
7. `Success. No rows returned` is the correct result.

The security rules allow:

- Every workspace member to submit feedback.
- A member to see only their own submitted feedback.
- The workspace owner to see all feedback in the private owner inbox.
- Users outside the workspace cannot access its feedback.

## Step 2 — Upload the app update

Upload `ExpenseSplitter_Feedback_v13.zip` as a new Production deployment in
your existing Cloudflare Pages project.

After deployment, reopen the app. If the old version remains, refresh the page
or close and reopen the installed app.

## Where users submit feedback

Open **Team → Send feedback**, or tap the floating **Feedback** button.

## Where the owner reads feedback

Open **Team → Tester feedback inbox**.

The owner can export all feedback as CSV for sorting and analysis.
