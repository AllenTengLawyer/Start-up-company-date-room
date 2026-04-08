window.LddView = {
  setup() {
    const { t } = VueI18n.useI18n();
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const projectId = Vue.computed(() => route.params.id);
    const sections = Vue.ref([]);
    const todoItems = Vue.ref([]);
    const founderSummary = Vue.ref([]);
    const score = Vue.ref({ score_pct: 0, provided: 0, partial: 0, pending: 0, na: 0, total: 0 });
    const allFiles = Vue.ref([]);
    const allCatTree = Vue.ref([]); // full category tree for modal
    const openSections = Vue.ref({});
    const activeTab = Vue.ref('all'); // 'all' | 'todo'
    const showMapModal = Vue.ref(false);
    const mappingItem = Vue.ref(null);
    const mapStep = Vue.ref(1); // 1 = pick category, 2 = pick files
    const mapSelectedCatId = Vue.ref(null);
    const mapSelectedFileIds = Vue.ref(new Set());
    const error = Vue.ref('');

    const allCategories = Vue.computed(() => {
      // Flatten category tree preserving depth for indented display
      function flatten(nodes, depth = 0) {
        const result = [];
        for (const n of nodes) {
          result.push({ ...n, depth });
          if (n.children && n.children.length) result.push(...flatten(n.children, depth + 1));
        }
        return result;
      }
      return [{ id: null, name: '全部文件', depth: 0 }, ...flatten(allCatTree.value)];
    });

    // Returns all category IDs that are descendants of (or equal to) a given catId
    function descendantCatIds(catId) {
      if (catId === null) return null; // null = all
      const result = new Set([catId]);
      function walk(nodes) {
        for (const n of nodes) {
          if (result.has(n.id) || result.has(n.parent_id)) {
            result.add(n.id);
          }
          if (n.children && n.children.length) walk(n.children);
        }
      }
      // Walk until stable (handles arbitrary depth)
      let prev = 0;
      while (prev !== result.size) {
        prev = result.size;
        walk(allCatTree.value);
      }
      return result;
    }

    const modalFiles = Vue.computed(() => {
      if (mapSelectedCatId.value === null) return allFiles.value;
      const ids = descendantCatIds(mapSelectedCatId.value);
      return allFiles.value.filter(f => ids.has(f.category_id));
    });

    const SECTION_TITLES_CN = {
      '1': '集团公司基本文件', '2': '业务与重大合同', '3': '借款和担保',
      '4': '财务和会计', '5': '动产和不动产', '6': '知识产权',
      '7': '税务及财政补贴', '8': '雇员和不竞争', '9': '保险',
      '10': '诉讼、执行及行政处罚', '11': '网络安全、数据合规', '12': 'ESG', '13': '其他'
    };
    const SECTION_TITLES_US = {
      '1': 'Corporate Formation', '2': 'Corporate Governance', '3': 'Capitalization & Financing',
      '4': 'Contracts & Agreements', '5': 'Intellectual Property', '6': 'Human Resources',
      '7': 'Financial Records', '8': 'Legal & Compliance', '9': 'Business Operations',
      '10': 'Tax Records', '11': 'Insurance', '12': 'Real Estate & Assets'
    };
    const companyType = Vue.ref('cn');
    const SECTION_TITLES = Vue.computed(() =>
      companyType.value === 'us' ? SECTION_TITLES_US : SECTION_TITLES_CN
    );

    async function load() {
      error.value = '';
      try {
        try {
          await api('POST', `/projects/${projectId.value}/ensure-seeded`);
        } catch (e) { error.value = e.message || String(e); }
        const projInfo = await api('GET', `/projects/${projectId.value}`);
        companyType.value = projInfo.company_type || 'cn';
        const [lddData, scoreData, filesData, todoData, summaryData, catsData] = await Promise.all([
          api('GET', `/projects/${projectId.value}/ldd`),
          api('GET', `/projects/${projectId.value}/ldd/score`),
          api('GET', `/projects/${projectId.value}/files`),
          api('GET', `/projects/${projectId.value}/ldd/todo`),
          api('GET', `/projects/${projectId.value}/founders/summary`),
          api('GET', `/projects/${projectId.value}/categories`),
        ]);
        sections.value = lddData.sections;
        score.value = scoreData;
        allFiles.value = filesData;
        todoItems.value = todoData.items;
        founderSummary.value = summaryData;
        allCatTree.value = catsData;
        openSections.value = {};
        if (sections.value.length) openSections.value[sections.value[0].section_no] = true;
      } catch (e) {
        error.value = e.message || String(e);
        sections.value = [];
        todoItems.value = [];
        founderSummary.value = [];
        allFiles.value = [];
        allCatTree.value = [];
        openSections.value = {};
        score.value = { score_pct: 0, provided: 0, partial: 0, pending: 0, na: 0, total: 0 };
      }
    }

    function toggleSection(no) {
      openSections.value[no] = !openSections.value[no];
    }

    async function updateStatus(item) {
      await api('PUT', `/ldd/${item.id}/status`, { status: item.status, statement: item.statement });
      const s = await api('GET', `/projects/${projectId.value}/ldd/score`);
      score.value = s;
      // Refresh todo list after status change
      const td = await api('GET', `/projects/${projectId.value}/ldd/todo`);
      todoItems.value = td.items;
    }

    function openMapModal(item) {
      mappingItem.value = item;
      mapStep.value = 1;
      mapSelectedCatId.value = null;
      mapSelectedFileIds.value = new Set();
      showMapModal.value = true;
    }

    function toggleFileSelect(fileId) {
      const s = new Set(mapSelectedFileIds.value);
      if (s.has(fileId)) s.delete(fileId); else s.add(fileId);
      mapSelectedFileIds.value = s;
    }

    function selectAllInCategory() {
      const ids = new Set(modalFiles.value.map(f => f.id));
      mapSelectedFileIds.value = ids;
    }

    async function confirmMappings() {
      for (const fileId of mapSelectedFileIds.value) {
        await api('POST', `/ldd/${mappingItem.value.id}/mappings`, { file_id: fileId });
      }
      showMapModal.value = false;
      await load();
    }

    async function addMapping(fileId) {
      await api('POST', `/ldd/${mappingItem.value.id}/mappings`, { file_id: fileId });
      showMapModal.value = false;
      await load();
    }

    async function removeMapping(mappingId) {
      await api('DELETE', `/ldd/mappings/${mappingId}`);
      await load();
    }

    async function updateMappingNote(mappingId, notes) {
      try {
        await api('PUT', `/ldd/mappings/${mappingId}/notes`, { notes });
      } catch (e) {
        error.value = e.message || String(e);
      }
    }
    const exporting = Vue.ref(false);

    async function exportLddZip() {
      exporting.value = true;
      try {
        const resp = await fetch(`/api/projects/${projectId.value}/export/ldd-zip`);
        if (!resp.ok) throw new Error(await resp.text());
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LDD_${projectId.value}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch(e) { alert('导出失败：' + e.message); }
      finally { exporting.value = false; }
    }

    const riskLabel = { high: '高', medium: '中', low: '低' };
    const statusLabel = { provided: '✓ 已提供', partial: '△ 部分', pending: '✗ 未提供', na: '— 不适用' };

    Vue.onMounted(load);
    Vue.watch(projectId, () => load());

    return { t, sections, todoItems, founderSummary, score, allFiles, allCatTree, openSections,
             activeTab, showMapModal, mappingItem, mapStep, mapSelectedCatId, mapSelectedFileIds,
             allCategories, modalFiles, exporting, error,
             SECTION_TITLES, riskLabel, statusLabel,
             toggleSection, updateStatus, openMapModal, addMapping,
             toggleFileSelect, selectAllInCategory, confirmMappings, removeMapping,
            descendantCatIds, exportLddZip, router, projectId, updateMappingNote };
  },
  template: `
    <div class="page">
      <div class="page-header">
        <h2>{{ t('nav_ldd') }}</h2>
        <button class="btn-secondary" @click="exportLddZip" :disabled="exporting">
          {{ exporting ? '导出中...' : '📦 导出尽调包' }}
        </button>
      </div>

      <div class="error" v-if="error">{{ error }}</div>

      <!-- Founder summary (only if founders exist) -->
      <div class="card" v-if="founderSummary.length" style="margin-bottom:16px;">
        <div class="panel-title" style="margin-bottom:10px;">{{ t('founder_summary_title') }}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div v-for="f in founderSummary" :key="f.id"
            style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;min-width:180px;"
            @click="router.push('/project/' + projectId + '/founder/' + f.id)">
            <div style="width:32px;height:32px;border-radius:50%;background:#3182ce;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">
              {{ f.name[0] }}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">{{ f.name }}</div>
              <div style="font-size:11px;color:#718096;">{{ f.role || '—' }}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                <div class="progress-bar-wrap">
                  <div class="progress-bar-fill" :style="{ width: f.score_pct + '%' }"></div>
                </div>
                <span style="font-size:11px;color:#4a5568;white-space:nowrap;">{{ f.score_pct }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Score bar -->
      <div class="score-card card">
        <div class="score-main">
          <div class="score-circle">
            <span class="score-num">{{ score.score_pct }}</span><span class="score-pct">%</span>
          </div>
          <div class="score-label">{{ t('score_label') }}</div>
        </div>
        <div class="score-stats">
          <div class="stat-item stat-provided"><div class="stat-n">{{ score.provided }}</div><div>已提供</div></div>
          <div class="stat-item stat-partial"><div class="stat-n">{{ score.partial }}</div><div>部分</div></div>
          <div class="stat-item stat-pending"><div class="stat-n">{{ score.pending }}</div><div>未提供</div></div>
          <div class="stat-item stat-na"><div class="stat-n">{{ score.na }}</div><div>不适用</div></div>
        </div>
      </div>

      <!-- Tab toggle -->
      <div class="tabs" style="margin-bottom:12px;">
        <button :class="['tab', activeTab === 'all' ? 'active' : '']" @click="activeTab = 'all'">全部清单</button>
        <button :class="['tab', activeTab === 'todo' ? 'active' : '']" @click="activeTab = 'todo'">
          {{ t('ldd_todo_tab') }}
          <span v-if="todoItems.length" style="margin-left:4px;background:#e53e3e;color:#fff;font-size:10px;padding:1px 5px;border-radius:10px;">{{ todoItems.length }}</span>
        </button>
      </div>

      <!-- TODO list -->
      <div v-if="activeTab === 'todo'">
        <div class="empty" v-if="todoItems.length === 0">{{ t('ldd_todo_empty') }}</div>
        <div class="ldd-sections" v-else>
          <div class="ldd-item card" v-for="item in todoItems" :key="item.id" style="margin-bottom:8px;">
            <div class="item-row">
              <span class="item-no">{{ item.item_no }}</span>
              <span :class="['risk-badge', 'risk-' + item.risk_level]">{{ riskLabel[item.risk_level] }}</span>
              <span class="item-title-text">{{ item.title }}</span>
              <select v-model="item.status" @change="updateStatus(item)" :class="['status-select', 'status-' + item.status]">
                <option value="pending">{{ t('status_pending') }}</option>
                <option value="provided">{{ t('status_provided') }}</option>
                <option value="partial">{{ t('status_partial') }}</option>
                <option value="na">{{ t('status_na') }}</option>
              </select>
            </div>
            <div class="item-detail">
              <textarea v-model="item.statement" @blur="updateStatus(item)"
                class="input statement-input" rows="2" :placeholder="t('ldd_statement')"></textarea>
              <div class="mapped-files">
                <span class="mapped-file" v-for="mf in item.mapped_files" :key="mf.id">
                  📄 {{ mf.file_name }}
                  <span class="file-cat-badge" v-if="mf.category_name">{{ mf.category_name }}</span>
                    <textarea class="input statement-input" rows="2" style="margin-top:6px;" placeholder="说明/备注"
                      v-model="mf.notes" @blur="updateMappingNote(mf.id, mf.notes)"></textarea>
                  <button class="btn-icon-danger" @click="removeMapping(mf.id)">✕</button>
                </span>
                <button class="btn-link" @click="openMapModal(item)">+ {{ t('ldd_add_mapping') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Full accordion -->
      <div class="ldd-sections" v-if="activeTab === 'all'">
        <div class="ldd-section" v-for="sec in sections" :key="sec.section_no">
          <div class="section-header" @click="toggleSection(sec.section_no)">
            <span class="section-no">§{{ sec.section_no }}</span>
            <span class="section-title">{{ sec.section_title || SECTION_TITLES[sec.section_no] || sec.section_no }}</span>
            <span class="section-count">{{ sec.items.filter(i => i.status === 'provided').length }}/{{ sec.items.length }}</span>
            <span class="chevron">{{ openSections[sec.section_no] ? '▲' : '▼' }}</span>
          </div>
          <div class="section-items" v-if="openSections[sec.section_no]">
            <div class="ldd-item" v-for="item in sec.items" :key="item.id">
              <div class="item-row">
                <span class="item-no">{{ item.item_no }}</span>
                <span :class="['risk-badge', 'risk-' + item.risk_level]">{{ riskLabel[item.risk_level] }}</span>
                <span class="item-title-text">{{ item.title }}</span>
                <select v-model="item.status" @change="updateStatus(item)" :class="['status-select', 'status-' + item.status]">
                  <option value="pending">{{ t('status_pending') }}</option>
                  <option value="provided">{{ t('status_provided') }}</option>
                  <option value="partial">{{ t('status_partial') }}</option>
                  <option value="na">{{ t('status_na') }}</option>
                </select>
              </div>
              <div class="item-detail" v-if="item.status !== 'na'">
                <textarea v-model="item.statement" @blur="updateStatus(item)"
                  class="input statement-input" rows="2" :placeholder="t('ldd_statement')"></textarea>
                <div class="mapped-files">
                  <span class="mapped-file" v-for="mf in item.mapped_files" :key="mf.id">
                    📄 {{ mf.file_name }}
                    <span class="file-cat-badge" v-if="mf.category_name">{{ mf.category_name }}</span>
                    <textarea class="input statement-input" rows="2" style="margin-top:6px;" placeholder="说明/备注"
                      v-model="mf.notes" @blur="updateMappingNote(mf.id, mf.notes)"></textarea>
                    <button class="btn-icon-danger" @click="removeMapping(mf.id)">✕</button>
                  </span>
                  <button class="btn-link" @click="openMapModal(item)">+ {{ t('ldd_add_mapping') }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Map file modal (two-step) -->
      <div class="modal-overlay" v-if="showMapModal" @click.self="showMapModal = false">
        <div class="modal card">
          <div class="modal-header">
            <span>关联文件到：{{ mappingItem?.item_no }}</span>
            <button class="btn-ghost" @click="showMapModal = false">✕</button>
          </div>
          <div class="modal-body" style="display:flex;gap:0;padding:0;min-height:320px;">
            <!-- Step 1: category list (tree-indented, clicking selects all descendants) -->
            <div style="width:180px;border-right:1px solid var(--border);padding:8px 0;flex-shrink:0;overflow-y:auto;">
              <div v-for="cat in allCategories" :key="cat.id ?? 'all'"
                :class="['cat-pick-item', mapSelectedCatId === cat.id ? 'active' : '']"
                :style="{ paddingLeft: (8 + (cat.depth || 0) * 14) + 'px' }"
                @click="mapSelectedCatId = cat.id">
                <span>{{ cat.name }}</span>
                <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">
                  {{ cat.id === null ? allFiles.length : allFiles.filter(f => {
                    const ids = descendantCatIds(cat.id); return ids && ids.has(f.category_id);
                  }).length }}
                </span>
              </div>
            </div>
            <!-- Step 2: file list with checkboxes -->
            <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
              <div style="padding:6px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;color:var(--text-muted);">{{ modalFiles.length }} 个文件</span>
                <button class="btn-link" @click="selectAllInCategory" v-if="modalFiles.length > 0">全选该分类</button>
              </div>
              <div style="flex:1;overflow-y:auto;padding:8px;">
              <div class="empty" v-if="modalFiles.length === 0">暂无已注册文件（请先在“文件柜”扫描并注册）</div>
              <div v-for="f in modalFiles" :key="f.id"
                :class="['file-pick-item', mapSelectedFileIds.has(f.id) ? 'selected' : '']"
                @click="toggleFileSelect(f.id)">
                <input type="checkbox" :checked="mapSelectedFileIds.has(f.id)" @click.stop="toggleFileSelect(f.id)" style="margin-right:8px;">
                📄 {{ f.file_name }}
              </div>
              </div><!-- end scroll -->
            </div><!-- end right column -->
          </div><!-- end modal-body -->
          <div class="modal-footer" style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
            <span style="font-size:12px;color:var(--text-secondary);align-self:center;">已选 {{ mapSelectedFileIds.size }} 个文件</span>
            <button class="btn-ghost" @click="showMapModal = false">取消</button>
            <button class="btn-primary" @click="confirmMappings" :disabled="mapSelectedFileIds.size === 0">确认关联</button>
          </div>
        </div><!-- end modal card -->
      </div><!-- end overlay -->
    </div>
  `
};
