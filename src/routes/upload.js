const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { requireAuth } = require('../auth')
const { config } = require('../config')

const router = express.Router()

// 确保上传目录存在
const uploadDir = path.resolve(__dirname, '../../public/uploads')

if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true })
  } catch (e) {
    // 目录创建失败，会在上传时处理
  }
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：时间戳 + 随机数 + 原始扩展名
    const ext = path.extname(file.originalname) || '.jpg'
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${ext}`
    cb(null, filename)
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片文件
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持图片文件（jpg、png、gif、webp）'))
    }
  }
})

// 图片上传接口
router.post('/image', requireAuth, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' })
    }

    // 检查文件是否真的保存成功
    const filePath = req.file.path
    const fileExists = fs.existsSync(filePath)
    
    if (!fileExists) {
      return res.status(500).json({ error: '文件保存失败' })
    }

    // 返回图片URL（相对于public目录的路径）
    const imageUrl = `/uploads/${req.file.filename}`
    
    res.json({ 
      url: imageUrl,
      filename: req.file.filename,
      size: req.file.size
    })
  } catch (e) {
    next(e)
  }
})

module.exports = router
