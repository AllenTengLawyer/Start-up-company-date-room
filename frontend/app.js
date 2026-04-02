const { createApp, ref, reactive, computed, onMounted, watch } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;
const { createI18n } = VueI18n;

// API helper
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
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
    const appReady = ref(false);
    const locale = ref('zh');
    const showProjectMenu = ref(false);

    const currentProject = computed(() => state.currentProject);

    async function loadProjects() {
      state.projects = await api('GET', '/projects');
      if (state.projects.length > 0 && !state.currentProject) {
        state.currentProject = state.projects[0];
      }
    }

    function onProjectCreated(project) {
      state.currentProject = project;
      loadProjects();
      const dest = project.mode === 'early_team'
        ? `/project/${project.id}/founders`
        : `/project/${project.id}/cabinet`;
      router.push(dest);
    }

    function switchProject(project) {
      state.currentProject = project;
      showProjectMenu.value = false;
      const dest = project.mode === 'early_team'
        ? `/project/${project.id}/founders`
        : `/project/${project.id}/cabinet`;
      router.push(dest);
    }

    function toggleLang() {
      locale.value = locale.value === 'zh' ? 'en' : 'zh';
      VueI18n.useI18n().locale.value = locale.value;
    }

    onMounted(async () => {
      await loadProjects();
      if (state.projects.length === 0) router.push('/init');
      else if (router.currentRoute.value.path === '/') {
        const p = state.projects[0];
        router.push(p.mode === 'early_team' ? `/project/${p.id}/founders` : `/project/${p.id}/cabinet`);
      }
      appReady.value = true;
    });

    // Sync currentProject when route changes
    watch(() => router.currentRoute.value.params.id, (id) => {
      if (id) {
        const found = state.projects.find(p => p.id == id);
        if (found) state.currentProject = found;
      }
    });

    return { appReady, currentProject, locale, showProjectMenu, appState: state,
             loadProjects, onProjectCreated, switchProject, toggleLang };
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