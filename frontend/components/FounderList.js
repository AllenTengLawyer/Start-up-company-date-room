window.FounderList = {
  setup() {
    const { t } = VueI18n.useI18n();
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const projectId = Vue.computed(() => route.params.id);
    const founders = Vue.ref([]);
    const showForm = Vue.ref(false);
    const form = Vue.reactive({ name: '', role: '', id_number: '', join_date: '', employment_type: 'full_time', notes: '' });
    const error = Vue.ref('');

    async function load() {
      founders.value = await api('GET', `/projects/${projectId.value}/founders`);
    }

    async function addFounder() {
      if (!form.name.trim()) { error.value = '请填写姓名'; return; }
      await api('POST', `/projects/${projectId.value}/founders`, { ...form });
      Object.assign(form, { name: '', role: '', id_number: '', join_date: '', employment_type: 'full_time', notes: '' });
      showForm.value = false; error.value = '';
      await load();
    }

    async function deleteFounder(id) {
      if (!confirm(t('confirm_delete'))) return;
      await api('DELETE', `/founders/${id}`);
      await load();
    }

    async function upgradeProject() {
      await api('PUT', `/projects/${projectId.value}/mode`, { mode: 'established' });
      appState.currentProject = { ...appState.currentProject, mode: 'established' };
      router.push(`/project/${projectId.value}/cabinet`);
    }

    Vue.onMounted(load);

    return { t, founders, showForm, form, error, projectId, addFounder, deleteFounder, upgradeProject, router };
  },
  template: `
    <div class="page">
      <div class="page-header">
        <h2>{{ t('nav_founders') }}</h2>
        <div class="header-actions">
          <button class="btn-secondary" @click="upgradeProject">{{ t('upgrade_btn') }}</button>
          <button class="btn-primary" @click="showForm = !showForm">+ {{ t('btn_add') }}</button>
        </div>
      </div>
      <div class="upgrade-banner">{{ t('upgrade_prompt') }}</div>

      <div class="card form-card" v-if="showForm">
        <div class="form-row">
          <div class="form-group"><label>{{ t('founder_name') }} *</label><input v-model="form.name" class="input"></div>
          <div class="form-group"><label>{{ t('founder_role') }}</label><input v-model="form.role" class="input" placeholder="CEO / CTO / COO"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>{{ t('founder_id') }}</label><input v-model="form.id_number" class="input"></div>
          <div class="form-group"><label>{{ t('founder_join') }}</label><input v-model="form.join_date" class="input" type="date"></div>
        </div>
        <div class="form-group">
          <label>全职/兼职</label>
          <select v-model="form.employment_type" class="input">
            <option value="full_time">{{ t('founder_type_full') }}</option>
            <option value="part_time">{{ t('founder_type_part') }}</option>
          </select>
        </div>
        <div class="form-group"><label>{{ t('founder_notes') }}</label><textarea v-model="form.notes" class="input" rows="2"></textarea></div>
        <div class="error" v-if="error">{{ error }}</div>
        <div class="form-actions">
          <button class="btn-primary" @click="addFounder">{{ t('btn_save') }}</button>
          <button class="btn-ghost" @click="showForm = false">{{ t('btn_cancel') }}</button>
        </div>
      </div>

      <div class="founders-grid">
        <div class="founder-card card" v-for="f in founders" :key="f.id" @click="router.push('/project/' + projectId + '/founder/' + f.id)">
          <div class="founder-avatar">{{ f.name[0] }}</div>
          <div class="founder-info">
            <div class="founder-name">{{ f.name }}</div>
            <div class="founder-role">{{ f.role || '—' }}</div>
            <div class="founder-meta">{{ f.employment_type === 'full_time' ? t('founder_type_full') : t('founder_type_part') }}</div>
          </div>
          <button class="btn-icon-danger" @click.stop="deleteFounder(f.id)">✕</button>
        </div>
      </div>
      <div class="empty" v-if="founders.length === 0">暂无创始人，点击"添加"创建第一个创始人档案</div>
    </div>
  `
};
