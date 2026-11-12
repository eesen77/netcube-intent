// Dil katmanı: kaynak metinler Türkçe kalır; İngilizce seçilince ekrandaki metin
// (statik HTML + dinamik sonuçlar + rapor satırları) sözlükten çevrilir ve dil
// değişince geri alınır. Yapılandırma komutları dilden bağımsızdır, çevrilmez.
(function () {
  const EN = window.NETCUBE_EN || {};
  const KEY = 'netcube.lang';
  const exact = new Map();
  const pats = [];
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  Object.keys(EN).forEach(rawKey => {
    const prio = rawKey.charAt(0) === '^' && /\{\d+\}/.test(rawKey) ? 1 : 0;
    const k = prio ? rawKey.slice(1) : rawKey;
    if (!/\{\d+\}/.test(k)) { exact.set(k, EN[rawKey]); return; }
    let re = '^'; const idx = []; let lit = '';
    k.split(/(\{\d+\})/).forEach(part => {
      const m = part.match(/^\{(\d+)\}$/);
      if (m) { re += '([\\s\\S]*?)'; idx.push(m[1]); } else { re += escRe(part); if (part.length > lit.length) lit = part; }
    });
    pats.push({ re: new RegExp(re + '$'), idx, val: EN[rawKey], lit, prio, len: k.replace(/\{\d+\}/g, '').length });
  });
  pats.sort((a, b) => (b.prio - a.prio) || (b.len - a.len));

  let lang = 'tr';
  const cache = new Map();

  function applyPat(p, s, depth) {
    const m = s.match(p.re); if (!m) return null;
    const caps = {}; p.idx.forEach((n, i) => { caps[n] = depth < 4 ? trLine(m[i + 1], depth + 1) : m[i + 1]; });
    return p.val.replace(/\{(\d+)\}/g, (_, n) => (caps[n] !== undefined ? caps[n] : ''));
  }
  const TR_STOP = /\b(ve|veya|için|ile|yok|değil|olarak|gerekir|tanımlı|etkin|kapalı|açık|cihaz|profil|durumu|mevcut|yeni|kullan|önerildi|seçin|eksik|hazırla|sunucu|komut|bulgu)\b/i;
  const looksTurkish = x => /[çğıöşüÇĞİÖŞÜ]/.test(x) || TR_STOP.test(x);
  function splitJoin(s, sep, depth, joiner, strict) {
    const parts = s.split(sep); if (parts.length < 2) return null;
    const t = parts.map(x => trLine(x, depth + 1));
    if (strict && parts.some((x, i) => t[i] === x.trim() && looksTurkish(x))) return null;
    const out = t.join(joiner);
    return out !== s ? out : null;
  }
  function trLine(text, depth) {
    const s = text.trim();
    if (!s) return text;
    if (depth === 0 && cache.has(s)) return cache.get(s);
    let out = null;
    if (exact.has(s)) out = exact.get(s);
    // 1) öncelikli kalıplar (yapısal satırlar)
    if (out === null) for (const p of pats) { if (!p.prio) break; if (p.lit && !s.includes(p.lit)) continue; const r = applyPat(p, s, depth); if (r !== null) { out = r; break; } }
    // 2) " — " ile ayrılmış parçalar
    if (out === null && s.includes(' — ')) out = splitJoin(s, ' — ', depth, ' — ', true);
    // 3) genel kalıplar
    if (out === null) for (const p of pats) { if (p.prio) continue; if (p.lit && !s.includes(p.lit)) continue; const r = applyPat(p, s, depth); if (r !== null) { out = r; break; } }
    // 4) cümleler
    if (out === null) out = splitJoin(s, /(?<=[\p{L}\p{N})\]][.!?])\s+/u, depth, ' ');
    // 5) " · " ve ", " listeleri
    if (out === null && s.includes(' · ')) out = splitJoin(s, ' · ', depth, ' · ');
    if (out === null && s.includes(', ')) out = splitJoin(s, ', ', depth, ', ');
    if (out === null) out = s;
    if (depth === 0) { if (cache.size > 4000) cache.clear(); cache.set(s, out); }
    return out;
  }
  function trBlock(text) {
    if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(text)) return text;
    return text.split('\n').map(line => { const lead = line.match(/^\s*/)[0]; const out = trLine(line, 0); return out === line ? line : lead + out.trim(); }).join('\n');
  }
  function t(text) { return lang === 'en' ? trBlock(String(text)) : String(text); }

  // ---------- DOM ----------
  const origText = new WeakMap(); // node -> {orig, out}
  const origAttr = new WeakMap(); // el -> {attr: {orig, out}}
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
  const ATTRS = ['placeholder', 'aria-label', 'title'];

  function trTextNode(node) {
    if (lang !== 'en' || !node.parentNode || SKIP.has(node.parentNode.nodeName)) return;
    const cur = node.nodeValue; const rec = origText.get(node);
    if (rec && cur === rec.out) return;
    const out = trBlock(cur);
    if (out !== cur) { origText.set(node, { orig: cur, out }); node.nodeValue = out; }
  }
  function trAttrs(el) {
    if (lang !== 'en' || !el.getAttribute) return;
    ATTRS.forEach(a => {
      const v = el.getAttribute(a); if (v == null) return;
      const rec = (origAttr.get(el) || {})[a];
      if (rec && v === rec.out) return;
      const out = trBlock(v);
      if (out !== v) { const m = origAttr.get(el) || {}; m[a] = { orig: v, out }; origAttr.set(el, m); el.setAttribute(a, out); }
    });
  }
  function walk(root) {
    if (root.nodeType === 3) { trTextNode(root); return; }
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    trAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = tw.nextNode();
    while (n) { if (n.nodeType === 3) trTextNode(n); else if (!SKIP.has(n.nodeName)) trAttrs(n); n = tw.nextNode(); }
  }
  function restoreAll() {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = tw.nextNode();
    while (n) {
      if (n.nodeType === 3) { const r = origText.get(n); if (r && n.nodeValue === r.out) { n.nodeValue = r.orig; } origText.delete(n); }
      else { const m = origAttr.get(n); if (m) { Object.keys(m).forEach(a => { if (n.getAttribute(a) === m[a].out) n.setAttribute(a, m[a].orig); }); origAttr.delete(n); } }
      n = tw.nextNode();
    }
  }
  function translateMeta() {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      if (!meta.dataset.trOrig) meta.dataset.trOrig = meta.getAttribute('content');
      meta.setAttribute('content', lang === 'en' ? trBlock(meta.dataset.trOrig) : meta.dataset.trOrig);
    }
  }

  // ---------- örnek niyet metinleri ----------
  function syncIntent() {
    const el = document.getElementById('intentInput'); if (!el) return;
    const v = el.value.trim();
    if (lang === 'en' && EN[v] !== undefined && SAMPLES.has(v)) el.value = EN[v];
    else if (lang === 'tr') { const tr = REVERSE.get(v); if (tr) el.value = tr; }
  }
  const SAMPLES = new Set(); const REVERSE = new Map();
  (window.NETCUBE_EN_SAMPLES || []).forEach(k => { SAMPLES.add(k); if (EN[k]) REVERSE.set(EN[k], k); });

  // ---------- gözlemci ----------
  const obs = new MutationObserver(muts => {
    if (lang !== 'en') return;
    muts.forEach(m => {
      if (m.type === 'childList') m.addedNodes.forEach(n => walk(n));
      else if (m.type === 'characterData') trTextNode(m.target);
    });
  });

  function setLang(l, silent) {
    lang = l === 'en' ? 'en' : 'tr';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    if (lang === 'en') walk(document.body); else restoreAll();
    translateMeta(); syncIntent(); updateButtons();
    if (!silent) document.dispatchEvent(new CustomEvent('netcube:lang', { detail: lang }));
  }

  let btns = null;
  function updateButtons() { if (btns) Object.keys(btns).forEach(k => { btns[k].classList.toggle('active', k === lang); btns[k].setAttribute('aria-pressed', String(k === lang)); }); }
  function buildUi() {
    const wrap = document.createElement('div'); wrap.className = 'lang-switch'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Language / Dil');
    btns = {};
    [['tr', 'TR'], ['en', 'EN']].forEach(([k, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.lang = k; b.lang = k;
      b.addEventListener('click', () => { if (lang !== k) setLang(k); }); wrap.appendChild(b); btns[k] = b;
    });
    const actions = document.querySelector('.top-actions'); actions.insertBefore(wrap, actions.firstChild);
  }

  function initial() {
    try { const s = localStorage.getItem(KEY); if (s === 'tr' || s === 'en') return s; } catch (e) { /* ignore */ }
    return /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en';
  }

  window.I18N = { t, get lang() { return lang; }, setLang, locale: () => (lang === 'en' ? 'en-GB' : 'tr-TR'), _trBlock: trBlock };
  buildUi();
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  setLang(initial(), true);
})();
