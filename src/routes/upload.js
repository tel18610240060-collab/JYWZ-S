const express = require('express')
const multer = require('multer')
const path = require('path')
const { requireAuth } = require('../auth')
const { config } = require('../config')
const { uploadBuffer } = require('../services/tos')

const router = express.Router()

// 使用内存存储，便于直接上传到 TOS
const memoryStorage = multer.memoryStorage()

const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持图片文件（jpg、png、gif、webp）'))
    }
  }
})

// 图片上传接口：接收文件后上传到 TOS 对象存储，返回 TOS 公网 URL
router.post('/image', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          return res.status(400).json({ error: '文件大小超过限制（最大10MB）' })
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.status(400).json({ error: '文件上传错误：' + err.message })
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(400).json({ error: err.message || '文件上传失败' })
    }
    next()
  })
}, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.status(400).json({ error: '未上传文件' })
    }

    const hasTos = config.TOS_ACCESS_KEY_ID && config.TOS_SECRET_ACCESS_KEY && config.TOS_BUCKET

    if (hasTos) {
      // 上传到 TOS 对象存储，加超时避免卡死
      const TOS_UPLOAD_TIMEOUT_MS = 25000
      const ext = path.extname(req.file.originalname) || '.jpg'
      const key = `uploads/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).substring(2, 12)}${ext}`
      const contentType = req.file.mimetype || 'image/jpeg'

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TOS 上传超时（25秒）')), TOS_UPLOAD_TIMEOUT_MS)
      })
      const imageUrl = await Promise.race([
        uploadBuffer(req.file.buffer, key, contentType),
        timeoutPromise
      ])
      console.log('[upload] TOS uploaded:', key, 'size:', req.file.size)

      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      return res.json({
        url: imageUrl,
        filename: path.basename(key),
        size: req.file.size
      })
    }

    // 未配置 TOS 时返回错误，提示配置对象存储
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(503).json({
      error: '未配置 TOS 对象存储，请设置 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET、TOS_PUBLIC_URL'
    })
  } catch (e) {
    console.error('[upload] Error:', e.message || e)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.status(500).json({ error: '上传失败：' + (e.message || '未知错误') })
  }
})

module.exports = router
