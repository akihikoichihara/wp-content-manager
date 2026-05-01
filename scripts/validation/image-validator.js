const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

class ImageValidator {
  constructor(rules = {}) {
    this.rules = {
      maxSize: 1024 * 1024, // 1MB
      allowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
      maxDimensions: { width: 1200, height: 800 },
      altTextRequired: true,
      altTextMinLength: 5,
      descriptiveFilenames: true,
      ...rules
    };
  }

  async validateImages(content, basePath = null) {
    const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const images = [];
    let match;

    // Extract all images
    while ((match = imagePattern.exec(content)) !== null) {
      const altText = match[1];
      const imageSrc = match[2];
      images.push({
        altText,
        src: imageSrc,
        original: match[0]
      });
    }

    const results = {
      totalImages: images.length,
      validImages: 0,
      issues: [],
      warnings: [],
      successes: [],
      details: []
    };

    // Check each image
    for (const image of images) {
      try {
        const imageResult = await this.validateImage(image, basePath);
        results.details.push(imageResult);

        if (imageResult.isValid) {
          results.validImages++;
          results.successes.push(`画像OK: ${path.basename(image.src)}`);
        } else {
          imageResult.issues.forEach(issue => {
            if (issue.severity === 'error') {
              results.issues.push(issue.message);
            } else {
              results.warnings.push(issue.message);
            }
          });
        }
      } catch (error) {
        results.issues.push(`画像検証エラー: ${image.src} (${error.message})`);
      }
    }

    return results;
  }

  async validateImage(image, basePath) {
    const result = {
      src: image.src,
      altText: image.altText,
      type: this.getImageType(image.src),
      isValid: true,
      issues: [],
      metadata: {}
    };

    // Validate alt text
    this.validateAltText(image.altText, result);

    // Validate filename
    this.validateFilename(image.src, result);

    // Validate format
    this.validateFormat(image.src, result);

    // For local images, validate file properties
    if (result.type === 'local' && basePath) {
      await this.validateLocalImage(image.src, basePath, result);
    }

    // For external images, validate URL and accessibility
    if (result.type === 'external') {
      await this.validateExternalImage(image.src, result);
    }

    // Set overall validity
    result.isValid = !result.issues.some(issue => issue.severity === 'error');

    return result;
  }

  validateAltText(altText, result) {
    if (!altText || altText.trim() === '') {
      if (this.rules.altTextRequired) {
        result.issues.push({
          severity: 'error',
          message: 'Alt属性が設定されていません'
        });
      }
    } else {
      if (altText.length < this.rules.altTextMinLength) {
        result.issues.push({
          severity: 'warning',
          message: `Alt属性が短すぎます（${altText.length}文字 < ${this.rules.altTextMinLength}文字）`
        });
      } else {
        result.metadata.altTextLength = altText.length;
      }

      // Check for non-descriptive alt text
      const nonDescriptive = ['image', '画像', 'photo', '写真', 'picture'];
      if (nonDescriptive.some(word => altText.toLowerCase().includes(word.toLowerCase()))) {
        result.issues.push({
          severity: 'warning',
          message: 'Alt属性をより具体的にしてください'
        });
      }
    }
  }

  validateFilename(src, result) {
    const filename = path.basename(src);
    const nameWithoutExt = path.parse(filename).name;

    if (this.rules.descriptiveFilenames) {
      // Check for non-descriptive filenames
      const nonDescriptive = /^(img|image|photo|picture|screenshot)[\d_-]*$/i;
      if (nonDescriptive.test(nameWithoutExt)) {
        result.issues.push({
          severity: 'warning',
          message: 'ファイル名をより具体的にしてください'
        });
      }

      // Check for random/generated filenames
      const randomPattern = /^[a-f0-9]{8,}$|^[A-Z0-9]{8,}$/;
      if (randomPattern.test(nameWithoutExt)) {
        result.issues.push({
          severity: 'warning',
          message: '意味のあるファイル名を使用してください'
        });
      }
    }

    result.metadata.filename = filename;
  }

  validateFormat(src, result) {
    const extension = path.extname(src).toLowerCase().substring(1);
    
    if (!this.rules.allowedFormats.includes(extension)) {
      result.issues.push({
        severity: 'error',
        message: `サポートされていない画像形式: ${extension}`
      });
    } else {
      result.metadata.format = extension;
      
      // Recommend modern formats
      if (['jpg', 'jpeg', 'png'].includes(extension)) {
        result.issues.push({
          severity: 'info',
          message: 'WebP形式の使用を検討してください（より高効率）'
        });
      }
    }
  }

  async validateLocalImage(src, basePath, result) {
    try {
      const imagePath = path.resolve(basePath, src);
      const stats = await fs.stat(imagePath);
      
      // File size check
      result.metadata.fileSize = stats.size;
      if (stats.size > this.rules.maxSize) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        const maxSizeMB = (this.rules.maxSize / (1024 * 1024)).toFixed(2);
        result.issues.push({
          severity: 'warning',
          message: `ファイルサイズが大きすぎます（${sizeMB}MB > ${maxSizeMB}MB）`
        });
      }

      // Try to get image dimensions (basic check)
      // Note: This is a simplified implementation
      // In a real-world scenario, you'd use an image processing library
      await this.estimateImageDimensions(imagePath, result);

    } catch (error) {
      result.issues.push({
        severity: 'error',
        message: `ローカル画像にアクセスできません: ${error.message}`
      });
    }
  }

  async validateExternalImage(src, result) {
    try {
      const response = await this.checkImageUrl(src);
      result.metadata.httpStatus = response.statusCode;
      result.metadata.contentType = response.headers['content-type'];
      
      if (response.statusCode >= 200 && response.statusCode < 300) {
        // Check content type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          result.issues.push({
            severity: 'error',
            message: '画像ファイルではありません'
          });
        }

        // Check content length
        const contentLength = parseInt(response.headers['content-length']) || 0;
        if (contentLength > this.rules.maxSize) {
          const sizeMB = (contentLength / (1024 * 1024)).toFixed(2);
          const maxSizeMB = (this.rules.maxSize / (1024 * 1024)).toFixed(2);
          result.issues.push({
            severity: 'warning',
            message: `外部画像のサイズが大きすぎます（${sizeMB}MB > ${maxSizeMB}MB）`
          });
        }
      } else {
        result.issues.push({
          severity: 'error',
          message: `外部画像にアクセスできません（HTTP ${response.statusCode}）`
        });
      }
    } catch (error) {
      result.issues.push({
        severity: 'error',
        message: `外部画像の検証エラー: ${error.message}`
      });
    }
  }

  async estimateImageDimensions(imagePath, result) {
    // This is a simplified dimension check
    // In a real implementation, you'd use a library like 'sharp' or 'jimp'
    try {
      const buffer = await fs.readFile(imagePath);
      
      // Basic dimension estimation for common formats
      let dimensions = null;
      
      if (imagePath.toLowerCase().endsWith('.png')) {
        dimensions = this.getPNGDimensions(buffer);
      } else if (imagePath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
        dimensions = this.getJPEGDimensions(buffer);
      }
      
      if (dimensions) {
        result.metadata.dimensions = dimensions;
        
        if (dimensions.width > this.rules.maxDimensions.width || 
            dimensions.height > this.rules.maxDimensions.height) {
          result.issues.push({
            severity: 'warning',
            message: `画像サイズが大きすぎます（${dimensions.width}×${dimensions.height}）`
          });
        }
      }
    } catch (error) {
      // Don't fail the validation if we can't read dimensions
      result.metadata.dimensionError = error.message;
    }
  }

  getPNGDimensions(buffer) {
    // PNG header check (simplified)
    if (buffer.length < 24) return null;
    if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
    
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    
    return { width, height };
  }

  getJPEGDimensions(buffer) {
    // JPEG dimension reading (very simplified)
    // This is a basic implementation - use a proper library in production
    if (buffer.length < 4) return null;
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
    
    // This is a placeholder - proper JPEG parsing is complex
    // You should use a library like 'image-size' for accurate results
    return { width: 0, height: 0, note: 'Dimension detection not implemented for JPEG' };
  }

  checkImageUrl(url) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        timeout: 5000,
        headers: {
          'User-Agent': 'wp-content-manager/1.0'
        }
      };

      const req = client.request(options, (res) => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  getImageType(src) {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return 'external';
    } else if (src.startsWith('/')) {
      return 'absolute';
    } else {
      return 'local';
    }
  }

  generateOptimizationSuggestions(results) {
    const suggestions = [];

    if (results.totalImages === 0) {
      suggestions.push('画像を追加してコンテンツを豊かにしてください');
      return suggestions;
    }

    // Alt text suggestions
    const missingAltCount = results.details.filter(img => 
      !img.altText || img.altText.trim() === ''
    ).length;
    
    if (missingAltCount > 0) {
      suggestions.push(`${missingAltCount}件の画像にAlt属性を追加してください`);
    }

    // Format suggestions
    const oldFormatCount = results.details.filter(img => 
      img.metadata.format && ['jpg', 'jpeg', 'png'].includes(img.metadata.format)
    ).length;
    
    if (oldFormatCount > 0) {
      suggestions.push('WebP形式への変換を検討してください（パフォーマンス向上）');
    }

    // Size suggestions
    const largeSizeCount = results.details.filter(img => 
      img.metadata.fileSize && img.metadata.fileSize > this.rules.maxSize
    ).length;
    
    if (largeSizeCount > 0) {
      suggestions.push(`${largeSizeCount}件の画像のサイズを最適化してください`);
    }

    return suggestions;
  }
}

module.exports = ImageValidator;