-- 允许 comments.post_id 为 NULL（支持固定帖子评论）
-- 注意：固定帖子的评论 post_id 为 NULL，通过 user_id 的 quit_date 识别
ALTER TABLE comments 
  MODIFY post_id BIGINT UNSIGNED NULL;
