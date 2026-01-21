const { getPool } = require('../src/db/pool')

async function main() {
  const pool = getPool()
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()

    // 在事务中使用 conn.query 和 conn.execute
    const exec = async (sql, params) => {
      const [result] = await conn.execute(sql, params)
      return result
    }

    // 检查是否已初始化（检查是否有6个固定帖子，且sort_order为1-6）
    const [existingRows] = await conn.query(`
      SELECT COUNT(*) AS c 
      FROM featured_posts 
      WHERE sort_order IN (1, 2, 3, 4, 5, 6)
    `)
    if (existingRows && Number(existingRows.c || 0) >= 6) {
      console.log('[initFeaturedPosts] 固定帖子已存在，跳过初始化')
      await conn.rollback()
      return
    }
    
    // 如果存在部分数据，先清理（删除所有固定帖子，重新初始化）
    if (existingRows && Number(existingRows.c || 0) > 0) {
      console.log('[initFeaturedPosts] 发现部分数据，清理后重新初始化')
      // 先删除投票选项（因为有外键约束）
      await exec('DELETE FROM vote_options WHERE post_id IN (SELECT id FROM featured_posts)')
      // 删除所有固定帖子
      await exec('DELETE FROM featured_posts')
    }

    // 1. 你有哪些戒烟方法推荐 - 普通帖子
    const post1Result = await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['你有哪些戒烟方法推荐', '', 'normal', 'all', 'all', 1]
    )
    const post1Id = post1Result.insertId

    // 2. 戒断反应有哪些 - 投票型帖子
    const post2Result = await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['戒断反应有哪些', '', 'vote', 'all', 'all', 2]
    )
    const post2Id = post2Result.insertId

    // 为"戒断反应有哪些"创建20个投票选项
    const withdrawalOptions = [
      '脾气暴躁情绪低落',
      '睡眠中断/难以入睡/梦里吸烟',
      '嗜睡',
      '一会就饿',
      '吐黑痰',
      '咳嗽',
      '头晕',
      '口腔溃疡',
      '注意力不集中',
      '发胖',
      '口渴',
      '胸部不时隐隐作痛',
      '长痘痘',
      '便秘',
      '头痛',
      '拉肚子',
      '胸闷气短',
      '浑身酸痛',
      '盗汗',
      '心悸心慌焦虑'
    ]

    for (let i = 0; i < withdrawalOptions.length; i++) {
      await exec(
        `INSERT INTO vote_options(post_id, option_text, sort_order)
         VALUES(?,?,?)`,
        [post2Id, withdrawalOptions[i], i + 1]
      )
    }

    // 3. 戒烟后身体/容貌有哪些变化 - 普通帖子
    await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['戒烟后身体/容貌有哪些变化', '', 'normal', 'all', 'all', 3]
    )

    // 4. 戒烟后有哪些改变 - 投票型帖子
    const post4Result = await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['戒烟后有哪些改变', '', 'vote', 'all', 'all', 4]
    )
    const post4Id = post4Result.insertId

    // 为"戒烟后有哪些改变"创建9个投票选项
    const improvementOptions = [
      '鼻孔清爽、呼吸顺畅，慢性鼻炎得到改善',
      '口气问题得到解决',
      '烟渍消失 牙齿变白',
      '味觉恢复 吃饭更香',
      '睡眠质量提高',
      '皮肤有光泽',
      '刷牙不干呕',
      '不嗜睡 起床神清气爽',
      '视力得到改善'
    ]

    for (let i = 0; i < improvementOptions.length; i++) {
      await exec(
        `INSERT INTO vote_options(post_id, option_text, sort_order)
         VALUES(?,?,?)`,
        [post4Id, improvementOptions[i], i + 1]
      )
    }

    // 5. 是什么让你坚持了下来 - 普通帖子（钻石以上可回复）
    await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['是什么让你坚持了下来', '', 'normal', 'all', 'diamond+', 5]
    )

    // 6. 就想整两口儿的时候你是怎么顶住的 - 普通帖子（黄金一以上可回复）
    await exec(
      `INSERT INTO featured_posts(title, content, post_type, view_permission, reply_permission, sort_order)
       VALUES(?,?,?,?,?,?)`,
      ['就想整两口儿的时候你是怎么顶住的', '', 'normal', 'all', 'gold1+', 6]
    )

    await conn.commit()
    console.log('[initFeaturedPosts] 固定帖子初始化完成')
  } catch (e) {
    await conn.rollback()
    console.error('[initFeaturedPosts] 初始化失败:', e)
    throw e
  } finally {
    conn.release()
    await pool.end()
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

module.exports = { main }
