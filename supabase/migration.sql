-- Migração: org_id → user_id
-- Execute este SQL para migrar o schema antigo para o novo modelo por usuário

-- ============================================================
-- 1. Adicionar coluna user_id se não existir
-- ============================================================
ALTER TABLE templates ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id UUID;

-- ============================================================
-- 2. Popular user_id a partir dos dados existentes
-- ============================================================
-- Se você tinha org_id, pode transferir aqui
-- Exemplo: UPDATE templates SET user_id = auth.users.id FROM organizations WHERE templates.org_id = organizations.id AND auth.users.org_id = organizations.id;
-- Por enquanto, vamos попуlar com um user placeholder

-- ============================================================
-- 3. Criar índices
-- ============================================================
DROP INDEX IF EXISTS idx_templates_org_shortcut;
DROP INDEX IF EXISTS idx_templates_org_folder;

CREATE INDEX IF NOT EXISTS idx_templates_user_shortcut ON templates(user_id, shortcut);
CREATE INDEX IF NOT EXISTS idx_templates_user_folder ON templates(user_id, folder_id);

-- ============================================================
-- 4. Adicionar constraint unique
-- ============================================================
ALTER TABLE templates DROP CONSTRAINT IF EXISTS idx_templates_user_shortcut;
ALTER TABLE templates ADD CONSTRAINT idx_templates_user_shortcut UNIQUE (user_id, shortcut);

-- ============================================================
-- 5. Trigger updated_at (se não existir)
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
-- 6. RLS Policies
-- ============================================================

-- Folders
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

-- Templates
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
-- 7. Habilitar Realtime
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

SELECT 'Migração concluída com sucesso!' as resultado;