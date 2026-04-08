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
    const projectInfo = Vue.ref(null);
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
    const catMoreOpenId = Vue.ref(null);
    const sortKey = Vue.ref('registered_at');
    const sortDir = Vue.ref('desc');
    const zipLoadingCatId = Vue.ref(null);
    const error = Vue.ref('');
    const catPanelWidth = Vue.ref(360);
    const isResizing = Vue.ref(false);
    const fileNameColWidth = Vue.ref(440);
    const isNameColResizing = Vue.ref(false);
    const dragFileIds = Vue.ref([]);
    const dragOverCatId = Vue.ref(null);
    const isDragging = Vue.ref(false);
    const dragTargetLabel = Vue.ref('');
    const toastMessage = Vue.ref('');
    let toastTimer = null;

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

    // Pagination + counts
    const totalFiles = Vue.ref(0);
    const filteredTotal = Vue.ref(0);
    const unclassifiedTotal = Vue.ref(0);
    const categoryCounts = Vue.ref({});
    const pageSize = Vue.ref(12);
    const pageOffset = Vue.ref(0);

    // Scan pagination
    const scanPageSize = Vue.ref(12);
    const scanOffset = Vue.ref(0);

    // Details drawer
    const drawerOpen = Vue.ref(false);
    const drawerWidth = Vue.ref(380);
    const drawerFileId = Vue.ref(null);
    const drawerData = Vue.ref(null);
    const drawerLoading = Vue.ref(false);
    const drawerError = Vue.ref('');
    const drawerNotes = Vue.ref('');
    const drawerSaving = Vue.ref(false);
    const drawerCategoryId = Vue.ref(null);
    const isDrawerResizing = Vue.ref(false);
    const drawerX = Vue.ref(null);
    const drawerY = Vue.ref(null);
    const isDrawerDragging = Vue.ref(false);

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
      unclassifiedTotal.value || 0
    );

    function buildFilesQuery() {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize.value));
      params.set('offset', String(pageOffset.value));
      params.set('sort_key', String(sortKey.value || 'registered_at'));
      params.set('sort_dir', String(sortDir.value || 'desc'));
      if (selectedCatId.value === 'unclassified') {
        params.set('unclassified', 'true');
      } else if (selectedCatId.value !== null && selectedCatId.value !== undefined) {
        params.set('category_id', String(selectedCatId.value));
        params.set('include_descendants', 'true');
      }
      return params.toString();
    }

    async function loadFilesPage() {
      const res = await api('GET', `/projects/${projectId.value}/files?${buildFilesQuery()}`);
      if (Array.isArray(res)) {
        registeredFiles.value = res;
        filteredTotal.value = res.length;
        return;
      }
      registeredFiles.value = res.items || [];
      filteredTotal.value = res.total || 0;
      if (typeof res.unclassified_count === 'number') unclassifiedTotal.value = res.unclassified_count;
      if (pageOffset.value > 0 && pageOffset.value >= filteredTotal.value) {
        pageOffset.value = Math.max(0, pageOffset.value - pageSize.value);
        await loadFilesPage();
      }
      if (drawerOpen.value && drawerFileId.value) {
        loadDrawer(drawerFileId.value);
      }
    }

    async function resetAndLoadFiles() {
      pageOffset.value = 0;
      clearSelection();
      await loadFilesPage();
    }

    async function loadCounts() {
      const c = await api('GET', `/projects/${projectId.value}/files/counts`);
      totalFiles.value = c.total || 0;
      unclassifiedTotal.value = c.unclassified_count || 0;
      const direct = c.direct_by_category || c.by_category || {};
      function aggTree(nodes) {
        let sum = 0;
        for (const n of nodes || []) {
          const id = n && n.id != null ? String(n.id) : '';
          const selfCnt = direct[id] != null ? Number(direct[id] || 0) : Number(direct[Number(id)] || 0);
          const childSum = aggTree(n.children || []);
          sum += selfCnt + childSum;
        }
        return sum;
      }
      function buildAggMap(nodes, out) {
        for (const n of nodes || []) {
          const idStr = String(n.id);
          const selfCnt = direct[idStr] != null ? Number(direct[idStr] || 0) : Number(direct[Number(idStr)] || 0);
          let childTotal = 0;
          if (Array.isArray(n.children) && n.children.length) {
            childTotal = aggTree(n.children);
            buildAggMap(n.children, out);
          }
          out[idStr] = selfCnt + childTotal;
        }
      }
      const agg = {};
      buildAggMap(categories.value || [], agg);
      categoryCounts.value = agg;
    }

    async function load() {
      error.value = '';
      try {
        try {
          await api('POST', `/projects/${projectId.value}/ensure-seeded`);
        } catch (e) { error.value = e.message || String(e); }
        const [proj, cats] = await Promise.all([
          api('GET', `/projects/${projectId.value}`),
          api('GET', `/projects/${projectId.value}/categories`),
        ]);
        projectInfo.value = proj || null;
        categories.value = cats;
        await Promise.all([loadCounts(), resetAndLoadFiles()]);
      } catch (e) {
        error.value = e.message || String(e);
        categories.value = [];
        registeredFiles.value = [];
        projectInfo.value = null;
        totalFiles.value = 0;
        filteredTotal.value = 0;
        unclassifiedTotal.value = 0;
        categoryCounts.value = {};
      }
    }

    async function scan() {
      scanning.value = true; error.value = '';
      try {
        const res = await api('POST', `/projects/${projectId.value}/scan`);
        scannedFiles.value = res.files;
        scanOffset.value = 0;
        selected.value = {};
        res.files.forEach(f => {
          selected.value[f.file_path] = { checked: true, category_id: f.suggested_category_id };
        });
        activeTab.value = 'scan';

        // Check for duplicates
        if (res.duplicates && res.duplicates.length > 0) {
          duplicates.value = res.duplicates;
          pendingFiles.value = res.files;
          showDuplicateModal.value = true;
        }
      } catch(e) { error.value = e.message; }
      finally { scanning.value = false; }
    }

    async function autoCategorize() {
      error.value = '';
      try {
        const res = await api('POST', `/projects/${projectId.value}/files/auto-categorize`, { only_unclassified: true });
        await load();
        alert(`已自动分类 ${res.updated || 0} 个文件`);
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    function handleDuplicateClose() {
      showDuplicateModal.value = false;
      scannedFiles.value = pendingFiles.value.length ? pendingFiles.value : scannedFiles.value;
      scanOffset.value = 0;
      selected.value = {};
      scannedFiles.value.forEach(f => {
        selected.value[f.file_path] = { checked: true, category_id: f.suggested_category_id };
      });
      pendingFiles.value = [];
      duplicates.value = [];
      activeTab.value = 'scan';
    }

    function handleDuplicateConfirm(filesToRegister) {
      showDuplicateModal.value = false;
      // Update scannedFiles to only include non-skipped files
      const keepPaths = new Set(filesToRegister.map(f => f.file_path));
      scannedFiles.value = pendingFiles.value.filter(f => keepPaths.has(f.file_path));
      scanOffset.value = 0;
      selected.value = {};
      scannedFiles.value.forEach(f => {
        selected.value[f.file_path] = { checked: true, category_id: f.suggested_category_id };
      });
      pendingFiles.value = [];
      duplicates.value = [];
      activeTab.value = 'scan';
    }

    const scanTotal = Vue.computed(() => scannedFiles.value.length);
    const scanPageCount = Vue.computed(() => Math.max(1, Math.ceil(scanTotal.value / scanPageSize.value)));
    const scanPageNo = Vue.computed(() => Math.floor(scanOffset.value / scanPageSize.value) + 1);
    const scanCanPrev = Vue.computed(() => scanOffset.value > 0);
    const scanCanNext = Vue.computed(() => (scanOffset.value + scanPageSize.value) < scanTotal.value);
    const scanPagedFiles = Vue.computed(() => scannedFiles.value.slice(scanOffset.value, scanOffset.value + scanPageSize.value));

    function prevScanPage() {
      if (!scanCanPrev.value) return;
      scanOffset.value = Math.max(0, scanOffset.value - scanPageSize.value);
    }
    function nextScanPage() {
      if (!scanCanNext.value) return;
      scanOffset.value = scanOffset.value + scanPageSize.value;
    }

    function toggleSelectAllScanPage(val) {
      scanPagedFiles.value.forEach(f => { selected.value[f.file_path].checked = val; });
    }

    const allCheckedScanPage = Vue.computed(() =>
      scanPagedFiles.value.length > 0 && scanPagedFiles.value.every(f => selected.value[f.file_path]?.checked)
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
      if (scanOffset.value > 0 && scanOffset.value >= scannedFiles.value.length) {
        scanOffset.value = Math.max(0, scanOffset.value - scanPageSize.value);
      }
      await load();
    }

    async function updateFileCategory(fileId, catId) {
      try {
        await api('PUT', `/files/${fileId}`, { category_id: catId || null });
        await load();
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    async function deleteFile(fileId) {
      if (!confirm(t('confirm_delete'))) return;
      try {
        await api('DELETE', `/files/${fileId}`);
        await load();
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    async function openFileDir(fileId) {
      try {
        await api('POST', `/projects/${projectId.value}/open-file-dir`, { file_id: fileId });
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    async function openFile(fileId) {
      try {
        await api('POST', `/projects/${projectId.value}/open-file`, { file_id: fileId });
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    async function openCategoryDir(catId) {
      try {
        await api('POST', `/projects/${projectId.value}/open-category-dir`, { category_id: catId });
      } catch (e) {
        error.value = e.message || String(e);
      }
    }

    async function loadDrawer(fileId) {
      if (!fileId) return;
      drawerLoading.value = true;
      drawerError.value = '';
      try {
        const d = await api('GET', `/files/${fileId}/details`);
        drawerData.value = d;
        drawerNotes.value = d && typeof d.notes === 'string' ? d.notes : (d?.notes || '');
        drawerCategoryId.value = d ? (d.category_id ?? '') : '';
      } catch (e) {
        drawerError.value = e.message || String(e);
        drawerData.value = null;
      } finally {
        drawerLoading.value = false;
      }
    }

    function clamp(n, min, max) {
      const v = Number(n);
      if (!Number.isFinite(v)) return min;
      return Math.max(min, Math.min(max, v));
    }

    function placeDrawer(ev) {
      const margin = 16;
      const w = Math.max(320, Math.min(720, Number(drawerWidth.value) || 520));
      const h = Math.min(720, Math.max(420, window.innerHeight - 40));

      let x = Math.round(window.innerWidth - w - margin);
      let y = Math.round(window.innerHeight * 0.10);

      if (ev && typeof ev.clientX === 'number' && typeof ev.clientY === 'number') {
        x = ev.clientX + 14;
        y = ev.clientY - 40;
      }

      x = clamp(x, margin, window.innerWidth - w - margin);
      y = clamp(y, margin, window.innerHeight - h - margin);

      drawerX.value = x;
      drawerY.value = y;
    }

    function startFloatingDrag(e) {
      if (!e) return;
      e.preventDefault();
      isDrawerDragging.value = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = Number(drawerX.value) || 0;
      const startTop = Number(drawerY.value) || 0;
      const margin = 12;

      function onMove(ev) {
        const w = Math.max(320, Math.min(720, Number(drawerWidth.value) || 520));
        const h = Math.min(720, Math.max(420, window.innerHeight - 40));
        const left = startLeft + (ev.clientX - startX);
        const top = startTop + (ev.clientY - startY);
        drawerX.value = clamp(left, margin, window.innerWidth - w - margin);
        drawerY.value = clamp(top, margin, window.innerHeight - h - margin);
      }
      function onUp() {
        isDrawerDragging.value = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function centerFloatingDrawer() {
      const margin = 16;
      const w = Math.max(320, Math.min(720, Number(drawerWidth.value) || 520));
      const h = Math.min(720, Math.max(420, window.innerHeight - 40));
      drawerX.value = clamp(Math.round((window.innerWidth - w) / 2), margin, window.innerWidth - w - margin);
      drawerY.value = clamp(Math.round((window.innerHeight - h) / 2), margin, window.innerHeight - h - margin);
    }

    async function openDetails(file, ev) {
      if (!file) return;
      if (!drawerOpen.value) placeDrawer(ev);
      drawerOpen.value = true;
      drawerFileId.value = file.id;
      await loadDrawer(file.id);
    }

    function closeDetails() {
      drawerOpen.value = false;
      drawerFileId.value = null;
      drawerData.value = null;
      drawerError.value = '';
      drawerNotes.value = '';
      drawerCategoryId.value = '';
      drawerSaving.value = false;
    }

    async function saveDrawerNotes() {
      if (!drawerFileId.value) return;
      drawerSaving.value = true;
      try {
        await api('PUT', `/files/${drawerFileId.value}`, { notes: drawerNotes.value });
        showToast('备注已保存');
        await loadDrawer(drawerFileId.value);
      } catch (e) {
        drawerError.value = e.message || String(e);
      } finally {
        drawerSaving.value = false;
      }
    }

    async function saveDrawerCategory() {
      if (!drawerFileId.value) return;
      const raw = drawerCategoryId.value;
      const cid = raw === '' || raw === null || raw === undefined ? null : parseInt(raw, 10);
      drawerSaving.value = true;
      try {
        await api('PUT', `/files/${drawerFileId.value}`, { category_id: Number.isFinite(cid) ? cid : null });
        showToast('分类已更新');
        await Promise.all([loadCounts(), resetAndLoadFiles()]);
      } catch (e) {
        drawerError.value = e.message || String(e);
      } finally {
        drawerSaving.value = false;
      }
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(String(text || ''));
        showToast('已复制');
      } catch (e) {
        const v = prompt('复制到剪贴板（手动 Ctrl+C）：', String(text || ''));
        if (v !== null) showToast('已复制');
      }
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

    function toggleCatMore(catId) {
      if (catId === null || catId === undefined) {
        catMoreOpenId.value = null;
        return;
      }
      catMoreOpenId.value = (catMoreOpenId.value === catId) ? null : catId;
    }

    function getTopBadge(name) {
      const s = String(name || '').trim();
      if (!s) return '•';
      const normalized = s.replace(/^[\s\d\.\-_\(\)\[\]（）【】#、，,]+/, '');
      const firstHan = (normalized.match(/[\u4e00-\u9fff]/) || [])[0];

      if (firstHan) {
        const c = firstHan;
        try {
          const collator = new Intl.Collator('zh-Hans-u-co-pinyin');
          const bounds = [
            ['阿', 'A'], ['芭', 'B'], ['擦', 'C'], ['搭', 'D'], ['蛾', 'E'],
            ['发', 'F'], ['噶', 'G'], ['哈', 'H'], ['机', 'J'], ['喀', 'K'],
            ['垃', 'L'], ['妈', 'M'], ['拿', 'N'], ['哦', 'O'], ['啪', 'P'],
            ['期', 'Q'], ['然', 'R'], ['撒', 'S'], ['塌', 'T'], ['挖', 'W'],
            ['昔', 'X'], ['压', 'Y'], ['匝', 'Z'],
          ];
          let out = 'Z';
          for (let i = 0; i < bounds.length; i++) {
            if (collator.compare(c, bounds[i][0]) >= 0) out = bounds[i][1];
            else break;
          }
          return out;
        } catch (e) {
          return c;
        }
      }

      const m = normalized.match(/[A-Za-z0-9]/);
      if (m) return m[0].toUpperCase();
      return normalized[0] || s[0];
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
      resetAndLoadFiles();
    }

    function selectCategory(catId) {
      selectedCatId.value = catId;
      resetAndLoadFiles();
    }

    const pageNo = Vue.computed(() => Math.floor(pageOffset.value / pageSize.value) + 1);
    const pageCount = Vue.computed(() => {
      const total = filteredTotal.value || 0;
      return Math.max(1, Math.ceil(total / pageSize.value));
    });
    const canPrev = Vue.computed(() => pageOffset.value > 0);
    const canNext = Vue.computed(() => (pageOffset.value + pageSize.value) < (filteredTotal.value || 0));

    function prevPage() {
      if (!canPrev.value) return;
      pageOffset.value = Math.max(0, pageOffset.value - pageSize.value);
      clearSelection();
      loadFilesPage();
    }
    function nextPage() {
      if (!canNext.value) return;
      pageOffset.value = pageOffset.value + pageSize.value;
      clearSelection();
      loadFilesPage();
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

    function showToast(msg) {
      toastMessage.value = msg;
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastMessage.value = '';
      }, 2200);
    }

    function getCatLabel(catId) {
      if (catId === null || catId === 'unclassified') return '未分类';
      const c = flatCats.value.find(x => String(x.id) === String(catId));
      return c ? c.name : '分类';
    }

    function getCatPath(catId) {
      if (catId == null) return '';
      const idTo = {};
      for (const c of flatCats.value) idTo[c.id] = c;
      const parts = [];
      let cur = catId;
      while (cur != null && idTo[cur]) {
        parts.push(idTo[cur].name);
        cur = idTo[cur].parent_id;
      }
      return parts.reverse().join('/');
    }

    function formatBytes(n) {
      const v = Number(n || 0);
      if (!Number.isFinite(v) || v <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let x = v;
      while (x >= 1024 && i < units.length - 1) {
        x /= 1024;
        i++;
      }
      return `${x >= 10 || i === 0 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
    }

    function formatDT(s) {
      if (!s) return '—';
      return String(s).slice(0, 19).replace('T', ' ');
    }

    const drawerBreadcrumb = Vue.computed(() => {
      if (!drawerData.value) return '';
      const cat = drawerData.value.category_id ? getCatPath(drawerData.value.category_id) : '未分类';
      return `${cat} / ${drawerData.value.file_name || ''}`;
    });

    function resetDragState() {
      isDragging.value = false;
      dragFileIds.value = [];
      dragOverCatId.value = null;
      dragTargetLabel.value = '';
    }

    function startResize(e) {
      isResizing.value = true;
      const startX = e.clientX;
      const startW = catPanelWidth.value;
      const startDrawerW = drawerWidth.value;
      function onMove(ev) {
        const dx = ev.clientX - startX;
        catPanelWidth.value = Math.max(240, Math.min(720, startW + dx));
        if (drawerOpen.value) {
          const rightDelta = dx;
          drawerWidth.value = Math.max(320, Math.min(720, startDrawerW - rightDelta));
        }
      }
      function onUp() {
        isResizing.value = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function startNameColResize(e) {
      if (e) e.preventDefault();
      isNameColResizing.value = true;
      const startX = e.clientX;
      const startW = fileNameColWidth.value;
      function onMove(ev) {
        const dx = ev.clientX - startX;
        fileNameColWidth.value = Math.max(280, Math.min(720, startW + dx));
      }
      function onUp() {
        isNameColResizing.value = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function catHasChildren(catId) {
      const c = flatCats.value.find(x => String(x.id) === String(catId));
      return !!(c && Array.isArray(c.children) && c.children.length > 0);
    }

    function startDrawerResize(e) {
      isDrawerResizing.value = true;
      const startX = e.clientX;
      const startW = drawerWidth.value;
      const startCatW = catPanelWidth.value;
      function onMove(ev) {
        const dx = startX - ev.clientX;
        drawerWidth.value = Math.max(320, Math.min(720, startW + dx));
        const catDelta = dx;
        catPanelWidth.value = Math.max(240, Math.min(720, startCatW - catDelta));
      }
      function onUp() {
        isDrawerResizing.value = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function onFileDragStart(file, ev) {
      const ids = selectedFileIds.value.has(file.id) ? Array.from(selectedFileIds.value) : [file.id];
      dragFileIds.value = ids;
      isDragging.value = true;
      dragTargetLabel.value = '';
      if (ev && ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', ids.join(','));
      }
    }

    function onCatDragOver(catId, ev) {
      if (ev) ev.preventDefault();
      dragOverCatId.value = catId;
      dragTargetLabel.value = getCatLabel(catId === null ? 'unclassified' : catId);
      if (ev && ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    }

    function onCatDragLeave(catId) {
      if (dragOverCatId.value === catId) dragOverCatId.value = null;
    }

    async function onCatDrop(catId, ev) {
      if (ev) ev.preventDefault();
      let ids = dragFileIds.value && dragFileIds.value.length ? dragFileIds.value : [];
      if ((!ids || ids.length === 0) && ev && ev.dataTransfer) {
        const raw = ev.dataTransfer.getData('text/plain') || '';
        const parsed = raw.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n));
        if (parsed.length) ids = parsed;
      }
      const label = getCatLabel(catId || 'unclassified');
      resetDragState();
      if (!ids.length) return;
      try {
        await api('PUT', '/files/batch', { file_ids: ids, category_id: catId || null });
        // Keep user context: switch to target category and show results
        selectedCatId.value = (catId == null ? 'unclassified' : catId);
        pageOffset.value = 0;
        activeTab.value = 'registered';
        clearSelection();
        await load();
        showToast(`已移动 ${ids.length} 个文件到「${label}」`);
      } catch (e) {
        error.value = e.message || String(e);
      }
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

    Vue.onMounted(() => {
      load();
      window.addEventListener('dragend', resetDragState);
      window.addEventListener('drop', resetDragState);
      window.addEventListener('keydown', onKeydown);
      window.addEventListener('click', onGlobalClick);
    });
    Vue.onBeforeUnmount(() => {
      window.removeEventListener('dragend', resetDragState);
      window.removeEventListener('drop', resetDragState);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('click', onGlobalClick);
    });

    function onGlobalClick() {
      catMoreOpenId.value = null;
    }

    function onKeydown(e) {
      if (e && e.key === 'Escape') {
        if (drawerOpen.value) {
          closeDetails();
          return;
        }
        if (showSearch.value) {
          showSearch.value = false;
          return;
        }
      }
    }

    const filteredFiles = Vue.computed(() => {
      return registeredFiles.value;
    });

    const selectedCount = Vue.computed(() => selectedFileIds.value.size);
    const selectedFilesForRename = Vue.computed(() =>
      registeredFiles.value.filter(f => selectedFileIds.value.has(f.id))
    );

    return {
      t, categories, flatCats, registeredFiles, filteredFiles, unclassifiedCount,
      scannedFiles, selected, scanning,
      activeTab, selectedCatId, addingSubCatId, newCatName, newSubCatName,
      renamingCatId, renamingCatName, catMoreOpenId, sortKey, sortDir, zipLoadingCatId, error, projectId, catPanelWidth, isResizing, dragOverCatId,
      isDragging, dragFileIds, dragTargetLabel, toastMessage, projectInfo,
      totalFiles, filteredTotal, categoryCounts, pageNo, pageCount, canPrev, canNext,
      suggestedCount,
      // Duplicate detection
      showDuplicateModal, duplicates, pendingFiles, handleDuplicateClose, handleDuplicateConfirm,
      // Batch operations
      selectedFileIds, showBatchBar, showBatchRenameModal, selectedCount,
      toggleFileSelection, selectAllFiles, clearSelection,
      batchMoveToCategory, batchDelete, openBatchRename, handleBatchRename,
      selectedFilesForRename, startResize,
      fileNameColWidth, isNameColResizing, startNameColResize,
      // Search
      showSearch,
      // Version history
      showVersionModal, versionFileId, versionFileName, openVersionHistory, onRollback,
      // Functions
      scan, autoCategorize, registerSelected, registerSuggested,
      updateFileCategory, deleteFile, openFileDir, openFile, openCategoryDir, addCategory, addSubCategory,
      startRename, confirmRename, moveCat, toggleSort, deleteCategory, downloadCategoryZip,
      toggleCatMore,
      selectCategory, prevPage, nextPage,
      drawerOpen, drawerWidth, drawerFileId, drawerData, drawerLoading, drawerError, drawerNotes, drawerSaving,
      drawerCategoryId, isDrawerResizing, drawerX, drawerY, isDrawerDragging, startFloatingDrag,
      centerFloatingDrawer,
      scanPagedFiles, scanPageNo, scanPageCount, scanCanPrev, scanCanNext, prevScanPage, nextScanPage,
      toggleSelectAllScanPage, allCheckedScanPage,
      drawerBreadcrumb,
      openDetails, closeDetails, saveDrawerNotes, saveDrawerCategory, copyText, getCatPath, formatBytes, formatDT, startDrawerResize,
      onFileDragStart, onCatDragOver, onCatDragLeave, onCatDrop, getTopBadge
    };
  },
  template: `
    <div class="page">
      <div class="toast" v-if="toastMessage">{{ toastMessage }}</div>
      <!-- Duplicate Warning Modal -->
      <DuplicateWarningModal
        v-if="showDuplicateModal"
        :duplicates="duplicates"
        :allFiles="pendingFiles"
        @close="handleDuplicateClose"
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
          @close="showSearch = false"
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
          <button class="btn-secondary" @click="autoCategorize" :disabled="scanning || unclassifiedCount === 0">
            一键自动分类
          </button>
          <button class="btn-primary" @click="scan" :disabled="scanning">
            {{ scanning ? '扫描中...' : t('btn_scan') }}
          </button>
        </div>
      </div>
      <div class="error" v-if="error">{{ error }}</div>
      <div class="drag-banner" v-if="isDragging">
        拖拽中：将移动 {{ dragFileIds.length }} 个文件 <span v-if="dragTargetLabel">→ {{ dragTargetLabel }}</span>
        <span v-else style="color:var(--text-muted);margin-left:6px;">把文件拖到左侧分类即可归类</span>
      </div>

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

      <div class="cabinet-layout" :style="{ display:'grid', gridTemplateColumns: catPanelWidth + 'px 24px 1fr' }">
        <!-- Category Tree -->
        <div class="cat-panel card" :style="{ width: '100%' }">
          <div class="cat-panel-header">
            <div class="panel-title">分类管理</div>
          </div>
          <div class="cat-tree">
            <!-- All files -->
            <div
              :class="['cat-node', 'level-0', 'cat-node-special', selectedCatId === null ? 'cat-node-active' : '']"
              style="padding-left:8px;"
              @click="selectCategory(null)">
              <span class="cat-name">全部文件</span>
              <span class="cat-count-pill">{{ totalFiles }}</span>
            </div>
            <!-- Unclassified -->
            <div
              :class="['cat-node', 'level-0', 'cat-node-special', 'cat-node-unclassified', selectedCatId === 'unclassified' ? 'cat-node-active' : '', dragOverCatId === 'unclassified' ? 'cat-node-dropover' : '']"
              style="padding-left:8px;"
              @click="selectCategory('unclassified')"
              @dragover="onCatDragOver('unclassified', $event)" @dragleave="onCatDragLeave('unclassified')" @drop="onCatDrop(null, $event)">
              <span class="cat-name">未分类</span>
              <span :class="['cat-count-pill', 'emph']">{{ unclassifiedCount }}</span>
              <span class="drop-hint" v-if="isDragging && dragOverCatId === 'unclassified'">松开移动</span>
            </div>
            <!-- Category nodes -->
            <template v-for="(cat, idx) in flatCats" :key="cat.id">
              <div :style="{ paddingLeft: (cat.depth * 16 + 8) + 'px', '--cat-indent': (cat.depth * 16 + 8) + 'px' }"
                :class="['cat-node', cat.depth === 0 ? 'level-0' : 'cat-node-child', ('cat-depth-' + Math.min(cat.depth, 3)), (cat.depth > 1 ? 'cat-depth-2plus' : ''), (cat.depth === 0 && idx > 0 ? 'cat-group-divider' : ''), (idx > 0 && flatCats[idx-1] && flatCats[idx-1].depth === 0 && cat.depth > 0 ? 'cat-first-child' : ''), selectedCatId === cat.id ? 'cat-node-active' : '', dragOverCatId === cat.id ? 'cat-node-dropover' : '', catMoreOpenId === cat.id ? 'cat-node-more-open' : '']"
                @click="selectCategory(cat.id)"
                @dragover="onCatDragOver(cat.id, $event)" @dragleave="onCatDragLeave(cat.id)" @drop="onCatDrop(cat.id, $event)">
                <!-- Rename mode -->
                <template v-if="renamingCatId === cat.id">
                  <input v-model="renamingCatName" class="input input-sm" style="flex:1;"
                    @keyup.enter="confirmRename(cat.id)" @keyup.esc="renamingCatId = null"
                    @click.stop autofocus>
                  <button class="btn-sm" style="font-size:10px;padding:3px 7px;" @click.stop="confirmRename(cat.id)">✓</button>
                </template>
                <!-- Normal mode -->
                <template v-else>
                  <span class="cat-prefix">
                    <span v-if="cat.depth === 0" class="cat-top-badge">{{ getTopBadge(cat.name) }}</span>
                  </span>
                  <span class="cat-name">{{ cat.name }}</span>
                  <span class="cat-count-pill">{{ (categoryCounts && categoryCounts[cat.id]) ? categoryCounts[cat.id] : 0 }}</span>
                  <span class="drop-hint" v-if="isDragging && dragOverCatId === cat.id">松开移动</span>
                  <span class="cat-actions">
                    <button class="btn-icon-add" title="添加子分类" @click.stop="addingSubCatId = (addingSubCatId === cat.id ? null : cat.id); newSubCatName = ''">+</button>
                    <button class="btn-icon-add" title="更多" @click.stop="toggleCatMore(cat.id)">⋯</button>
                    <button class="btn-icon-danger" @click.stop="deleteCategory(cat.id)">✕</button>
                  </span>
                  <div v-if="catMoreOpenId === cat.id" class="cat-more-menu" @click.stop>
                    <button class="cat-more-item" @click.stop="catMoreOpenId = null; startRename(cat)">重命名</button>
                    <button class="cat-more-item" @click.stop="catMoreOpenId = null; moveCat(cat.id, 'up')">上移</button>
                    <button class="cat-more-item" @click.stop="catMoreOpenId = null; moveCat(cat.id, 'down')">下移</button>
                    <div class="cat-more-divider"></div>
                    <button class="cat-more-item" @click.stop="catMoreOpenId = null; downloadCategoryZip(cat.id)">
                      {{ zipLoadingCatId === cat.id ? '导出中…' : '导出压缩包' }}
                    </button>
                    <button class="cat-more-item" @click.stop="catMoreOpenId = null; openCategoryDir(cat.id)">打开文件夹</button>
                  </div>
                </template>
              </div>
              <!-- Inline sub-cat input -->
              <div v-if="addingSubCatId === cat.id"
                :style="{ paddingLeft: ((cat.depth + 1) * 16 + 8) + 'px', '--cat-indent': ((cat.depth + 1) * 16 + 8) + 'px' }"
                class="sub-cat-input-row cat-node-child">
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
        <div class="panel-resizer" :class="{ 'resizing': isResizing }" @mousedown="startResize"></div>

        <!-- Files Panel -->
        <div class="files-panel" :style="{ width: '100%' }">
          <div class="tabs">
            <button :class="['tab', activeTab === 'registered' ? 'active' : '']" @click="activeTab = 'registered'">
              已注册文件 ({{ registeredFiles.length }}/{{ filteredTotal }})
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
                <span v-if="selectedCount > 0" class="toolbar-hint">已选 {{ selectedCount }}</span>
                <div class="table-toolbar__right">
                  <button class="btn-secondary" @click="prevPage" :disabled="!canPrev">上一页</button>
                  <span class="toolbar-muted">第 {{ pageNo }} / {{ pageCount }} 页</span>
                  <button class="btn-secondary" @click="nextPage" :disabled="!canNext">下一页</button>
                </div>
              </div>
              <table class="file-table">
                <colgroup>
                  <col style="width:40px;">
                  <col :style="{ width: fileNameColWidth + 'px' }">
                  <col style="width:190px;">
                  <col style="width:110px;">
                  <col style="width:112px;">
                </colgroup>
                <thead>
                  <tr>
                    <th class="col-check"><input type="checkbox" @change="$event.target.checked ? selectAllFiles() : clearSelection()"></th>
                    <th class="sortable-th col-name" @click="toggleSort('file_name')">
                      文件名 <span class="sort-icon">{{ sortKey === 'file_name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                      <span class="col-resizer" @mousedown.stop="startNameColResize" @click.stop></span>
                    </th>
                    <th style="width:140px;">分类</th>
                    <th class="sortable-th" @click="toggleSort('registered_at')">
                      入库时间 <span class="sort-icon">{{ sortKey === 'registered_at' ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
                    </th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in filteredFiles" :key="f.id" :class="{ 'selected-row': selectedFileIds.has(f.id) }">
                    <td><input type="checkbox" :checked="selectedFileIds.has(f.id)" @change="toggleFileSelection(f.id)"></td>
                    <td class="col-name">
                      <div class="file-name-cell">
                        <span class="drag-handle" title="拖拽到左侧分类" draggable="true" @dragstart.stop="onFileDragStart(f, $event)">⠿</span>
                        <span class="file-icon">📄</span>
                        <button class="file-name-link" @click.stop="openDetails(f, $event)" :title="f.file_name">{{ f.file_name }}</button>
                      </div>
                    </td>
                    <td style="width:140px;max-width:140px;">
                      <select :value="f.category_id" @change="updateFileCategory(f.id, $event.target.value)" class="input input-sm" style="max-width:130px;min-width:0;width:100%;">
                        <option value="">— 未分类 —</option>
                        <option v-for="c in flatCats" :key="c.id" :value="c.id">
                          {{ '　'.repeat(c.depth) + c.name }}
                        </option>
                      </select>
                    </td>
                    <td class="time-cell">{{ (f.registered_at || f.created_at) ? (f.registered_at || f.created_at).slice(0, 10) : '—' }}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn-icon" title="打开所在文件夹" @click="openFileDir(f.id)">📁</button>
                        <button class="btn-icon" title="详情" @click="openDetails(f, $event)">🛈</button>
                        <button class="btn-icon-danger" title="删除" @click="deleteFile(f.id)">🗑</button>
                      </div>
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
                <div class="scan-actions__left">
                  <span class="scan-actions__title">{{ t('scan_found').replace('{n}', scannedFiles.length) }}</span>
                  <span class="scan-actions__meta">（{{ suggestedCount }} 个已有建议分类）</span>
                </div>
                <div class="scan-actions__right">
                  <button class="btn-secondary" @click="registerSuggested" v-if="suggestedCount > 0">
                    一键注册建议文件 ({{ suggestedCount }})
                  </button>
                  <button class="btn-primary" @click="registerSelected">注册选中文件</button>
                </div>
              </div>
              <div class="table-toolbar">
                <label class="checkbox-label">
                  <input type="checkbox" :checked="allCheckedScanPage" @change="toggleSelectAllScanPage($event.target.checked)">
                  全选本页
                </label>
                <div class="table-toolbar__right">
                  <button class="btn-secondary" @click="prevScanPage" :disabled="!scanCanPrev">上一页</button>
                  <span class="toolbar-muted">第 {{ scanPageNo }} / {{ scanPageCount }} 页</span>
                  <button class="btn-secondary" @click="nextScanPage" :disabled="!scanCanNext">下一页</button>
                </div>
              </div>
              <table class="file-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>文件名</th>
                    <th>建议分类</th>
                    <th>指定分类</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in scanPagedFiles" :key="f.file_path">
                    <td><input type="checkbox" v-model="selected[f.file_path].checked"></td>
                    <td :title="f.file_path">{{ f.file_name }}</td>
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

      <!-- Floating Details Drawer -->
        <div v-if="drawerOpen" class="floating-drawer" :style="{ left: (drawerX || 16) + 'px', top: (drawerY || 16) + 'px', width: drawerWidth + 'px' }">
        <div class="floating-drawer-header" @mousedown.stop="startFloatingDrag" @dblclick.stop="centerFloatingDrawer">
          <div class="details-title">文件详情</div>
          <button class="btn-icon" title="关闭" @click="closeDetails">×</button>
        </div>
        <div class="floating-drawer-body">
          <div v-if="drawerData" class="details-subhead">
            <div class="drawer-breadcrumb">{{ drawerBreadcrumb }}</div>
            <div class="drawer-path">{{ drawerData.file_path }}</div>
            <div class="details-badges">
              <span :class="['badge-pill', drawerData.indexed ? 'ok' : 'muted']">{{ drawerData.indexed ? '已索引' : '未索引' }}</span>
              <span class="badge-pill">版本 {{ drawerData.version_count || 0 }}</span>
            </div>
          </div>
          <div v-if="drawerLoading" class="empty">加载中...</div>
          <div v-else-if="drawerError" class="error">{{ drawerError }}</div>
          <div v-else-if="drawerData" class="details-body">
            <div class="detail-row"><div class="detail-label">文件名</div><div class="detail-value">{{ drawerData.file_name }}</div></div>
            <div class="detail-row">
              <div class="detail-label">分类</div>
              <div class="detail-value">
                <select class="input input-sm" v-model="drawerCategoryId" @change="saveDrawerCategory" :disabled="drawerSaving" style="width:100%;">
                  <option value="">— 未分类 —</option>
                  <option v-for="c in flatCats" :key="c.id" :value="c.id">
                    {{ '　'.repeat(c.depth) + c.name }}
                  </option>
                </select>
                <div v-if="drawerData.category_id" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="btn-ghost" @click="openCategoryDir(drawerData.category_id)">打开分类文件夹</button>
                </div>
              </div>
            </div>
            <div class="detail-row"><div class="detail-label">入库</div><div class="detail-value">{{ formatDT(drawerData.registered_at) }}</div></div>
            <div class="detail-row"><div class="detail-label">修改</div><div class="detail-value">{{ formatDT(drawerData.last_modified) }}</div></div>
            <div class="detail-row"><div class="detail-label">大小</div><div class="detail-value">{{ formatBytes(drawerData.file_size) }}</div></div>
            <div class="detail-row"><div class="detail-label">索引</div><div class="detail-value">{{ drawerData.indexed ? '已索引' : '未索引' }}</div></div>
            <div class="detail-row"><div class="detail-label">版本</div><div class="detail-value">{{ drawerData.version_count || 0 }}</div></div>

            <div style="margin-top:14px;">
              <div class="detail-label" style="margin-bottom:6px;">备注</div>
              <textarea class="input" style="width:100%;min-height:120px;resize:vertical;"
                v-model="drawerNotes" @blur="saveDrawerNotes" :disabled="drawerSaving"></textarea>
              <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
                <button class="btn-ghost" @click="saveDrawerNotes" :disabled="drawerSaving">{{ drawerSaving ? '保存中…' : '保存备注' }}</button>
              </div>
            </div>

            <div class="drawer-actions">
              <button class="btn-ghost" @click="openFile(drawerData.id)">打开文件</button>
              <button class="btn-ghost" @click="openFileDir(drawerData.id)">打开所在文件夹</button>
              <button class="btn-ghost" @click="openVersionHistory(drawerData)">版本历史</button>
            </div>
          </div>
          <div v-else class="empty">请选择一个文件查看详情</div>
        </div>
      </div>
    </div>
  `
};
