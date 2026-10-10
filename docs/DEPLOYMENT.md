# Deployment

Production: frontend https://findostai.vercel.app (Vercel project `findost-ai`), API https://findost-api.vercel.app
(Vercel project `findost-api`), Supabase project `yhukcuzieqypcwnzibjp` (us-east-1), Resend domain `tehsaad.site`.

## Order for every release with schema changes

1. **Database:** `npx supabase db push` (linked project) — or, without the DB password,
   `npx supabase db query --linked -f supabase/migrations/<file>.sql` and record it in
   `supabase_migrations.schema_migrations`. Migrations are additive only.
2. **Auth config:** `TURNSTILE_SECRET_KEY=… RESEND_API_KEY=… npx supabase config push` (run `config diff` first;
   it must show only intended changes).
3. **Backend:** `cd backend && npx vercel deploy --prod` → check `GET /api/v1/health`.
4. **Frontend:** `cd frontend && npx vercel deploy --prod` (build fails on purpose if `API_URL` is unset).
5. Smoke test: `/`, `/login`, `/signup`, `/robots.txt`, `/sitemap.xml`, `/opengraph-image`, `/api/v1/health`,
   `/api/v1/public/benchmark`; then sign in by hand (captcha) and use Settings → Test AI connection.

## Environment variables (names only)

| Project | Variables |
|---|---|
| findost-api | `DATABASE_URL`, `SUPABASE_URL`, `CORS_ORIGINS`, `ENVIRONMENT=production`, `GROQ_API_KEY`, `GROQ_MODEL` (optional), `GEMINI_API_KEY`, `GEMINI_MODEL` (optional), `AI_DAILY_LIMIT`, `ANON_AI_DAILY_LIMIT`, `ANON_MAX_TRANSACTIONS`, `DEMO_TTL_DAYS` (optional), `CRON_SECRET` |
| findost-ai | `API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SITE_URL` |
| Supabase Auth (config push) | `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY` |

Never set `DEV_AUTH_SECRET` in production (it is ignored there anyway).

## Scheduled job

`backend/vercel.json` defines a daily cron (21:30 UTC = 02:30 PKT) calling `/api/v1/internal/cleanup-demos`. Vercel
sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set on the project.

## Email

Supabase Auth sends confirmation, password-reset and email-change emails through Resend SMTP
(`smtp.resend.com:465`, user `resend`, password = a Resend API key restricted to sending from `tehsaad.site`).
Templates live in `supabase/templates/` and link to `/auth/confirm?token_hash=…`, which works across devices.
Supabase's email rate limit is raised to 30/hour (custom SMTP required).

## Rollback

Vercel: `npx vercel rollback` (or promote the previous deployment) per project. Database migrations are additive,
so the previous backend keeps working with the new schema. Auth: set `enable_confirmations=false` /
`enable_anonymous_sign_ins=false` in `supabase/config.toml` and `config push`.

## Local development

See README → Run locally. On machines where Node cannot reach Google Fonts (`ETIMEDOUT`), build with
`NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000`.
