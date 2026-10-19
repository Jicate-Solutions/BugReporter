Adding Claude accounts to the JICATE workers
============================================

Director, 2026-10-19: up to 5 extra Claude Max accounts, switched per Windows
box from the Control Tower (AI Routines page) as their allowance runs down.

Labels: give each account ONE short label and use the SAME label on every box,
for example acct1 ... acct5. The Control Tower tracks usage by label.
"default" is each box's own sign-in (today aicse) and is always there.

For EACH account (the Director does this; Claude cannot sign in for you):
1. On any one computer, in a normal terminal or PowerShell window (NOT a Claude
   tab), run:  claude setup-token
   Sign in to that account in the browser it opens. Copy the key it prints.
2. On EACH Windows box, in C:\jicate-ai\ run:
     node save-claude-account.mjs acct1
   Paste the same key (it is hidden), press Enter.
   Expect: account=acct1 saved and works
   The key is saved in C:\jicate-ai\accounts\acct1.token, readable only by that
   Windows user. It is never shown, logged or sent anywhere.
3. Within a minute each worker tells the Control Tower it holds acct1, and the
   account appears in the pickers on the AI Routines page.

Then, on the AI Routines page ("Claude accounts" card):
- Each account shows two bars, this 5 hours and this week, with reset times,
  from the latest job that ran on it.
- Give each account a priority number (1 = use first).
- Switch a whole box with one choice: default, any label, or "auto (priority
  list)": workers use the lowest-numbered account that still has allowance
  (both windows under 95%), move to the next when it runs out, and switch
  back by themselves when an earlier account's 5-hour or weekly allowance
  renews. Accounts with no number come last; ties go to the least-used.
- You get an email when any account passes 90% of either allowance.
- With "fall back" on (the default), a worker whose account hits its limit
  moves to its next account by itself.

Risk to know: each .token file is a long-lived key for a paid account. Anyone
who gets a box's files gets those accounts. Keep the boxes locked; to revoke an
account, delete its .token file on every box and sign out of it at claude.ai.
