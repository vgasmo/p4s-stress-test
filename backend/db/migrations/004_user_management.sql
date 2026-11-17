-- Gestão de utilizadores: convites, links de palavra-passe de uso único e invalidação de sessões.

ALTER TABLE users
    -- Sobe a cada mudança de palavra-passe e a cada desativação: os refresh tokens
    -- emitidos antes deixam de ser aceites.
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0,
    -- NULL: a conta foi criada por convite e ainda não tem palavra-passe definida.
    ADD COLUMN password_set_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE;

-- As contas que já existiam têm palavra-passe.
UPDATE users SET password_set_at = created_at;

CREATE TYPE password_token_purpose AS ENUM ('invite', 'reset');

CREATE TABLE password_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 do token. O token em claro só existe no link, que é mostrado uma vez.
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose password_token_purpose NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_tokens_user ON password_tokens(user_id);
