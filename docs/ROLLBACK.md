# Rollback point — before the enterprise upgrade

Marked on 2026-10-10 at the user's request, immediately before the enterprise upgrade went live.

| What | Rollback target |
|---|---|
| Code | git tag `rollback/pre-enterprise-2026-10-10` = commit `0d15dbb` |
| Backend (Vercel `findost-api`) | deployment `dpl_E6zCksA7MdGysP5dY4mAkEbEnUXX` — https://findost-jwdv7k78p-teh-saad.vercel.app |
| Frontend (Vercel `findost-ai`) | deployment `dpl_DGt4Q6KHGMb25KjyTQCkJh5EghGS` — https://findost-ln86kqqm7-teh-saad.vercel.app |
| Database | migrations up to `20261012000000_private_demo_flag` |
| Supabase Auth settings | unchanged by the upgrade (nothing to roll back) |

## Roll back (about 2 minutes, no rebuild)

```bash
cd frontend && npx vercel promote https://findost-ln86kqqm7-teh-saad.vercel.app --yes   # frontend first
cd ../backend && npx vercel promote https://findost-jwdv7k78p-teh-saad.vercel.app --yes # then backend
curl -s https://findost-api.vercel.app/api/v1/health                                   # check
```

Promoting instantly points the production domains back at the old builds. Then, if the code should follow:

```bash
git checkout main && git reset --hard rollback/pre-enterprise-2026-10-10 && git push --force-with-lease origin main
```

(Only do the git reset if you also want GitHub `main` back at the old code; the live site is already rolled back
by the promote commands.)

## Database

The upgrade only **adds** five tables (`workspace_members`, `workspace_invitations`, `budgets`, `savings_goals`,
`finance_actions`). The old backend never reads them, so it works unchanged with them present — **no database
rollback is needed**. Leave them in place so nothing created after the upgrade is lost. Only if you explicitly want
them gone (this deletes team memberships, budgets, goals and actions recorded after the upgrade):

```sql
DROP TABLE IF EXISTS public.finance_actions, public.savings_goals, public.budgets,
  public.workspace_invitations, public.workspace_members;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261013000000';
```

## Environment variables added by the upgrade

`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` on `findost-api`. The old backend ignores them; they can stay.

## What went live (2026-10-10)

| What | Value |
|---|---|
| Migration | `20261013000000_enterprise_workspaces` applied by the user; 5 tables, RLS on, recorded in `schema_migrations` |
| Backend env | `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` set on `findost-api` (production) |
| Backend | deployment `dpl_J4qTH3YFBPyTZ5TC1XpGBotn29Jt` (findost-d5f54cn4k-teh-saad.vercel.app) |
| Frontend | deployment findost-au9u6ejny-teh-saad.vercel.app |

To undo, use the promote commands above.

## Accuracy pass (2026-10-10, commit a39f3b5)

Backend findost-990gmmfhr-teh-saad.vercel.app, frontend findost-114czdxxv-teh-saad.vercel.app. No database change.
To return to the enterprise release without this pass, promote findost-d5f54cn4k (backend) and findost-au9u6ejny
(frontend); to return to before the enterprise upgrade, use the commands at the top.

## Workspace selection (2026-10-10, main 24c14ac = PR #2)

Backend findost-rnlvn5erl-teh-saad.vercel.app, frontend findost-jsrk5lqyj-teh-saad.vercel.app. No database change.
To undo, promote the accuracy-pass deployments: backend findost-990gmmfhr, frontend findost-114czdxxv.
