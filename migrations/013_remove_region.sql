-- 移除 region 字段，只保留 city 字段用于同城匹配
ALTER TABLE users DROP COLUMN region;
