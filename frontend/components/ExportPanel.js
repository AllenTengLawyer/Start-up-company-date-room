window.ExportPanel = {
  setup() {
    const { t, locale } = VueI18n.useI18n();
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const projectId = Vue.computed(() => route.params.id);
    const loading = Vue.ref(false);
    const error = Vue.ref('');
    const destPath = Vue.ref('');
    const folderLoading = Vue.ref(false);
    const folderResult = Vue.ref(null);
    const showSkipped = Vue.ref(false);
    const jsonLoading = Vue.ref(false);
    const importLoading = Vue.ref(false);
    const importResult = Vue.ref(null);
    const projectMode = Vue.ref('');
    const founderLoading = Vue.ref(false);

    Vue.onMounted(async () => {
      try {
        const proj = await api('GET', `/projects/${projectId.value}`);
        const root = String(proj.root_path || '').replace(/[\\\/]+$/, '');
        destPath.value = root ? (root + '/_export') : '';
        projectMode.value = proj.mode || '';
      } catch(e) {}
    });

    async function exportDocx() {
      loading.value = true; error.value = '';
      try {
        const lang = String(locale.value || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
        const res = await fetch(`/api/projects/${projectId.value}/export/docx?lang=${encodeURIComponent(lang)}`);
        if (!res.ok) {
          const contentType = (res.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            const detail = err && Object.prototype.hasOwnProperty.call(err, 'detail') ? err.detail : null;
            throw new Error(typeof detail === 'string' ? detail : (detail ? JSON.stringify(detail) : res.statusText));
          }
          const text = await res.text().catch(() => '');
          throw new Error(text || res.statusText);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `DD_Report_${projectId.value}.docx`;
        a.click(); URL.revokeObjectURL(url);
      } catch(e) {
        error.value = e && e.message ? e.message : String(e);
      }
      finally { loading.value = false; }
    }

    function exportHtml() {
      const lang = String(locale.value || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
      window.open(`/api/projects/${projectId.value}/export/html?lang=${encodeURIComponent(lang)}`, '_blank');
    }

    async function exportFolder() {
      if (!destPath.value.trim()) return;
      folderLoading.value = true; folderResult.value = null; error.value = '';
      showSkipped.value = false;
      try {
        const res = await fetch(`/api/projects/${projectId.value}/export/folder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dest_path: destPath.value.trim() })
        });
        if (!res.ok) {
          const contentType = (res.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('application/json')) {
            const e = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(e.detail || res.statusText);
          }
          const text = await res.text().catch(() => '');
          throw new Error(text || res.statusText);
        }
        folderResult.value = await res.json();
      } catch(e) { error.value = e.message; }
      finally { folderLoading.value = false; }
    }

    async function pickDestFolder() {
      error.value = '';
      try {
        const res = await api('POST', '/browse-folder');
        if (res && res.path) destPath.value = res.path;
      } catch (e) {
        error.value = (e && e.message) ? e.message : String(e);
      }
    }

    async function exportJson() {
      jsonLoading.value = true; error.value = '';
      try {
        const res = await fetch(`/api/projects/${projectId.value}/export/json`);
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `backup_project_${projectId.value}.json`;
        a.click(); URL.revokeObjectURL(url);
      } catch(e) { error.value = e.message; }
      finally { jsonLoading.value = false; }
    }

    async function importJson(event) {
      const file = event.target.files[0];
      if (!file) return;
      importLoading.value = true; importResult.value = null; error.value = '';
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch('/api/projects/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
        const result = await res.json();
        importResult.value = result;
        await appState.projects; // trigger reload
        const projects = await api('GET', '/projects');
        appState.projects = projects;
        appState.currentProject = projects.find(p => p.id === result.id) || appState.currentProject;
        router.push(`/project/${result.id}/cabinet`);
      } catch(e) { error.value = e.message; }
      finally { importLoading.value = false; event.target.value = ''; }
    }

    async function exportFounderReport() {
      founderLoading.value = true; error.value = '';
      try {
        const res = await fetch(`/api/projects/${projectId.value}/export/founder-report`);
        if (!res.ok) {
          const e = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(e.detail || res.statusText);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `founder_report_${projectId.value}.zip`;
        a.click(); URL.revokeObjectURL(url);
      } catch(e) { error.value = e.message || String(e); }
      finally { founderLoading.value = false; }
    }

    return { t, loading, error, exportDocx, exportHtml,
             destPath, folderLoading, folderResult, showSkipped, exportFolder,
             pickDestFolder,
             jsonLoading, importLoading, importResult, exportJson, importJson,
             projectMode, founderLoading, exportFounderReport };
  },
  template: `
    <div class="page">
      <div class="page-header"><h2>{{ t('nav_export') }}</h2></div>
      <div class="export-panel card">

        <!-- early_team 模式：只显示创始人报告导出 -->
        <template v-if="projectMode === 'early_team'">
          <div class="export-option">
            <div class="export-icon">👤</div>
            <div class="export-info">
              <div class="export-title">创始人背景核查报告</div>
              <div class="export-desc">按创始人分组导出 Word 报告 + 附件，打包为 ZIP</div>
            </div>
            <button class="btn-primary" @click="exportFounderReport" :disabled="founderLoading">
              {{ founderLoading ? '生成中...' : '导出 ZIP' }}
            </button>
          </div>
        </template>

        <!-- 普通模式：显示完整导出选项 -->
        <template v-else>
          <div class="export-option">
            <div class="export-icon">📝</div>
            <div class="export-info">
              <div class="export-title">Word 自查报告</div>
              <div class="export-desc">.docx 格式，包含项目概览、表格与清单，适合内部存档与对外协作</div>
            </div>
            <button class="btn-primary" @click="exportDocx" :disabled="loading">
              {{ loading ? '生成中...' : t('btn_export_docx') }}
            </button>
          </div>
          <div class="export-option">
            <div class="export-icon">🌐</div>
            <div class="export-info">
              <div class="export-title">HTML 预览</div>
              <div class="export-desc">在浏览器中预览报告，可使用浏览器打印功能另存为PDF</div>
            </div>
            <button class="btn-secondary" @click="exportHtml">{{ t('btn_export_html') }}</button>
          </div>
          <div class="export-option" style="flex-direction:column;align-items:stretch;gap:10px;">
            <div style="display:flex;align-items:center;gap:16px;">
              <div class="export-icon">📁</div>
              <div class="export-info">
                <div class="export-title">{{ t('export_folder_title') }}</div>
                <div class="export-desc">{{ t('export_folder_desc') }}</div>
              </div>
              <button class="btn-secondary" @click="exportFolder" :disabled="folderLoading || !destPath.trim()">
                {{ folderLoading ? '导出中...' : t('btn_export_folder') }}
              </button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;padding-left:56px;">
              <label style="font-size:12px;color:#4a5568;white-space:nowrap;">{{ t('export_folder_dest') }}</label>
              <input v-model="destPath" class="input input-sm" style="flex:1;" placeholder="目标文件夹路径...">
              <button class="btn-ghost" @click="pickDestFolder" :disabled="folderLoading">选择...</button>
            </div>
            <div v-if="folderResult" style="padding-left:56px;font-size:12px;">
              <div style="color:#276749;">✓ {{ t('export_folder_success').replace('{n}', folderResult.copied) }}</div>
              <div v-if="folderResult.skipped.length" style="margin-top:4px;">
                <span style="color:#c05621;cursor:pointer;" @click="showSkipped=!showSkipped">
                  ⚠ {{ t('export_folder_skipped').replace('{n}', folderResult.skipped.length) }}
                  {{ showSkipped ? '▲' : '▼' }}
                </span>
                <div v-if="showSkipped" style="margin-top:4px;display:flex;flex-direction:column;gap:2px;">
                  <div v-for="s in folderResult.skipped" :key="s.file_name" style="color:#718096;">
                    {{ s.file_name }} — {{ s.reason }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <div class="error" v-if="error">{{ error }}</div>

        <!-- JSON backup/import（所有模式均显示） -->
        <div class="export-option">
          <div class="export-icon">💾</div>
          <div class="export-info">
            <div class="export-title">{{ t('export_json_title') }}</div>
            <div class="export-desc">{{ t('export_json_desc') }}</div>
          </div>
          <button class="btn-ghost" @click="exportJson" :disabled="jsonLoading">
            {{ jsonLoading ? '导出中...' : t('btn_export_json') }}
          </button>
        </div>
        <div class="export-option">
          <div class="export-icon">📥</div>
          <div class="export-info">
            <div class="export-title">{{ t('import_json_title') }}</div>
            <div class="export-desc">{{ t('import_json_desc') }}</div>
            <div v-if="importResult" style="color:#276749;font-size:12px;margin-top:4px;">
              ✓ {{ t('import_success').replace('{name}', importResult.name) }}
            </div>
          </div>
          <label class="btn-ghost" style="cursor:pointer;">
            {{ importLoading ? '导入中...' : t('btn_import_json') }}
            <input type="file" accept=".json" style="display:none;" @change="importJson" :disabled="importLoading">
          </label>
        </div>
      </div>
    </div>
  `
};
