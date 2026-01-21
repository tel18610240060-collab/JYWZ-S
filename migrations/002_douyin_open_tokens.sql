-- douyin open auth tokens (for relationship chain / user data scopes)

CREATE TABLE IF NOT EXISTS douyin_open_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  scope VARCHAR(64) NOT NULL,
  open_id VARCHAR(64) NULL,
  access_token VARCHAR(512) NOT NULL,
  refresh_token VARCHAR(512) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  refresh_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_scope (user_id, scope),
  KEY idx_expires_at (expires_at),
  CONSTRAINT fk_douyin_open_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

