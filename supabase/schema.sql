-- Minutário — Supabase Database Schema
-- Complete schema for multi-device template sync with org isolation

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 2. ORGANIZATIONS (escritórios / tribunais)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. USER ROLE ENUM
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'assessor', 'guest');
    END IF;
END
$$;

-- ============================================================
-- 4. USERS (assessores)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'assessor',
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. FOLDERS (pastas)
-- ============================================================
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_idx INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. TEMPLATES (modelos)
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    folder_id UUID NULL REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    plain_text TEXT NOT NULL DEFAULT '',
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_templates_org_shortcut
    ON templates(org_id, shortcut);

CREATE INDEX IF NOT EXISTS idx_templates_org_folder
    ON templates(org_id, folder_id);

-- Trigger: auto-update updated_at on templates
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

-- Also auto-update organizations and users
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. RLS POLICIES
-- ============================================================

-- Organizations: visible to members of the org
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select ON organizations;
CREATE POLICY org_select ON organizations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = organizations.id
              AND users.id = auth.uid()
        )
    );

-- Users: visible within same org
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users AS me
            WHERE me.id = auth.uid()
              AND me.org_id = users.org_id
        )
    );

-- Folders: visible to org members, mutations admin-only
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folders_select ON folders;
CREATE POLICY folders_select ON folders
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = folders.org_id
              AND users.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS folders_insert ON folders;
CREATE POLICY folders_insert ON folders
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = folders.org_id
              AND users.id = auth.uid()
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS folders_update ON folders;
CREATE POLICY folders_update ON folders
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = folders.org_id
              AND users.id = auth.uid()
              AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = folders.org_id
              AND users.id = auth.uid()
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS folders_delete ON folders;
CREATE POLICY folders_delete ON folders
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = folders.org_id
              AND users.id = auth.uid()
              AND users.role = 'admin'
        )
    );

-- Templates: visible to org members, mutations by org members
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS templates_select ON templates;
CREATE POLICY templates_select ON templates
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = templates.org_id
              AND users.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS templates_insert ON templates;
CREATE POLICY templates_insert ON templates
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = templates.org_id
              AND users.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS templates_update ON templates;
CREATE POLICY templates_update ON templates
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = templates.org_id
              AND users.id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = templates.org_id
              AND users.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS templates_delete ON templates;
CREATE POLICY templates_delete ON templates
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.org_id = templates.org_id
              AND users.id = auth.uid()
        )
    );

-- ============================================================
-- 8. AUTH HOOKS
-- ============================================================

-- 8.1 Handle new user signup: auto-create row in public.users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    default_org_id UUID;
BEGIN
    -- Find or create a default fallback org if needed.
    -- In production, you'd map by email domain or invite token.
    -- Here we link to a pre-seeded org if it exists.
    SELECT id INTO default_org_id
    FROM organizations
    WHERE slug = 'tribunal-teste'
    LIMIT 1;

    INSERT INTO users (id, email, org_id, role, display_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(default_org_id, NULL),
        'assessor',
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- 8.2 Custom access-token hook: inject org_id + role into JWT
CREATE OR REPLACE FUNCTION custom_access_token_hook()
RETURNS TRIGGER AS $$
DECLARE
    user_rec RECORD;
BEGIN
    SELECT org_id, role INTO user_rec
    FROM users
    WHERE id = NEW.user_id;

    IF user_rec IS NOT NULL THEN
        NEW.claims := jsonb_set(
            NEW.claims,
            '{app_metadata}',
            COALESCE(NEW.claims->'app_metadata', '{}'::jsonb) || jsonb_build_object(
                'org_id', user_rec.org_id,
                'role', user_rec.role
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant required execution privilege for the hook
GRANT EXECUTE ON FUNCTION custom_access_token_hook() TO supabase_auth_admin;

-- ============================================================
-- 9. REALTIME
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE templates, folders;
    END IF;
END
$$;

-- ============================================================
-- 10. SEED DATA
-- ============================================================

-- Seed organization
INSERT INTO organizations (id, name, slug)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Tribunal de Justiça Teste',
    'tribunal-teste'
)
ON CONFLICT (slug) DO NOTHING;

-- Seed folders
INSERT INTO folders (id, org_id, name, order_idx)
VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Petições Iniciais', 1),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Manifestações Processuais', 2)
ON CONFLICT DO NOTHING;

-- Seed templates
INSERT INTO templates (
    id, org_id, folder_id, name, shortcut, content, plain_text, is_personal, usage_count
)
VALUES
    (
        'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        'Petição Inicial - Ação de Indenização',
        '/petind',
        'Vem o(a) autor(a), por seu advogado que esta subscreve, com fulcro no art. 319 do CPC, propor a presente AÇÃO DE INDENIZAÇÃO POR DANOS MORAIS E MATERIAIS em face de...',
        'Vem o(a) autor(a), por seu advogado que esta subscreve, com fulcro no art. 319 do CPC, propor a presente AÇÃO DE INDENIZAÇÃO POR DANOS MORAIS E MATERIAIS em face de...',
        FALSE,
        0
    ),
    (
        'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
        'Contestação Padrão',
        '/contest',
        'Preliminarmente, o requerido requer a extinção do processo sem resolução do mérito, nos termos do art. 485, VI, do CPC, por ilegitimidade de parte...',
        'Preliminarmente, o requerido requer a extinção do processo sem resolução do mérito, nos termos do art. 485, VI, do CPC, por ilegitimidade de parte...',
        FALSE,
        0
    )
ON CONFLICT DO NOTHING;
