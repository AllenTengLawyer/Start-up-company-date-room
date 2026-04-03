/**
 * DuplicateWarningModal - Shows duplicate file warnings during scan
 */
const DuplicateWarningModal = {
  template: `
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>⚠️ 发现重复文件</h3>
          <button class="btn-close" @click="$emit('close')">×</button>
        </div>

        <div class="modal-body">
          <p class="modal-intro">
            扫描发现 <strong>{{ duplicateCount }}</strong> 个可能重复的文件
            （文件名和大小相同）
          </p>

          <div class="duplicate-groups">
            <div v-for="(group, idx) in duplicates" :key="idx" class="dup-group">
              <div class="dup-header">
                <span class="dup-name">{{ group.new_file.file_name }}</span>
                <span class="dup-size">({{ formatSize(group.new_file.file_size) }})</span>
              </div>
              <div class="dup-files">
                <div class="dup-existing">
                  <span class="badge badge-existing">已存在</span>
                  <span class="path">{{ group.existing_file }}</span>
                </div>
                <div class="dup-new">
                  <span class="badge badge-new">新发现</span>
                  <span class="path">{{ group.new_file.file_path }}</span>
                </div>
              </div>
              <div class="dup-actions">
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    v-model="skipFiles"
                    :value="group.new_file.file_path"
                  >
                  跳过此文件
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <div class="footer-stats">
            已选择跳过 {{ skipFiles.length }} 个文件
          </div>
          <div class="footer-actions">
            <button class="btn-secondary" @click="skipAll">
              全部跳过
            </button>
            <button class="btn-secondary" @click="keepAll">
              全部保留
            </button>
            <button class="btn-primary" @click="confirm">
              确认 ({{ filesToRegister.length }} 个文件)
            </button>
          </div>
        </div>
      </div>
    </div>
  `,

  props: {
    duplicates: {
      type: Array,
      default: () => []
    },
    allFiles: {
      type: Array,
      default: () => []
    }
  },

  emits: ['close', 'confirm'],

  data() {
    return {
      skipFiles: []
    }
  },

  computed: {
    duplicateCount() {
      return this.duplicates.length
    },
    filesToRegister() {
      const skipSet = new Set(this.skipFiles)
      return this.allFiles.filter(f => !skipSet.has(f.file_path))
    }
  },

  methods: {
    formatSize(bytes) {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },
    skipAll() {
      this.skipFiles = this.duplicates.map(d => d.new_file.file_path)
    },
    keepAll() {
      this.skipFiles = []
    },
    confirm() {
      this.$emit('confirm', this.filesToRegister)
    }
  }
}

window.DuplicateWarningModal = DuplicateWarningModal;
window.DuplicateWarningModal = DuplicateWarningModal;
