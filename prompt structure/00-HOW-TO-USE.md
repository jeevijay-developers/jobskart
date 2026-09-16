# How to use these prompts

13 prompts, designed to be sent to Lovable **one at a time, in order**. Each is self-contained: it restates the context Lovable needs, so you never rely on chat memory holding across a long session.

## Rules

1. **Send P0-00 first, always.** It sets the standing rules. Re-send it after any Lovable session restart.
2. **One prompt per message.** Do not merge two — Lovable degrades badly on multi-feature prompts.
3. **Verify before advancing.** Each prompt ends with an acceptance checklist. Do not send the next until the previous passes.
4. **Commit after each.** One commit per prompt keeps rollback cheap.
5. **If a prompt fails twice**, split it at its section headings and send the halves separately.

## Order and dependencies

```
P0-00  Ground rules              ← always first
P0-01  Candidate onboarding bugs ← independent, ship first for the client
P0-02  Posting flow restructure  ← independent
P0-03  JD auto-generation        ← needs P0-02
P0-04  Job tiers                 ← independent
P0-05  Boost engine              ← needs P0-04
P0-06  Ranking & feed            ← needs P0-04, P0-05
P0-07  DB access & unlocks       ← needs P0-04
P0-08  60-day response purge     ← needs P0-04
P0-09  Employer verification     ← independent
P0-10  RBAC + activity tracker   ← needs P0-05, P0-07
P0-11  Recommended profiles      ← needs P0-06, P0-07
P0-12  Admin controls            ← needs all of the above
```

Parallel-safe if you have two people: {01, 09} can run alongside {02, 03}.
