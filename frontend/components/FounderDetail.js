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
    const error = Vue.ref('');
    const dragOver = Vue.ref({});
    const uploading = Vue.ref({});

    async function load() {
      const data = await api('GET', `/founders/${founderId.value}/checklist`);
      checklist.value = data.items;
      dimensions.value = data.dimensions;
    }

    Vue.onMounted(load);

    const dimItems = Vue.computed(() => checklist.value.filter(i => i.dimension === activeDim.value));
    const dimKeys = Vue.computed(() => Object.keys(dimensions.value));

    async function updateStatus(item) {
      await api('PUT', `/founders/${founderId.value}/checklist/${item.code}`, {
        status: item.status, statement: item.statement
      });
    }

    async function uploadFiles(itemCode, files) {
      if (!files || files.length === 0) return;
      uploading.value = { ...uploading.value, [itemCode]: true };
      error.value = '';
      try {
        for (const file of files) {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('item_code', itemCode);
          const res = await fetch(`/api/founders/${founderId.value}/upload`, {
            method: 'POST', body: fd
          });
          if (!res.ok) {
            const e = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(e.detail || res.statusText);
          }
        }
        await load();
      } catch(e) {
        error.value = e.message || String(e);
      } finally {
        uploading.value = { ...uploading.value, [itemCode]: false };
      }
    }

    function onFileInput(item, event) {
      uploadFiles(item.code, event.target.files);
      event.target.value = '';
    }

    function onDrop(item, event) {
      event.preventDefault();
      dragOver.value = { ...dragOver.value, [item.code]: false };
      uploadFiles(item.code, event.dataTransfer.files);
    }

    function onDragOver(item, event) {
      event.preventDefault();
      dragOver.value = { ...dragOver.value, [item.code]: true };
    }

    function onDragLeave(item) {
      dragOver.value = { ...dragOver.value, [item.code]: false };
    }

    async function removeFile(fileId) {
      if (!confirm(t('confirm_delete'))) return;
      await api('DELETE', `/founder-files/${fileId}`);
      await load();
    }

    const riskLabel = { high: '高', medium: '中', low: '低' };

    return { t, checklist, dimensions, activeDim, dimItems, dimKeys, error,
             dragOver, uploading, founderId, projectId, router,
             updateStatus, onFileInput, onDrop, onDragOver, onDragLeave, removeFile,
             riskLabel };
  },
  template: `
    <div class="page">
      <div class="page-header">
        <button class="btn-ghost" @click="router.push('/project/' + projectId + '/founders')">← 返回</button>
        <h2>创始人背景核查</h2>
      </div>
      <div class="error" v-if="error">{{ error }}</div>
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

            <div v-if="item.item_type === 'file'"
              :class="['upload-drop-zone', dragOver[item.code] ? 'drag-active' : '']"
              @dragover="onDragOver(item, $event)"
              @dragleave="onDragLeave(item)"
              @drop="onDrop(item, $event)">
              <span v-if="uploading[item.code]">上传中...</span>
              <span v-else>拖拽文件到此处，或
                <label class="upload-link">点击选择
                  <input type="file" multiple style="display:none;" @change="onFileInput(item, $event)">
                </label>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};
