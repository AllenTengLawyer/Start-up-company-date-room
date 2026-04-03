/**
 * VersionHistoryModal - Display and manage file version history
 */
const VersionHistoryModal = {
  template: `
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal card" style="max-width: 600px; max-height: 80vh;">
        <div class="modal-header">
          <h3>📋 版本历史: {{ fileName }}</h3>
          <button class="btn-close" @click="$emit('close')">×</button>
        </div>

        <div class="modal-body" style="overflow-y: auto;">
          <div v-if="loading" class="loading">加载中...</div>

          <div v-else-if="versions.length === 0" class="empty-state">
            暂无版本历史
          </div>

          <div v-else class="version-list">
            <div
              v-for="(v, idx) in versions"
              :key="v.id"
              :class="['version-item', { 'current': idx === 0 }]"
            >
              <div class="version-header">
                <span class="version-badge">v{{ v.version_no }}</span>
                <span v-if="idx === 0" class="current-badge">当前</span>
                <span class="version-date">{{ formatDate(v.created_at) }}</span>
              </div>

              <div class="version-details">
                <div class="detail-row">
                  <span class="detail-label">路径:</span>
                  <span class="detail-value path">{{ v.file_path }}</span>
                </div>
                <div class="detail-row" v-if="v.file_size">
                  <span class="detail-label">大小:</span>
                  <span class="detail-value">{{ formatSize(v.file_size) }}</span>
                </div>
                <div class="detail-row" v-if="v.content_hash">
                  <span class="detail-label">哈希:</span>
                  <span class="detail-value hash">{{ v.content_hash.substring(0, 16) }}...</span>
                </div>
              </div>

              <div v-if="idx !== 0" class="version-actions">
                <button
                  class="btn-sm btn-secondary"
                  @click="confirmRollback(v)"
                  :disabled="rollingBack"
                >
                  {{ rollingBack ? '回滚中...' : '回滚到此版本' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <div class="footer-info">
            共 {{ versions.length }} 个版本
          </div>
          <button class="btn btn-secondary" @click="$emit('close')">关闭</button>
        </div>

        <!-- Rollback Confirmation Modal -->
        <div v-if="showRollbackConfirm" class="modal-overlay" @click.self="showRollbackConfirm = false">
          <div class="modal card" style="max-width: 400px;">
            <div class="modal-header">
              <h3>⚠️ 确认回滚</h3>
            </div>
            <div class="modal-body">
              <p>确定要回滚到版本 <strong>v{{ selectedVersion?.version_no }}</strong> 吗？</p>
              <p class="rollback-warning">此操作将：</p>
              <ul class="rollback-list">
                <li>恢复文件路径为: {{ selectedVersion?.file_path }}</li>
                <li>创建一个新的版本记录当前状态</li>
                <li>你可以再次回滚来撤销此操作</li>
              </ul>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" @click="showRollbackConfirm = false">取消</button>
              <button class="btn btn-primary" @click="executeRollback">确认回滚</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  props: {
    fileId: {
      type: Number,
      required: true
    },
    fileName: {
      type: String,
      default: ''
    }
  },

  emits: ['close', 'rollback'],

  data() {
    return {
      versions: [],
      loading: false,
      rollingBack: false,
      showRollbackConfirm: false,
      selectedVersion: null
    }
  },

  mounted() {
    this.loadVersions()
  },

  methods: {
    async loadVersions() {
      this.loading = true
      try {
        const res = await api('GET', `/files/${this.fileId}/versions`)
        this.versions = res.versions || []
      } catch (e) {
        console.error('Failed to load versions:', e)
      } finally {
        this.loading = false
      }
    },

    formatDate(dateStr) {
      if (!dateStr) return '-'
      const d = new Date(dateStr)
      return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    },

    formatSize(bytes) {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },

    confirmRollback(version) {
      this.selectedVersion = version
      this.showRollbackConfirm = true
    },

    async executeRollback() {
      if (!this.selectedVersion) return

      this.rollingBack = true
      this.showRollbackConfirm = false

      try {
        const res = await api('POST', `/files/${this.fileId}/rollback`, {
          version_id: this.selectedVersion.id
        })

        this.$emit('rollback', res)
        await this.loadVersions()
      } catch (e) {
        alert('回滚失败: ' + e.message)
      } finally {
        this.rollingBack = false
        this.selectedVersion = null
      }
    }
  }
}

// Mount to window for global access
window.VersionHistoryModal = VersionHistoryModal;
