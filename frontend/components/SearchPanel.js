/**
 * SearchPanel - Full-text search across file content
 */
const SearchPanel = {
  template: `
    <div class="search-panel">
      <div class="search-input-wrapper">
        <button class="btn-search-back" @click="$emit('close')" title="退出搜索">
          ←
        </button>
        <input
          v-model="query"
          @input="onInput"
          @keyup.enter="search"
          type="text"
          class="search-input"
          placeholder="搜索文件内容..."
        >
        <button class="btn-search" @click="search">
          🔍
        </button>
        <button v-if="query" class="btn-clear" @click="clear">
          ×
        </button>
        <button class="btn-search-exit" @click="$emit('close')">
          返回
        </button>
      </div>

      <div v-if="loading" class="search-loading">
        搜索中...
      </div>
      
      <div v-else-if="error" class="error">
        {{ error }}
      </div>

      <div v-else-if="hasSearched" class="search-results">
        <div class="results-header">
          <span v-if="results.length > 0">
            找到 {{ results.length }} 个结果
            <span v-if="!ftsEnabled" class="badge badge-warning">基础搜索模式</span>
          </span>
          <span v-else>未找到结果</span>
        </div>

        <div v-for="(result, idx) in results" :key="result.id" class="result-item"
             @click="openFile(result)">
          <div class="result-title">
            <span class="file-name">{{ result.file_name }}</span>
            <span v-if="result.category_name" class="badge badge-category">
              {{ result.category_name }}
            </span>
          </div>
          <div class="result-snippet" v-html="result.snippet"></div>
          <div class="result-path">{{ result.file_path }}</div>
        </div>
      </div>

      <div v-else class="search-tips">
        <p>💡 搜索提示：</p>
        <ul>
          <li>支持 PDF、Word、TXT 等文档内容搜索</li>
          <li>搜索结果会显示匹配的文本片段</li>
        </ul>
      </div>
    </div>
  `,

  props: {
    projectId: {
      type: Number,
      required: true
    }
  },

  data() {
    return {
      query: '',
      results: [],
      loading: false,
      hasSearched: false,
      ftsEnabled: true,
      debounceTimer: null,
      error: '',
      abortController: null
    }
  },

  methods: {
    onInput() {
      clearTimeout(this.debounceTimer)
      if (this.query.length >= 2) {
        this.debounceTimer = setTimeout(() => this.search(), 300)
      }
    },

    async search() {
      if (!this.query.trim()) return

      if (this.abortController) {
        try { this.abortController.abort(); } catch (e) {}
      }
      const controller = new AbortController()
      this.abortController = controller

      this.loading = true
      this.error = ''
      try {
        const data = await api(
          'GET',
          `/projects/${this.projectId}/search?q=${encodeURIComponent(this.query)}`,
          null,
          { signal: controller.signal }
        )
        this.results = data.results || []
        this.ftsEnabled = data.fts_enabled
        this.hasSearched = true
      } catch (e) {
        if (e && e.name === 'AbortError') return
        this.error = (e && e.message) ? e.message : '搜索失败'
        this.results = []
        this.hasSearched = true
      } finally {
        if (this.abortController === controller) {
          this.loading = false
          this.abortController = null
        }
      }
    },

    clear() {
      this.query = ''
      this.results = []
      this.hasSearched = false
    },

    openFile(result) {
      this.$emit('open-file', result)
    }
  }
}

// Mount to window for global access
window.SearchPanel = SearchPanel;
