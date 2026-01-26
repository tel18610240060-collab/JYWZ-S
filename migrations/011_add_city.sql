-- 添加城市字段
ALTER TABLE users ADD COLUMN city VARCHAR(64) NULL AFTER region;
