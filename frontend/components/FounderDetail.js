window.FounderDetail = {
  setup() {
    const { t } = VueI18n.useI18n();
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const founderId = Vue.computed(() => route.params.fid);
    const projectId = Vue.computed(() => route.params.id);
    const checklist = Vue.ref([]);
    const dimensions = Vue.ref({});
    const activeDim = Vue.ref('A');
    const fileInput = Vue.ref({});
    const error = Vue.ref('');
    const cabinetFiles = Vue.ref([]);
    const showCabinetModal = Vue.ref(false);
    const cabinetTargetCode = Vue.ref(null);

    async function load() {
      const data = await api('GET', `/founders/${founderId.value}/checklist`);
      checklist.value = data.items;
      dimensions.value = data.dimensions;
    }

    Vue.onMounted(async () => {
      const [, files] = await Promise.all([
        load(),
        api('GET', `/projects/${projectId.value}/files`),
      ]);
      cabinetFiles.value = files;
    });

    const dimItems = Vue.computed(() => checklist.value.filter(i => i.dimension === activeDim.value));
    const dimKeys = Vue.computed(() => Object.keys(dimensions.value));

    async function updateStatus(item) {
      await api('PUT', `/founders/${founderId.value}/checklist/${item.code}`, {
        status: item.status, statement: item.statement
      });
    }

    async function addFile(item) {
      const fp = fileInput.value[item.code];
      if (!fp || !fp.trim()) return;
      const fname = fp.split(/[\\/]/).pop();
      await api('POST', `/founders/${founderId.value}/files`, {
        item_code: item.code, file_name: fname, file_path: fp.trim()
      });
      fileInput.value[item.code] = '';
      await load();
    }

    async function removeFile(fileId) {
      if (!confirm(t('confirm_delete'))) return;
      await api('DELETE', `/founder-files/${fileId}`);
      await load();
    }

    function openCabinetModal(code) {
      cabinetTargetCode.value = code;
      showCabinetModal.value = true;
    }

    function pickCabinetFile(f) {
      fileInput.value[cabinetTargetCode.value] = f.file_path;
      showCabinetModal.value = false;
    }

    const statusColor = { provided: 'green', partial: 'orange', pending: 'red', na: 'gray' };
    const riskLabel = { high: '高', medium: '中', low: '低' };

    return { t, checklist, dimensions, activeDim, dimItems, dimKeys, fileInput, error,
             cabinetFiles, showCabinetModal, cabinetTargetCode,
             founderId, projectId, router, updateStatus, addFile, removeFile,
             openCabinetModal, pickCabinetFile, statusColor, riskLabel };
  },
  template: `
    <div class="page">
      <div class="page-header">
        <button class="btn-ghost" @click="router.push('/project/' + projectId + '/founders')">← 返回</button>
        <h2>创始人背景核查</h2>
      </div>
      <div class="dim-tabs">
        <button v-for="dk in dimKeys" :key="dk"
          :class="['dim-tab', activeDim === dk ? 'active' : '']"
          @click="activeDim = dk">
          {{ dimensions[dk]?.zh || dk }}
        </button>
      </div>
      <div class="checklist-items">
        <div class="checklist-item card" v-for="item in dimItems" :key="item.code">
          <div class="item-header">
            <span class="item-code">{{ item.code }}</span>
            <span :class="['risk-badge', 'risk-' + item.risk_level]">{{ riskLabel[item.risk_level] }}</span>
            <span class="item-type-badge">{{ item.item_type === 'file' ? '📄' : item.item_type === 'statement' ? '📝' : '📋' }}</span>
            <select v-model="item.status" @change="updateStatus(item)" :class="['status-select', 'status-' + item.status]">
              <option value="pending">{{ t('status_pending') }}</option>
              <option value="provided">{{ t('status_provided') }}</option>
              <option value="partial">{{ t('status_partial') }}</option>
              <option value="na">{{ t('status_na') }}</option>
            </select>
          </div>
          <div class="item-title">{{ item.title }}</div>
          <div class="item-body">
            <textarea v-if="item.item_type === 'statement' || item.statement !== undefined"
              v-model="item.statement" @blur="updateStatus(item)"
              class="input statement-input" rows="2" :placeholder="t('ldd_statement')"></textarea>
            <div class="file-list" v-if="item.files && item.files.length">
              <div class="file-entry" v-for="f in item.files" :key="f.id">
                📄 {{ f.file_name }}
                <button class="btn-icon-danger" @click="removeFile(f.id)">✕</button>
              </div>
            </div>
            <div class="add-file-row" v-if="item.item_type === 'file'">
              <input v-model="fileInput[item.code]" class="input input-sm" placeholder="粘贴文件路径..." @keyup.enter="addFile(item)">
              <button class="btn-sm" @click="addFile(item)">添加</button>
              <button class="btn-ghost" style="font-size:12px;padding:4px 8px;" @click="openCabinetModal(item.code)"
                title="从文件柜选择">📁</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Cabinet file picker modal -->
      <div class="modal-overlay" v-if="showCabinetModal" @click.self="showCabinetModal = false">
        <div class="modal card">
          <div class="modal-header">
            <span>从文件柜选择</span>
            <button class="btn-ghost" @click="showCabinetModal = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="empty" v-if="cabinetFiles.length === 0">文件柜中暂无文件</div>
            <div class="file-pick-list">
              <div class="file-pick-item" v-for="f in cabinetFiles" :key="f.id"
                @click="pickCabinetFile(f)">
                📄 {{ f.file_name }}
                <span class="file-cat-badge" v-if="f.category_name">{{ f.category_name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};
