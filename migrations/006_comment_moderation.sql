-- 评论表扩展：支持图片和内容审核
-- 注意：MySQL 8.0.19+ 支持 IF NOT EXISTS，但为了兼容性，使用条件检查
ALTER TABLE comments 
  ADD COLUMN image_urls JSON NULL;

ALTER TABLE comments 
  ADD COLUMN moderation_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE comments 
  ADD COLUMN moderation_result JSON NULL;

-- 移除外键约束（因为 post_id 可能指向 posts 或 featured_posts）
-- 注意：外键删除会在 migrate.js 中处理重复错误
ALTER TABLE comments DROP FOREIGN KEY IF EXISTS fk_comments_post;

-- 添加审核状态索引（如果不存在）
-- 注意：索引创建会在 migrate.js 中处理重复错误
CREATE INDEX idx_moderation_status ON comments(moderation_status);
