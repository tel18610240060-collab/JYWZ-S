-- 添加 group_type 字段到 comments 表，用于区分同城和同日小组的评论
-- group_type: 'same-day' 表示同日戒烟小组，'same-city' 表示同城戒烟小组，NULL 表示普通帖子评论
ALTER TABLE comments 
  ADD COLUMN group_type VARCHAR(20) NULL;

-- 添加索引以提高查询性能
CREATE INDEX idx_group_type_post_id ON comments(group_type, post_id);

-- 为现有的固定帖子评论设置默认值（根据用户数据推断）
-- 注意：这个更新可能需要根据实际数据调整
-- UPDATE comments SET group_type = 'same-day' WHERE post_id IS NULL;
