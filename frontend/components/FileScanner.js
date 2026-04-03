window.FileScanner = {
  components: {
    DuplicateWarningModal,
    BatchRenameModal,
    SearchPanel,
    VersionHistoryModal
  },
  setup() {
    const { t } = VueI18n.useI18n();
    const route = VueRouter.useRoute();
    const projectId = Vue.computed(() => route.params.id);
    const categories = Vue.ref([]);
    const registeredFiles = Vue.ref([]);
    const scannedFiles = Vue.ref([]);
    const selected = Vue.ref({});
    const scanning = Vue.ref(false);
    const activeTab = Vue.ref('registered');
    const selectedCatId = Vue.ref(null); // null = all, 'unclassified' = no category
    const addingSubCatId = Vue.ref(null);
    const newCatName = Vue.ref('');
    const newSubCatName = Vue.ref('');
    const renamingCatId = Vue.ref(null);
    const renamingCatName = Vue.ref('');
    const sortKey = Vue.ref('created_at');
    const sortDir = Vue.ref('desc');
    const zipLoadingCatId = Vue.ref(null);
    const error = Vue.ref('');

    // Duplicate detection
    const showDuplicateModal = Vue.ref(false);
    const duplicates = Vue.ref([]);
    const pendingFiles = Vue.ref([]);

    // Batch operations
    const selectedFileIds = Vue.ref(new Set());
    const showBatchBar = Vue.ref(false);
    const showBatchRenameModal = Vue.ref(false);

    // Search panel
    const showSearch = Vue.ref(false);

    // Version history
    const showVersionModal = Vue.ref(false);
    const versionFileId = Vue.ref(null);
    const versionFileName = Vue.ref('');

    function flattenCats(nodes, depth = 0) {
      const result = [];
      for (const n of nodes) {
        result.push({ ...n, depth });
        if (n.children) result.push(...flattenCats(n.children, depth + 1));
      }
      return result;
    }
    const flatCats = Vue.computed(() => flattenCats(categories.value));

    const unclassifiedCount = Vue.computed(() =>
      registeredFiles.value.filter(f => !f.category_id).length
    );

    async function load() {
      const [cats, files] = await Promise.all([
        api('GET', `/projects/${projectId.value}/categories`),
        api('GET', `/projects/${projectId.value}/files`),
      ]);
      categories.value = cats;
      registeredFiles.value = files;
    }

    async function scan() {
      scanning.value = true; error.value = '';
      try {
        const res = await api('POST', `/projects/${projectId.value}/scan`);
        scannedFiles.value = res.files;
        selected.value = {};
        res.files.forEach(f => {
          selected.value[f.file_path] = { checked: true, category_id: f.suggested_category_id };
        });

        // Check for duplicates
        if (res.duplicates && res.duplicates.length > 0) {
          duplicates.value = res.duplicates;
          pendingFiles.value = res.files;
          showDuplicateModal.value = true;
        } else {
          activeTab.value = 'scan';
        }
      } catch(e) { error.value = e.message; }
      finally { scanning.value = false; }
    }

    function handleDuplicateConfirm(filesToRegister) {
      showDuplicateModal.value = false;
      // Update scannedFiles to only include non-skipped files
      const keepPaths = new Set(filesToRegister.map(f => f.file_path));
      scannedFiles.value = pendingFiles.value.filter(f => keepPaths.has(f.file_path));
      selected.value = {};
      scannedFiles.value.forEach(f => {
        selected.value[f.file_path] = { checked: true, category_id: f.suggested_category_id };
      });
      pendingFiles.value = [];
      duplicates.value = [];
      activeTab.value = 'scan';
    }

    function toggleSelectAll(val) {
      scannedFiles.value.forEach(f => { selected.value[f.file_path].checked = val; });
    }

    const allChecked = Vue.computed(() =>
      scannedFiles.value.length > 0 && scannedFiles.value.every(f => selected.value[f.file_path]?.checked)
    );
    const suggestedCount = Vue.computed(() =>
      scannedFiles.value.filter(f => f.suggested_category_id).length
    );

    async function registerSuggested() {
      scannedFiles.value.forEach(f => {
        if (selected.value[f.file_path]) selected.value[f.file_path].checked = !!f.suggested_category_id;
      });
      await registerSelected();
    }

    async function registerSelected() {
      const toRegister = scannedFiles.value
        .filter(f => selected.value[f.file_path]?.checked)
        .map(f => ({
          file_name: f.file_name,
          file_path: f.file_path,
          category_id: selected.value[f.file_path]?.category_id || null,
          keyword_suggested: f.suggested_category_id ? 1 : 0,
        }));
      if (!toRegister.length) return;
      await api('POST', `/projects/${projectId.value}/files`, toRegister);
      scannedFiles.value = scannedFiles.value.filter(f => !selected.value[f.file_path]?.checked);
      await load();
    }

    async function updateFileCategory(fileId, catId) {
      await api('PUT', `/files/${fileId}`, { category_id: catId || null });
      await load();
    }

    async function deleteFile(fileId) {
      if (!confirm(t('confirm_delete'))) return;
      await api('DELETE', `/files/${fileId}`);
      await load();
    }

    async function addSubCategory(parentId) {
      const name = newSubCatName.value.trim();
      if (!name) return;
      await api('POST', `/projects/${projectId.value}/categories`, { name, parent_id: parentId });
      newSubCatName.value = '';
      addingSubCatId.value = null;
      await load();
    }

    function startRename(cat) {
      renamingCatId.value = cat.id;
      renamingCatName.value = cat.name;
    }

    async function confirmRename(catId) {
      const name = renamingCatName.value.trim();
      if (!name) { renamingCatId.value = null; return; }
      await api('PUT', `/categories/${catId}`, { name });
      renamingCatId.value = null;
      await load();
    }

    async function moveCat(catId, direction) {
      const flat = flatCats.value;
      const idx = flat.findIndex(c => c.id === catId);
      if (idx < 0) return;
      const cur = flat[idx];
      // Find siblings (same parent, same depth)
      const siblings = flat.filter(c => c.parent_id === cur.parent_id);
      const sibIdx = siblings.findIndex(c => c.id === catId);
      const swapWith = direction === 'up' ? siblings[sibIdx - 1] : siblings[sibIdx + 1];
      if (!swapWith) return;
      // Swap sort_order values
      await Promise.all([
        api('PUT', `/categories/${catId}`, { sort_order: swapWith.sort_order }),
        api('PUT', `/categories/${swapWith.id}`, { sort_order: cur.sort_order }),
      ]);
      await load();
    }

    function toggleSort(key) {
      if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
      else { sortKey.value = key; sortDir.value = 'asc'; }
    }

    async function addCategory(parentId = null) {
      const name = newCatName.value.trim();
      if (!name) return;
      await api('POST', `/projects/${projectId.value}/categories`, { name, parent_id: parentId });
      newCatName.value = '';
      await load();
    }

    async function deleteCategory(id) {
      if (!confirm(t('confirm_delete'))) return;
      try { await api('DELETE', `/categories/${id}`); await load(); }
      catch(e) { error.value = e.message; }
    }

    async function downloadCategoryZip(catId) {
      zipLoadingCatId.value = catId;
      try {
        const resp = await fetch(`/api/projects/${projectId.value}/export/category-zip?cat_id=${catId}`);
        if (!resp.ok) throw new Error(await resp.text());
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cat = flatCats.value.find(c => c.id === catId);
        a.download = `${cat ? cat.name : catId}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch(e) { error.value = e.message; }
      finally { zipLoadingCatId.value = null; }
    }

    // Batch operations
    function toggleFileSelection(fileId) {
      if (selectedFileIds.value.has(fileId)) {
        selectedFileIds.value.delete(fileId);
      } else {
        selectedFileIds.value.add(fileId);
      }
      showBatchBar.value = selectedFileIds.value.size > 0;
    }

    function selectAllFiles() {
      filteredFiles.value.forEach(f => selectedFileIds.value.add(f.id));
      showBatchBar.value = true;
    }

    function clearSelection() {
      selectedFileIds.value.clear();
      showBatchBar.value = false;
    }

    async function batchMoveToCategory(catId) {
      const ids = Array.from(selectedFileIds.value);
      if (!ids.length) return;
      try {
        await api('PUT', '/files/batch', { file_ids: ids, category_id: catId });
        clearSelection();
        await load();
      } catch(e) { error.value = e.message; }
    }

    async function batchDelete() {
      const ids = Array.from(selectedFileIds.value);
      if (!ids.length) return;
      if (!confirm(`确定要删除选中的 ${ids.length} 个文件吗？`)) return;
      try {
        await api('POST', '/files/batch-delete', { file_ids: ids });
        clearSelection();
        await load();
      } catch(e) { error.value = e.message; }
    }

    function openBatchRename() {
      if (selectedFileIds.value.size === 0) return;
      showBatchRenameModal.value = true;
    }

    async function handleBatchRename(options) {
      showBatchRenameModal.value = false;
      const ids = Array.from(selectedFileIds.value);
      if (!ids.length) return;
      try {
        await api('POST', `/files/batch-rename?project_id=${projectId.value}`, {
          file_ids: ids,
          pattern: options.pattern,
          prefix: options.prefix,
          suffix: options.suffix,
          start_number: options.startNumber
        });
        clearSelection();
        await load();
      } catch(e) { error.value = e.message; }
    }

    // Version history
    function openVersionHistory(file) {
      versionFileId.value = file.id;
      versionFileName.value = file.file_name;
      showVersionModal.value = true;
    }

    function onRollback() {
      showVersionModal.value = false;
      load();
    }

    Vue.onMounted(load);

    const filteredFiles = Vue.computed(() => {
      let base;
      if (selectedCatId.value === null) base = registeredFiles.value;
      else if (selectedCatId.value === 'unclassified') base = registeredFiles.value.filter(f => !f.category_id);
      else base = registeredFiles.value.filter(f => String(f.category_id) === String(selectedCatId.value));
      return [...base].sort((a, b) => {
        const av = a[sortKey.value] || '';
        const bv = b[sortKey.value] || '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir.value === 'asc' ? cmp : -cmp;
      });
    });

    const selectedCount = Vue.computed(() => selectedFileIds.value.size);
    const selectedFilesForRename = Vue.computed(() =>
      registeredFiles.value.filter(f => selectedFileIds.value.has(f.id))
    );

    return {
      t, categories, flatCats, registeredFiles, filteredFiles, unclassifiedCount,
      scannedFiles, selected, scanning,
      activeTab, selectedCatId, addingSubCatId, newCatName, newSubCatName,
      renamingCatId, renamingCatName, sortKey, sortDir, zipLoadingCatId, error, projectId,
      allChecked, suggestedCount,
      // Duplicate detection
      showDuplicateModal, duplicates, pendingFiles, handleDuplicateConfirm,
      // Batch operations
      selectedFileIds, showBatchBar, showBatchRenameModal, selectedCount,
      toggleFileSelection, selectAllFiles, clearSelection,
      batchMoveToCategory, batchDelete, openBatchRename, handleBatchRename,
      selectedFilesForRename,
      // Search
      showSearch,
      // Version history
      showVersionModal, versionFileId, versionFileName, openVersionHistory, onRollback,
      // Functions
      scan, registerSelected, registerSuggested, toggleSelectAll,
      updateFileCategory, deleteFile, addCategory, addSubCategory,
      startRename, confirmRename, moveCat, toggleSort, deleteCategory, downloadCategoryZip
    };
  },
  template: `
    <div class="page">
      <!-- Duplicate Warning Modal -->
      <DuplicateWarningModal
        v-if="showDuplicateModal"
        :duplicates="duplicates"
        :allFiles="pendingFiles"
        @close="showDuplicateModal = false"
        @confirm="handleDuplicateConfirm"
      />

      <!-- Batch Rename Modal -->
      <BatchRenameModal
        v-if="showBatchRenameModal"
        :fileCount="selectedCount"
        :sampleFiles="selectedFilesForRename"
        :projectId="parseInt(projectId)"
        @close="showBatchRenameModal = false"
        @confirm="handleBatchRename"
      />

      <!-- Version History Modal -->
      <VersionHistoryModal
        v-if="showVersionModal"
        :fileId="versionFileId"
        :fileName="versionFileName"
        @close="showVersionModal = false"
        @rollback="onRollback"
      />

      <!-- Search Panel -->
      <div v-if="showSearch" class="search-overlay">
        <SearchPanel
          :projectId="parseInt(projectId)"
          @open-file="f => $emit('open-file', f)"
        />
        <button class="btn-close-search" @click="showSearch = false">×</button>
      </div>

      <div class="page-header">
        <h2>{{ t('nav_cabinet') }}</h2>
        <div class="header-actions">
          <button class="btn-secondary" @click="showSearch = true">
            🔍 搜索
          </button>
          <button class="btn-primary" @click="scan" :disabled="scanning">
            {{ scanning ? '扫描中...' : t('btn_scan') }}
          </button>
        </div>
      </div>
      <div class="error" v-if="error">{{ error }}</div>

      <!-- Batch Operations Bar -->
      <div v-if="showBatchBar" class="batch-bar">
        <span class="batch-count">已选择 {{ selectedCount }} 个文件</span>
        <div class="batch-actions">
          <select @change="batchMoveToCategory($event.target.value); $event.target.value = ''" class="input input-sm">
            <option value="">移动到分类...</option>
            <option v-for="c in flatCats" :key="c.id" :value="c.id">
              {{ '　'.repeat(c.depth) + c.name }}
            </option>
          </select>
          <button class="btn-secondary" @click="openBatchRename">批量重命名</button>
          <button class="btn-danger" @click="batchDelete">批量删除</button>
          <button class="btn-text" @click="clearSelection">取消</button>
        </div>
      </div>

      <div class="cabinet-layout">
        <!-- Category Tree -->
        <div class="cat-panel card">
          <div class="panel-title">分类管理</div>
          <div class="cat-tree">
            <!-- All files -->
            <div :class="['cat-node', selectedCatId === null ? 'cat-node-active' : '']"
              style="padding-left:8px;" @click="selectedCatId = null">
              <span class="cat-name">全部文件</span>
              <span class="cat-count">{{ registeredFiles.length }}</span>
            </div>
            <!-- Unclassified -->
            <div v-if="unclassifiedCount > 0"
              :class="['cat-node', selectedCatId === 'unclassified' ? 'cat-node-active' : '']"
              style="padding-left:8px;" @click="selectedCatId = 'unclassified'">
              <span class="cat-name" style="color:var(--amber);">未分类</span>
              <span class="cat-count" style="color:var(--amber);">{{ unclassifiedCount }}</span>
            </div>
            <!-- Category nodes -->
            <template v-for="cat in flatCats" :key="cat.id">
              <div :style="{ paddingLeft: (cat.depth * 16 + 8) + 'px' }"
                :class="['cat-node', selectedCatId === cat.id ? 'cat-node-active' : '']"
                @click="selectedCatId = cat.id">
                <!-- Rename mode -->
                <template v-if="renamingCatId === cat.id">
                  <input v-model="renamingCatName" class="input input-sm" style="flex:1;"
                    @keyup.enter="confirmRename(cat.id)" @keyup.esc="renamingCatId = null"
                    @click.stop autofocus>
                  <button class="btn-sm" style="font-size:10px;padding:3px 7px;" @click.stop="confirmRename(cat.id)">✓</button>
                </template>
                <!-- Normal mode -->
                <template v-else>
                  <span class="cat-name">{{ cat.name }}</span>
                  <span class="cat-count">{{ registeredFiles.filter(f => f.category_id === cat.id).length }}</span>
                  <button class="btn-icon-add" title="上移" @click.stop="moveCat(cat.id, 'up')">↑</button>
                  <button class="btn-icon-add" title="下移" @click.stop="moveCat(cat.id, 'down')">↓</button>
                  <button class="btn-icon-add" title="重命名" @click.stop="startRename(cat)">✎</button>
                  <button class="btn-icon-add" title="添加子分类" @click.stop="addingSubCatId = (addingSubCatId === cat.id ? null : cat.id); newSubCatName = ''">+</button>
                  <button class="btn-icon-add" title="导出压缩包" @click.stop="downloadCategoryZip(cat.id)">
                    {{ zipLoadingCatId === cat.id ? '…' : '⬇' }}
                  </button>
                  <button class="btn-icon-danger" @click.stop="deleteCategory(cat.id)">✕</button>
                </template>
              </div>
              <!-- Inline sub-cat input -->
              <div v-if="addingSubCatId === cat.id"
                :style="{ paddingLeft: ((cat.depth + 1) * 16 + 8) + 'px' }"
                class="sub-cat-input-row">
                <input v-model="newSubCatName" class="input input-sm" placeholder="子分类名称..."
                  @keyup.enter="addSubCategory(cat.id)" @keyup.esc="addingSubCatId = null" autofocus>
                <button class="btn-sm" @click="addSubCategory(cat.id)">确认</button>
              </div>
            </template>
          </div>
          <div class="add-cat-row">
            <input v-model="newCatName" class="input input-sm" placeholder="新一级分类..." @keyup.enter="addCategory()">
            <button class="btn-sm" @click="addCategory()">添加</button>
          </div>
        </div>

        <!-- Files Panel -->
        <div class="files-panel">
          <div class="tabs">
            <button :class="['tab', activeTab === 'registered' ? 'active' : '']" @click="activeTab = 'registered'">
              已注册文件 ({{ filteredFiles.length }}{{ selectedCatId ? '/' + registeredFiles.length : '' }})
            </button>
            <button :class="['tab', activeTab === 'scan' ? 'active' : '']" @click="activeTab = 'scan'">
              扫描结果 ({{ scannedFiles.length }})
            </button>
          </div>

          <!-- Registered files -->
          <div v-if="activeTab === 'registered'">
            <div class="empty" v-if="filteredFiles.length === 0">
              {{ selectedCatId === 'unclassified' ? '暂无未分类文件' : selectedCatId ? '该分类下暂无文件' : '暂无文件，点击"扫描目录"发现文件' }}
            </div>
            <div v-else>
              <div class="table-toolbar">
                <label class="checkbox-label">
                  <input type="checkbox" @change="$event.target.checked ? selectAllFiles() : clearSelection()">
                  全选本页
                </label>
              </div>
              <table class="file-table">
                <thead>
                  <tr>
                    <th style="width: 40px;"><input type="checkbox" @change="$event.target.checked ? selectAllFiles() : clearSelection()"></th>
                    <th class="sortable-th" @click="toggleSort('file_name')">
                      文件名 <span class="sort-icon">{{ sortKey === 'file_name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                    </th>
                    <th>分类</th>
                    <th class="sortable-th" @click="toggleSort('created_at')">
                      入库时间 <span class="sort-icon">{{ sortKey === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                    </th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in filteredFiles" :key="f.id" :class="{ 'selected-row': selectedFileIds.has(f.id) }">
                    <td><input type="checkbox" :checked="selectedFileIds.has(f.id)" @change="toggleFileSelection(f.id)"></td>
                    <td><span class="file-icon">📄</span> {{ f.file_name }}</td>
                    <td>
                      <select :value="f.category_id" @change="updateFileCategory(f.id, $event.target.value)" class="input input-sm">
                        <option value="">— 未分类 —</option>
                        <option v-for="c in flatCats" :key="c.id" :value="c.id">
                          {{ '　'.repeat(c.depth) + c.name }}
                        </option>
                      </select>
                    </td>
                    <td class="time-cell">{{ f.created_at ? f.created_at.slice(0, 10) : '—' }}</td>
                    <td>
                      <button class="btn-icon" title="版本历史" @click="openVersionHistory(f)">📋</button>
                      <button class="btn-icon-danger" @click="deleteFile(f.id)">✕</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Scan results -->
          <div v-if="activeTab === 'scan'">
            <div class="empty" v-if="scannedFiles.length === 0">{{ t('scan_empty') }}</div>
            <div v-else>
              <div class="scan-actions">
                <span>{{ t('scan_found').replace('{n}', scannedFiles.length) }}
                  <span style="color:var(--text-muted);margin-left:6px;">（{{ suggestedCount }} 个已有建议分类）</span>
                </span>
                <div style="display:flex;gap:6px;">
                  <button class="btn-secondary" @click="registerSuggested" v-if="suggestedCount > 0">
                    一键注册建议文件 ({{ suggestedCount }})
                  </button>
                  <button class="btn-primary" @click="registerSelected">注册选中文件</button>
                </div>
              </div>
              <table class="file-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" :checked="allChecked" @change="toggleSelectAll($event.target.checked)"></th>
                    <th>文件名</th><th>建议分类</th><th>指定分类</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in scannedFiles" :key="f.file_path">
                    <td><input type="checkbox" v-model="selected[f.file_path].checked"></td>
                    <td>{{ f.file_name }}</td>
                    <td><span class="badge-suggested" v-if="f.suggested_category_name">{{ f.suggested_category_name }}</span></td>
                    <td>
                      <select v-model="selected[f.file_path].category_id" class="input input-sm">
                        <option :value="null">— 未分类 —</option>
                        <option v-for="c in flatCats" :key="c.id" :value="c.id">{{ '　'.repeat(c.depth) + c.name }}</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};
