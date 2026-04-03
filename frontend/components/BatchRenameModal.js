/**
 * BatchRenameModal - Batch file rename with pattern options
 */
const BatchRenameModal = {
  template: `
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal card" style="max-width: 500px;">
        <div class="modal-header">
          <h3>批量重命名 ({{ fileCount }} 个文件)</h3>
          <button class="btn-close" @click="$emit('close')">×</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>命名规则</label>
            <select v-model="pattern" class="form-control">
              <option value="date">日期前缀 (YYYYMMDD_原文件名)</option>
              <option value="sequence">序号前缀 (001_原文件名)</option>
              <option value="prefix">自定义前缀</option>
              <option value="suffix">自定义后缀</option>
            </select>
          </div>

          <div v-if="pattern === 'prefix'" class="form-group">
            <label>前缀文字</label>
            <input v-model="prefix" class="form-control" placeholder="输入前缀">
          </div>

          <div v-if="pattern === 'suffix'" class="form-group">
            <label>后缀文字</label>
            <input v-model="suffix" class="form-control" placeholder="输入后缀">
          </div>

          <div v-if="pattern === 'sequence'" class="form-group">
            <label>起始序号</label>
            <input v-model.number="startNumber" type="number" min="1" class="form-control" style="width: 100px;">
          </div>

          <div class="preview-section">
            <label>预览</label>
            <div class="preview-list">
              <div v-for="(item, idx) in preview" :key="idx" class="preview-item">
                <span class="old-name">{{ item.old }}</span>
                <span class="arrow">→</span>
                <span class="new-name">{{ item.new }}</span>
              </div>
              <div v-if="preview.length >= 5" class="preview-more">
                ... 还有 {{ fileCount - 5 }} 个文件
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" @click="confirm" :disabled="!canConfirm">
            确认重命名
          </button>
        </div>
      </div>
    </div>
  `,

  props: {
    fileCount: {
      type: Number,
      default: 0
    },
    sampleFiles: {
      type: Array,
      default: () => []
    },
    projectId: {
      type: Number,
      required: true
    }
  },

  emits: ['close', 'confirm'],

  data() {
    return {
      pattern: 'date',
      prefix: '',
      suffix: '',
      startNumber: 1
    }
  },

  computed: {
    canConfirm() {
      if (this.pattern === 'prefix') return this.prefix.trim().length > 0
      if (this.pattern === 'suffix') return this.suffix.trim().length > 0
      return true
    },
    preview() {
      const samples = this.sampleFiles.slice(0, 5)
      return samples.map((f, idx) => {
        const oldName = f.file_name || f.name || 'file'
        const base = oldName.replace(/\.[^/.]+$/, '')
        const ext = oldName.match(/\.[^/.]+$/)?.[0] || ''

        let newBase = base
        const now = new Date()

        switch (this.pattern) {
          case 'date':
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
            newBase = `${dateStr}_${base}`
            break
          case 'sequence':
            const num = (this.startNumber + idx).toString().padStart(3, '0')
            newBase = `${num}_${base}`
            break
          case 'prefix':
            newBase = `${this.prefix}${base}`
            break
          case 'suffix':
            newBase = `${base}${this.suffix}`
            break
        }

        return {
          old: oldName,
          new: `${newBase}${ext}`
        }
      })
    }
  },

  methods: {
    confirm() {
      this.$emit('confirm', {
        pattern: this.pattern,
        prefix: this.prefix,
        suffix: this.suffix,
        startNumber: this.startNumber
      })
    }
  }
}

// Mount to window for global access
window.BatchRenameModal = BatchRenameModal;
