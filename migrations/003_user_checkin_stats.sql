-- add checkin statistics fields to users table

ALTER TABLE users
  ADD COLUMN total_checkin_days INT NOT NULL DEFAULT 0 COMMENT '累计打卡天数（考虑断签惩罚后的值）',
  ADD COLUMN failure_count INT NOT NULL DEFAULT 0 COMMENT '戒烟失败次数',
  ADD COLUMN last_checkin_date DATE NULL COMMENT '最后打卡日期',
  ADD COLUMN last_calc_date DATE NULL COMMENT '最后计算日期（用于断签检测）';
