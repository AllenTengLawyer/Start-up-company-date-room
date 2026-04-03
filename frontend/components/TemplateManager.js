/**
 * TemplateManager - Manage LDD checklist templates
 */
const TemplateManager = {
  template: `
    <div class="template-manager">
      <div class="template-header">
        <h3>📋 LDD尽调清单模板</h3>
        <div class="template-filters">
          <select v-model="filterRound" class="input input-sm">
            <option value="">全部轮次</option>
            <option value="angel">天使轮</option>
            <option value="series_a">A轮</option>
            <option value="series_b">B轮</option>
            <option value="custom">自定义</option>
          </select>
          <button class="btn-primary" @click="showImportModal = true">导入模板</button>
        </div>
      </div>

      <div class="template-list">
        <div v-for="t in filteredTemplates" :key="t.id" class="template-card">
          <div class="template-info">
            <div class="template-name">
              {{ t.name }}
              <span v-if="t.is_builtin" class="badge badge-builtin">内置</span>
            </div>
            <div class="template-meta">
              <span class="round-badge" :class="'round-' + t.round_type">{{ formatRoundType(t.round_type) }}</span>
              <span class="item-count">{{ t.item_count }} 项检查点</span>
            </div>
            <div v-if="t.description" class="template-desc">{{ t.description }}</div>
          </div>
          <div class="template-actions">
            <button class="btn-sm" @click="viewTemplate(t)">查看</button>
            <button class="btn-sm btn-primary" @click="applyTemplate(t)" v-if="projectId">应用</button>
            <button class="btn-sm" @click="exportTemplate(t)">导出</button>
            <button class="btn-sm btn-danger" v-if="!t.is_builtin" @click="deleteTemplate(t)">删除</button>
          </div>
        </div>

        <div v-if="filteredTemplates.length === 0" class="empty-state">
          暂无模板
        </div>
      </div>

      <!-- Import Modal -->
      <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
        <div class="modal card" style="max-width: 500px;">
          <div class="modal-header">
            <h3>导入模板</h3>
            <button class="btn-close" @click="showImportModal = false">×</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>粘贴JSON模板</label>
              <textarea v-model="importJson" class="form-control" rows="10" placeholder='{"name": "...", "round_type": "...", "items": [...]}'></textarea>
            </div>
            <div v-if="importError" class="error">{{ importError }}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showImportModal = false">取消</button>
            <button class="btn btn-primary" @click="doImport" :disabled="!importJson.trim()">导入</button>
          </div>
        </div>
      </div>

      <!-- View Modal -->
      <div v-if="viewingTemplate" class="modal-overlay" @click.self="viewingTemplate = null">
        <div class="modal card" style="max-width: 700px; max-height: 80vh;">
          <div class="modal-header">
            <h3>{{ viewingTemplate.name }}</h3>
            <button class="btn-close" @click="viewingTemplate = null">×</button>
          </div>
          <div class="modal-body" style="overflow-y: auto;">
            <div class="template-detail-meta">
              <span class="round-badge" :class="'round-' + viewingTemplate.round_type">{{ formatRoundType(viewingTemplate.round_type) }}</span>
              <span>{{ viewingTemplate.items?.length || 0 }} 项检查点</span>
            </div>
            <div v-if="viewingTemplate.description" class="template-detail-desc">{{ viewingTemplate.description }}</div>

            <table class="template-items-table">
              <thead>
                <tr><th>章节</th><th>编号</th><th>标题</th><th>类型</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in viewingTemplate.items" :key="item.id">
                  <td>{{ item.section_no }}</td>
                  <td>{{ item.item_no }}</td>
                  <td>{{ item.title }}</td>
                  <td><span class="badge" :class="'type-' + item.item_type">{{ item.item_type }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="viewingTemplate = null">关闭</button>
            <button class="btn btn-primary" @click="applyTemplate(viewingTemplate)" v-if="projectId">应用到项目</button>
          </div>
        </div>
      </div>
    </div>
  `,

  props: {
    projectId: {
      type: Number,
      default: null
    }
  },

  emits: ['template-applied'],

  data() {
    return {
      templates: [],
      loading: false,
      filterRound: '',
      showImportModal: false,
      importJson: '',
      importError: '',
      viewingTemplate: null
    }
  },

  computed: {
    filteredTemplates() {
      if (!this.filterRound) return this.templates
      return this.templates.filter(t => t.round_type === this.filterRound)
    }
  },

  mounted() {
    this.loadTemplates()
  },

  methods: {
    async loadTemplates() {
      this.loading = true
      try {
        const res = await api('GET', '/ldd/templates')
        this.templates = res.templates || []
      } catch (e) {
        console.error('Failed to load templates:', e)
      } finally {
        this.loading = false
      }
    },

    formatRoundType(type) {
      const map = {
        'angel': '天使轮',
        'series_a': 'A轮',
        'series_b': 'B轮',
        'custom': '自定义'
      }
      return map[type] || type
    },

    async viewTemplate(t) {
      try {
        const res = await api('GET', `/ldd/templates/${t.id}`)
        this.viewingTemplate = res
      } catch (e) {
        alert('加载模板失败: ' + e.message)
      }
    },

    async applyTemplate(t) {
      if (!this.projectId) return
      if (!confirm(`确定要应用模板"${t.name}"到当前项目吗？这将替换现有的尽调清单。`)) return

      try {
        await api('POST', `/projects/${this.projectId}/apply-template?template_id=${t.id}`)
        this.$emit('template-applied')
        alert('模板应用成功！')
      } catch (e) {
        alert('应用模板失败: ' + e.message)
      }
    },

    async exportTemplate(t) {
      try {
        const res = await api('GET', `/ldd/templates/${t.id}/export`)
        const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `template_${t.name}_${t.round_type}.json`
        a.click()
        URL.revokeObjectURL(url)
      } catch (e) {
        alert('导出失败: ' + e.message)
      }
    },

    async deleteTemplate(t) {
      if (!confirm(`确定要删除模板"${t.name}"吗？`)) return

      try {
        await api('DELETE', `/ldd/templates/${t.id}`)
        await this.loadTemplates()
      } catch (e) {
        alert('删除失败: ' + e.message)
      }
    },

    async doImport() {
      this.importError = ''
      try {
        const data = JSON.parse(this.importJson)
        await api('POST', '/ldd/templates/import', data)
        this.showImportModal = false
        this.importJson = ''
        await this.loadTemplates()
      } catch (e) {
        this.importError = e.message || '导入失败'
      }
    }
  }
}

export default TemplateManager

// Mount to window for global access
window.TemplateManager = TemplateManager;
