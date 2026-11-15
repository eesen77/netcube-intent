// Değişiklik yönetimi katmanı: config farkı (diff), risk puanı, CR/MOP raporu, ön kontrol,
// kurumsal standart (golden config), isimlendirme standardı ve otomasyon (Ansible/Netmiko) dosyaları.
// Hepsi çevrimdışı ve statik analizdir; cihaza bağlanmaz. Risk puanı sezgiseldir.
(function () {
  const CM = {};
  const NL = String.fromCharCode(10);
  const GKEY = 'netcube.golden', NKEY = 'netcube.naming';

  // ---------- Config ayrıştırma ve fark ----------
  // Her satır, üst satırlarının yoluyla birlikte anahtarlanır; aynı komut farklı arayüz altında ayrı sayılır.
  function parse(text) {
    const out = []; const stack = [];
    String(text || '').split(/\r?\n/).forEach(raw => {
      const line = raw.replace(/\s+$/, ''); const t = line.trim();
      if (!t || /^[!#]/.test(t) || /^(end|return|quit|exit)$/i.test(t)) return;
      const ind = line.length - line.trimStart().length;
      while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
      const key = stack.map(x => x.t).concat(t).join(' > ');
      out.push({ key, s: line });
      stack.push({ ind, t });
    });
    return out;
  }

  CM.diff = function (oldText, newText) {
    const A = parse(oldText), B = parse(newText); const n = A.length, m = B.length; const ops = [];
    if (n * m > 8e6) { // çok büyük config: sıra gözetmeyen küme farkı
      const sa = new Set(A.map(x => x.key)), sb = new Set(B.map(x => x.key));
      A.forEach(x => { if (!sb.has(x.key)) ops.push({ t: '-', s: x.s }); });
      B.forEach(x => ops.push({ t: sa.has(x.key) ? '=' : '+', s: x.s }));
      return ops;
    }
    const w = m + 1; const L = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = A[i].key === B[j].key ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i].key === B[j].key) { ops.push({ t: '=', s: B[j].s }); i++; j++; }
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push({ t: '-', s: A[i].s }); i++; }
      else { ops.push({ t: '+', s: B[j].s }); j++; }
    }
    while (i < n) ops.push({ t: '-', s: A[i++].s });
    while (j < m) ops.push({ t: '+', s: B[j++].s });
    return ops;
  };

  // Yalnız eklenecek komutları üreten modüller: mevcut config'de zaten olanları '=' işaretler
  CM.deltaView = function (existing, delta) {
    const have = new Set(parse(existing).map(x => x.key));
    return parse(delta).map(x => ({ t: have.has(x.key) ? '=' : '+', s: x.s }));
  };

  CM.formatDiff = function (ops, context) {
    const c = context == null ? 2 : context; const add = ops.filter(o => o.t === '+').length, del = ops.filter(o => o.t === '-').length, same = ops.length - add - del;
    const keep = new Array(ops.length).fill(false);
    ops.forEach((o, i) => { if (o.t !== '=') for (let k = Math.max(0, i - c); k <= Math.min(ops.length - 1, i + c); k++) keep[k] = true; });
    const L = [`FARK ÖZETİ: +${add} eklenen · -${del} çıkarılan · ${same} değişmeyen satır`, ''];
    let skipped = 0;
    ops.forEach((o, i) => {
      if (!keep[i]) { skipped++; return; }
      if (skipped) { L.push(`  … ${skipped} değişmeyen satır`); skipped = 0; }
      L.push((o.t === '=' ? '  ' : o.t + ' ') + o.s);
    });
    if (skipped) L.push(`  … ${skipped} değişmeyen satır`);
    if (!add && !del) L.push('Hedef config mevcut config ile aynı; uygulanacak değişiklik yok.');
    return L.join(NL);
  };

  // Fark metnini satır başı işaretini koruyarak çevirir (dil İngilizce ise)
  CM.trDiff = function (text) {
    const I = window.I18N; if (!I || I.lang !== 'en') return text;
    return String(text).split(NL).map(l => (/^([+-]| ) /.test(l) ? l.slice(0, 2) + I.t(l.slice(2)) : I.t(l))).join(NL);
  };

  // Yan yana görünüm: '-' ve '+' blokları aynı satırlara hizalanır, uzun değişmeyen kısımlar özetlenir
  CM.sideBySideHtml = function (diffText, ops) {
    const I = window.I18N; const en = Boolean(I && I.lang === 'en'); const T = x => (en ? I.t(x) : x);
    const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = String(diffText).split(NL); const intro = T(lines[0] || ''); const sum = T(lines.find(l => l.startsWith('FARK ÖZETİ')) || '');
    const rows = []; let i = 0;
    while (i < ops.length) {
      if (ops[i].t === '=') { rows.push({ l: ops[i], r: ops[i] }); i++; continue; }
      const dels = [], adds = [];
      while (i < ops.length && ops[i].t === '-') dels.push(ops[i++]);
      while (i < ops.length && ops[i].t === '+') adds.push(ops[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ l: dels[k] || null, r: adds[k] || null });
    }
    const keep = rows.map(() => false);
    rows.forEach((r, k) => { if ((r.l && r.l.t === '-') || (r.r && r.r.t === '+')) for (let j = Math.max(0, k - 3); j <= Math.min(rows.length - 1, k + 3); j++) keep[j] = true; });
    let out = '<div class="diff-note">' + esc(intro) + '<br><b>' + esc(sum) + '</b></div><div class="sbs"><div class="sbs-head"><span>' + esc(T('Mevcut config')) + '</span><span>' + esc(T('Hedef config')) + '</span></div>';
    let skipped = 0;
    const cell = (o, cls) => '<div class="sbs-cell ' + (o ? cls : 'empty') + '">' + (o ? esc(T(o.s)) : '') + '</div>';
    rows.forEach((r, k) => {
      if (!keep[k]) { skipped++; return; }
      if (skipped) { out += '<div class="sbs-gap">… ' + skipped + ' ' + esc(T('değişmeyen satır')) + '</div>'; skipped = 0; }
      out += '<div class="sbs-row">' + cell(r.l, r.l && r.l.t === '-' ? 'del' : '') + cell(r.r, r.r && r.r.t === '+' ? 'add' : '') + '</div>';
    });
    if (skipped) out += '<div class="sbs-gap">… ' + skipped + ' ' + esc(T('değişmeyen satır')) + '</div>';
    return out + '</div>';
  };

  CM.diffFor = function (existing, out, hasFull) {
    if (!(existing || '').trim()) return 'Fark için bu cihaza running-config yükleyin (Dosya seç veya Örnek config kullan).';
    if (hasFull) return 'Mevcut config ile üretilen hedef config karşılaştırması (+ eklenir, - çıkarılır):' + NL + NL + CM.formatDiff(CM.diff(existing, out));
    const ops = CM.deltaView(existing, out); const add = ops.filter(o => o.t === '+').length;
    return 'Bu modül yalnız eklenecek komutları üretir; hiçbir mevcut satır çıkarılmaz. "+" yeni komut, boşluk ise mevcut config\'de zaten olan komuttur:' + NL + NL + CM.formatDiff(ops, 1) + (add ? '' : NL + 'Tüm komutlar zaten mevcut.');
  };

  // ---------- Risk puanı (sezgisel) ----------
  const SIGNALS = [
    { re: /^\s*(line vty|user-interface vty|aaa new-model|aaa authentication login|access-class|acl \d+ inbound)/mi, w: 15, t: 'Yönetim erişimi (AAA / VTY / ACL) değişiyor', m: 'Konsol veya OOB erişimi hazır olsun; yeni oturumda SSH erişimini doğrulamadan mevcut oturumu kapatmayın.' },
    { re: /description MANAGEMENT/i, w: 20, t: 'Yönetim VLAN\'ı / adresi değişiyor', m: 'Yönetim adresini değiştirmeden önce yeni adresten erişimi doğrulayın; reload-in veya rollback zamanlayıcısı kullanın.' },
    { re: /spanning-tree (vlan .*root|priority|mode)|^\s*stp (root|priority|mode)/mi, w: 15, t: 'STP root / öncelik değişiyor', m: 'Topoloji değişimi kısa kesintiye yol açabilir; bakım penceresinde ve önce root olacak cihazda uygulayın.' },
    { re: /switchport trunk allowed|vlan trunk allowed|port trunk allow-pass|channel-group|interface port-channel|interface lag|eth-trunk/mi, w: 15, t: 'Trunk / LAG (uplink) yapısı değişiyor', m: 'Uplinkleri sırayla değiştirin; bir uplink ayakta kalırken diğerini yapılandırın.' },
    { re: /^\s*(router (ospf|bgp|eigrp)|ospf \d|bgp \d|ip route |ip route-static)/mi, w: 12, t: 'Yönlendirme (OSPF / BGP / EIGRP / statik) değişiyor', m: 'Komşuluk ve rota sayılarını önce/sonra karşılaştırın (show ip route summary).' },
    { re: /^\s*(ip route 0\.0\.0\.0|ip route-static 0\.0\.0\.0)/mi, w: 10, t: 'Varsayılan rota değişiyor', m: 'İnternet / merkez erişimi etkilenebilir; yedek yol hazır olmadan değiştirmeyin.' },
    { re: /stackwise-virtual|^\s*vsx\b|^\s*vpc domain|dfs-group|css enable|feature vpc|stack slot/mi, w: 25, t: 'Sanallaştırma (VSS / vPC / VSX / CSS / M-LAG / stack) kuruluyor', m: 'Genellikle chassis yeniden başlatması gerekir; tek seferde tek eşi değiştirin ve dual-active tespitini doğrulayın.' },
    { re: /dot1x system-auth-control|aaa authentication port-access|dot1x enable|authentication port-control auto/mi, w: 12, t: '802.1X kimlik doğrulama zorunlu kılınıyor', m: 'Önce pilot portlarda ve monitor/open modunda deneyin; critical VLAN ve RADIUS yedeğini doğrulayın.' },
    { re: /crypto ikev2|crypto ipsec|ike proposal|ipsec policy|tunnel protection|crypto map/mi, w: 10, t: 'VPN / IPsec tüneli değişiyor', m: 'Tünel kesintisi uzak şubeleri etkiler; önce yedek hub / yol üzerinde doğrulayın.' }
  ];

  CM.risk = function (ctx) {
    const rows = []; let score = 0;
    const add = (w, t, m) => { rows.push({ w, t, m }); score += w; };
    const n = ctx.ids.length; if (n > 1) add(Math.min(20, n * 4), `${n} cihaz etkileniyor`, 'Cihazları aşamalı uygulayın; ilk cihazda doğrulama yapmadan diğerine geçmeyin.');
    if (ctx.mode === 'live') add(10, 'Canlı sistem (mevcut config üzerinde değişiklik)', 'Uygulamadan önce running-config yedeğini alın.');
    const text = ctx.added != null ? ctx.added : ctx.text;
    SIGNALS.forEach(s => { if (s.re.test(text)) add(s.w, s.t, s.m); });
    if (ctx.removed > 0) add(Math.min(20, Math.ceil(ctx.removed / 5) + 5), `${ctx.removed} mevcut satır kaldırılıyor`, 'Kaldırılan satırların kullanımda olmadığını doğrulayın; rollback için yedeği saklayın.');
    score = Math.min(100, score);
    const level = score >= 60 ? 'YÜKSEK' : score >= 30 ? 'ORTA' : 'DÜŞÜK';
    const L = ['DEĞİŞİKLİK RİSK DEĞERLENDİRMESİ', '', `Risk seviyesi: ${level} (puan ${score}/100)`, `Etkilenen cihaz: ${n}`];
    if (ctx.userPorts) L.push(`Etkilenebilecek kullanıcı portu (üst sınır): ${ctx.userPorts}`);
    L.push('', 'RİSK SİNYALLERİ');
    if (rows.length) rows.forEach(r => L.push(`- (+${r.w}) ${r.t}`)); else L.push('- Belirgin risk sinyali bulunmadı.');
    if (rows.length) { L.push('', 'AZALTMA ÖNERİLERİ'); rows.forEach(r => L.push(`- ${r.m}`)); }
    L.push('', 'NOT', 'Bu puan, üretilen komutlardaki desenlere dayanan sezgisel bir tahmindir; gerçek kesinti süresini veya etkilenen kullanıcı sayısını öngörmez. Topolojinizi ve bakım penceresini dikkate alarak kendi değerlendirmenizle birlikte kullanın.');
    return { score, level, rows, text: L.join(NL) };
  };

  // ---------- CR / MOP raporu ----------
  CM.changeRequest = function (ctx) {
    const d = new Date(); const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const L = ['DEĞİŞİKLİK TALEBİ (CR) VE UYGULAMA PROSEDÜRÜ (MOP)', '', `CR no: CHG-${ymd}-001 (örnek; ITSM numarası ile değiştirin)`, `Başlık: ${String(ctx.intent || '').replace(/\s+/g, ' ').slice(0, 110)}`,
      'Değişiklik türü: <STANDART / NORMAL / ACİL>', `Risk seviyesi: ${ctx.risk.level} (puan ${ctx.risk.score}/100, sezgisel)`, 'Planlanan pencere: <TARİH / SAAT>', 'Tahmini etki süresi: <DK>', 'Talep eden / uygulayan: <AD>', '',
      '1. ÖZET', ctx.summary || '-', '', '2. KAPSAM (ETKİLENEN CİHAZLAR)'];
    ctx.devices.forEach(x => L.push(`- ${x.name} · ${x.vendor} ${x.model}${x.role ? ' · ' + x.role : ''}`));
    L.push('', '3. ÖN KOŞULLAR', '- Etkilenen tüm cihazların running-config yedeği alındı ve saklandı.', '- Konsol / OOB yönetim erişimi doğrulandı.', '- Bakım penceresi ve ilgili ekiplerin bilgilendirilmesi onaylandı.', '- <...> yer tutucuları (parola, anahtar, adres) gerçek değerlerle dolduruldu.', '- Üretilen config laboratuvarda veya pilot cihazda doğrulandı.');
    if (ctx.preflight && ctx.preflight.length) { L.push('', '4. ÖN KONTROL BULGULARI'); ctx.preflight.forEach(x => L.push(`- ${x}`)); } else L.push('', '4. ÖN KONTROL BULGULARI', '- Statik ön kontrolde çakışma bulunmadı.');
    L.push('', '5. UYGULAMA ADIMLARI', '1. Her cihazda yedek alın.');
    ctx.devices.forEach((x, i) => L.push(`${i + 2}. ${x.name}: configs/${x.file} içeriğini uygulayın ve hemen doğrulayın.`));
    L.push(`${ctx.devices.length + 2}. Tüm cihazlarda doğrulama adımlarını çalıştırın ve sonuçları kaydedin.`, '', '6. DOĞRULAMA');
    ctx.verify.forEach(v => { L.push(`--- ${v.name} ---`, v.text); });
    L.push('', '7. GERİ DÖNÜŞ (ROLLBACK)');
    ctx.rollback.forEach(v => { L.push(`--- ${v.name} ---`, v.text); });
    L.push('', '8. GERİ DÖNÜŞ KRİTERLERİ', '- Doğrulama adımlarından biri başarısız olursa.', '- Yönetim erişimi kaybedilirse veya kritik servis etkilenirse.', '- Pencere süresi aşılırsa: <KARAR VERİCİ>', '', '9. ONAYLAR (CAB)', 'Teknik onay: <AD / TARİH>', 'Güvenlik onayı: <AD / TARİH>', 'Servis sahibi onayı: <AD / TARİH>', 'CAB kararı: <ONAY / RET>', '',
      '10. VARSAYIMLAR', 'Bu belge NetCube Intent tarafından çevrimdışı üretilmiş taslaktır. Komutlar cihaz modeli ve sürümüne göre doğrulanmalıdır; araç cihaza bağlanmaz ve hiçbir şey uygulamaz.');
    return L.join(NL);
  };

  // ---------- Ön kontrol (pre-flight) ve bağımlılık ----------
  function ipToInt(ip) { const p = String(ip).split('.').map(Number); return p.length === 4 && p.every(x => x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
  function cidr(c) { const m = String(c).match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/); if (!m) return null; const ip = ipToInt(m[1]); if (ip == null) return null; const p = Number(m[2]); const mask = p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0; const net = (ip & mask) >>> 0; return { net, end: (net | (~mask >>> 0)) >>> 0 }; }
  const overlap = (a, b) => a && b && a.net <= b.end && b.net <= a.end;

  CM.preflight = function (ctx) {
    const issues = [];
    const dup = (arr, label) => { const seen = new Map(); arr.forEach(x => { if (!x.v) return; if (seen.has(x.v)) issues.push(`${label} çakışması: ${x.v} (${seen.get(x.v)} ve ${x.n})`); else seen.set(x.v, x.n); }); };
    if (ctx.campus) {
      const inv = ctx.campus;
      dup(inv.devices.map(d => ({ v: String(d.hostname).toLowerCase(), n: d.hostname })), 'Hostname');
      dup(inv.devices.map(d => ({ v: String(d.mgmt).split('/')[0], n: d.hostname })), 'Yönetim IP');
      dup(inv.vlans.map(v => ({ v: v.id, n: 'VLAN ' + v.name })), 'VLAN ID');
      dup(inv.vlans.map(v => ({ v: String(v.name).toLowerCase(), n: 'VLAN ' + v.id })), 'VLAN adı');
      const mv = inv.vlans.find(v => /manag|yönetim|mgmt/i.test(v.name)); const mnet = mv ? cidr(ctx.mgmtCidr || '') : null;
      if (mnet) inv.devices.forEach(d => { const ip = ipToInt(String(d.mgmt).split('/')[0]); if (ip != null && (ip < mnet.net || ip > mnet.end)) issues.push(`${d.hostname}: yönetim IP'si (${d.mgmt}) yönetim alt ağının dışında`); });
    }
    if (ctx.wan) {
      const inv = ctx.wan;
      dup(inv.routers.map(r => ({ v: String(r.hostname).toLowerCase(), n: r.hostname })), 'Hostname');
      dup(inv.routers.filter(r => !r.dhcp).map(r => ({ v: r.wan, n: r.hostname })), 'WAN IP');
      const nets = inv.routers.map(r => ({ c: cidr(`${r.lanNet}/${r.lanPrefix}`), n: r.hostname }));
      for (let i = 0; i < nets.length; i++) for (let j = i + 1; j < nets.length; j++) if (overlap(nets[i].c, nets[j].c)) issues.push(`LAN alt ağı çakışması: ${nets[i].n} ve ${nets[j].n}`);
    }
    // Bağımlılık: erişim VLAN'ı, aynı cihazın trunk allowed listesinde olmalı (üretilen config'ler üzerinden)
    (ctx.configs || []).forEach(c => {
      const t = c.text; const access = new Set(), allowed = new Set(); let hasTrunk = false;
      let m; const rxA = /(?:switchport access vlan|vlan access|port default vlan)\s+(\d+)/g; while ((m = rxA.exec(t))) access.add(Number(m[1]));
      const rxT = /(?:switchport trunk allowed vlan(?: add)?|vlan trunk allowed|port trunk allow-pass vlan)\s+([\d,\s-]+)/g;
      while ((m = rxT.exec(t))) { hasTrunk = true; m[1].trim().split(/[,\s]+/).forEach(p => { const r = p.split('-').map(Number); if (r.length === 2) for (let k = r[0]; k <= r[1] && k - r[0] < 4096; k++) allowed.add(k); else if (!Number.isNaN(r[0])) allowed.add(r[0]); }); }
      if (hasTrunk && !/allowed vlan all|allowed all/.test(t)) access.forEach(v => { if (!allowed.has(v)) issues.push(`${c.name}: VLAN ${v} erişim portlarında kullanılıyor ama trunk allowed listesinde yok`); });
    });
    return issues;
  };

  // ---------- Kurumsal standart (golden config) ----------
  CM.getGolden = function () {
    try { const o = JSON.parse(localStorage.getItem(GKEY) || '{}'); return { enabled: Boolean(o.enabled), cisco: o.cisco || '', aruba: o.aruba || '', huawei: o.huawei || '' }; } catch (e) { return { enabled: false, cisco: '', aruba: '', huawei: '' }; }
  };
  CM.setGolden = function (g) { try { localStorage.setItem(GKEY, JSON.stringify(g)); } catch (e) { /* yok */ } };
  CM.inject = function (vendor, text, g) {
    if (!g || !g.enabled || typeof text !== 'string') return text;
    const block = g[vendor === 'cisco' ? 'cisco' : vendor === 'aruba' ? 'aruba' : 'huawei'] || '';
    const have = new Set(text.split(/\r?\n/).map(l => l.trim()));
    const lines = block.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim() && !have.has(l.trim()));
    if (!lines.length) return text;
    const cm = vendor === 'huawei' ? '#' : '!'; const arr = text.split(NL);
    let last = arr.length; while (last > 0 && !arr[last - 1].trim()) last--;
    const tail = last > 0 && /^(end|return)$/i.test(arr[last - 1].trim()) ? last - 1 : last;
    arr.splice(tail, 0, `${cm} ===== KURUMSAL STANDART (Golden config) =====`, ...lines);
    return arr.join(NL);
  };

  // ---------- İsimlendirme standardı ----------
  CM.getNaming = function () {
    try { const o = JSON.parse(localStorage.getItem(NKEY) || '{}'); return { pattern: o.pattern || '', site: o.site || '' }; } catch (e) { return { pattern: '', site: '', vlanUpper: false }; }
  };
  CM.setNaming = function (n) { try { localStorage.setItem(NKEY, JSON.stringify(n)); } catch (e) { /* yok */ } };
  CM.host = function (role, n, def) {
    const c = CM.getNaming(); if (!c.pattern.trim()) return def;
    const nn = String(n).padStart(2, '0');
    const out = c.pattern.replace(/\{site\}/gi, c.site || 'SITE').replace(/\{role\}/gi, role).replace(/\{nn\}/g, nn).replace(/\{n\}/g, String(n));
    return out.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase() || def;
  };

  // ---------- Otomasyon dosyaları (Ansible / Netmiko) ----------
  CM.automation = function (devices) {
    const ans = d => ({ cisco: 'cisco.ios.ios', aruba: 'arubanetworks.aoscx.aoscx', huawei: 'community.network.ce' }[d.vendor] || 'ansible.netcommon.network_cli');
    const net = d => ({ cisco: 'cisco.ios.ios', aruba: 'arubanetworks.aoscx.aoscx', huawei: 'huawei.vrp' }[d.vendor] || 'ios');
    const nm = d => ({ cisco: 'cisco_ios', aruba: 'aruba_os', huawei: 'huawei' }[d.vendor] || 'cisco_ios');
    const hosts = ['# NetCube Intent: örnek envanter. <...> değerlerini doldurun; parolaları vault ile saklayın.', 'all:', '  children:'];
    ['cisco', 'aruba', 'huawei'].forEach(v => {
      const list = devices.filter(d => d.vendor === v); if (!list.length) return;
      hosts.push(`    ${v}:`, '      vars:', `        ansible_network_os: ${net(list[0])}`, '        ansible_connection: ansible.netcommon.network_cli', '        ansible_user: <USER>', '        ansible_password: "{{ vault_device_password }}"', '      hosts:');
      list.forEach(d => hosts.push(`        ${d.name}:`, `          ansible_host: ${d.mgmt ? String(d.mgmt).split('/')[0] : '<MGMT_IP>'}`, `          cfg_file: ../${d.file}`));
    });
    const play = ['# NetCube Intent: örnek Ansible playbook. Varsayılan olarak yalnız FARK gösterir (--check --diff).',
      '# Uygulamak için: ansible-playbook -i hosts.yml site.yml   (check_mode kapalıyken değişiklik yapar)',
      '- name: NetCube Intent - Cisco', '  hosts: cisco', '  gather_facts: false', '  tasks:', '    - name: Config uygula (varsayılan dry-run)', '      cisco.ios.ios_config:', '        src: "{{ cfg_file }}"', '      check_mode: "{{ dry_run | default(true) }}"', '      diff: true', '',
      '- name: NetCube Intent - Aruba AOS-CX', '  hosts: aruba', '  gather_facts: false', '  tasks:', '    - name: Config uygula (varsayılan dry-run)', '      arubanetworks.aoscx.aoscx_config:', '        src: "{{ cfg_file }}"', '      check_mode: "{{ dry_run | default(true) }}"', '      diff: true', '',
      '- name: NetCube Intent - Huawei VRP', '  hosts: huawei', '  gather_facts: false', '  tasks:', '    - name: Config uygula (varsayılan dry-run)', '      community.network.ce_config:', '        src: "{{ cfg_file }}"', '      check_mode: "{{ dry_run | default(true) }}"', '      diff: true', '',
      '# Not: ansible_network_os ve modül adları kurulu collection sürümünüze göre doğrulanmalıdır. Uygulamak için: -e dry_run=false'];
    const py = ['#!/usr/bin/env python3', '"""NetCube Intent: örnek Netmiko betiği. Varsayılan olarak hiçbir şey göndermez (dry-run).', 'Uygulamak için --apply verin. Önce lab/pilot cihazda deneyin; cihaz yedeğini alın."""',
      'import argparse, getpass, json, pathlib', 'from netmiko import ConnectHandler', '',
      `DEVICES = ${JSON.stringify(devices.map(d => ({ name: d.name, device_type: nm(d), host: d.mgmt ? String(d.mgmt).split('/')[0] : '<MGMT_IP>', cfg: '../' + d.file })), null, 2).split(NL).join(NL)}`, '',
      'def main():', '    ap = argparse.ArgumentParser()', '    ap.add_argument("--apply", action="store_true", help="komutları gerçekten gönder")', '    ap.add_argument("--only", help="yalnız bu cihaz adı")', '    a = ap.parse_args()', '    user = input("Kullanıcı: ")', '    pw = getpass.getpass("Parola: ")',
      '    for d in DEVICES:', '        if a.only and d["name"] != a.only:', '            continue', '        lines = [l for l in pathlib.Path(__file__).parent.joinpath(d["cfg"]).read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith(("!", "#"))]',
      '        print(f"{d[\'name\']}: {len(lines)} komut" + ("" if a.apply else " (dry-run, gönderilmedi)"))', '        if not a.apply:', '            continue', '        conn = ConnectHandler(device_type=d["device_type"], host=d["host"], username=user, password=pw)',
      '        print(conn.send_config_set(lines))', '        conn.disconnect()', '', 'if __name__ == "__main__":', '    main()', ''];
    void ans;
    return [{ name: 'automation/hosts.yml', data: hosts.join(NL) + NL }, { name: 'automation/site.yml', data: play.join(NL) + NL }, { name: 'automation/push_netmiko.py', data: py.join(NL) }];
  };

  // ---------- Planı işleme: golden config, fark, ön kontrol, risk ve CR ----------
  const safeName = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
  CM.process = function (protocol, intent, ids, devsMap, outputs, notes) {
    const g = CM.getGolden(); const isNew = protocol === 'campus' || protocol === 'wan';
    const campus = protocol === 'campus' ? state.campusInv : null, wan = protocol === 'wan' ? state.wanInv : null;
    if (protocol !== 'audit') ids.forEach(i => { const o = outputs[i]; if (!o) return; ['delta', 'full'].forEach(k => { if (typeof o[k] === 'string') o[k] = CM.inject(devsMap[i].vendor, o[k], g); }); });
    let added = '', removed = 0, anyExisting = false;
    ids.forEach(i => {
      const o = outputs[i]; if (!o) return; const main = o.full || o.delta || ''; const existing = state.configs[i] || '';
      if (isNew) { o.diff = 'Yeni kurulum: karşılaştırılacak mevcut config yok; tüm komutlar eklenecektir.'; return; }
      o.diff = CM.diffFor(existing, main, Boolean(o.full));
      if (existing.trim()) o.diffOps = o.full ? CM.diff(existing, main) : CM.deltaView(existing, main);
      if (existing.trim()) { anyExisting = true; const ops = o.full ? CM.diff(existing, main) : CM.deltaView(existing, main); added += ops.filter(x => x.t === '+').map(x => x.s).join(NL) + NL; removed += ops.filter(x => x.t === '-').length; }
    });
    const nameOf = i => (devsMap[i] && devsMap[i].hostname) || `DEVICE-${i.toUpperCase()}`;
    const mainOf = i => { const o = outputs[i]; return o ? (o.full || o.delta || '') : ''; };
    const pre = CM.preflight({
      campus, wan, mgmtCidr: campus ? (() => { const ni = netInfo(managementAddress(1)); return `${ni.net}/${ni.prefix}`; })() : '',
      configs: campus ? ids.map(i => ({ name: nameOf(i), text: mainOf(i) })) : []
    });
    pre.forEach(x => notes.push(`Ön kontrol: ${x}`));
    const userPorts = campus ? campus.accesses.reduce((s, a) => s + Math.max(0, (a.ports || 0) - 4) * (a.stack || 1), 0) : 0;
    const risk = CM.risk({ ids, mode: isNew ? 'new' : state.mode, text: ids.map(mainOf).join(NL), added: anyExisting ? added : null, removed, userPorts });
    const devices = ids.map(i => ({ name: nameOf(i), vendor: vendorName(devsMap[i].vendor), model: devsMap[i].model || '', role: devsMap[i].role || '', file: safeName(nameOf(i)) + '.cfg' }));
    const cr = CM.changeRequest({ intent, summary: `${protocol.toUpperCase()}: ${intent}`, risk, devices, preflight: pre,
      verify: ids.filter(i => outputs[i] && outputs[i].verify).map(i => ({ name: nameOf(i), text: outputs[i].verify })),
      rollback: ids.filter(i => outputs[i] && outputs[i].rollback).map(i => ({ name: nameOf(i), text: outputs[i].rollback })) });
    return { risk, riskText: risk.text, crText: cr, preflight: pre };
  };

  window.NETCUBE_CM = CM;
})();
