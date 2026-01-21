-- 评论回复和点赞功能
-- 添加父评论ID字段（支持嵌套回复）
-- 注意：migrate.js 会处理重复字段错误，但如果字段已存在会跳过
ALTER TABLE comments 
  ADD COLUMN parent_comment_id BIGINT UNSIGNED NULL;

-- 添加回复目标用户ID（@谁）
ALTER TABLE comments 
  ADD COLUMN reply_to_user_id BIGINT UNSIGNED NULL;

-- 添加索引（migrate.js 会处理重复索引错误）
CREATE INDEX idx_parent_comment_id ON comments(parent_comment_id);
CREATE INDEX idx_reply_to_user_id ON comments(reply_to_user_id);

-- 创建评论点赞表
CREATE TABLE IF NOT EXISTS comment_likes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  comment_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_comment_user (comment_id, user_id),
  INDEX idx_comment_id (comment_id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 在 comments 表中添加点赞数字段（冗余字段，提高查询性能）
ALTER TABLE comments 
  ADD COLUMN like_count INT UNSIGNED NOT NULL DEFAULT 0;

-- 添加点赞数索引（migrate.js 会处理重复索引错误）
CREATE INDEX idx_like_count ON comments(like_count);
