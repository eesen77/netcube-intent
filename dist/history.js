// İş geçmişi: üretilen her plan girdileriyle birlikte tarayıcı/uygulama deposuna
// (localStorage) kaydedilir. Electron'da uygulama veri klasöründe kalır; kurulum
// güncellense veya uygulama kapansa da silinmez. Dışa/içe aktarma JSON ile yapılır.
(function () {
  const KEY = 'netcube.jobs.v1';
  const MAX_JOBS = 50;
  const MODULE_LABEL = { routing: 'Routing & Overlay', security: 'Secure Access', cabling: 'Fiziksel Plan', hardening: 'Switch Hardening', campus: 'Campus Builder', audit: 'Config Denetimi' };
  const Jobs = { restoring: false, list: [] };

  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function load() {
    try { const raw = localStorage.getItem(KEY); Jobs.list = raw ? JSON.parse(raw) : []; if (!Array.isArray(Jobs.list)) Jobs.list = []; }
    catch (e) { Jobs.list = []; }
  }
  function persist() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try { localStorage.setItem(KEY, JSON.stringify(Jobs.list)); return true; }
      catch (e) { if (Jobs.list.length <= 1) break; Jobs.list.pop(); }
    }
    return false;
  }

  function fieldIds() {
    return $$('.workspace input[id], .workspace select[id], .workspace textarea[id], .intent textarea[id]');
  }

  function capture() {
    const fields = {}; fieldIds().forEach(el => { fields[el.id] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
    const devices = $$('.device-card').map(c => ({
      id: c.dataset.device, vendor: $('.vendor', c).value, model: $('.model', c).value, custom: $('.model-custom', c).value,
      os: $('.os', c).value, version: $('.version', c).value, role: $('.role', c).value,
      ports: $('.ports', c).value, touched: Boolean($('.ports', c).dataset.touched), config: state.configs[c.dataset.device] || ''
    }));
    return { mode: state.mode, module: state.module, forced: state.forced, fields, devices };
  }

  function saveCurrent() {
    if (!state.plan) return;
    const snap = capture();
    const key = simpleHash(JSON.stringify(snap));
    const p = state.plan;
    const intent = (snap.fields.intentInput || '').replace(/\s+/g, ' ').trim();
    const rec = {
      id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      key, ts: Date.now(),
      title: `${p.definition.title} · ${p.ids.length} cihaz`,
      subtitle: intent.length > 90 ? intent.slice(0, 90) + '…' : intent,
      module: snap.module, solution: state.solution, snap,
      outputs: p.outputs
    };
    const existing = Jobs.list.findIndex(j => j.key === key);
    if (existing >= 0) Jobs.list.splice(existing, 1);
    Jobs.list.unshift(rec);
    if (Jobs.list.length > MAX_JOBS) Jobs.list.length = MAX_JOBS;
    const ok = persist();
    updateBadge();
    if (isOpen()) render(ok ? '' : 'Depolama dolu: eski işler silindi veya kayıt yapılamadı.');
  }

  // ---------- geri yükleme ----------
  function restore(rec) {
    const snap = rec.snap;
    Jobs.restoring = true;
    try {
      const want = snap.devices.length;
      while (deviceIds().length < want) addDevice();
      while (deviceIds().length > want) { const last = deviceIds().filter(i => !['a', 'b'].includes(i)).pop(); if (!last) break; removeDevice(last); }
      state.configs = {};
      const cards = $$('.device-card');
      snap.devices.forEach((d, i) => {
        const card = cards[i]; if (!card) return;
        card.dataset.device = d.id;
        $('.device-index', card).textContent = d.id.toUpperCase();
        $('.vendor', card).value = d.vendor; $('.vendor-dot', card).className = `vendor-dot ${d.vendor}`;
        fillModelSelect($('.model', card), d.vendor, d.model === CUSTOM_MODEL ? undefined : d.model);
        if (d.model === CUSTOM_MODEL) $('.model', card).value = CUSTOM_MODEL;
        $('.model-custom', card).value = d.custom || '';
        applyModelDefaults(card);
        $('.os', card).value = d.os; $('.version', card).value = d.version;
        $('.role', card).value = d.role; $('.ports', card).value = d.ports;
        if (d.touched) $('.ports', card).dataset.touched = '1'; else delete $('.ports', card).dataset.touched;
        renderCaps(card);
        state.configs[d.id] = d.config || '';
        const status = $('.config-status', card);
        if (d.config) { status.textContent = `Kayıtlı config · ${window.summarizeConfig(window.parseConfig(d.config))}`; status.classList.add('loaded'); }
        else { status.textContent = 'Henüz yüklenmedi'; status.classList.remove('loaded'); }
      });
      setModule(snap.module); setMode(snap.mode);
      const f = snap.fields;
      Object.keys(f).filter(k => /Vendor$/.test(k)).forEach(k => { const el = document.getElementById(k); if (el) { el.value = f[k]; el.dispatchEvent(new Event('change')); } });
      Object.keys(f).filter(k => !/Vendor$/.test(k)).forEach(k => { const el = document.getElementById(k); if (!el) return; if (el.type === 'checkbox') el.checked = f[k] === '1'; else el.value = f[k]; });
      state.forced = snap.forced || null;
      analyzePlan();
    } finally { Jobs.restoring = false; }
    close();
  }

  // ---------- dışa / içe aktarma ----------
  function exportJobs() {
    const blob = new Blob([JSON.stringify({ app: 'netcube-intent', version: 1, exportedAt: new Date().toISOString(), jobs: Jobs.list }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `netcube-isler-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function importJobs(file) {
    try {
      const data = JSON.parse(await file.text());
      const incoming = (data.jobs || []).filter(j => j && j.snap && j.key && Array.isArray(j.snap.devices));
      const have = new Set(Jobs.list.map(j => j.key));
      let added = 0;
      incoming.forEach(j => { if (!have.has(j.key)) { Jobs.list.push(j); have.add(j.key); added++; } });
      Jobs.list.sort((x, y) => y.ts - x.ts); if (Jobs.list.length > MAX_JOBS) Jobs.list.length = MAX_JOBS;
      persist(); updateBadge(); render(`${added} iş içe aktarıldı${incoming.length - added ? `, ${incoming.length - added} tanesi zaten vardı` : ''}.`);
    } catch (e) { render('Dosya okunamadı: geçerli bir NetCube iş dosyası değil.'); }
  }

  // ---------- arayüz ----------
  let panel, btn;
  const isOpen = () => panel && !panel.hidden;
  function updateBadge() { if (btn) btn.textContent = Jobs.list.length ? `Geçmiş · ${Jobs.list.length}` : 'Geçmiş'; }
  function render(message) {
    if (!panel) return;
    const items = Jobs.list.map(j => {
      const when = new Date(j.ts).toLocaleString(window.I18N ? I18N.locale() : 'tr-TR', { dateStyle: 'short', timeStyle: 'short' });
      return `<li class="job-item"><div class="job-main"><strong>${esc(j.title)}</strong><small>${esc(MODULE_LABEL[j.module] || j.module)} · ${esc(when)}</small><span>${esc(j.subtitle)}</span></div><div class="job-actions"><button type="button" data-job-open="${esc(j.id)}">Aç</button><button type="button" data-job-del="${esc(j.id)}" aria-label="Sil">Sil</button></div></li>`;
    }).join('');
    $('.jobs-body', panel).innerHTML = (message ? `<p class="jobs-msg">${esc(message)}</p>` : '') + (items ? `<ul class="job-list">${items}</ul>` : '<p class="jobs-empty">Henüz kayıtlı iş yok. “Planı hazırla” dediğin her plan buraya girdileriyle birlikte kaydedilir.</p>');
    $('.jobs-count', panel).textContent = `${Jobs.list.length} / ${MAX_JOBS} iş`;
  }
  function open() { render(); panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

  function buildUi() {
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'history-button'; btn.id = 'historyButton'; btn.setAttribute('aria-expanded', 'false');
    const actions = $('.top-actions'); actions.insertBefore(btn, actions.firstChild);
    panel = document.createElement('aside'); panel.id = 'historyPanel'; panel.hidden = true; panel.setAttribute('aria-label', 'Kayıtlı işler');
    panel.innerHTML = `<div class="jobs-head"><div><strong>Kayıtlı işler</strong><small class="jobs-count"></small></div><button type="button" class="jobs-close" aria-label="Kapat">×</button></div>
      <div class="jobs-tools"><button type="button" data-jobs="export">Dışa aktar</button><label class="jobs-import">İçe aktar<input type="file" accept=".json,application/json" hidden></label><button type="button" data-jobs="clear">Tümünü sil</button></div>
      <div class="jobs-body"></div>
      <p class="jobs-note">İşler bu bilgisayarda saklanır. Yüklenen configler de kaydedilir; parola/anahtar içeren config'leri paylaşırken dışa aktarılan dosyaya dikkat edin.</p>`;
    document.body.appendChild(panel);
    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    $('.jobs-close', panel).addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
    panel.addEventListener('click', e => {
      const o = e.target.closest('[data-job-open]'), d = e.target.closest('[data-job-del]'), t = e.target.closest('[data-jobs]');
      if (o) { const rec = Jobs.list.find(j => j.id === o.dataset.jobOpen); if (rec) restore(rec); }
      if (d) { Jobs.list = Jobs.list.filter(j => j.id !== d.dataset.jobDel); persist(); updateBadge(); render(); }
      if (t && t.dataset.jobs === 'export') exportJobs();
      if (t && t.dataset.jobs === 'clear' && Jobs.list.length && window.confirm(window.I18N ? I18N.t('Tüm kayıtlı işler silinsin mi? Bu geri alınamaz.') : 'Tüm kayıtlı işler silinsin mi? Bu geri alınamaz.')) { Jobs.list = []; persist(); updateBadge(); render(); }
    });
    $('.jobs-import input', panel).addEventListener('change', e => { const f = e.target.files[0]; if (f) importJobs(f); e.target.value = ''; });
  }

  load(); buildUi(); updateBadge();

  const original = analyzePlan;
  analyzePlan = function () { original.apply(this, arguments); if (!Jobs.restoring) saveCurrent(); };
  window.NETCUBE_JOBS = Jobs;
})();
