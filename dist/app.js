const state = {
  mode: 'live',
  module: 'routing',
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
  "İki lokasyon aynı kurum içinde. 10.20.0.0/16 ve 10.30.0.0/16 ağlarını duyur. Area ve router ID değerlerini mevcut config'e göre sen belirle.",
  "Kullanıcı portlarında 802.1X olsun, başarısız olursa MAB denensin. ClearPass kullan, telefon ve bilgisayar aynı portta çalışsın. 8 saatte reauth ve RADIUS CoA olsun.",
  "İki leaf cihazı yedekli olarak spine katmanına bağla. Boş uplink portlarını seç, 100G DAC kabloları ve etiketleriyle saha iş emri hazırla; ardından VXLAN EVPN config'ini üret."
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
    role: $('.role', card).value,
    ports: $('.ports', card).value.split(',').map(x => x.trim()).filter(Boolean),
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

function setModule(module) {
  state.module = module;
  $$('.module-picker button').forEach(b => b.classList.toggle('active', b.dataset.module === module));
  $('#securityContext').hidden = module !== 'security';
  $('#cablingContext').hidden = module !== 'cabling';
  const text = {
    routing: "İki cihazdaki VLAN 40'ı aynı Layer 2 ağ olarak uzat. Adı BILGI_ISLEM olsun. VNI ve gerekli loopback adreslerini sen belirle. Mevcut yapıyı bozmadan VXLAN EVPN kullan.",
    security: "Kullanıcı portlarında 802.1X olsun, başarısız olursa MAB denensin. ClearPass RADIUS kullan, telefon ve bilgisayar aynı portta çalışsın. 8 saatte reauth ve CoA etkin olsun.",
    cabling: "İki leaf cihazı yedekli olarak spine katmanına bağla. Boş uplink portlarını seç, 100G DAC kablo ve etiketleriyle saha iş emri hazırla. Ardından VXLAN EVPN config'ini üret."
  };
  $('#intentInput').value = text[module];
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
  if (/802\.1x|mab|radius|clearpass|cisco ise|nps|web auth|reauth|coa|secure access/.test(t)) return 'security';
  if (/kablo|portları seç|saha iş|fiziksel|dac|aoc|fiber/.test(t)) return 'cabling';
  if (/vxlan|vni|layer 2|aynı vlan|vlan.*uzat|evpn/.test(t)) return 'vxlan';
  if (/static|statik|next.?hop|üzerinden eriş/.test(t)) return 'static';
  if (/eigrp/.test(t)) return 'eigrp';
  if (/bgp|farklı as|as 6\d{4}/.test(t)) return 'bgp';
  if (/ospf|area|aynı kurum|dinamik routing/.test(t)) return 'ospf';
  return 'ospf';
}

function securityConfig(vendor, side) {
  const radius1 = ($('#radiusServers')?.value || '10.10.10.20, 10.10.10.21').split(',')[0].trim();
  const radius2 = ($('#radiusServers')?.value || '10.10.10.20, 10.10.10.21').split(',')[1]?.trim() || '10.10.10.21';
  const data = {
    cisco: {
      delta: `configure terminal\naaa new-model\nradius server NAC-1\n address ipv4 ${radius1} auth-port 1812 acct-port 1813\n key 0 <RADIUS_SECRET_FROM_VAULT>\nradius server NAC-2\n address ipv4 ${radius2} auth-port 1812 acct-port 1813\n key 0 <RADIUS_SECRET_FROM_VAULT>\naaa group server radius NAC\n server name NAC-1\n server name NAC-2\naaa authentication dot1x default group NAC\naaa authorization network default group NAC\naaa accounting dot1x default start-stop group NAC\ndot1x system-auth-control\n! Pilot port\ninterface GigabitEthernet1/0/5\n switchport mode access\n authentication host-mode multi-domain\n authentication order dot1x mab\n authentication priority dot1x mab\n authentication periodic\n authentication timer reauthenticate 28800\n mab\n dot1x pae authenticator\n spanning-tree portfast\n spanning-tree bpduguard enable\nend`,
      verify: `show aaa servers\nshow authentication sessions interface GigabitEthernet1/0/5 details\nshow dot1x interface GigabitEthernet1/0/5 details\nshow radius statistics`,
      rollback: `configure terminal\ninterface GigabitEthernet1/0/5\n no authentication periodic\n no authentication order\n no authentication priority\n no mab\n no dot1x pae authenticator\nend`
    },
    aruba: {
      delta: `configure terminal\nradius-server host ${radius1} key ciphertext <RADIUS_SECRET_FROM_VAULT>\nradius-server host ${radius2} key ciphertext <RADIUS_SECRET_FROM_VAULT>\naaa group server radius NAC\n server ${radius1}\n server ${radius2}\n! Pilot port\ninterface 1/1/5\n aaa authentication port-access dot1x authenticator\n  enable\n aaa authentication port-access mac-auth\n  enable\n aaa authentication port-access client-limit 2\n spanning-tree port-type admin-edge\n spanning-tree bpdu-guard`,
      verify: `show radius-server\nshow port-access clients interface 1/1/5 detail\nshow port-access authenticator interface 1/1/5\nshow aaa authentication port-access interface 1/1/5`,
      rollback: `configure terminal\ninterface 1/1/5\n no aaa authentication port-access dot1x authenticator\n no aaa authentication port-access mac-auth`
    },
    huawei: {
      delta: `system-view\nradius-server template NAC\n radius-server shared-key cipher <RADIUS_SECRET_FROM_VAULT>\n radius-server authentication ${radius1} 1812\n radius-server accounting ${radius1} 1813\n radius-server authentication ${radius2} 1812 secondary\nquit\ndot1x enable\ninterface GigabitEthernet0/0/5\n dot1x enable\n dot1x mac-bypass\n stp edged-port enable\n stp bpdu-protection\nquit\nreturn`,
      verify: `display radius-server configuration\ndisplay dot1x interface GigabitEthernet0/0/5\ndisplay access-user interface GigabitEthernet0/0/5`,
      rollback: `system-view\ninterface GigabitEthernet0/0/5\n undo dot1x mac-bypass\n undo dot1x enable\nquit\nreturn`
    }
  };
  return data[vendor] || null;
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
  if (protocol === 'security') return securityConfig(vendor, side);
  if (protocol === 'cabling') protocol = 'vxlan';
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
  let protocol = state.module === 'routing' ? detectIntent(intent) : state.module;
  if (protocol === 'eigrp' && (a.vendor !== 'cisco' || b.vendor !== 'cisco')) protocol = 'ospf';
  const bothLoaded = fa.live && fb.live;
  const existingOspf = fa.ospf && fb.ospf;
  const definitions = {
    vxlan: { title: 'VXLAN EVPN', icon: 'VX', confidence: bothLoaded ? 94 : 86, reason: `Aynı VLAN iki farklı cihaz arasında Layer 2 olarak uzatılmak isteniyor. ${existingOspf ? 'Mevcut OSPF underlay korunuyor; ' : ''}overlay MP-BGP EVPN ile kuruluyor.`, tags: ['VLAN 40', 'VNI 10040', 'BGP EVPN', 'VTEP /32'] },
    bgp: { title: 'eBGP', icon: 'BG', confidence: bothLoaded ? 92 : 84, reason: 'Farklı AS numaraları ve kontrollü prefix ilanı istendiği için eBGP en uygun yöntem. Yalnızca belirtilen ağlar ilan ediliyor.', tags: ['AS 65001 ↔ 65002', 'IPv4 unicast', 'Prefix kontrollü'] },
    ospf: { title: 'OSPF', icon: 'OS', confidence: existingOspf ? 96 : 88, reason: `${existingOspf ? 'Her iki mevcut config içinde OSPF bulundu. ' : ''}Aynı yönetim alanındaki ağlar için minimum operasyonel yükle dinamik yönlendirme sağlıyor.`, tags: ['Process 10', 'Area 0', 'Minimum delta'] },
    static: { title: 'Static route', icon: 'SR', confidence: 97, reason: 'Tek hedef ağ ve açık bir next-hop bulunduğu için yeni bir dinamik protokol eklemeden en küçük değişiklik sağlanıyor.', tags: ['10.50.0.0/16', 'Tek next-hop', 'Düşük değişiklik'] },
    eigrp: { title: 'EIGRP', icon: 'EI', confidence: 89, reason: 'Her iki cihaz profili ve kullanıcı niyeti EIGRP ile uyumlu. Mevcut routing alanı genişletiliyor.', tags: ['AS 100', 'Named mode', 'Cisco profili'] }
    ,security: { title: 'Secure Access + NAC', icon: 'SA', confidence: bothLoaded ? 92 : 83, reason: `${$('#nacPlatform').value} için 802.1X birincil, MAB fallback olacak şekilde pilot port politikası hazırlanıyor. RADIUS secret çıktıya yazılmıyor.`, tags: ['802.1X → MAB', 'CoA', '8 saat reauth', $('#nacPlatform').value] }
    ,cabling: { title: 'Leaf–Spine Fiziksel Plan + VXLAN EVPN', icon: 'FP', confidence: bothLoaded ? 91 : 82, reason: 'Boş olduğu beyan edilen uplink portları yedekli bağlantı için eşlendi. Kablo, port, IP ve VXLAN değişikliği aynı uygulama planında birleştirildi.', tags: [$('#linkSpeed').value, $('#mediaType').value, $('#redundancy').value, 'VNI 10040'] }
  };
  const d = definitions[protocol];
  let alternatives = [
    { key: protocol, name: d.title, note: 'Önerilen · mevcut niyete en uygun', score: d.confidence, enabled: true },
    { key: protocol === 'ospf' ? 'bgp' : 'ospf', name: protocol === 'ospf' ? 'eBGP' : 'OSPF', note: 'Uygulanabilir alternatif', score: protocol === 'vxlan' ? 58 : 72, enabled: true },
    { key: 'static', name: 'Static route', note: protocol === 'static' ? 'Önerilen' : 'Küçük topolojide uygulanabilir', score: protocol === 'static' ? 97 : 54, enabled: protocol !== 'vxlan' },
    { key: 'eigrp', name: 'EIGRP', note: (a.vendor === 'cisco' && b.vendor === 'cisco') ? 'Cihaz profilleriyle uyumlu' : 'Ortak vendor desteği bulunamadı', score: (a.vendor === 'cisco' && b.vendor === 'cisco') ? 68 : 0, enabled: a.vendor === 'cisco' && b.vendor === 'cisco' }
  ];
  if (protocol === 'security') alternatives = [
    { key:'security', name:'802.1X + MAB', note:'Önerilen · kurumsal erişim profili', score:d.confidence, enabled:true },
    { key:'security', name:'MAB only', note:'IoT/yazıcı profili · sonraki sürüm', score:64, enabled:false },
    { key:'security', name:'Web authentication', note:'Misafir profili · sonraki sürüm', score:58, enabled:false }
  ];
  if (protocol === 'cabling') alternatives = [
    { key:'cabling', name:'Çift uplink + VXLAN EVPN', note:'Önerilen · yedekli fabric bağlantısı', score:d.confidence, enabled:true },
    { key:'cabling', name:'Tek uplink', note:'Daha düşük maliyet · formdan seçilebilir', score:61, enabled:false },
    { key:'ospf', name:'Yalnız Layer 3 bağlantı', note:'L2 uzatma gerekmiyorsa daha sade', score:70, enabled:true }
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
  renderCablingPlan();
  const now = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#snapshotLabel').textContent = `Config snapshot · ${now}`;
  updateDeviceTabs(); renderOutput();
  $('#results').hidden = false;
  setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function renderCablingPlan() {
  const p = state.plan;
  const show = state.solution === 'cabling' || state.solution === 'vxlan';
  $('#cablingCard').hidden = !show;
  if (!show) return;
  const aPorts = p.a.ports.length ? p.a.ports : ['49','50'];
  const bPorts = p.b.ports.length ? p.b.ports : ['49','50'];
  const media = $('#mediaType')?.value || 'QSFP28 DAC';
  const speed = $('#linkSpeed')?.value || '100 Gbps';
  const count = ($('#redundancy')?.value || 'Çift bağlantı') === 'Tek bağlantı' ? 1 : 2;
  const rows = Array.from({length:count}, (_,i) => ({id:`CBL-${String(i+1).padStart(3,'0')}`,source:`${vendorName(p.a.vendor)} ${p.a.model}`,sp:aPorts[i]||aPorts[0],target:`${vendorName(p.b.vendor)} ${p.b.model}`,tp:bPorts[i]||bPorts[0],media:`${speed} · ${media}`}));
  $('#cableRows').innerHTML = rows.map(r => `<tr><td>${r.id}</td><td>${r.source}</td><td><code>${r.sp}</code></td><td>${r.target}</td><td><code>${r.tp}</code></td><td>${r.media}</td><td><span class="cable-state">Önerildi</span></td></tr>`).join('');
  $('#cablePlanStatus').textContent = `${rows.length} BAĞLANTI · SAHADA DOĞRULA`;
  $('#fieldOrderText').textContent = `${rows.map(r=>`${r.id}: ${r.source} port ${r.sp} → ${r.target} port ${r.tp}`).join(' · ')}`;
}

function fieldOrderText() {
  const p=state.plan; const count=($('#redundancy')?.value||'Çift bağlantı')==='Tek bağlantı'?1:2;
  const links=Array.from({length:count},(_,i)=>`${i+2}. CBL-${String(i+1).padStart(3,'0')}: ${vendorName(p.a.vendor)} ${p.a.model} port ${p.a.ports[i]||p.a.ports[0]||'49'} → ${vendorName(p.b.vendor)} ${p.b.model} port ${p.b.ports[i]||p.b.ports[0]||'49'}.`).join('\n');
  return `SAHA UYGULAMA EMRİ\n\n1. Cihaz adlarını, rack konumlarını ve portların boş olduğunu doğrulayın.\n${links}\n${count+2}. Her bağlantıda ${$('#linkSpeed')?.value||'100 Gbps'} link durumunu doğrulayın.\n${count+3}. LLDP komşularını beklenen cihaz ve portlarla karşılaştırın.\n${count+4}. Underlay komşuluğu kurulduktan sonra VXLAN/EVPN doğrulamasına geçin.\n\nKABLO: ${$('#cableLength')?.value||'3 m'} ${$('#mediaType')?.value||'QSFP28 DAC'}\nDURUM: Portlar config/envanter beyanından önerildi; fiziksel boşluk sahada doğrulanmalı.`;
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
  else if (state.outputPanel === 'field') text = fieldOrderText();
  else if (!output) text = `Bu çözüm ${vendorName(info.vendor)} ${info.model} profili için uygun görünmüyor.\n\nAlternatif olarak OSPF veya BGP planı seçin.`;
  else text = output[state.outputPanel] || 'Bu bölüm için çıktı bulunamadı.';
  $('#codeOutput').textContent = text;
  $('#codeLabel').textContent = `${vendorName(info.vendor).toUpperCase()} ${info.os.toUpperCase()} · ${state.outputPanel.toUpperCase()}`;
  $$('.output-nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === state.outputPanel));
  const orders = state.solution === 'vxlan' || state.solution === 'cabling'
    ? ['Underlay erişimini ve loopback rotalarını doğrula', 'Spine/route-reflector EVPN komşuluklarını hazırla', 'Leaf VTEP ve VLAN–VNI eşleşmesini uygula', 'EVPN route ve MAC öğrenimini doğrula']
    : state.solution === 'security'
      ? ['NAC/RADIUS politikasını hazırla', 'Tek pilot portta uygula', 'Başarılı, MAB ve RADIUS-down senaryolarını test et', 'Doğrulama sonrası port grubuna genişlet']
      : ['Ön kontrol komutlarını çalıştır', 'Hedef cihaz konfigürasyonunu uygula', 'Kaynak cihaz konfigürasyonunu uygula', 'Komşuluk ve route tablosunu doğrula'];
  $('#applyOrder').innerHTML = orders.map(x => `<li>${x}</li>`).join('');
}

function switchAlternative(protocol) {
  const intent = $('#intentInput').value;
  const keywords = { ospf: ' OSPF kullan.', bgp: ' AS 65001 ve AS 65002 arasında eBGP kullan.', static: ' Statik route kullan.', eigrp: ' EIGRP kullan.', vxlan: ' VXLAN EVPN kullan.' };
  if (!keywords[protocol]) return;
  $('#intentInput').value = intent.replace(/\s+(OSPF|eBGP|BGP|EIGRP|Static route|Statik route|VXLAN EVPN) kullan\.?$/i, '') + keywords[protocol];
  analyzePlan();
}

$$('.segmented button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('.module-picker button').forEach(b => b.addEventListener('click', () => setModule(b.dataset.module)));
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
$('#fieldOrderButton').addEventListener('click', () => { state.outputPanel='field'; renderOutput(); $('.output').scrollIntoView({behavior:'smooth',block:'start'}); });
$('#themeButton').addEventListener('click', () => document.body.classList.toggle('dark'));

setMode('live');
setModule('routing');
