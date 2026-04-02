window.ProjectInit = {
  emits: ['project-created'],
  setup(_, { emit }) {
    const { t } = VueI18n.useI18n();
    const form = Vue.reactive({ name: '', root_path: '', mode: 'established', company_type: 'cn' });
    const error = Vue.ref('');
    const loading = Vue.ref(false);
    const browsing = Vue.ref(false);

    async function browseFolder() {
      browsing.value = true;
      try {
        const res = await api('GET', '/browse-folder');
        if (res.path) form.root_path = res.path;
      } catch(e) { /* ignore */ }
      finally { browsing.value = false; }
    }

    async function submit() {
      if (!form.name.trim() || !form.root_path.trim()) { error.value = '请填写所有必填项'; return; }
      loading.value = true; error.value = '';
      try {
        const result = await api('POST', '/projects', { ...form });
        emit('project-created', { ...result, mode: form.mode, name: form.name });
      } catch(e) { error.value = e.message; }
      finally { loading.value = false; }
    }

    return { t, form, error, loading, browsing, submit, browseFolder };
  },
  template: `
    <div class="page-init">
      <h2>{{ t('init_title') }}</h2>
      <div class="form-group">
        <label>{{ t('init_company_name') }} *</label>
        <input v-model="form.name" type="text" class="input" placeholder="例：深圳某某科技有限公司">
      </div>
      <div class="form-group">
        <label>{{ t('init_root_path') }} *</label>
        <div style="display:flex;gap:8px;">
          <input v-model="form.root_path" type="text" class="input" placeholder="例：D:\\公司文件" style="flex:1;">
          <button class="btn-secondary" @click="browseFolder" :disabled="browsing" style="white-space:nowrap;">
            {{ browsing ? '选择中...' : '📁 浏览' }}
          </button>
        </div>
        <div class="hint">文件将保留在原位置，系统只记录文件名和路径</div>
      </div>
      <div class="form-group">
        <label>{{ t('init_mode') }}</label>
        <div class="radio-group">
          <label><input type="radio" v-model="form.mode" value="early_team"> {{ t('init_mode_early') }}</label>
          <label><input type="radio" v-model="form.mode" value="established"> {{ t('init_mode_est') }}</label>
        </div>
      </div>
      <div class="form-group">
        <label>{{ t('init_company_type') }}</label>
        <select v-model="form.company_type" class="input">
          <option value="cn">{{ t('init_type_cn') }}</option>
          <option value="us">{{ t('init_type_us') }}</option>
        </select>
      </div>
      <div class="error" v-if="error">{{ error }}</div>
      <button class="btn-primary" @click="submit" :disabled="loading">
        {{ loading ? '创建中...' : t('init_submit') }}
      </button>
    </div>
  `
};
