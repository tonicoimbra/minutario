-- Minutario - Supabase full reset
-- Drops and recreates the per-user schema from scratch.

-- ============================================================
-- 0. CLEANUP
-- ============================================================

-- Triggers depend on tables and the trigger function.
DO $$
BEGIN
    IF to_regclass('public.templates') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_templates_updated_at ON public.templates';
    END IF;

    IF to_regclass('public.folders') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS update_folders_updated_at ON public.folders';
    END IF;
END
$$;

-- Trigger function dropped with CASCADE to handle any dependent triggers on other tables.
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

-- RLS policies depend on their tables.
DO $$
BEGIN
    IF to_regclass('public.folders') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS folders_select ON public.folders';
        EXECUTE 'DROP POLICY IF EXISTS folders_insert ON public.folders';
        EXECUTE 'DROP POLICY IF EXISTS folders_update ON public.folders';
        EXECUTE 'DROP POLICY IF EXISTS folders_delete ON public.folders';
    END IF;

    IF to_regclass('public.templates') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS templates_select ON public.templates';
        EXECUTE 'DROP POLICY IF EXISTS templates_insert ON public.templates';
        EXECUTE 'DROP POLICY IF EXISTS templates_update ON public.templates';
        EXECUTE 'DROP POLICY IF EXISTS templates_delete ON public.templates';
    END IF;
END
$$;

-- templates references folders, so templates must be dropped first.
DROP TABLE IF EXISTS public.templates;
DROP TABLE IF EXISTS public.folders;

-- uuid-ossp is only needed after the tables are recreated.
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;

-- Minutário — Supabase Database Schema
-- Simple per-user template sync (no organizations)

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 2. FOLDERS (pastas pessoais)
-- ============================================================
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_idx INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. TEMPLATES (modelos)
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    folder_id UUID NULL REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    plain_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_templates_user_shortcut_idx
    ON templates(user_id, shortcut);

CREATE INDEX IF NOT EXISTS idx_templates_user_folder
    ON templates(user_id, folder_id);

-- Unique constraint: one template per shortcut per user
ALTER TABLE templates ADD CONSTRAINT idx_templates_user_shortcut UNIQUE (user_id, shortcut);

-- ============================================================
-- 4. TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_templates_updated_at ON templates;
CREATE TRIGGER update_templates_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_folders_updated_at ON folders;
CREATE TRIGGER update_folders_updated_at
    BEFORE UPDATE ON folders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. RLS POLICIES
-- ============================================================

-- Folders: only owner
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folders_select ON folders;
CREATE POLICY folders_select ON folders
    FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS folders_insert ON folders;
CREATE POLICY folders_insert ON folders
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS folders_update ON folders;
CREATE POLICY folders_update ON folders
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS folders_delete ON folders;
CREATE POLICY folders_delete ON folders
    FOR DELETE
    USING (user_id = auth.uid());

-- Templates: only owner
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS templates_select ON templates;
CREATE POLICY templates_select ON templates
    FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS templates_insert ON templates;
CREATE POLICY templates_insert ON templates
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS templates_update ON templates;
CREATE POLICY templates_update ON templates
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS templates_delete ON templates;
CREATE POLICY templates_delete ON templates
    FOR DELETE
    USING (user_id = auth.uid());

-- ============================================================
-- 6. REALTIME
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE templates;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE folders;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END
$$;

-- ============================================================
-- 7. SEED DATA (optional - for testing only)
-- ============================================================
-- Note: No seed data for user-centric model
-- Each user's templates are created through the app
