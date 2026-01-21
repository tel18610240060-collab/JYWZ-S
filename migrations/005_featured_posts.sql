-- 固定帖子表
CREATE TABLE IF NOT EXISTS featured_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  content VARCHAR(2000) NOT NULL DEFAULT '',
  post_type ENUM('normal', 'vote') NOT NULL DEFAULT 'normal',
  view_permission VARCHAR(20) NOT NULL DEFAULT 'all',
  reply_permission VARCHAR(20) NOT NULL DEFAULT 'all',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 投票选项表
CREATE TABLE IF NOT EXISTS vote_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NOT NULL,
  option_text VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  vote_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post_id (post_id, sort_order),
  CONSTRAINT fk_vote_options_post FOREIGN KEY (post_id) REFERENCES featured_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 投票记录表
CREATE TABLE IF NOT EXISTS vote_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NOT NULL,
  option_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_vote (post_id, option_id, user_id),
  KEY idx_post_option (post_id, option_id),
  KEY idx_user_id (user_id),
  CONSTRAINT fk_vote_records_post FOREIGN KEY (post_id) REFERENCES featured_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_records_option FOREIGN KEY (option_id) REFERENCES vote_options(id) ON DELETE CASCADE,
  CONSTRAINT fk_vote_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
