const state = {
  mode: 'live',
  configs: { a: '', b: '' },
  outputDevice: 'a',
  outputPanel: 'delta',
  solution: 'vxlan',
  plan: null
};

const examples = [
  "İki cihazdaki VLAN 40'ı aynı Layer 2 ağ olarak uzat. Adı BILGI_ISLEM olsun. VNI ve gerekli loopback adreslerini sen belirle. Mevcut yapıyı bozmadan VXLAN EVPN kullan.",
  "Merkezdeki 10.10.0.0/16 ağı ile şubedeki 10.40.0.0/16 ağı dinamik routing ile haberleşsin. Merkez AS 65001, şube AS 65002. En uygun protokolü seç.",
  "10.50.0.0/16 ağına 192.168.1.1 üzerinden erişim sağla. Mevcut routing yapısına en az müdahale eden çözümü hazırla.",
  "İki lokasyon aynı kurum içinde. 10.20.0.0/16 ve 10.30.0.0/16 ağlarını duyur. Area ve router ID değerlerini mevcut config'e göre sen belirle."
];
let exampleIndex = 0;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function deviceInfo(id) {
  const card = document.querySelector(`[data-device="${id}"]`);
  return {
    vendor: $('.vendor', card).value,
    model: $('.model', card).value.trim() || 'Model belirtilmedi',
    os: $('.os', card).value.trim(),
    version: $('.version', card).value.trim(),
    config: state.configs[id]
  };
}

function vendorName(v) { return ({ cisco: 'Cisco', aruba: 'Aruba', huawei: 'Huawei' })[v] || v; }

function setMode(mode) {
  state.mode = mode;
  $$('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('#modeNote').textContent = mode === 'live'
    ? 'Canlı sistemde mevcut config analiz edilir ve yalnızca gerekli delta üretilir.'
    : 'Yeni kurulumda adres, area, AS, VNI ve router ID değerleri güvenli varsayımlarla önerilir.';
  $$('.config-zone').forEach(z => z.style.display = mode === 'live' ? 'grid' : 'none');
}

function sampleConfig(vendor, side) {
  const configs = {
    cisco: `hostname ${side === 'a' ? 'DC1-LEAF-01' : 'DC2-LEAF-01'}\n!\ninterface Loopback0\n ip address ${side === 'a' ? '10.255.0.11' : '10.255.0.12'} 255.255.255.255\n!\nrouter ospf 10\n router-id ${side === 'a' ? '10.255.0.11' : '10.255.0.12'}\n network 10.255.0.0 0.0.0.255 area 0\n!\nvlan 10\n name USERS\n!`,
    aruba: `hostname ${side === 'a' ? 'DC1-LEAF-01' : 'DC2-LEAF-01'}\ninterface loopback 0\n ip address ${side === 'a' ? '10.255.0.11' : '10.255.0.12'}/32\n!\nrouter ospf 10\n router-id ${side === 'a' ? '10.255.0.11' : '10.255.0.12'}\n area 0.0.0.0\n!\nvlan 10\n name USERS\n!`,
    huawei: `sysname ${side === 'a' ? 'DC1-LEAF-01' : 'DC2-LEAF-01'}\n#\ninterface LoopBack0\n ip address ${side === 'a' ? '10.255.0.11' : '10.255.0.12'} 255.255.255.255\n#\nospf 10 router-id ${side === 'a' ? '10.255.0.11' : '10.255.0.12'}\n area 0.0.0.0\n  network 10.255.0.0 0.0.0.255\n#\nvlan batch 10\n#`
  };
  return configs[vendor];
}

function detectIntent(text) {
  const t = text.toLocaleLowerCase('tr-TR');
  if (/vxlan|vni|layer 2|aynı vlan|vlan.*uzat|evpn/.test(t)) return 'vxlan';
  if (/static|statik|next.?hop|üzerinden eriş/.test(t)) return 'static';
  if (/eigrp/.test(t)) return 'eigrp';
  if (/bgp|farklı as|as 6\d{4}/.test(t)) return 'bgp';
  if (/ospf|area|aynı kurum|dinamik routing/.test(t)) return 'ospf';
  return 'ospf';
}

function configFacts(info) {
  const c = info.config.toLowerCase();
  return {
    ospf: /router ospf|^ospf /m.test(c),
    bgp: /router bgp|^bgp /m.test(c),
    vxlan: /vxlan|evpn|nve/.test(c),
    live: Boolean(info.config),
    hostname: (info.config.match(/(?:hostname|sysname)\s+([^\n]+)/i) || [,''])[1].trim()
  };
}

function vendorConfigs(vendor, protocol, side) {
  const ip = side === 'a' ? '10.254.0.11' : '10.254.0.12';
  const peer = side === 'a' ? '10.254.0.12' : '10.254.0.11';
  const asn = side === 'a' ? '65001' : '65002';
  const remoteAs = side === 'a' ? '65002' : '65001';
  const network = side === 'a' ? '10.10.0.0' : '10.40.0.0';
  const nextHop = side === 'a' ? '192.168.1.2' : '192.168.1.1';

  const data = {
    cisco: {
      vxlan: {
        delta: `configure terminal\n! Önerilen delta — cihaz kabiliyeti uygulanmadan önce doğrulanmalı\nvlan 40\n name BILGI_ISLEM\n!\ninterface Loopback1\n description VTEP\n ip address ${ip} 255.255.255.255\n!\nrouter bgp ${asn}\n address-family l2vpn evpn\n  neighbor ${peer} activate\n  neighbor ${peer} send-community both\n exit-address-family\n!\n! VLAN 40 → VNI 10040 eşlemesi platform profiline göre eklenir\nend`,
        verify: `show vlan id 40\nshow ip interface brief | include Loopback1\nshow bgp l2vpn evpn summary\nshow bgp l2vpn evpn\nshow platform software fed switch active vxlan`,
        rollback: `configure terminal\nrouter bgp ${asn}\n address-family l2vpn evpn\n  no neighbor ${peer} activate\n exit-address-family\nno interface Loopback1\nno vlan 40\nend`,
      },
      bgp: {
        delta: `configure terminal\nrouter bgp ${asn}\n neighbor 192.168.50.${side === 'a' ? '2' : '1'} remote-as ${remoteAs}\n address-family ipv4\n  network ${network} mask 255.255.0.0\n  neighbor 192.168.50.${side === 'a' ? '2' : '1'} activate\n exit-address-family\nend`,
        verify: `show ip route ${network}\nshow bgp ipv4 unicast summary\nshow bgp ipv4 unicast neighbors 192.168.50.${side === 'a' ? '2' : '1'} advertised-routes`,
        rollback: `configure terminal\nrouter bgp ${asn}\n no neighbor 192.168.50.${side === 'a' ? '2' : '1'}\n address-family ipv4\n  no network ${network} mask 255.255.0.0\nend`
      },
      ospf: {
        delta: `configure terminal\nrouter ospf 10\n network ${network} 0.0.255.255 area 0\nend`,
        verify: `show ip ospf neighbor\nshow ip ospf interface brief\nshow ip route ospf\nshow ip route ${network}`,
        rollback: `configure terminal\nrouter ospf 10\n no network ${network} 0.0.255.255 area 0\nend`
      },
      static: {
        delta: `configure terminal\nip route 10.50.0.0 255.255.0.0 ${nextHop}\nend`,
        verify: `show ip route ${nextHop}\nshow ip route 10.50.0.0\nshow ip cef 10.50.0.0`,
        rollback: `configure terminal\nno ip route 10.50.0.0 255.255.0.0 ${nextHop}\nend`
      },
      eigrp: {
        delta: `configure terminal\nrouter eigrp 100\n network ${network} 0.0.255.255\n passive-interface default\n no passive-interface GigabitEthernet1/0/48\nend`,
        verify: `show ip eigrp neighbors\nshow ip eigrp topology\nshow ip route eigrp`,
        rollback: `configure terminal\nrouter eigrp 100\n no network ${network} 0.0.255.255\nend`
      }
    },
    aruba: {
      vxlan: {
        delta: `configure terminal\nvlan 40\n name BILGI_ISLEM\ninterface loopback 1\n ip address ${ip}/32\n!\nrouter bgp ${asn}\n address-family l2vpn evpn\n  neighbor ${peer} activate\n  neighbor ${peer} send-community both\n exit-address-family\n!\nevpn\n vlan 40\n  rd auto\n  route-target both auto\n!\ninterface vxlan 1\n source ip ${ip}\n no shutdown`,
        verify: `show vlan 40\nshow interface loopback 1\nshow bgp l2vpn evpn summary\nshow bgp l2vpn evpn\nshow interface vxlan 1`,
        rollback: `configure terminal\nno interface vxlan 1\nno evpn\nrouter bgp ${asn}\n no address-family l2vpn evpn\nno interface loopback 1\nno vlan 40`
      },
      bgp: {
        delta: `configure terminal\nrouter bgp ${asn}\n neighbor 192.168.50.${side === 'a' ? '2' : '1'} remote-as ${remoteAs}\n address-family ipv4 unicast\n  network ${network}/16\n  neighbor 192.168.50.${side === 'a' ? '2' : '1'} activate`,
        verify: `show ip route ${network}/16\nshow bgp ipv4 unicast summary\nshow bgp ipv4 unicast`,
        rollback: `configure terminal\nrouter bgp ${asn}\n no neighbor 192.168.50.${side === 'a' ? '2' : '1'}\n address-family ipv4 unicast\n  no network ${network}/16`
      },
      ospf: {
        delta: `configure terminal\nrouter ospf 10\n area 0.0.0.0\ninterface vlan 40\n ip ospf 10 area 0.0.0.0`,
        verify: `show ip ospf neighbors\nshow ip ospf interface brief\nshow ip route ospf`,
        rollback: `configure terminal\ninterface vlan 40\n no ip ospf 10 area 0.0.0.0`
      },
      static: {
        delta: `configure terminal\nip route 10.50.0.0/16 ${nextHop}`,
        verify: `show ip route ${nextHop}\nshow ip route 10.50.0.0/16`,
        rollback: `configure terminal\nno ip route 10.50.0.0/16 ${nextHop}`
      },
      eigrp: null
    },
    huawei: {
      vxlan: {
        delta: `system-view\nvlan 40\n description BILGI_ISLEM\nquit\ninterface LoopBack1\n ip address ${ip} 255.255.255.255\nquit\nbridge-domain 40\n vxlan vni 10040\nquit\nbgp ${asn}\n peer ${peer} as-number ${remoteAs}\n l2vpn-family evpn\n  peer ${peer} enable\n  peer ${peer} advertise-community\nquit\nreturn`,
        verify: `display vlan 40\ndisplay interface LoopBack1\ndisplay bgp evpn peer\ndisplay bgp evpn routing-table\ndisplay vxlan vni`,
        rollback: `system-view\nbgp ${asn}\n undo peer ${peer}\nquit\nundo bridge-domain 40\nundo interface LoopBack1\nundo vlan 40\nreturn`
      },
      bgp: {
        delta: `system-view\nbgp ${asn}\n peer 192.168.50.${side === 'a' ? '2' : '1'} as-number ${remoteAs}\n ipv4-family unicast\n  network ${network} 255.255.0.0\n  peer 192.168.50.${side === 'a' ? '2' : '1'} enable\nquit\nreturn`,
        verify: `display ip routing-table ${network}\ndisplay bgp peer\ndisplay bgp routing-table`,
        rollback: `system-view\nbgp ${asn}\n undo peer 192.168.50.${side === 'a' ? '2' : '1'}\n ipv4-family unicast\n  undo network ${network} 255.255.0.0\nreturn`
      },
      ospf: {
        delta: `system-view\nospf 10\n area 0.0.0.0\n  network ${network} 0.0.255.255\nreturn`,
        verify: `display ospf peer brief\ndisplay ospf interface\ndisplay ip routing-table protocol ospf`,
        rollback: `system-view\nospf 10\n area 0.0.0.0\n  undo network ${network} 0.0.255.255\nreturn`
      },
      static: {
        delta: `system-view\nip route-static 10.50.0.0 255.255.0.0 ${nextHop}\nreturn`,
        verify: `display ip routing-table ${nextHop}\ndisplay ip routing-table 10.50.0.0`,
        rollback: `system-view\nundo ip route-static 10.50.0.0 255.255.0.0 ${nextHop}\nreturn`
      },
      eigrp: null
    }
  };
  return data[vendor]?.[protocol] || null;
}

function analyzePlan() {
  const intent = $('#intentInput').value.trim();
  const a = deviceInfo('a'); const b = deviceInfo('b');
  const fa = configFacts(a); const fb = configFacts(b);
  let protocol = detectIntent(intent);
  if (protocol === 'eigrp' && (a.vendor !== 'cisco' || b.vendor !== 'cisco')) protocol = 'ospf';
  const bothLoaded = fa.live && fb.live;
  const existingOspf = fa.ospf && fb.ospf;
  const definitions = {
    vxlan: { title: 'VXLAN EVPN', icon: 'VX', confidence: bothLoaded ? 94 : 86, reason: `Aynı VLAN iki farklı cihaz arasında Layer 2 olarak uzatılmak isteniyor. ${existingOspf ? 'Mevcut OSPF underlay korunuyor; ' : ''}overlay MP-BGP EVPN ile kuruluyor.`, tags: ['VLAN 40', 'VNI 10040', 'BGP EVPN', 'VTEP /32'] },
    bgp: { title: 'eBGP', icon: 'BG', confidence: bothLoaded ? 92 : 84, reason: 'Farklı AS numaraları ve kontrollü prefix ilanı istendiği için eBGP en uygun yöntem. Yalnızca belirtilen ağlar ilan ediliyor.', tags: ['AS 65001 ↔ 65002', 'IPv4 unicast', 'Prefix kontrollü'] },
    ospf: { title: 'OSPF', icon: 'OS', confidence: existingOspf ? 96 : 88, reason: `${existingOspf ? 'Her iki mevcut config içinde OSPF bulundu. ' : ''}Aynı yönetim alanındaki ağlar için minimum operasyonel yükle dinamik yönlendirme sağlıyor.`, tags: ['Process 10', 'Area 0', 'Minimum delta'] },
    static: { title: 'Static route', icon: 'SR', confidence: 97, reason: 'Tek hedef ağ ve açık bir next-hop bulunduğu için yeni bir dinamik protokol eklemeden en küçük değişiklik sağlanıyor.', tags: ['10.50.0.0/16', 'Tek next-hop', 'Düşük değişiklik'] },
    eigrp: { title: 'EIGRP', icon: 'EI', confidence: 89, reason: 'Her iki cihaz profili ve kullanıcı niyeti EIGRP ile uyumlu. Mevcut routing alanı genişletiliyor.', tags: ['AS 100', 'Named mode', 'Cisco profili'] }
  };
  const d = definitions[protocol];
  const alternatives = [
    { key: protocol, name: d.title, note: 'Önerilen · mevcut niyete en uygun', score: d.confidence, enabled: true },
    { key: protocol === 'ospf' ? 'bgp' : 'ospf', name: protocol === 'ospf' ? 'eBGP' : 'OSPF', note: 'Uygulanabilir alternatif', score: protocol === 'vxlan' ? 58 : 72, enabled: true },
    { key: 'static', name: 'Static route', note: protocol === 'static' ? 'Önerilen' : 'Küçük topolojide uygulanabilir', score: protocol === 'static' ? 97 : 54, enabled: protocol !== 'vxlan' },
    { key: 'eigrp', name: 'EIGRP', note: (a.vendor === 'cisco' && b.vendor === 'cisco') ? 'Cihaz profilleriyle uyumlu' : 'Ortak vendor desteği bulunamadı', score: (a.vendor === 'cisco' && b.vendor === 'cisco') ? 68 : 0, enabled: a.vendor === 'cisco' && b.vendor === 'cisco' }
  ];
  state.solution = protocol;
  state.plan = { intent, a, b, fa, fb, definition: d, alternatives, outputs: { a: vendorConfigs(a.vendor, protocol, 'a'), b: vendorConfigs(b.vendor, protocol, 'b') } };
  renderPlan();
}

function renderPlan() {
  const p = state.plan; const d = p.definition;
  $('#protocolIcon').textContent = d.icon;
  $('#confidence').textContent = `%${d.confidence} güven`;
  $('#solutionTitle').textContent = d.title;
  $('#solutionReason').textContent = d.reason;
  $('#planTags').innerHTML = d.tags.map(t => `<span>${t}</span>`).join('');
  const missing = [p.fa.live, p.fb.live].filter(Boolean).length;
  $('#warningBox').innerHTML = missing === 2
    ? '<b>Canlı config analiz edildi</b><span>Öneri, yüklenen snapshot üzerindeki en küçük değişiklik olarak hazırlandı.</span>'
    : `<b>${2 - missing} config eksik</b><span>Eksik cihaz için model tabanlı varsayım kullanıldı; uygulamadan önce gerçek config ile yeniden doğrulanmalı.</span>`;
  $('#alternativeList').innerHTML = p.alternatives.map((a, i) => `<div class="alternative-row"><div><strong>${a.name}</strong><small>${a.note}</small></div><div class="score-track"><i style="width:${a.score}%"></i></div><span class="score">${a.enabled ? '%' + a.score : '—'}</span><button class="alt-action" data-alt="${a.key}" ${!a.enabled || i === 0 ? 'disabled' : ''}>${i === 0 ? 'Seçili' : 'İncele'}</button></div>`).join('');
  const now = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#snapshotLabel').textContent = `Config snapshot · ${now}`;
  updateDeviceTabs(); renderOutput();
  $('#results').hidden = false;
  setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function updateDeviceTabs() {
  const p = state.plan;
  $$('#deviceTabs button').forEach(btn => {
    const info = p[btn.dataset.outputDevice];
    btn.textContent = `${btn.dataset.outputDevice.toUpperCase()} · ${vendorName(info.vendor)}`;
    btn.classList.toggle('active', btn.dataset.outputDevice === state.outputDevice);
  });
}

function analysisText(id) {
  const p = state.plan; const info = p[id]; const f = p[id === 'a' ? 'fa' : 'fb'];
  return `CİHAZ ANALİZİ\n\nVendor        : ${vendorName(info.vendor)}\nModel         : ${info.model}\nİşletim sistemi: ${info.os || 'Belirtilmedi'} ${info.version}\nConfig durumu : ${f.live ? 'Yüklendi ve tarandı' : 'Yüklenmedi — profil varsayımı'}\nHostname      : ${f.hostname || 'Tespit edilemedi'}\nMevcut OSPF   : ${f.ospf ? 'Evet' : 'Tespit edilmedi'}\nMevcut BGP    : ${f.bgp ? 'Evet' : 'Tespit edilmedi'}\nMevcut VXLAN  : ${f.vxlan ? 'Evet' : 'Tespit edilmedi'}\n\nKARAR\n${p.definition.title} önerildi. ${p.definition.reason}\n\nGÜVENLİK NOTU\nBu prototip config'i cihaza uygulamaz. Platform komutları model ve sürüm dokümanlarıyla doğrulanmadan üretimde kullanılmamalıdır.`;
}

function renderOutput() {
  const p = state.plan; if (!p) return;
  const info = p[state.outputDevice];
  const output = p.outputs[state.outputDevice];
  let text;
  if (state.outputPanel === 'analysis') text = analysisText(state.outputDevice);
  else if (!output) text = `Bu çözüm ${vendorName(info.vendor)} ${info.model} profili için uygun görünmüyor.\n\nAlternatif olarak OSPF veya BGP planı seçin.`;
  else text = output[state.outputPanel] || 'Bu bölüm için çıktı bulunamadı.';
  $('#codeOutput').textContent = text;
  $('#codeLabel').textContent = `${vendorName(info.vendor).toUpperCase()} ${info.os.toUpperCase()} · ${state.outputPanel.toUpperCase()}`;
  $$('.output-nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === state.outputPanel));
  const orders = state.solution === 'vxlan'
    ? ['Underlay erişimini ve loopback rotalarını doğrula', 'Spine/route-reflector EVPN komşuluklarını hazırla', 'Leaf VTEP ve VLAN–VNI eşleşmesini uygula', 'EVPN route ve MAC öğrenimini doğrula']
    : ['Ön kontrol komutlarını çalıştır', 'Hedef cihaz konfigürasyonunu uygula', 'Kaynak cihaz konfigürasyonunu uygula', 'Komşuluk ve route tablosunu doğrula'];
  $('#applyOrder').innerHTML = orders.map(x => `<li>${x}</li>`).join('');
}

function switchAlternative(protocol) {
  const intent = $('#intentInput').value;
  const keywords = { ospf: ' OSPF kullan.', bgp: ' AS 65001 ve AS 65002 arasında eBGP kullan.', static: ' Statik route kullan.', eigrp: ' EIGRP kullan.', vxlan: ' VXLAN EVPN kullan.' };
  $('#intentInput').value = intent.replace(/\s+(OSPF|eBGP|BGP|EIGRP|Static route|Statik route|VXLAN EVPN) kullan\.?$/i, '') + keywords[protocol];
  analyzePlan();
}

$$('.segmented button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('.vendor').forEach(select => select.addEventListener('change', e => {
  const card = e.target.closest('.device-card');
  $('.vendor-dot', card).className = `vendor-dot ${e.target.value}`;
  const presets = { cisco: ['C9300X-24Y','IOS-XE','17.12'], aruba: ['CX 6300M','AOS-CX','10.13'], huawei: ['CloudEngine S6730-H','VRP','V200R023'] };
  const x = presets[e.target.value]; $('.model',card).value=x[0]; $('.os',card).value=x[1]; $('.version',card).value=x[2];
}));
$$('.sample-config').forEach(btn => btn.addEventListener('click', () => {
  const card = btn.closest('.device-card'); const id = card.dataset.device; const vendor = $('.vendor', card).value;
  state.configs[id] = sampleConfig(vendor, id);
  const status = $('.config-status', card); status.textContent = `Örnek config · ${state.configs[id].split('\n').length} satır`; status.classList.add('loaded');
}));
$$('.config-file').forEach(input => input.addEventListener('change', async () => {
  const file = input.files[0]; if (!file) return;
  const card = input.closest('.device-card'); const id = card.dataset.device;
  state.configs[id] = await file.text();
  const status = $('.config-status', card); status.textContent = `${file.name} · ${state.configs[id].split('\n').length} satır`; status.classList.add('loaded');
}));
$('#exampleButton').addEventListener('click', () => { exampleIndex = (exampleIndex + 1) % examples.length; $('#intentInput').value = examples[exampleIndex]; });
$('#analyzeButton').addEventListener('click', () => {
  const btn = $('#analyzeButton'); btn.classList.add('loading'); btn.querySelector('span').textContent = 'Analiz ediliyor';
  setTimeout(() => { analyzePlan(); btn.classList.remove('loading'); btn.querySelector('span').textContent = 'Planı hazırla'; }, 650);
});
$('#deviceTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.outputDevice = b.dataset.outputDevice; updateDeviceTabs(); renderOutput(); });
$('.output-nav').addEventListener('click', e => { const b=e.target.closest('button'); if(!b)return; state.outputPanel=b.dataset.panel; renderOutput(); });
$('#alternativeList').addEventListener('click', e => { const b=e.target.closest('[data-alt]'); if(b && !b.disabled) switchAlternative(b.dataset.alt); });
$('#copyButton').addEventListener('click', async () => { await navigator.clipboard.writeText($('#codeOutput').textContent); $('#copyButton').textContent='Kopyalandı'; setTimeout(()=>$('#copyButton').textContent='Kopyala',1200); });
$('#themeButton').addEventListener('click', () => document.body.classList.toggle('dark'));

setMode('live');
