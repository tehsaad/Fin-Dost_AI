-- Private demo workspaces: owners who signed in anonymously. Additive and backward compatible.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_businesses_anonymous_created ON public.businesses (is_anonymous, created_at);
