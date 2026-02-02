-- 性别默认改为「男」（原为「保密」）
ALTER TABLE users MODIFY COLUMN gender ENUM('男','女','保密') NOT NULL DEFAULT '男';
