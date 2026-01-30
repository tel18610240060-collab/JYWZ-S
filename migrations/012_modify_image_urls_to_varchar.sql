-- 修改 checkins 表的 image_urls 字段类型为 VARCHAR(2000)
-- 用于存储逗号分隔的图片URL字符串

ALTER TABLE checkins 
MODIFY COLUMN image_urls VARCHAR(2000) NULL;
