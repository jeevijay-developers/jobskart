# JobsKart — System Documentation

Planning and build documentation for JobsKart, derived from the client's requirement documents (candidate bug list, job posting flow, JD templates, and the Employer / UX / Product Flows decks) and from a review of the existing codebase at `github.com/jeevijay-developers/jobskart`.

## Structure

```
docs/      — system design documents
prompts/   — sliced, copy-paste-ready Lovable prompts (send one at a time)
```

## docs/

| File | Read it when |
|---|---|
| `00-PROJECT-OVERVIEW.md` | Starting anywhere. Scope tiers, what exists, what's missing |
| `architecture.md` | Making any structural or security decision |
| `schema.md` | Writing a migration |
| `design.md` | Building any screen |
| `monetization.md` | Touching tiers, boosts, credits, or unlocks |
| `rbac.md` | Touching permissions or membership |
| `jd-engine.md` | Building JD generation |
| `matching.md` | Touching scoring, ranking, or recommendations |
| `migration.md` | Moving off Lovable to Jeevijay's Supabase |

## prompts/

Start with `00-HOW-TO-USE.md`, then send `P0-00` through `P0-12` in order, one per message, verifying each acceptance checklist before advancing.

## Decisions taken (not in the client documents)

1. **Unlock model = hybrid.** The deck specifies 25 unlocks per job; the built schema has company-wide credit-priced unlocks with `UNIQUE (company_id, candidate_user_id)`. Resolved as: job allowance first, wallet fallback, and repeat unlocks of the same candidate are free for the company. Prevents double-charging across recruiters.
2. **Classic+ does not rank higher than Classic.** It is a reusability product, not a visibility product. Trending is the visibility product.
3. **Boost decays** across its window rather than applying a flat bonus, so a boosted job cannot sit stale at the top.
4. **JD generation is deterministic**, not AI. Optional AI polish is P1 and may not alter figures or add responsibilities.
5. **"Never show No Candidates Found"** is implemented as a staged broadening ladder with the stage labelled to the recruiter.
6. **"Make recruiters feel AI is working"** is implemented as genuine freshness (new-candidate injection, recency decay, real counts) rather than randomised reordering.
7. **Elasticsearch/Algolia deferred to P2.** Postgres GIN + FTS carries well past launch; pgvector when semantic matching is actually needed.

## Open items requiring client input

Pricing only — none of these block engineering, and all are admin-editable without a deploy:
- Price per plan and what each plan grants
- Credit cost of a Trending post and of a boost
- Credit pack pricing ladder
- Whether HR Admin may spend credits (defaulted to no)
