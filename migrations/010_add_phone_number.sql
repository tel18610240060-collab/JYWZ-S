-- 添加手机号字段
ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL AFTER avatar_url;
