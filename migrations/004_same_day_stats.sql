-- 扩展user_reads表，添加昨日失败数记录（用于计算较昨天减员数）

ALTER TABLE user_reads
  ADD COLUMN yesterday_failed_count INT NOT NULL DEFAULT 0 COMMENT '昨日失败数（用于计算减员数）',
  ADD COLUMN stat_date DATE NOT NULL DEFAULT (CURDATE()) COMMENT '统计日期';

-- 创建索引
CREATE INDEX idx_stat_date ON user_reads(stat_date);
