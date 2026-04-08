const { createApp, ref, reactive, computed, onMounted, watch } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;
const { createI18n } = VueI18n;

// API helper
async function api(method, path, body, extra) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (extra && typeof extra === 'object') {
    if (extra.headers && typeof extra.headers === 'object') {
      opts.headers = { ...opts.headers, ...extra.headers };
    }
    for (const [k, v] of Object.entries(extra)) {
      if (k === 'headers') continue;
      opts[k] = v;
    }
  }
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const msg = (e && e.message) ? e.message : String(e);
    throw new Error(`请求失败（可能后端未启动或已崩溃）：${msg}`);
  }

  if (!res.ok) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = err && Object.prototype.hasOwnProperty.call(err, 'detail') ? err.detail : null;
      if (typeof detail === 'string' && detail.trim()) throw new Error(detail);
      if (detail != null) throw new Error(JSON.stringify(detail));
      throw new Error(res.statusText);
    }
    const text = await res.text().catch(() => '');
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}
window.api = api;

// Global state
const state = reactive({ currentProject: null, projects: [] });
window.appState = state;

// Routes
const routes = [
  { path: '/', redirect: '/init' },
  { path: '/init', component: window.ProjectInit },
  { path: '/project/:id/founders', component: window.FounderList },
  { path: '/project/:id/founder/:fid', component: window.FounderDetail },
  { path: '/project/:id/cabinet', component: window.FileScanner },
  { path: '/project/:id/ldd', component: window.LddView },
  { path: '/project/:id/export', component: window.ExportPanel },
];

const router = createRouter({ history: createWebHashHistory(), routes });

// App
const App = {
  setup() {
    const { locale: i18nLocale } = VueI18n.useI18n();
    const appReady = ref(false);
    const locale = ref(i18nLocale.value || 'zh');
    const initError = ref('');
    const showProjectMenu = ref(false);

    const currentProject = computed(() => state.currentProject);

    async function ensureSeeded(project) {
      if (!project || project.mode !== 'established') return;
      try {
        await api('POST', `/projects/${project.id}/ensure-seeded`);
      } catch (e) {}
    }

    async function loadProjects() {
      state.projects = await api('GET', '/projects');
      if (state.projects.length > 0 && !state.currentProject) {
        state.currentProject = state.projects[0];
        await ensureSeeded(state.currentProject);
      }
    }

    function onProjectCreated(project) {
      state.currentProject = project;
      ensureSeeded(project);
      loadProjects();
      const dest = project.mode === 'early_team'
        ? `/project/${project.id}/founders`
        : `/project/${project.id}/cabinet`;
      router.push(dest);
    }

    function switchProject(project) {
      state.currentProject = project;
      showProjectMenu.value = false;
      ensureSeeded(project);
      const dest = project.mode === 'early_team'
        ? `/project/${project.id}/founders`
        : `/project/${project.id}/cabinet`;
      router.push(dest);
    }

    function toggleLang() {
      locale.value = locale.value === 'zh' ? 'en' : 'zh';
      i18nLocale.value = locale.value;
    }

    async function openProjectRoot() {
      if (!currentProject.value) return;
      try {
        await api('POST', `/projects/${currentProject.value.id}/open-root`);
      } catch (e) {
        alert('打开失败: ' + e.message);
      }
    }


    async function deleteCurrentProject() {
      if (!currentProject.value) return;
      if (!confirm(`确定要删除项目 "${currentProject.value.name}" 吗？\n\n此操作将删除该项目的所有数据，包括：\n- 文件分类和记录\n- LDD 尽调清单\n- 创始人档案\n\n此操作不可撤销！`)) return;

      try {
        await api('DELETE', `/projects/${currentProject.value.id}`);
        showProjectMenu.value = false;
        await loadProjects();
        if (state.projects.length > 0) {
          state.currentProject = state.projects[0];
          const dest = state.currentProject.mode === 'early_team'
            ? `/project/${state.currentProject.id}/founders`
            : `/project/${state.currentProject.id}/cabinet`;
          router.push(dest);
        } else {
          state.currentProject = null;
          router.push('/init');
        }
      } catch (e) {
        alert('删除失败: ' + e.message);
      }
    }

    onMounted(async () => {
      try {
        await loadProjects();
        if (state.projects.length === 0) router.push('/init');
        else if (router.currentRoute.value.path === '/') {
          const p = state.projects[0];
          router.push(p.mode === 'early_team' ? `/project/${p.id}/founders` : `/project/${p.id}/cabinet`);
        }
        appReady.value = true;
      } catch (e) {
        initError.value = e.message || String(e);
        appReady.value = true;
        router.push('/init');
      }
    });

    // Sync currentProject when route changes
    watch(() => router.currentRoute.value.params.id, (id) => {
      if (id) {
        const found = state.projects.find(p => p.id == id);
        if (found) {
          state.currentProject = found;
          ensureSeeded(found);
        }
      }
    });

    return { appReady, initError, currentProject, locale, showProjectMenu, appState: state,
             loadProjects, onProjectCreated, switchProject, toggleLang, openProjectRoot, deleteCurrentProject };
  },
  template: document.querySelector('#app').innerHTML,
};

async function bootstrap() {
  const [zh, en] = await Promise.all([
    fetch('/i18n/zh.json').then(r => r.json()),
    fetch('/i18n/en.json').then(r => r.json()),
  ]);

  const i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh, en } });
  const app = createApp(App);
  app.use(router);
  app.use(i18n);
  app.mount('#app');
}

bootstrap();
