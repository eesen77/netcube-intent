const wsStash = {};
const state = {
  ws: 'main',
  mode: 'live',
  module: 'routing',
  configs: { a: '', b: '' },
  outputDevice: 'a',
  outputPanel: 'delta',
  solution: 'vxlan',
  plan: null,
  forced: null,
  intentGuessed: false
};

const examples = [
  "İki cihazdaki VLAN 40'ı aynı Layer 2 ağ olarak uzat. Adı BILGI_ISLEM olsun. VNI ve gerekli loopback adreslerini sen belirle. Mevcut yapıyı bozmadan VXLAN EVPN kullan.",
  "Merkezdeki 10.10.0.0/16 ağı ile şubedeki 10.40.0.0/16 ağı dinamik routing ile haberleşsin. Merkez AS 65001, şube AS 65002. En uygun protokolü seç.",
  "10.50.0.0/16 ağına 192.168.1.1 üzerinden erişim sağla. Mevcut routing yapısına en az müdahale eden çözümü hazırla.",
  "İki lokasyon aynı kurum içinde. 10.20.0.0/16 ve 10.30.0.0/16 ağlarını duyur. Area ve router ID değerlerini mevcut config'e göre sen belirle.",
  "Kullanıcı portlarında 802.1X olsun, başarısız olursa MAB denensin. ClearPass kullan, telefon ve bilgisayar aynı portta çalışsın. 8 saatte reauth ve RADIUS CoA olsun.",
  "İki leaf cihazı yedekli olarak spine katmanına bağla. Boş uplink portlarını seç, 100G DAC kabloları ve etiketleriyle saha iş emri hazırla; ardından VXLAN EVPN config'ini üret."
  ,"Bu switchi kurumsal erişim switchi olarak güvenli hale getir. SSH, AAA, yönetim ACL, NTP, syslog, SNMPv3, spanning-tree korumaları ve Layer 2 güvenlik ayarlarıyla tam config hazırla."
  ,"2 core ve 4 access switch için VLAN 10 USERS, VLAN 20 VOICE, VLAN 40 BILGI_ISLEM ve VLAN 99 MANAGEMENT olacak şekilde yedekli campus topolojisi ve hardening uygulanmış tam config hazırla."
];
let exampleIndex = 0;

const $ = (s, root = document) => root.querySelector(s);
function autoHost(role, n, def) { return window.NETCUBE_CM ? window.NETCUBE_CM.host(role, n, def) : def; }
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const CATALOG = window.NETCUBE_DEVICES || [];
const CUSTOM_MODEL = '__custom';
const PROTO_NAME = { ospf: 'OSPF', bgp: 'eBGP', eigrp: 'EIGRP', static: 'Static route', vxlan: 'VXLAN EVPN', dot1x: '802.1X / MAB', dmvpn: 'DMVPN', ipsec: 'IPsec', gre: 'GRE' };
const FALLBACKS = { vxlan: ['ospf', 'bgp', 'static'], eigrp: ['ospf', 'bgp', 'static'], bgp: ['ospf', 'static'], ospf: ['bgp', 'static'], static: [] };

function catalogFor(vendor) { return CATALOG.filter(d => d.vendor === vendor); }
function findDevice(vendor, model) { return CATALOG.find(d => d.vendor === vendor && d.model === model) || null; }
function deviceCaps(info) {
  const d = findDevice(info.vendor, info.model);
  if (d) return { ...d.caps, known: true, note: d.note };
  return { ospf: true, bgp: true, eigrp: info.vendor === 'cisco', static: true, vxlan: true, dot1x: true, dmvpn: info.vendor === 'cisco', ipsec: true, gre: true, known: false, note: 'Özel model: yetenekler doğrulanamadı, varsayım kullanıldı.' };
}
function supports(info, proto) { return Boolean(deviceCaps(info)[proto]); }
function deviceLabel(info) { return `${vendorName(info.vendor)} ${info.model}`; }

function fillModelSelect(select, vendor, selected) {
  const list = catalogFor(vendor);
  select.innerHTML = list.map(d => `<option value="${d.model}">${d.model}</option>`).join('') + `<option value="${CUSTOM_MODEL}">Diğer (elle gir)…</option>`;
  select.value = list.some(d => d.model === selected) ? selected : (list[0] ? list[0].model : CUSTOM_MODEL);
}

function applyModelDefaults(card) {
  const vendor = $('.vendor', card).value; const model = $('.model', card).value;
  const d = findDevice(vendor, model);
  $('.custom-model', card).hidden = model !== CUSTOM_MODEL;
  if (d) {
    $('.os', card).value = d.os; $('.version', card).value = d.version;
    if (!$('.ports', card).dataset.touched) $('.ports', card).value = d.uplinks.join(', ');
    const roleSel = $('.role', card);
    const roleMap = { access: 'leaf', core: 'spine', router: 'distribution' };
    const wanted = d.roles.map(r => roleMap[r] || r);
    if (!wanted.includes(roleSel.value)) roleSel.value = wanted[0];
  }
  renderCaps(card);
}

function renderCaps(card) {
  const vendor = $('.vendor', card).value; const model = $('.model', card).value;
  const info = { vendor, model: model === CUSTOM_MODEL ? ($('.model-custom', card).value.trim() || 'Özel model') : model };
  const caps = deviceCaps(info);
  $('.cap-chips', card).innerHTML = (caps.ipsec !== undefined && caps.dmvpn !== undefined && !caps.vxlan && !caps.dot1x && (findDevice(vendor, info.model) || {}).roles && findDevice(vendor, info.model).roles.includes('router') ? ['ospf', 'bgp', 'eigrp', 'static', 'dmvpn', 'ipsec', 'gre'] : ['ospf', 'bgp', 'eigrp', 'static', 'vxlan', 'dot1x']).map(k => `<span class="cap ${caps[k] ? 'on' : 'off'}">${caps[k] ? '✓' : '✕'} ${PROTO_NAME[k]}</span>`).join('');
  $('.cap-note', card).textContent = caps.note || '';
}

function deviceInfo(id) {
  const card = document.querySelector(`[data-device="${id}"]`);
  const rawModel = $('.model', card).value;
  return {
    vendor: $('.vendor', card).value,
    model: (rawModel === CUSTOM_MODEL ? $('.model-custom', card).value.trim() : rawModel) || 'Model belirtilmedi',
    os: $('.os', card).value.trim(),
    version: $('.version', card).value.trim(),
    role: $('.role', card).value,
    ports: $('.ports', card).value.split(',').map(x => x.trim()).filter(Boolean),
    config: state.configs[id] || ''
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
  const prevModule = state.module; const restoringJob = Boolean(window.NETCUBE_JOBS && window.NETCUBE_JOBS.restoring);
  const wsTarget = module === 'audit' ? 'audit' : 'main';
  if (!restoringJob && wsTarget !== state.ws) { wsStash[state.ws] = captureDeviceCards(); applyDeviceCards(wsStash[wsTarget] || defaultDeviceCards(wsTarget)); }
  state.ws = wsTarget;
  if (!restoringJob && module !== prevModule) clearResults();
  state.module = module; state.forced = null;
  state.outputPanel = module === 'audit' ? 'audit' : 'delta';
  state.outputDevice = 'a';
  $$('.module-picker button').forEach(b => b.classList.toggle('active', b.dataset.module === module));
  $('#securityContext').hidden = module !== 'security';
  $('#cablingContext').hidden = module !== 'cabling';
  $('#hardeningContext').hidden = module !== 'hardening';
  $('#campusContext').hidden = module !== 'campus';
  $('#auditContext').hidden = module !== 'audit';
  $('#wanContext').hidden = module !== 'wan';
  $('.device-grid').hidden = module === 'campus' || module === 'wan';
  applyCardVisibility(module);
  const actions = $('#deviceActions'); if (actions) actions.hidden = !['routing', 'cabling', 'security', 'audit'].includes(module);
  const seg = $('.segmented'); if (seg) seg.hidden = ['audit', 'campus', 'wan'].includes(module);
  const spineHint = $('#spineHint'); if (spineHint) spineHint.hidden = !['routing', 'cabling'].includes(module);
  const navVisible = { hardening: ['full', 'audit'], campus: ['full', 'audit'], audit: ['audit'], security: ['audit'], wan: ['audit'] }[module] || [];
  $$('.hardening-only').forEach(x => { x.hidden = !navVisible.includes(x.dataset.panel); });
  const fieldBtn = $('.output-nav [data-panel="field"]'); if (fieldBtn) fieldBtn.hidden = !['routing', 'cabling'].includes(module);
  const diffBtn = $('.output-nav [data-panel="diff"]'); if (diffBtn) diffBtn.hidden = ['campus', 'wan'].includes(module);
  const auditBtn = $('.hardening-only[data-panel="audit"]'); if (auditBtn) auditBtn.textContent = ['audit', 'security'].includes(module) ? 'Denetim raporu' : 'Hardening raporu';
  if (module === 'wan' && auditBtn) auditBtn.textContent = 'Tasarım raporu';
  const deltaBtn = $('.output-nav [data-panel="delta"]'); if (deltaBtn) deltaBtn.textContent = module === 'audit' ? 'Düzeltme komutları' : module === 'wan' ? 'Router config' : 'Delta config';
  const text = {
    wan: "Merkezde 1 hub ve şubelerde 3 spoke router ile DMVPN Phase 3 kur. Overlay yönlendirme EIGRP olsun, tüneller IPsec (IKEv2, AES-256) ile korunsun.",
    audit: "Yüklediğim config'leri güvenlik açısından denetle; hardening, Layer 2 koruma, 802.1X hazırlığı ve routing güvenliği için eksikleri ve düzeltme komutlarını ver.",
    routing: "İki cihazdaki VLAN 40'ı aynı Layer 2 ağ olarak uzat. Adı BILGI_ISLEM olsun. VNI ve gerekli loopback adreslerini sen belirle. Mevcut yapıyı bozmadan VXLAN EVPN kullan.",
    security: "Kullanıcı portlarında 802.1X olsun, başarısız olursa MAB denensin. ClearPass RADIUS kullan, telefon ve bilgisayar aynı portta çalışsın. 8 saatte reauth ve CoA etkin olsun.",
    cabling: "İki leaf cihazı yedekli olarak spine katmanına bağla. Boş uplink portlarını seç, 100G DAC kablo ve etiketleriyle saha iş emri hazırla. Ardından VXLAN EVPN config'ini üret.",
    hardening: "Bu switchi kurumsal erişim switchi olarak güvenli hale getir. SSH, AAA, yönetim ACL, NTP, syslog, SNMPv3, spanning-tree korumaları ve Layer 2 güvenlik ayarlarıyla tam config hazırla.",
    campus: "2 core ve 4 access switch için VLAN 10 USERS, VLAN 20 VOICE, VLAN 40 BILGI_ISLEM ve VLAN 99 MANAGEMENT olacak şekilde yedekli campus topolojisi ve hardening uygulanmış tam config hazırla."
  };
  $('#intentInput').value = window.I18N ? I18N.t(text[module]) : text[module];
  if (module === 'audit') setMode('live');
  const modeNotes = { audit: 'Kendi running-config dosyanı yükle; seçili profillere göre denetlenir ve düzeltme komutları üretilir.', campus: 'Cihazlarını ekle; config, port planı ve topoloji niyetinden üretilir.', wan: 'Router envanterini ekle; VPN config, tünel planı ve topoloji niyetinden üretilir.' };
  if (modeNotes[module]) $('#modeNote').textContent = modeNotes[module];
  retitleCards(module);
  renderHowTo(module);
  const grid = $('.device-grid'); if (grid) grid.dataset.module = module;
  if (module === 'audit') {
    const restoring = window.NETCUBE_JOBS && window.NETCUBE_JOBS.restoring;
    $$('.device-card').forEach(c => { if (!restoring && state.configs[c.dataset.device] && !c.dataset.detected) autoDetectCard(c); renderDetectChip(c); });
  }
}

function sampleConfig(vendor, side) {
  const idx = side.charCodeAt(0) - 97;
  const host = `DC${idx + 1}-LEAF-01`, lo = `10.255.0.${11 + idx}`;
  const configs = {
    cisco: `hostname ${host}\n!\ninterface Loopback0\n ip address ${lo} 255.255.255.255\n!\nrouter ospf 10\n router-id ${lo}\n network 10.255.0.0 0.0.0.255 area 0\n!\nvlan 10\n name USERS\n!`,
    aruba: `hostname ${host}\ninterface loopback 0\n ip address ${lo}/32\n!\nrouter ospf 10\n router-id ${lo}\n area 0.0.0.0\n!\nvlan 10\n name USERS\n!`,
    huawei: `sysname ${host}\n#\ninterface LoopBack0\n ip address ${lo} 255.255.255.255\n#\nospf 10 router-id ${lo}\n area 0.0.0.0\n  network 10.255.0.0 0.0.0.255\n#\nvlan batch 10\n#`
  };
  return configs[vendor];
}

function detectIntent(text) {
  state.intentGuessed = false;
  const t = text.toLocaleLowerCase('tr-TR') + '\n' + text.toLowerCase(); // tr-TR: I -> ı olduğundan EIGRP vb. ASCII kısaltmalar için ikinci biçim şart
  if (/802\.1x|\bmab\b|radius|clearpass|cisco ise|\bnps\b|web auth|reauth|\bcoa\b|secure access|\bnac\b|dot1x|network access control/.test(t)) return 'security';
  if (/kablo|portları seç|saha iş|fiziksel|\bdac\b|\baoc\b|fiber|\bcabl|work order|field order|physical|patch panel|transceiver/.test(t)) return 'cabling';
  if (/hardening|güvenli hale|baseline|snmpv3|yönetim acl|tam config|\bharden|management acl|full config/.test(t)) return 'hardening';
  if (/campus|core.*access|switch adedi|vlan.*topoloji|core and \d+ access|\d+ core/.test(t)) return 'campus';
  if (/vxlan|\bvni\b|layer 2|aynı vlan|vlan.*uzat|evpn|same vlan|extend.*vlan|stretch.*vlan|l2 extension/.test(t)) return 'vxlan';
  if (/static|statik|next.?hop|üzerinden eriş|\bvia\s+\d|default route/.test(t)) return 'static';
  if (/eigrp/.test(t)) return 'eigrp';
  if (/bgp|farklı as|as 6\d{4}|different as|\bas number\b/.test(t)) return 'bgp';
  if (/ospf|\barea\b|aynı kurum|dinamik routing|same (?:organi[sz]ation|company|domain)|dynamic routing/.test(t)) return 'ospf';
  state.intentGuessed = true;
  return 'ospf';
}

function inputValue(id, fallback='') { return document.getElementById(id)?.value.trim() || fallback; }
function ipOnly(cidr) { return cidr.split('/')[0]; }
function maskFor(cidr) {
  const p=Number(cidr.split('/')[1]||24); const n=p===24?'255.255.255.0':p===16?'255.255.0.0':p===30?'255.255.255.252':'255.255.255.0'; return n;
}
function adminAclParts(cidr) {
  const ip=ipOnly(cidr), p=Number(cidr.split('/')[1]||24); return {ip,wildcard:p===24?'0.0.0.255':p===16?'0.0.255.255':'0.0.0.255'};
}

function hardeningAudit(info) {
  const c=info.config.toLowerCase();
  const checks=[
    ['SSH yönetimi',/ssh|stelnet/.test(c)],['Telnet kapalı',/no telnet|undo telnet|transport input ssh/.test(c)],
    ['AAA etkin',/aaa new-model|^aaa|radius-server template/m.test(c)],['Management ACL',/access-class|access-list|acl number/.test(c)],
    ['NTP',/ntp/.test(c)],['Merkezi syslog',/logging host|logging |info-center loghost/.test(c)],
    ['SNMPv3',/snmp.*v3|snmp-agent.*v3/.test(c)],['BPDU koruması',/bpduguard|bpdu-guard|bpdu-protection/.test(c)],
    ['DHCP Snooping',/dhcp snooping|dhcp-snooping/.test(c)],['ARP inspection',/arp inspection|arp anti-attack/.test(c)]
  ];
  const passed=checks.filter(x=>x[1]).length, score=info.config?Math.round(passed/checks.length*100):0;
  return `HARDENING RAPORU\n\nCihaz          : ${vendorName(info.vendor)} ${info.model}\nConfig kaynağı : ${info.config?'Yüklenen canlı config':'Config yüklenmedi — yeni kurulum profili'}\nHardening skoru: %${score}\n\nKONTROLLER\n${checks.map(([n,ok])=>`${ok?'[OK]':'[EKSİK]'} ${n}`).join('\n')}\n\nKRİTİK NOTLAR\n- Secret, parola, private key ve SNMPv3 anahtarları çıktıya yazılmaz.\n- Management ACL uygulanmadan önce mevcut yönetim kaynakları doğrulanmalıdır.\n- AAA değişikliği pilot cihazda ve aktif konsol erişimi varken uygulanmalıdır.\n- Layer 2 korumaları yalnız ilgili access VLAN/port kapsamına alınmalıdır.`;
}

function hardeningConfig(vendor, side) {
  const info=deviceInfo(side), hostname=inputValue('hardHostname','ACCESS-SW01'), vlan=inputValue('mgmtVlan','99');
  const mgmt=inputValue('mgmtIp','10.99.0.11/24'), gateway=inputValue('mgmtGateway','10.99.0.1');
  const admin=adminAclParts(inputValue('adminNetwork','10.10.10.0/24'));
  const ntps=inputValue('ntpServers','10.10.20.10, 10.10.20.11').split(',').map(x=>x.trim());
  const syslog=inputValue('syslogServer','10.10.30.20');
  const configs={
    cisco:`! NETCUBE INTENT — CISCO IOS-XE HARDENING BASELINE\nhostname ${hostname}\nno ip http server\nno ip http secure-server\nservice timestamps debug datetime msec localtime show-timezone\nservice timestamps log datetime msec localtime show-timezone\nservice password-encryption\nlogin block-for 120 attempts 3 within 60\nlogin on-failure log\nlogin on-success log\nip domain-name corp.local\nip ssh version 2\nip ssh time-out 30\nip ssh authentication-retries 3\n!\naaa new-model\nusername breakglass privilege 15 secret <LOCAL_BREAKGLASS_SECRET_FROM_VAULT>\n!\nip access-list standard MGMT_ACCESS\n permit ${admin.ip} ${admin.wildcard}\n deny any log\n!\nvlan ${vlan}\n name MANAGEMENT\ninterface Vlan${vlan}\n description MANAGEMENT_SVI\n ip address ${ipOnly(mgmt)} ${maskFor(mgmt)}\n no shutdown\nip default-gateway ${gateway}\n!\nspanning-tree mode rapid-pvst\nspanning-tree portfast default\nspanning-tree portfast bpduguard default\nvtp mode transparent\n!\nip dhcp snooping\nno ip dhcp snooping information option\n!\nntp server ${ntps[0]} prefer\nntp server ${ntps[1]||ntps[0]}\nlogging host ${syslog}\nlogging trap warnings\nlogging buffered 32768 warnings\n!\nsnmp-server view NMS-VIEW iso included\nsnmp-server group NMS-GROUP v3 priv read NMS-VIEW access MGMT_ACCESS\nsnmp-server user <SNMPV3_USER> NMS-GROUP v3 auth sha <AUTH_FROM_VAULT> priv aes 256 <PRIV_FROM_VAULT>\n!\nline console 0\n exec-timeout 10 0\n logging synchronous\n login local\nline vty 0 15\n access-class MGMT_ACCESS in\n exec-timeout 10 0\n transport input ssh\n login local\n!\nbanner motd ^CUnauthorized access is prohibited and logged.^C\nend`,
    aruba:`! NETCUBE INTENT — ARUBA AOS-CX HARDENING BASELINE\nhostname ${hostname}\nno telnet-server\nssh server vrf default\nuser breakglass group administrators password ciphertext <LOCAL_SECRET_FROM_VAULT>\n!\nvlan ${vlan}\n name MANAGEMENT\ninterface vlan ${vlan}\n ip address ${mgmt}\n no shutdown\nip route 0.0.0.0/0 ${gateway}\n!\naccess-list ip MGMT_ACCESS\n 10 permit any ${admin.ip}/${inputValue('adminNetwork','10.10.10.0/24').split('/')[1]||24} any\n 20 deny any any log\n!\nspanning-tree\nspanning-tree bpdu-guard\n!\ndhcp-snooping\n!\nntp server ${ntps[0]} iburst prefer\nntp server ${ntps[1]||ntps[0]} iburst\nlogging ${syslog}\nlogging severity warning\n!\nsnmpv3 user <SNMPV3_USER> auth sha auth-pass plaintext <AUTH_FROM_VAULT> priv aes priv-pass plaintext <PRIV_FROM_VAULT>\n!\nbanner motd ^Unauthorized access is prohibited and logged.^`,
    huawei:`# NETCUBE INTENT — HUAWEI VRP HARDENING BASELINE\nsysname ${hostname}\nundo telnet server enable\nstelnet server enable\nssh server-source all-interface\nssh server authentication-type password\n#\naaa\n local-user breakglass password irreversible-cipher <LOCAL_SECRET_FROM_VAULT>\n local-user breakglass privilege level 15\n local-user breakglass service-type ssh\nquit\n#\nacl number 2000\n rule 5 permit source ${admin.ip} ${admin.wildcard}\n rule 100 deny\nquit\n#\nvlan ${vlan}\n description MANAGEMENT\nquit\ninterface Vlanif${vlan}\n ip address ${ipOnly(mgmt)} ${maskFor(mgmt)}\nquit\nip route-static 0.0.0.0 0.0.0.0 ${gateway}\n#\nstp enable\nstp bpdu-protection\ndhcp snooping enable\n#\nntp-service unicast-server ${ntps[0]} preferred\nntp-service unicast-server ${ntps[1]||ntps[0]}\ninfo-center loghost ${syslog}\n#\nsnmp-agent\nsnmp-agent sys-info version v3\nsnmp-agent group v3 NMS privacy read-view iso-view acl 2000\nsnmp-agent usm-user v3 <SNMPV3_USER> group NMS\n#\nuser-interface vty 0 4\n acl 2000 inbound\n authentication-mode aaa\n protocol inbound ssh\n idle-timeout 10 0\nquit\nheader login information ^Unauthorized access is prohibited and logged.^\nreturn`
  };
  let full=configs[vendor];
  if (/tacacs/i.test(($('#intentInput') || {}).value || '')) full = appendTacacs(vendor, full);
  if (vendor === 'huawei') full = insertBeforeEnd(full, huaweiHardExtras());
  return {
    delta: state.mode==='new'?full:`! CANLI SİSTEM DELTA ÖNERİSİ\n! Aşağıdaki hedef baseline, mevcut config ile satır/satır birleştirilmeden uygulanmamalıdır.\n\n${full}`,
    full,
    audit: hardeningAudit(info),
    verify: vendor==='cisco'?`show running-config | section aaa|line vty|snmp|logging|ntp\nshow ip ssh\nshow login\nshow access-lists MGMT_ACCESS\nshow spanning-tree summary\nshow ip dhcp snooping`:
      vendor==='aruba'?`show running-config\nshow ssh server\nshow access-list MGMT_ACCESS\nshow ntp status\nshow logging\nshow spanning-tree\nshow dhcp-snooping`:
      `display current-configuration\ndisplay ssh server status\ndisplay acl 2000\ndisplay ntp-service status\ndisplay logbuffer\ndisplay stp brief\ndisplay dhcp snooping`,
    rollback:`ROLLBACK PRENSİBİ\n\nBu hardening paketi çok sayıda yönetim ve güvenlik alanını değiştirir.\nGüvenli rollback, yüklenen orijinal config snapshot'ının geri yüklenmesidir.\n\n1. Aktif konsol/OOB erişimini koruyun.\n2. Mevcut config'i startup-config ve harici depoya yedekleyin.\n3. AAA ve management ACL değişikliklerini ayrı commit/adımda uygulayın.\n4. Yönetim erişimi kaybolursa orijinal snapshot'ı geri yükleyin.\n\nSnapshot fingerprint: ${info.config?simpleHash(info.config):'YENİ-KURULUM'}`
  };
}

function simpleHash(text) { let h=0; for(let i=0;i<text.length;i++) h=(h*31+text.charCodeAt(i))>>>0; return h.toString(16).padStart(8,'0').toUpperCase(); }

function campusVlans() {
  return inputValue('campusVlans','10:USERS,20:VOICE,40:BILGI_ISLEM,99:MANAGEMENT').split(',').map(x=>x.trim()).filter(Boolean).map(x=>{
    const [id,...name]=x.split(':'); return {id:Number(id.trim()),name:(name.join(':').trim()||`VLAN_${id.trim()}`).replace(/\s+/g,'_')};
  }).filter(x=>Number.isInteger(x.id)&&x.id>0&&x.id<4095);
}

function gatewayAddress(vlan,host) {
  const template=inputValue('gatewayTemplate','10.{VLAN}.0.1/24').replace('{VLAN}',String(vlan));
  const [ip,prefix='24']=template.split('/'); const parts=ip.split('.'); parts[3]=String(host); return `${parts.join('.')}/${prefix}`;
}
function managementAddress(host) {
  const subnet=inputValue('campusMgmtSubnet','10.99.0.0/24'); const [ip,prefix='24']=subnet.split('/'); const parts=ip.split('.'); parts[3]=String(host); return `${parts.join('.')}/${prefix}`;
}
function isManagementVlan(v) { return /MANAGEMENT|MGMT/i.test(v.name); }

// ---------- Campus Builder: cihaz envanteri + niyet tabanlı üretim (FHRP, core sanallaştırma, access stack) ----------
function campusIsIp(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(n => Number(n) <= 255); }

function netInfo(cidr) {
  const [ip, p = '24'] = cidr.split('/'); const pre = Math.max(0, Math.min(32, Number(p)));
  const o = ip.split('.').map(Number); const bits = pre === 0 ? 0 : (0xFFFFFFFF << (32 - pre)) >>> 0;
  const n = (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
  const q = x => [24, 16, 8, 0].map(s => (x >>> s) & 255).join('.');
  return { net: q((n & bits) >>> 0), mask: q(bits), wildcard: q((~bits) >>> 0), prefix: pre };
}

// ----- yetenekler -----
const VIRT_NAME = { svl: 'StackWise Virtual (VSS)', vpc: 'vPC', vsx: 'VSX', css: 'CSS', istack: 'iStack', mlag: 'M-LAG' };
function campusIsNxos(d) { return d.vendor === 'cisco' && /^NdK|^N9K|nexus/i.test(d.model); }
function campusStackable(v, model) {
  if (v === 'cisco') return /^C9[23]/i.test(model) && !/^N/i.test(model);
  if (v === 'aruba') return /CX\s*6[23]/i.test(model);
  if (v === 'huawei') return /S5735|S5731|S5732|S6730/i.test(model);
  return false;
}
function campusVirtKind(v, model) {
  if (v === 'cisco') return /^NdK|^N9K|nexus/i.test(model) ? 'vpc' : /^C9[456]/i.test(model) ? 'svl' : null;
  if (v === 'aruba') return /CX\s*(8|9|64)/i.test(model) ? 'vsx' : null;
  if (v === 'huawei') return /S7706/i.test(model) ? 'css' : /S6730/i.test(model) ? 'istack' : /CE\d/i.test(model) ? 'mlag' : null;
  return null;
}
// FHRP: Cisco HSRP/VRRP/GLBP; Aruba ve Huawei yalnız VRRP
function campusFhrpFor(vendor, want) {
  if (want === 'none') return { kind: null };
  const def = vendor === 'cisco' ? 'hsrp' : 'vrrp';
  if (!want || want === 'auto') return { kind: def };
  if (vendor !== 'cisco' && want !== 'vrrp') return { kind: 'vrrp', note: `${vendorName(vendor)} ${want.toUpperCase()} desteklemiyor; VRRP kullanıldı.` };
  return { kind: want };
}

function campusPortName(vendor, kind, n, chassis, nxos) {
  const ch = chassis || 1;
  if (vendor === 'cisco' && nxos) return `Ethernet1/${typeof n === 'object' ? (n.slot || 1) : n}`;
  if (vendor === 'cisco') return kind === 'up' ? `TenGigabitEthernet${n.mem || 1}/1/${n.slot || n}` : `TenGigabitEthernet${ch}/0/${n}`;
  if (vendor === 'aruba') return kind === 'up' ? `${n.mem || 1}/1/${48 + (n.slot || n)}` : `1/1/${n}`;
  return kind === 'up' ? `XGigabitEthernet${(n.mem || 1) - 1}/0/${n.slot || n}` : `XGigabitEthernet${chassis ? ch : 0}/0/${n}`;
}
function campusInterPairPorts(d, chassis) {
  const ch = chassis || 1;
  if (campusIsNxos(d)) return ['Ethernet1/44', 'Ethernet1/45'];
  if (d.vendor === 'cisco') return [`TenGigabitEthernet${ch}/0/44`, `TenGigabitEthernet${ch}/0/45`];
  if (d.vendor === 'aruba') return ['1/1/44', '1/1/45'];
  return [`XGigabitEthernet${chassis ? ch : 0}/0/44`, `XGigabitEthernet${chassis ? ch : 0}/0/45`];
}
function campusInterPorts(vendor, chassis, nxos) {
  const ch = chassis || 1;
  if (vendor === 'cisco' && nxos) return ['Ethernet1/47', 'Ethernet1/48'];
  if (vendor === 'cisco') return [`TenGigabitEthernet${ch}/0/47`, `TenGigabitEthernet${ch}/0/48`];
  if (vendor === 'aruba') return ['1/1/47', '1/1/48'];
  return [`XGigabitEthernet${chassis ? ch : 0}/0/47`, `XGigabitEthernet${chassis ? ch : 0}/0/48`];
}

// ----- niyet -----
function campusFeatures(text) {
  const t = (text || '').toLocaleLowerCase('tr-TR') + '\n' + (text || '').toLowerCase();
  const no = re => re.test(t);
  const f = { hardening: true, l2sec: true, dot1x: false, ospf: false, defaultRoute: null, dhcp: false, redundancy: null, vlans: null, cores: null, accesses: null, fhrp: null, virt: false, virtWord: null, stack: 0, labels: [] };
  if (no(/hardening (yok|olmasın|istemiyorum)|without hardening|no hardening|hardening\W*(?:is )?not needed/)) f.hardening = false;
  if (no(/(snooping|dai|l2 güvenlik|layer 2 güvenlik|layer 2 security)\s*(yok|olmasın|istemiyorum)|without (dhcp )?snooping|no (dhcp )?snooping/)) f.l2sec = false;
  f.dot1x = no(/802\.1x|\bmab\b|radius|clearpass|cisco ise|\bnps\b|\bnac\b|dot1x|kimlik doğrulama|network access control/);
  f.tacacs = no(/tacacs/);
  f.ospf = no(/ospf|dynamic routing|dinamik routing|dinamik yönlendirme/);
  f.dhcp = no(/dhcp\s*(server|sunucu|havuz|pool|hizmet)|dhcp (olsun|ver)|ip dağıt|address pool|dhcp pool/);
  const ipRe = /(\d{1,3}(?:\.\d{1,3}){3})(?!\/)/g; let mm;
  while ((mm = ipRe.exec(text || '')) !== null) {
    if (!campusIsIp(mm[1])) continue;
    const ctx = (text || '').slice(Math.max(0, mm.index - 70), mm.index + mm[0].length + 70).toLowerCase();
    if (/(default route|varsayılan rota|varsayılan yol|default gateway|internet|\bwan\b|çıkış)/.test(ctx) && /(\bvia\b|üzerinden|next-?hop)/.test(ctx)) { f.defaultRoute = mm[1]; break; }
  }
  if (!f.defaultRoute && no(/default route|varsayılan rota|internet çıkış|internet access|wan çıkış/)) f.defaultRoute = '<NEXT_HOP_IP>';
  if (no(/tek uplink|single uplink|single core|tek core uplink/)) f.redundancy = 'single';
  else if (no(/çift uplink|dual uplink|dual-homed|redundant|yedekli|dual core/)) f.redundancy = 'dual';
  // FHRP
  if (no(/(fhrp|hsrp|vrrp|glbp|gateway redundancy|gateway yedekli\w*)\s*(yok|olmasın|istemiyorum|kullanma)|(no|without)\s+(fhrp|hsrp|vrrp|glbp)/)) f.fhrp = 'none';
  else if (no(/\bglbp\b/)) f.fhrp = 'glbp'; else if (no(/\bvrrp\b/)) f.fhrp = 'vrrp'; else if (no(/\bhsrp\b/)) f.fhrp = 'hsrp';
  // core sanallaştırma: VSS / StackWise Virtual / VSX / vPC / MLAG / CSS
  if (no(/\bvss\b|stackwise.?virtual|\bsvl\b|\bvsx\b|\bvpc\b|v-pc|virtual port.?channel|m-?lag|multi.?chassis|\bcss\b|cluster switch|virtual chassis|core\w*.{0,30}\bstack|\bstack\w*.{0,30}core/)) f.virt = true;
  if (no(/\bvpc\b|v-pc|virtual port.?channel/)) f.virtWord = 'vpc';
  // access stack
  if (no(/\bstack|stackwise(?!.?virtual)|\bvsf\b|istack/) && !no(/core\w*.{0,30}\bstack|\bstack\w*.{0,30}core/) && !no(/stackwise.?virtual/) || no(/\bvsf\b|istack/)) {
    const sm = t.match(/(\d)\s*(?:'|’)?(?:li|lı|lu|lü)?\s*(?:switch(?:ler)?\s*)?(?:stack|üyeli)|stack of (\d)|(\d)\s*(?:member|üye)/);
    f.stack = sm ? Math.max(2, Math.min(4, Number(sm[1] || sm[2] || sm[3]))) : 2;
  }
  const vm = (text || '').match(/vlan\s*(\d{1,4})\s*[:\-]?\s*([A-Za-z][A-Za-z0-9_]{1,24})?/gi);
  const seen = new Map(); let m; const re = /vlan\s*(\d{1,4})\s*[:\-]?\s*([A-Za-z][A-Za-z0-9_]{1,24})?/gi;
  while ((m = re.exec(text || '')) !== null) { const id = Number(m[1]); if (id > 0 && id < 4095 && !seen.has(id)) seen.set(id, m[2] && m[2] === m[2].toUpperCase() ? m[2] : `VLAN_${id}`); }
  if (seen.size >= 2) f.vlans = [...seen.entries()].map(([id, name]) => ({ id, name }));
  const c = (text || '').match(/(\d{1,2})\s*(?:adet\s*)?core/i), a = (text || '').match(/(\d{1,2})\s*(?:adet\s*)?access/i);
  if (c) f.cores = Math.max(1, Math.min(4, Number(c[1]))); if (a) f.accesses = Math.max(1, Math.min(24, Number(a[1])));
  const L = f.labels;
  if (f.hardening) L.push('hardening'); if (f.l2sec) L.push('Layer 2 koruma'); if (f.dot1x) L.push('802.1X / MAB'); if (f.tacacs) L.push('TACACS+'); if (f.ospf) L.push('OSPF');
  if (f.defaultRoute) L.push('varsayılan rota'); if (f.dhcp) L.push('DHCP sunucusu'); if (f.redundancy) L.push(f.redundancy === 'single' ? 'tek uplink' : 'çift uplink');
  void vm;
  return f;
}

function campusApplyIntent() {
  const f = campusFeatures(($('#intentInput') || {}).value || '');
  state.campusFeatures = f;
  const msgs = [];
  if (f.vlans) {
    const txt = f.vlans.map(v => `${v.id}:${v.name}`).join(', ');
    const el = $('#campusVlans'); if (el && el.value.trim() !== txt) { el.value = txt; msgs.push('VLAN listesi niyetten alındı'); }
  }
  if (f.redundancy) { const el = $('#campusRedundancy'); if (el) el.value = f.redundancy === 'single' ? 'single' : 'dual'; }
  const put = (id, val, msg) => { const el = $('#' + id); if (el && el.value !== val) { el.value = val; msgs.push(msg); } };
  if (f.fhrp) put('campusFhrp', f.fhrp, `gateway yedekliliği: ${f.fhrp.toUpperCase()}`);
  if (f.virt) put('campusVirt', 'on', 'core sanallaştırma açıldı');
  if (f.stack) put('campusStack', String(f.stack), `access stack: ${f.stack} üyeli`);
  if ((f.cores || f.accesses) && !state.campusTouched) {
    const nc = state.campus.filter(r => r.role === 'core').length, na = state.campus.filter(r => r.role !== 'core').length;
    const wc = f.cores || nc, wa = f.accesses || na;
    if (wc !== nc || wa !== na) {
      const lc = state.campus.filter(r => r.role === 'core').at(-1) || { vendor: 'cisco', model: undefined };
      const la = state.campus.filter(r => r.role !== 'core').at(-1) || { vendor: 'cisco', model: undefined };
      const cores = state.campus.filter(r => r.role === 'core').slice(0, wc); while (cores.length < wc) cores.push(newCampusRow('core', lc.vendor, lc.model));
      const accs = state.campus.filter(r => r.role !== 'core').slice(0, wa); while (accs.length < wa) accs.push(newCampusRow('access', la.vendor, la.model));
      state.campus = [...cores, ...accs]; renderCampusRows(); msgs.push(`cihaz sayısı niyetten alındı (${wc} core, ${wa} access)`);
    }
  }
  state.campusIntentMsgs = msgs;
  return f;
}

// ----- envanter -----
function campusPairInfo(inv, c) {
  if (!inv.virt) return null;
  for (let i = 0; i < inv.virt.pairs.length; i++) { const p = inv.virt.pairs[i]; if (p.a === c) return { pair: p, i, chassis: 1, peer: p.b }; if (p.b === c) return { pair: p, i, chassis: 2, peer: p.a }; }
  return null;
}
// Çok katmanlı (4 core): ilk çift gateway/core, ikinci çift aggregation (L2); tek çiftte çift gateway'dir
function campusIsGw(inv, c) { const pi = campusPairInfo(inv, c); return !pi || !inv.virt.layered || pi.i === 0; }

function campusInventory() {
  const rows = state.campus && state.campus.length ? state.campus : defaultCampusRows();
  const f = state.campusFeatures || campusFeatures('');
  const notes = []; const seen = new Set();
  const mk = (r, idx) => {
    const role = r.role;
    const model = (r.model === CUSTOM_MODEL ? (r.custom || '').trim() : r.model) || (catalogFor(r.vendor)[0] || {}).model || (role === 'core' ? 'Core' : 'Access');
    const hostTyped = (r.hostname || '').trim().replace(/\s+/g, '-');
    const hostname = hostTyped || autoHost(role, idx + 1, `${role === 'core' ? 'CORE' : 'ACCESS'}-${String(idx + 1).padStart(2, '0')}`);
    let mgmt = managementAddress(role === 'core' ? idx + 2 : 20 + idx); let mgmtTyped = false;
    const typed = (r.mgmt || '').trim();
    if (typed) { const ip = typed.split('/')[0]; if (campusIsIp(ip)) { mgmt = `${ip}/${managementAddress(1).split('/')[1] || '24'}`; mgmtTyped = true; } else notes.push(`${hostname}: yönetim IP '${typed}' geçersiz; otomatik adres kullanıldı.`); }
    return { id: r.id, role, idx, vendor: r.vendor, model, hostname, hostTyped: Boolean(hostTyped), mgmt, mgmtTyped, ports: Number(r.ports) || 48, os: campusIsNxos({ vendor: r.vendor, model }) ? 'NX-OS' : OS_BY_VENDOR[r.vendor], version: 'Profil tabanlı', config: '' };
  };
  const cores = rows.filter(r => r.role === 'core').map((r, i) => mk(r, i));
  const accPhys = rows.filter(r => r.role !== 'core').map((r, i) => mk(r, i));
  const fhrpSel = inputValue('campusFhrp', 'auto'); const virtSel = inputValue('campusVirt', 'none') === 'on'; const stackN = Math.max(0, Math.min(4, Number(inputValue('campusStack', '0')) || 0));

  // core sanallaştırma: 2 core = tek çift; 4 core = iki çift (çok katmanlı, çift taraflı çok-şasili LAG)
  let virt = null;
  if (virtSel) {
    if (cores.length !== 2 && cores.length !== 4) notes.push('Core sanallaştırma için 2 core (tek çift) veya 4 core (iki çift, çok katmanlı) gerekir; FHRP ile devam edildi.');
    else {
      const pairs = []; const kinds = new Set(); let ok = true;
      for (let i = 0; i < cores.length && ok; i += 2) {
        const a = cores[i], b = cores[i + 1];
        if (a.vendor !== b.vendor) { ok = false; notes.push(`${a.hostname} / ${b.hostname} farklı üreticiden; sanallaştırma kurulamadı, FHRP ile devam edildi.`); break; }
        const ka = campusVirtKind(a.vendor, a.model), kb = campusVirtKind(b.vendor, b.model);
        if (!ka || ka !== kb) { ok = false; notes.push(`${a.model} / ${b.model} sanallaştırmayı desteklemiyor veya modeller aynı türde değil; FHRP ile devam edildi.`); break; }
        kinds.add(ka); pairs.push({ a, b });
      }
      if (ok && kinds.size === 1) virt = { kind: [...kinds][0], pairs, layered: pairs.length === 2 };
      else if (ok) notes.push('İki çift farklı sanallaştırma türünde; kurulamadı, FHRP ile devam edildi.');
    }
  }
  if (f.virtWord === 'vpc' && cores[0] && cores[0].vendor === 'cisco' && !(virt && virt.kind === 'vpc')) notes.push('vPC yalnızca Nexus (NX-OS) cihazlarda bulunur; Catalyst core\'larda StackWise Virtual (VSS) kullanıldı. vPC için core modelini Nexus seçin.');
  else if (f.virtWord === 'vpc' && virt && virt.kind !== 'vpc') notes.push(`vPC yerine bu üreticinin karşılığı (${VIRT_NAME[virt.kind]}) kullanıldı.`);
  if (virt && virt.layered) notes.push('Dört core: ilk çift gateway/core, ikinci çift aggregation (yalnız L2); iki çift arasında çift taraflı (double-sided) çok-şasili LAG kuruldu, access\'ler aggregation çiftine bağlandı.');
  if (virt && virt.kind === 'vpc' && cores.some(c => !campusIsNxos(c))) notes.push('vPC çiftlerinde Nexus dışı model var; kurulamadı.');

  // FHRP: tek çift SVL/VSX/M-LAG/CSS'de gerekmez; vPC (Nexus) ve çiftsiz tasarımda kullanılır
  const useFhrp = !virt || virt.kind === 'vpc' || virt.kind === 'mlag';
  const fhrp = useFhrp ? fhrpSel : null;
  if (useFhrp && cores.length) { const sv = new Set(); cores.forEach(c => { if (sv.has(c.vendor)) return; sv.add(c.vendor); const e = campusFhrpFor(c.vendor, fhrpSel); if (e.note) notes.push(e.note); }); }
  if (useFhrp && fhrpSel === 'glbp' && cores.some(c => campusIsNxos(c))) notes.push('GLBP, NX-OS vPC ile desteklenmez; HSRP kullanıldı.');
  if (useFhrp && fhrpSel === 'none') notes.push('FHRP istenmedi: sanal gateway adresi yok; istemcilere core\'lardan birinin gerçek adresi verilir.');

  // access stack
  const logical = []; let ai = 0; const grouped = stackN >= 2;
  while (ai < accPhys.length) {
    const first = accPhys[ai]; const members = [first]; let j = ai + 1;
    if (grouped) {
      if (!campusStackable(first.vendor, first.model)) notes.push(`${first.model} stack desteklemiyor; ayrı switch olarak bırakıldı.`);
      else while (j < accPhys.length && members.length < stackN && accPhys[j].vendor === first.vendor && accPhys[j].model === first.model) { members.push(accPhys[j]); j++; }
    }
    const li = logical.length; const L = { ...first, members, stack: members.length, idx: li };
    if (!first.hostTyped) L.hostname = autoHost('access', li + 1, `ACCESS-${String(li + 1).padStart(2, '0')}`);
    if (!first.mgmtTyped) L.mgmt = managementAddress(20 + li);
    logical.push(L); ai = members.length > 1 ? j : ai + 1;
  }
  logical.forEach(a => { if (seen.has(a.hostname)) notes.push(`Hostname ${a.hostname} birden fazla cihazda kullanılıyor.`); seen.add(a.hostname); });
  cores.forEach(c => { if (seen.has(c.hostname)) notes.push(`Hostname ${c.hostname} birden fazla cihazda kullanılıyor.`); seen.add(c.hostname); });
  if (grouped) notes.push(`Access stack: ${logical.filter(a => a.stack > 1).length} stack grubu (en fazla ${stackN} üye), ${logical.filter(a => a.stack === 1).length} tekil switch.`);

  const wantDual = inputValue('campusRedundancy', 'dual') === 'dual';
  const dual = wantDual && cores.length > 1;
  if (wantDual && cores.length === 1) notes.push('Tek core olduğu için çift uplink kurulamadı; her access tek core uplink kullanıyor.');

  // bağlantı planı
  const links = []; const used = {}; cores.forEach(c => { used[c.id] = 0; });
  const inv0 = { virt };
  const chassisOf = c => { const pi = campusPairInfo(inv0, c); return pi ? pi.chassis : 0; };
  const aggPair = virt ? virt.pairs[virt.layered ? 1 : 0] : null;
  logical.forEach((a, k) => {
    const m = a.members.length;
    if (virt) {
      const targets = dual ? [aggPair.a, aggPair.b] : [aggPair.a];
      for (let mi = 1; mi <= m; mi++) targets.forEach((c, ti) => { used[c.id]++; links.push({ access: a, core: c, u: ti, mem: mi, lag: k + 1, aPort: campusPortName(a.vendor, 'up', { mem: mi, slot: ti + 1 }), cPort: campusPortName(c.vendor, 'down', used[c.id], chassisOf(c) || 1, campusIsNxos(c)) }); });
    } else {
      const targets = dual ? [cores[k % cores.length], cores[(k + 1) % cores.length]] : [cores[k % cores.length]];
      targets.forEach((c, u) => { const mi = Math.min(u + 1, m); used[c.id]++; links.push({ access: a, core: c, u, mem: mi, lag: null, aPort: campusPortName(a.vendor, 'up', { mem: mi, slot: m === 1 ? u + 1 : 1 }), cPort: campusPortName(c.vendor, 'down', used[c.id], 1, campusIsNxos(c)) }); });
    }
  });
  // iki çift arası çift taraflı LAG (4 fiziksel bağlantı)
  const interLinks = [];
  if (virt && virt.layered) {
    const [P, Q] = virt.pairs; const pp = c => campusInterPairPorts(c, chassisOf(c));
    [[P.a, 0, Q.a, 0], [P.a, 1, Q.b, 0], [P.b, 0, Q.a, 1], [P.b, 1, Q.b, 1]].forEach(([x, xi, y, yi]) => interLinks.push({ x, y, xPort: pp(x)[xi], yPort: pp(y)[yi] }));
  }
  const interlink = !virt && cores.length >= 2 && fhrpSel !== 'none' ? { a: cores[0], b: cores[1] } : null;
  if (!virt && cores.length > 2) notes.push('2\'den fazla core için yalnızca ilk ikisi arasında inter-core bağlantı tanımlandı.');

  (state.campusIntentMsgs || []).forEach(m => notes.push(`Niyetten: ${m}.`));
  const labels = [...f.labels];
  if (virt) labels.push(virt.layered ? `${VIRT_NAME[virt.kind]} (2 çift, çok katmanlı)` : VIRT_NAME[virt.kind]);
  else if (fhrpSel !== 'none' && cores.length > 1) labels.push(`FHRP: ${(campusFhrpFor(cores[0].vendor, fhrpSel).kind || '').toUpperCase()}`);
  if (virt && virt.kind === 'vpc' && fhrpSel !== 'none') labels.push(`FHRP: ${(fhrpSel === 'auto' || fhrpSel === 'glbp' ? 'hsrp' : fhrpSel).toUpperCase()}`);
  if (grouped && logical.some(a => a.stack > 1)) labels.push(`access stack (${stackN} üyeli)`);
  notes.push(labels.length ? `Niyetten algılanan özellikler: ${labels.join(', ')}.` : 'Niyette ek özellik bulunamadı; temel paket üretildi.');
  return { devices: [...cores, ...logical], cores, accesses: logical, accPhys, links, interLinks, vlans: campusVlans(), dual, f: { ...f, labels }, virt, fhrp, interlink, stackN, coreCount: cores.length, accessCount: logical.length, accessPhysCount: accPhys.length, notes };
}

function campusLinksOf(inv, d) { return inv.links.filter(l => (d.role === 'core' ? l.core.id : l.access.id) === d.id); }
function campusRadius() { return (inputValue('radiusServers', '10.10.10.20, 10.10.10.21').split(',').map(x => x.trim()).filter(Boolean)); }
function campusDnsHint() { return '<DNS_IP>'; }
const hex2 = n => (n % 256).toString(16).padStart(2, '0');

// ----- Cisco Nexus (NX-OS): vPC, çok katmanlı vPC (çift taraflı) -----
function campusNxosDevice(d, inv) {
  const f = inv.f; const vlanIds = inv.vlans.map(v => v.id).join(','); const pi = campusPairInfo(inv, d);
  const gw = campusIsGw(inv, d); const idx = pi ? pi.i : 0;
  const fk = inv.fhrp === 'none' ? null : (inv.fhrp === 'vrrp' ? 'vrrp' : 'hsrp');
  const protectedIds = inv.vlans.filter(v => !isManagementVlan(v)).map(v => v.id);
  const mine = campusLinksOf(inv, d);
  const L = [`! ===== ${d.hostname} · ${d.model} · NX-OS${pi ? ` · vPC (domain ${idx + 1})` : ''} =====`, '! Arayüz adlarını model ve port numaralandırmasına göre doğrulayın', `hostname ${d.hostname}`, 'feature ssh', 'no feature telnet', 'feature lacp', 'feature interface-vlan'];
  if (pi) L.push('feature vpc');
  if (gw && fk === 'hsrp') L.push('feature hsrp'); if (gw && fk === 'vrrp') L.push('feature vrrp');
  if (gw && f.ospf) L.push('feature ospf'); if (gw && f.dhcp) L.push('feature dhcp', 'ip dhcp relay');
  if (f.hardening) L.push('ntp server 10.10.20.10 use-vrf management', 'logging server 10.10.30.20', 'username breakglass password <LOCAL_SECRET_FROM_VAULT> role network-admin', 'snmp-server user <SNMPV3_USER> network-admin auth sha <AUTH_FROM_VAULT> priv aes-128 <PRIV_FROM_VAULT>');
  const prio = pi ? (idx === 0 ? 4096 : 8192) : (d.idx === 0 ? 4096 : d.idx === 1 ? 8192 : 0);
  L.push('spanning-tree mode rapid-pvst', ...(prio ? [`spanning-tree vlan ${vlanIds} priority ${prio}`] : []));
  inv.vlans.forEach(v => L.push(`vlan ${v.id}`, ` name ${v.name}`));
  L.push('interface mgmt0', ' vrf member management', ` ip address ${d.mgmt}`);
  if (pi) {
    L.push(`vpc domain ${idx + 1}`, ' peer-switch', ` role priority ${d === pi.pair.a ? 100 : 200}`, ` peer-keepalive destination ${ipOnly(pi.peer.mgmt)} source ${ipOnly(d.mgmt)} vrf management`, ' peer-gateway', ' auto-recovery', ' ip arp synchronize',
      'interface port-channel1000', ' description VPC-PEER-LINK', ' switchport mode trunk', ' vpc peer-link');
    campusInterPorts('cisco', 0, true).forEach(p => L.push(`interface ${p}`, ' description VPC-PEER-LINK', ' switchport mode trunk', ' channel-group 1000 mode active'));
  }
  if (gw) {
    inv.vlans.forEach(v => {
      const mg = isManagementVlan(v); const vip = mg ? managementAddress(1) : gatewayAddress(v.id, 1); const pip = mg ? d.mgmt : gatewayAddress(v.id, (pi ? (d === pi.pair.a ? 0 : 1) : d.idx) + 2); const g = v.id % 256 || 1; const pr = (pi ? d === pi.pair.a : d.idx === 0) ? 110 : 100;
      L.push(`interface Vlan${v.id}`, ' no shutdown', ` description GW_${v.name}`, ` ip address ${ipOnly(pip)}/${netInfo(pip).prefix}`);
      if (fk === 'hsrp') L.push(` hsrp ${g}`, `  ip ${ipOnly(vip)}`, `  priority ${pr}`, '  preempt');
      if (fk === 'vrrp') L.push(` vrrp ${g}`, `  address ${ipOnly(vip)}`, `  priority ${pr}`, '  no shutdown');
      if (f.ospf) L.push(' ip router ospf 10 area 0.0.0.0');
      if (f.dhcp) L.push(' ip dhcp relay address <DHCP_SERVER_IP>');
    });
  }
  const lagBlock = (lag, desc, vpc) => ['interface port-channel' + lag, ` description ${desc}`, ' switchport mode trunk', ` switchport trunk allowed vlan ${vlanIds}`, ...(vpc ? [` vpc ${lag}`] : [])];
  const member = (port, desc, lag) => [`interface ${port}`, ` description ${desc}`, ' switchport mode trunk', ` channel-group ${lag} mode active`];
  if (pi) {
    const ids = new Set([pi.pair.a.id, pi.pair.b.id]);
    [...new Set(inv.links.filter(l => ids.has(l.core.id)).map(l => l.lag))].forEach(lag => { const acc = inv.links.find(l => l.lag === lag).access; L.push(...lagBlock(lag, `MEC${lag}-${acc.hostname}`, true)); inv.links.filter(l => l.lag === lag && l.core.id === d.id).forEach(l => L.push(...member(l.cPort, `MEC${lag}-${l.access.hostname}-${l.aPort}`, lag))); });
    if (inv.virt.layered) { L.push(...lagBlock(200, 'DOUBLE-SIDED-VPC-INTER-PAIR', true)); inv.interLinks.forEach(il => { if (il.x.id === d.id) L.push(...member(il.xPort, `MEC200-${il.y.hostname}`, 200)); if (il.y.id === d.id) L.push(...member(il.yPort, `MEC200-${il.x.hostname}`, 200)); }); }
  } else {
    mine.forEach(l => L.push(`interface ${l.cPort}`, ` description TO-${l.access.hostname}-${l.aPort}`, ' switchport mode trunk', ` switchport trunk allowed vlan ${vlanIds}`, ' no shutdown'));
    if (inv.interlink && (d === inv.interlink.a || d === inv.interlink.b)) { L.push(...lagBlock(255, 'INTER-CORE', false)); campusInterPorts('cisco', 0, true).forEach(p => L.push(...member(p, 'INTER-CORE-LINK', 255))); }
  }
  if (gw && f.dhcp) L.push('! NX-OS DHCP sunucusu desteklemez; relay adresini gerçek DHCP sunucusuyla değiştirin');
  if (gw && f.ospf) L.push('router ospf 10', ` router-id ${ipOnly(d.mgmt)}`, ' passive-interface default');
  if (gw && f.defaultRoute) L.push(`ip route 0.0.0.0/0 ${f.defaultRoute}`);
  void protectedIds;
  return L.join('\n');
}

// ----- Cisco -----
function campusCiscoDevice(d, inv) {
  if (campusIsNxos(d)) return campusNxosDevice(d, inv);
  const f = inv.f; const vlanIds = inv.vlans.map(v => v.id).join(',');
  const protectedIds = inv.vlans.filter(v => !isManagementVlan(v)).map(v => v.id); const protectedVlans = protectedIds.join(',');
  const vlanDefs = inv.vlans.map(v => `vlan ${v.id}\n name ${v.name}`).join('\n');
  const admin = adminAclParts(inputValue('adminNetwork', '10.10.10.0/24')); const radius = campusRadius();
  const base = ['ip domain-name corp.local', 'ip ssh version 2', 'spanning-tree mode rapid-pvst'];
  const hard = f.hardening ? ['service timestamps log datetime msec localtime show-timezone', 'service password-encryption', 'no ip http server', 'no ip http secure-server', 'username breakglass privilege 15 secret <LOCAL_SECRET_FROM_VAULT>', 'ip access-list standard MGMT_ACCESS', ` permit ${admin.ip} ${admin.wildcard}`, ' deny any log', 'ntp server 10.10.20.10 prefer', 'logging host 10.10.30.20', 'logging trap warnings', 'snmp-server group NMS v3 priv access MGMT_ACCESS', 'snmp-server user <SNMPV3_USER> NMS v3 auth sha <AUTH_FROM_VAULT> priv aes 256 <PRIV_FROM_VAULT>', 'line vty 0 15', ' access-class MGMT_ACCESS in', ' transport input ssh', ' login local', ' exec-timeout 10 0'] : ['line vty 0 15', ' transport input ssh', ' login local'];
  const aaa = f.hardening || f.dot1x || f.tacacs ? ['aaa new-model', ...(f.tacacs ? tacacsLines('cisco', radius) : [])] : [];
  const common = (f.tacacs ? [...base, ...(f.hardening ? ['spanning-tree portfast bpduguard default'] : []), ...aaa, ...hard].join('\n').replace(' login local', ' login authentication VTY_AUTH\n authorization exec VTY_AUTH\n authorization commands 15 VTY_AUTH') : [...base, ...(f.hardening ? ['spanning-tree portfast bpduguard default'] : []), ...aaa, ...hard].join('\n'));
  const mine = campusLinksOf(inv, d);
  const trust = f.l2sec ? [' ip dhcp snooping trust', ' ip arp inspection trust'] : [];
  const trunk = (port, desc, lag) => [`interface ${port}`, ` description ${desc}`, ...(lag ? [` channel-group ${lag} mode active`, ' no shutdown'] : [' switchport mode trunk', ` switchport trunk allowed vlan ${vlanIds}`, ...trust, ' no shutdown'])].join('\n');
  const poBlock = lag => [`interface Port-channel${lag}`, ` description MEC-${lag}`, ' switchport mode trunk', ` switchport trunk allowed vlan ${vlanIds}`, ...trust].join('\n');
  const l2lines = f.l2sec ? ['ip dhcp snooping', `ip dhcp snooping vlan ${protectedVlans}`, `ip arp inspection vlan ${protectedVlans}`] : [];
  const head = (suffix) => [`! ===== ${d.hostname} · ${d.model}${suffix || ''} =====`, '! Arayüz adlarını model ve port numaralandırmasına göre doğrulayın', `hostname ${d.hostname}`, common];
  const fh = campusFhrpFor('cisco', inv.f && inv.fhrp !== undefined ? inv.fhrp : 'auto');

  if (d.role === 'core') {
    const virt = inv.virt; const pi = campusPairInfo(inv, d); const isVirt = Boolean(pi);
    const chassis = isVirt ? pi.chassis : 0; const gw = campusIsGw(inv, d); const dom = isVirt ? pi.i + 1 : 0;
    const svl = isVirt ? ['stackwise-virtual', ` domain ${dom}`, `interface TenGigabitEthernet${chassis}/0/47`, ' stackwise-virtual link 1', `interface TenGigabitEthernet${chassis}/0/48`, ' stackwise-virtual link 1', `interface TenGigabitEthernet${chassis}/0/46`, ' stackwise-virtual dual-active-detection', '! Chassis\'i yeniden başlatın; SVL oluştuktan sonra tüm yapılandırma active chassis üzerinden yönetilir'] : [];
    if (isVirt && chassis === 2) return [...head(` · StackWise Virtual (domain ${dom}, chassis 2)`), ...svl, '! Bu chassis SVL sonrası aktif chassis ile birleşir; mantıksal yapılandırma yalnızca chassis 1 üzerinde uygulanır.', 'end'].join('\n');
    const mgmtVlan = inv.vlans.find(isManagementVlan) || inv.vlans.at(-1);
    const svis = gw ? inv.vlans.map(v => {
      const vip = isManagementVlan(v) ? managementAddress(1) : gatewayAddress(v.id, 1); const pip = isVirt ? vip : (isManagementVlan(v) ? d.mgmt : gatewayAddress(v.id, d.idx + 2)); const g = v.id % 256 || 1; const prio = d.idx === 0 ? 110 : 100;
      const l = [`interface Vlan${v.id}`, ` description GW_${v.name}`, ` ip address ${ipOnly(pip)} ${netInfo(pip).mask}`];
      if (!isVirt && fh.kind === 'hsrp') l.push(` standby ${g} ip ${ipOnly(vip)}`, ` standby ${g} priority ${prio}`, ` standby ${g} preempt`);
      if (!isVirt && fh.kind === 'vrrp') l.push(` vrrp ${g} address-family ipv4`, `  address ${ipOnly(vip)} primary`, `  priority ${prio}`, '  preempt');
      if (!isVirt && fh.kind === 'glbp') l.push(` glbp ${g} ip ${ipOnly(vip)}`, ` glbp ${g} priority ${prio}`, ` glbp ${g} preempt`, ` glbp ${g} load-balancing round-robin`);
      if (f.ospf) l.push(' ip ospf 10 area 0'); l.push(' no shutdown'); return l.join('\n');
    }).join('\n') : [`interface Vlan${mgmtVlan.id}`, ' description MANAGEMENT', ` ip address ${ipOnly(d.mgmt)} ${netInfo(d.mgmt).mask}`, ' no shutdown'].join('\n');
    const root = isVirt ? (pi.i === 0 ? 'primary' : 'secondary') : (d.idx === 0 ? 'primary' : d.idx === 1 ? 'secondary' : '');
    let links = '';
    if (isVirt) {
      const pairIds = new Set([pi.pair.a.id, pi.pair.b.id]);
      const lags = [...new Set(inv.links.filter(l => pairIds.has(l.core.id)).map(l => l.lag))];
      links = lags.map(lag => poBlock(lag) + '\n' + inv.links.filter(l => l.lag === lag).map(l => trunk(l.cPort, `MEC${lag}-${l.access.hostname}-${l.aPort}`, lag)).join('\n')).join('\n');
      if (virt.layered) {
        const mem = inv.interLinks.flatMap(il => [pairIds.has(il.x.id) ? { port: il.xPort, peer: il.y.hostname } : null, pairIds.has(il.y.id) ? { port: il.yPort, peer: il.x.hostname } : null].filter(Boolean));
        links += (links ? '\n' : '') + poBlock(200).replace('MEC-200', 'MEC-INTER-PAIR') + '\n' + mem.map(m => trunk(m.port, `MEC200-${m.peer}`, 200)).join('\n');
      }
    } else links = mine.map(l => trunk(l.cPort, `TO-${l.access.hostname}-${l.aPort}`)).join('\n');
    const inter = inv.interlink && (d === inv.interlink.a || d === inv.interlink.b) ? [poBlock(255).replace('MEC-255', 'INTER-CORE'), ...campusInterPorts('cisco', 0, false).map(p => trunk(p, 'INTER-CORE-LINK', 255))] : [];
    const dhcp = gw && f.dhcp && d.idx === 0 ? ['! DHCP sunucusu bu core üzerinde (sanal gateway adresiyle)', ...protectedIds.flatMap(id => { const v = inv.vlans.find(x => x.id === id); const g1 = gatewayAddress(id, 1); const ni = netInfo(g1); const base3 = ipOnly(g1).split('.').slice(0, 3).join('.'); return [`ip dhcp excluded-address ${base3}.1 ${base3}.10`, `ip dhcp pool VLAN${id}_${v.name}`, ` network ${ni.net} ${ni.mask}`, ` default-router ${ipOnly(g1)}`, ` dns-server ${campusDnsHint()}`, ' lease 1']; })] : [];
    const ospf = gw && f.ospf ? ['router ospf 10', ` router-id ${ipOnly(d.mgmt)}`, ' passive-interface default', ' no passive-interface <UPSTREAM_INTERFACE>', ...inv.vlans.map(v => { const ni = netInfo(isVirt ? gatewayAddress(v.id, 1) : (isManagementVlan(v) ? d.mgmt : gatewayAddress(v.id, d.idx + 2))); return ` network ${ni.net} ${ni.wildcard} area 0`; })] : [];
    const dr = gw && f.defaultRoute ? [`ip route 0.0.0.0 0.0.0.0 ${f.defaultRoute}`] : [];
    return [...head(isVirt ? ` · StackWise Virtual (domain ${dom}, chassis 1)` : ''), ...svl, ...(!isVirt && fh.kind === 'vrrp' ? ['fhrp version vrrp v3'] : []), ...(gw ? ['ip routing'] : []), vlanDefs, ...l2lines, svis, links, ...inter, root ? `spanning-tree vlan ${vlanIds} root ${root}` : '', ...dhcp, ...ospf, ...dr, 'end'].filter(Boolean).join('\n');
  }
  // access (mantıksal: stack olabilir)
  const mgmtVlan = inv.vlans.find(isManagementVlan) || inv.vlans.at(-1);
  const n = d.ports; const userEnd = Math.floor(n / 2); const dataEnd = n - 4;
  const voice = (inv.vlans.find(v => /VOICE/i.test(v.name)) || inv.vlans[0]).id; const data = inv.vlans[2] || inv.vlans[0];
  const dotGlobal = f.dot1x ? ['dot1x system-auth-control', 'aaa authentication dot1x default group radius', 'aaa authorization network default group radius', 'aaa accounting dot1x default start-stop group radius', ...radius.flatMap((ip, i) => [`radius server NAC-${i + 1}`, ` address ipv4 ${ip} auth-port 1812 acct-port 1813`, ' key <RADIUS_SECRET>']), 'radius-server dead-criteria time 5 tries 3', 'aaa server radius dynamic-author', ` client ${radius[0] || '<RADIUS_IP>'} server-key <COA_KEY>`] : [];
  const dotPort = f.dot1x ? [' authentication port-control auto', ' dot1x pae authenticator', ' mab', ' authentication order dot1x mab', ' authentication priority dot1x mab', ' authentication host-mode multi-domain', ' authentication periodic', ' authentication timer reauthenticate server', ' authentication event server dead action authorize vlan <CRITICAL_VLAN>'] : [];
  const portProt = f.l2sec ? [' ip verify source', ' spanning-tree portfast', ' spanning-tree bpduguard enable'] : [' spanning-tree portfast'];
  const stackLines = d.stack > 1 ? ['! StackWise stack: kabloları bağlayıp switch numaralarını/önceliklerini doğrulayın', ...d.members.flatMap((m, i) => [`switch ${i + 1} provision ${m.model.toLowerCase()}`, `switch ${i + 1} priority ${15 - i}`])] : [];
  const memberPorts = d.members.flatMap((_, i) => { const mi = i + 1; return [
    `interface range GigabitEthernet${mi}/0/1-${userEnd}`, ' description USER_AND_VOICE', ' switchport mode access', ` switchport access vlan ${inv.vlans[0].id}`, ` switchport voice vlan ${voice}`, ...dotPort, ...portProt,
    `interface range GigabitEthernet${mi}/0/${userEnd + 1}-${dataEnd}`, ` description ${data.name}`, ' switchport mode access', ` switchport access vlan ${data.id}`, ...dotPort, ...portProt,
    `interface range GigabitEthernet${mi}/0/${dataEnd + 1}-${n}`, ' description UNUSED_SHUTDOWN', ' shutdown']; });
  const mine2 = campusLinksOf(inv, d);
  let upl;
  if (inv.virt) { const lags = [...new Set(mine2.map(l => l.lag))]; upl = lags.map(lag => poBlock(lag) + '\n' + mine2.filter(l => l.lag === lag).map(l => trunk(l.aPort, `MEC${lag}-${l.core.hostname}-${l.cPort}`, lag)).join('\n')).join('\n'); }
  else upl = mine2.map(l => trunk(l.aPort, `TO-${l.core.hostname}-${l.cPort}`)).join('\n');
  return [...head(d.stack > 1 ? ` · ${d.stack} üyeli stack` : ''), ...stackLines, ...dotGlobal, vlanDefs, ...l2lines,
    `interface Vlan${mgmtVlan.id}`, ' description MANAGEMENT', ` ip address ${ipOnly(d.mgmt)} ${netInfo(d.mgmt).mask}`, ' no shutdown', `ip default-gateway ${ipOnly(managementAddress(1))}`,
    ...memberPorts, upl, 'end'].filter(Boolean).join('\n');
}

// ----- Aruba AOS-CX / Huawei VRP -----
function campusGenericDevice(d, inv) {
  const f = inv.f; const aruba = d.vendor === 'aruba', cm = aruba ? '!' : '#', label = aruba ? 'AOS-CX' : 'VRP';
  const vlanIds = inv.vlans.map(v => v.id);
  const protectedIds = inv.vlans.filter(v => !isManagementVlan(v)).map(v => v.id);
  const adminCidr = inputValue('adminNetwork', '10.10.10.0/24'); const adminAp = adminAclParts(adminCidr);
  const radius = campusRadius(); const mine = campusLinksOf(inv, d); const virt = inv.virt;
  const vlanLines = [...inv.vlans.map(v => (aruba ? `vlan ${v.id}\n name ${v.name}` : `vlan ${v.id}\n description ${v.name}\nquit`)), aruba ? 'vlan 999' + String.fromCharCode(10) + ' name BLACKHOLE_NATIVE' : 'vlan 999' + String.fromCharCode(10) + ' description BLACKHOLE_NATIVE' + String.fromCharCode(10) + 'quit'].join(String.fromCharCode(10));
  const head = aruba
    ? [`hostname ${d.hostname}`, 'ssh server vrf default', 'spanning-tree', 'spanning-tree mode rpvst', ...(f.hardening ? ['no telnet server vrf default', 'no telnet server vrf mgmt', 'user breakglass group administrators password ciphertext <LOCAL_SECRET_FROM_VAULT>', 'ntp server 10.10.20.10 iburst prefer', 'logging 10.10.30.20', 'snmpv3 user <SNMPV3_USER> auth sha auth-pass plaintext <AUTH_FROM_VAULT> priv aes priv-pass plaintext <PRIV_FROM_VAULT>', 'snmp-server vrf default', 'no https-server vrf default', '! Yönetim erişimini yalnız ' + adminCidr + ' ağına kısıtlayın: control-plane ACL OSPF/VRRP/RADIUS trafiğini engellememeli; platform dokümanına göre elle tasarlayın'] : [])]
    : [`sysname ${d.hostname}`, 'stelnet server enable', 'stp enable', 'stp mode rstp', ...(f.hardening ? ['undo telnet server enable', 'stp bpdu-protection', 'ntp-service unicast-server 10.10.20.10 preferred', 'info-center enable', 'info-center loghost 10.10.30.20', 'acl number 2000', ` rule 5 permit source ${adminAp.ip} ${adminAp.wildcard}`, ' rule 10 deny', 'quit', 'user-interface vty 0 4', ' acl 2000 inbound', ' authentication-mode aaa', ' protocol inbound ssh', ' idle-timeout 10 0', 'quit', 'aaa', ' local-user breakglass password irreversible-cipher <LOCAL_SECRET_FROM_VAULT>', ' local-user breakglass privilege level 15', ' local-user breakglass service-type ssh', 'quit', 'undo http server enable', 'undo http secure-server enable', 'snmp-agent sys-info version v3', 'snmp-agent group v3 NMS privacy', 'snmp-agent usm-user v3 <SNMPV3_USER> group NMS', 'snmp-agent usm-user v3 <SNMPV3_USER> authentication-mode sha cipher <AUTH_FROM_VAULT>', 'snmp-agent usm-user v3 <SNMPV3_USER> privacy-mode aes128 cipher <PRIV_FROM_VAULT>', ...huaweiHardExtras()] : [])];
  if (f.tacacs) head.push(...tacacsLines(aruba ? 'aruba' : 'huawei', radius));
  const snoop = !f.l2sec ? [] : aruba
    ? ['dhcpv4-snooping', ...protectedIds.map(id => `vlan ${id}\n dhcpv4-snooping`), `arp inspection vlan ${protectedIds.join(',')}`]
    : ['dhcp enable', 'dhcp snooping enable', ...protectedIds.map(id => `vlan ${id}\n dhcp snooping enable\nquit`), 'arp anti-attack check user-bind enable'];
  const trunk = (port, desc, lag) => (aruba
    ? [`interface ${port}`, ` description ${desc}`, ' no shutdown', ...(lag ? [` lag ${lag}`] : [' no routing', ' vlan trunk native 999', ` vlan trunk allowed ${vlanIds.join(',')}`, ...(f.l2sec ? [' dhcpv4-snooping trust', ' arp inspection trust'] : [])])].join('\n')
    : [`interface ${port}`, ` description ${desc}`, ...(lag ? [` eth-trunk ${lag}`] : [' port link-type trunk', ' port trunk pvid vlan 999', ` port trunk allow-pass vlan ${vlanIds.join(' ')}`, ...(f.l2sec ? [' dhcp snooping trusted'] : [])]), 'quit'].join('\n'));
  const lagBlock = (lag, multi) => (aruba
    ? [`interface lag ${lag}${multi ? ' multi-chassis' : ''}`, ` description LAG-${lag}`, ' no shutdown', ' no routing', ' vlan trunk native 999', ` vlan trunk allowed ${vlanIds.join(',')}`, ' lacp mode active', ...(f.l2sec ? [' dhcpv4-snooping trust', ' arp inspection trust'] : [])].join('\n')
    : [`interface Eth-Trunk ${lag}`, ` description LAG-${lag}`, ' mode lacp-static', ' port link-type trunk', ' port trunk pvid vlan 999', ` port trunk allow-pass vlan ${vlanIds.join(' ')}`, ...(multi ? [` dfs-group 1 m-lag ${lag}`] : []), ...(f.l2sec ? [' dhcp snooping trusted'] : []), 'quit'].join('\n'));
  const body = [];
  if (d.role === 'core') {
    const pi = campusPairInfo(inv, d); const isVirt = Boolean(pi); const primary = isVirt && pi.chassis === 1; const chassis = isVirt ? pi.chassis : 0;
    const peer = isVirt ? pi.peer : null; const gw = campusIsGw(inv, d); const dom = isVirt ? pi.i + 1 : 0; const kind = isVirt ? virt.kind : null;
    const mgmtV = inv.vlans.find(isManagementVlan) || inv.vlans.at(-1);
    if (isVirt) {
      const ip = campusInterPorts(d.vendor, chassis, false);
      if (kind === 'vsx') {
        body.push([`interface lag 256`, ' description VSX-ISL', ' no shutdown', ' no routing', ' vlan trunk native 1', ' vlan trunk allowed all', ' lacp mode active', ...ip.flatMap(p => [`interface ${p}`, ' no shutdown', ' lag 256']),
          'vsx', ` system-mac 02:00:00:00:0${dom}:00`, ' inter-switch-link lag 256', ` role ${primary ? 'primary' : 'secondary'}`, ` keepalive peer ${ipOnly(peer.mgmt)} source ${ipOnly(d.mgmt)} vrf mgmt`].join('\n'));
      } else if (kind === 'mlag') {
        body.push([`dfs-group ${dom}`, ` source ip ${ipOnly(d.mgmt)}`, ` priority ${primary ? 150 : 100}`, 'quit', 'interface Eth-Trunk 0', ' description PEER-LINK', ' mode lacp-static', ' peer-link 1', 'quit', ...ip.flatMap(p => [`interface ${p}`, ' eth-trunk 0', 'quit']), `# M-LAG komşu IP (peer): ${ipOnly(peer.mgmt)}`].join('\n'));
      } else {
        body.push([`# ${VIRT_NAME[kind]} komutları ve kablolama platform dokümanına göre doğrulanmalıdır`, kind === 'css' ? 'css enable' : `stack slot 0 priority ${primary ? 200 : 100}`, ...(kind === 'css' ? [`css priority ${primary ? 100 : 10}`] : ['stack slot 0 renumber ' + chassis]), `# Stack/CSS bağlantı portları: ${ip.join(', ')}`].join('\n'));
      }
    }
    const sharedGw = isVirt && kind !== 'vsx' && kind !== 'mlag'; // CSS/iStack: tek mantıksal cihaz
    if (gw) inv.vlans.forEach(v => {
      const mg = isManagementVlan(v); const vip = mg ? managementAddress(1) : gatewayAddress(v.id, 1); const g = v.id % 256 || 1; const prio = (isVirt ? primary : d.idx === 0) ? 110 : 100;
      const pip = sharedGw ? vip : mg ? d.mgmt : gatewayAddress(v.id, (isVirt ? chassis - 1 : d.idx) + 2);
      if (isVirt && kind === 'vsx' && aruba) body.push([`interface vlan ${v.id}`, ` description GW_${v.name}`, ` ip address ${pip}`, ...(f.ospf ? [' ip ospf 1 area 0.0.0.0'] : []), ` active-gateway ip mac 02:00:00:00:0${dom}:${hex2(g)}`, ` active-gateway ip ${ipOnly(vip)}`].join('\n'));
      else if (sharedGw || inv.fhrp === 'none') body.push(aruba ? [`interface vlan ${v.id}`, ` description GW_${v.name}`, ` ip address ${pip}`].join('\n') : [`interface Vlanif${v.id}`, ` description GW_${v.name}`, ` ip address ${ipOnly(pip)} ${netInfo(pip).mask}`, 'quit'].join('\n'));
      else body.push(aruba
        ? [`interface vlan ${v.id}`, ` description GW_${v.name}`, ` ip address ${pip}`, ...(f.ospf ? [' ip ospf 1 area 0.0.0.0'] : []), ` vrrp ${g} address-family ipv4`, `  address ${ipOnly(vip)} primary`, `  priority ${prio}`, '  no shutdown'].join('\n')
        : [`interface Vlanif${v.id}`, ` description GW_${v.name}`, ` ip address ${ipOnly(pip)} ${netInfo(pip).mask}`, ` vrrp vrid ${g} virtual-ip ${ipOnly(vip)}`, ` vrrp vrid ${g} priority ${prio}`, ...(f.dhcp && d.idx === 0 && !mg ? [' dhcp select global'] : []), 'quit'].join('\n'));
    });
    else body.push(aruba ? [`interface vlan ${mgmtV.id}`, ' description MANAGEMENT', ` ip address ${d.mgmt}`].join('\n') : [`interface Vlanif${mgmtV.id}`, ' description MANAGEMENT', ` ip address ${ipOnly(d.mgmt)} ${netInfo(d.mgmt).mask}`, 'quit'].join('\n'));
    if (isVirt) {
      const ids = new Set([pi.pair.a.id, pi.pair.b.id]); const multi = kind === 'vsx' || kind === 'mlag';
      [...new Set(inv.links.filter(l => ids.has(l.core.id)).map(l => l.lag))].forEach(lag => { body.push(lagBlock(lag, multi)); inv.links.filter(l => l.lag === lag && l.core.id === d.id).forEach(l => body.push(trunk(l.cPort, `MEC${lag}-${l.access.hostname}-${l.aPort}`, lag))); });
      if (virt.layered) { body.push(lagBlock(200, multi)); inv.interLinks.forEach(il => { if (il.x.id === d.id) body.push(trunk(il.xPort, `MEC200-${il.y.hostname}`, 200)); if (il.y.id === d.id) body.push(trunk(il.yPort, `MEC200-${il.x.hostname}`, 200)); }); }
    } else {
      mine.forEach(l => body.push(trunk(l.cPort, `TO-${l.access.hostname}-${l.aPort}`)));
      if (inv.interlink && (d === inv.interlink.a || d === inv.interlink.b)) { body.push(lagBlock(255, false).replace(/LAG-255/, 'INTER-CORE')); campusInterPorts(d.vendor).forEach(p => body.push(trunk(p, 'INTER-CORE-LINK', 255))); }
    }
    if (!isVirt) body.push(aruba ? `spanning-tree priority ${d.idx === 0 ? 0 : d.idx === 1 ? 1 : 8}` : `stp ${d.idx === 0 ? 'root primary' : d.idx === 1 ? 'root secondary' : 'priority 32768'}`);
    else if (primary) body.push(aruba ? `spanning-tree priority ${pi.i === 0 ? 0 : 1}` : (pi.i === 0 ? 'stp root primary' : 'stp root secondary'));
    if (gw && f.dhcp && d.idx === 0) {
      body.push('! DHCP sunucusu bu core üzerinde (sanal gateway adresiyle)');
      if (aruba) body.push(['dhcp-server vrf default', ...protectedIds.flatMap(id => { const v = inv.vlans.find(x => x.id === id); const gw = gatewayAddress(id, 1); const b3 = ipOnly(gw).split('.').slice(0, 3).join('.'); return [` pool VLAN${id}_${v.name}`, `  range ${b3}.11 ${b3}.250 prefix-len ${netInfo(gw).prefix}`, `  default-router ${ipOnly(gw)}`, `  dns-server ${campusDnsHint()}`, '  lease 01:00:00', '  enable']; })].join('\n'));
      else protectedIds.forEach(id => { const v = inv.vlans.find(x => x.id === id); const gw = gatewayAddress(id, 1); const ni = netInfo(gw); body.push([`ip pool VLAN${id}_${v.name}`, ` gateway-list ${ipOnly(gw)}`, ` network ${ni.net} mask ${ni.mask}`, ` dns-list ${campusDnsHint()}`, ' lease day 1', 'quit'].join('\n')); });
    }
    if (gw && f.ospf) {
      if (aruba) body.push(['router ospf 1', ` router-id ${ipOnly(d.mgmt)}`, ' passive-interface default', ' area 0.0.0.0', '! Upstream L3 arayüzünde: ip ospf 1 area 0.0.0.0 ve passive-interface kapatılmalı'].join('\n'));
      else body.push(['ospf 10 router-id ' + ipOnly(d.mgmt), ' silent-interface all', ' undo silent-interface <UPSTREAM_INTERFACE>', ' area 0.0.0.0', ...inv.vlans.map(v => { const ni = netInfo(isVirt ? gatewayAddress(v.id, 1) : (isManagementVlan(v) ? d.mgmt : gatewayAddress(v.id, d.idx + 2))); return `  network ${ni.net} ${ni.wildcard}`; }), 'quit'].join('\n'));
    }
    if (gw && f.defaultRoute) body.push(aruba ? `ip route 0.0.0.0/0 ${f.defaultRoute}` : `ip route-static 0.0.0.0 0.0.0.0 ${f.defaultRoute}`);
  } else {
    const mg = inv.vlans.find(isManagementVlan) || inv.vlans.at(-1); const n = d.ports; const userVlan = inv.vlans[0].id; const gw = ipOnly(managementAddress(1));
    if (d.stack > 1) body.push(aruba
      ? ['! VSF stack: üye numaraları, bağlantı portları ve rolleri doğrulayın', ...d.members.flatMap((m, i) => [`vsf member ${i + 1}`, ` role ${i === 0 ? 'primary' : 'secondary'}`, ` link 1 ${i + 1}/1/51`])].join('\n')
      : ['# iStack: stack-port bağlantıları ve üye numaralarını doğrulayın', ...d.members.flatMap((m, i) => [`stack slot ${i} priority ${200 - 10 * i}`, `stack slot ${i} renumber ${i}`])].join('\n'));
    if (f.dot1x) {
      body.push(aruba
        ? [...radius.map(ip => `radius-server host ${ip} key plaintext <RADIUS_SECRET>`), 'radius dyn-authorization enable', `radius dyn-authorization client ${radius[0] || '<RADIUS_IP>'} secret-key plaintext <COA_KEY>`, 'port-access role CRITICAL', ' vlan access <CRITICAL_VLAN>', '! 802.1X ayrıntıları (reauth, critical role) AOS-CX sürümüne göre doğrulanmalı', 'aaa authentication port-access dot1x authenticator', ' enable', ' reauth', ' reauth-period 28800', 'aaa authentication port-access mac-auth', ' enable'].join('\n')
        : huaweiNacLines(radius).join('\n'));
    }
    body.push(aruba
      ? [`interface vlan ${mg.id}`, ' description MANAGEMENT', ` ip address ${d.mgmt}`, `ip route 0.0.0.0/0 ${gw}`].join('\n')
      : [`interface Vlanif${mg.id}`, ' description MANAGEMENT', ` ip address ${ipOnly(d.mgmt)} ${netInfo(d.mgmt).mask}`, 'quit', `ip route-static 0.0.0.0 0.0.0.0 ${gw}`].join('\n'));
    d.members.forEach((_, i) => { const mi = i + 1;
      body.push(aruba
        ? [`interface ${mi}/1/1-${mi}/1/${n - 4}`, ' description USER_PORTS', ' no shutdown', ' no routing', ` vlan access ${userVlan}`, ' spanning-tree port-type admin-edge', ...(f.hardening || f.l2sec ? [' spanning-tree bpdu-guard'] : []), ...(f.l2sec ? [' ip source-lockdown'] : []), ...(f.dot1x ? [' aaa authentication port-access dot1x authenticator', '  enable', '  reauth', ' aaa authentication port-access mac-auth', '  enable', ' aaa authentication port-access critical-role CRITICAL'] : []), `interface ${mi}/1/${n - 3}-${mi}/1/${n}`, ' description UNUSED_SHUTDOWN', ' shutdown'].join('\n')
        : [`port-group name USER_PORTS_${mi}`, ` group-member GigabitEthernet${mi - 1}/0/1 to GigabitEthernet${mi - 1}/0/${n - 4}`, ' port link-type access', ` port default vlan ${userVlan}`, ' stp edged-port enable', ...(f.l2sec ? [' ip source check user-bind enable'] : []), ...(f.dot1x ? [' authentication-profile NAC_AUTH_PROF'] : []), 'quit', `port-group name UNUSED_PORTS_${mi}`, ` group-member GigabitEthernet${mi - 1}/0/${n - 3} to GigabitEthernet${mi - 1}/0/${n}`, ' description UNUSED_SHUTDOWN', ' shutdown', 'quit'].join('\n')); });
    if (virt) { [...new Set(mine.map(l => l.lag))].forEach(lag => { body.push(lagBlock(lag, false)); mine.filter(l => l.lag === lag).forEach(l => body.push(trunk(l.aPort, `MEC${lag}-${l.core.hostname}-${l.cPort}`, lag))); }); }
    else mine.forEach(l => body.push(trunk(l.aPort, `TO-${l.core.hostname}-${l.cPort}`)));
  }
  return [`${cm} ===== ${d.hostname} · ${d.model} · ${label}${d.stack > 1 ? ` · ${d.stack} üyeli stack` : ''}${virt && d.role === 'core' ? ` · ${VIRT_NAME[virt.kind]}` : ''} =====`, `${cm} Arayüz adlarını model ve port numaralandırmasına göre doğrulayın`, ...head, vlanLines, ...snoop, ...body, aruba ? '' : 'return'].filter(Boolean).join('\n');
}

function campusReport(inv) {
  const f = inv.f; const virt = inv.virt;
  const keepFhrp = !virt || virt.kind === 'vpc' || virt.kind === 'mlag';
  const fk = campusFhrpFor(inv.cores[0] ? inv.cores[0].vendor : 'cisco', inv.fhrp).kind;
  const gwLine = !keepFhrp ? `${VIRT_NAME[virt.kind]}: core çifti tek mantıksal gateway (FHRP gerekmez)` : inv.fhrp === 'none' ? 'FHRP yok (sanal gateway adresi tanımlanmadı)' : `Gateway yedekliliği: ${(inv.virt && inv.virt.kind === 'vpc' && fk === 'glbp' ? 'hsrp' : fk || 'hsrp').toUpperCase()}`;
  const L = ['CAMPUS TASARIM RAPORU', '', `${inv.coreCount} core · ${inv.accessCount} access · ${inv.vlans.length} VLAN`,
    `Topoloji: ${inv.dual ? 'Her access iki core’a yedekli bağlı' : 'Tek uplink'}`, `Management gateway: ${managementAddress(1)}`, '', 'NİYETTEN ALGILANAN ÖZELLİKLER', f.labels.length ? f.labels.map(x => `- ${x}`).join('\n') : '- (ek özellik yok)', '', 'TOPOLOJİ SEÇİMLERİ', `- ${gwLine}`];
  if (virt) virt.pairs.forEach((p, i) => L.push(`- ${VIRT_NAME[virt.kind]} çifti ${i + 1}: ${p.a.hostname} + ${p.b.hostname}${virt.layered ? (i === 0 ? ' (core / gateway)' : ' (aggregation / L2)') : ''}`));
  if (virt && virt.layered) L.push('- İki çift arası: çift taraflı (double-sided) çok-şasili LAG (4 fiziksel bağlantı)');
  if (inv.interlink) L.push(`- Core'lar arası bağlantı: Port-channel 255 (${campusInterPorts(inv.cores[0].vendor, 0, campusIsNxos(inv.cores[0])).join(', ')})`);
  if (inv.accesses.some(a => a.stack > 1)) L.push(`- Access stack: ${inv.accesses.filter(a => a.stack > 1).map(a => `${a.hostname} ×${a.stack}`).join(', ')}`);
  L.push('', 'CİHAZ ENVANTERİ');
  inv.cores.forEach(d => L.push(`- ${d.hostname} (core) · ${vendorName(d.vendor)} ${d.model} · ${d.mgmt}`));
  inv.accesses.forEach(d => L.push(`- ${d.hostname} (access${d.stack > 1 ? `, ${d.stack} üyeli stack` : ''}) · ${vendorName(d.vendor)} ${d.model} · ${d.mgmt}`));
  L.push('', 'VLANLAR', ...inv.vlans.map(v => `${v.id}\t${v.name}\tGateway ${isManagementVlan(v) ? managementAddress(1) : gatewayAddress(v.id, 1)}`), '', 'PORT PLANI');
  inv.links.forEach(l => L.push(`${l.access.hostname}${l.access.stack > 1 ? `(üye ${l.mem})` : ''} ${l.aPort} → ${l.core.hostname} ${l.cPort}${l.lag ? ` (LAG ${l.lag})` : ''}`));
  inv.interLinks.forEach(il => L.push(`${il.x.hostname} ${il.xPort} → ${il.y.hostname} ${il.yPort} (LAG 200)`));
  L.push('', 'GÜVENLİK');
  if (inv.cores[0]) L.push(virt ? `- ${inv.cores[0].hostname} (mantıksal çift) STP root primary.` : inv.cores[1] ? `- ${inv.cores[0].hostname} STP root primary, ${inv.cores[1].hostname} root secondary.` : `- ${inv.cores[0].hostname} STP root primary.`);
  if (f.l2sec) L.push('- DHCP Snooping ve DAI kullanıcı VLANlarında etkin.', '- Yalnız uplink portları DHCP/ARP trusted.', '- Access portlarında IP Source Guard ve BPDU Guard etkin.');
  if (f.dot1x) L.push('- Access kullanıcı portlarında 802.1X + MAB, RADIUS CoA ve critical VLAN politikası var.');
  if (f.hardening) L.push('- Yönetim düzlemi hardening (SSH, AAA, ACL, NTP, syslog, SNMPv3) uygulandı.');
  L.push('- Kullanılmayan son 4 port kapalı.', '- Secret değerleri vault placeholder olarak bırakıldı.', '', 'VARSAYIM', 'Gerçek port kapasitesi ve komut desteği tam model/sürüm profiliyle doğrulanmalıdır.');
  return L.join('\n');
}

function campusConfig(vendor, side) {
  const inv = state.campusInv || campusInventory();
  const d = inv.devices.find(x => x.id === side);
  const full = vendor === 'cisco' ? campusCiscoDevice(d, inv) : campusGenericDevice(d, inv);
  const f = inv.f; const virt = inv.virt;
  const checks = ['1. VLAN ve trunk kapsamını doğrula.', '2. STP root primary/secondary ve blocked yedek yolu doğrula.', '3. Core gateway/first-hop redundancy durumunu doğrula.', `4. Her access switchten ${managementAddress(1)} management gateway ping testi yap.`];
  if (f.l2sec) checks.push('5. DHCP Snooping binding ve DAI drop sayaçlarını doğrula.', '6. Trusted portların yalnız uplinkler olduğunu doğrula.');
  if (f.hardening) checks.push('7. SSH, NTP, syslog ve SNMPv3 yönetim servislerini doğrula.');
  if (f.dot1x) checks.push('8. 802.1X, MAB ve RADIUS-down (critical VLAN) senaryolarını pilot portta test et.');
  if (f.dhcp) checks.push('9. İstemcilerin DHCP ile doğru VLAN adresini aldığını doğrula.');
  if (f.ospf || f.defaultRoute) checks.push('10. Upstream komşuluğu, OSPF rotaları ve varsayılan rotayı doğrula.');
  if (virt) {
    const cmd = { svl: 'show stackwise-virtual', vpc: 'show vpc brief / show vpc consistency-parameters global', vsx: 'show vsx status', mlag: 'display dfs-group 1 m-lag', css: 'display css status', istack: 'display stack' }[virt.kind];
    checks.push(`11. Sanallaştırma durumunu doğrula (${cmd}).`, '12. Port-channel/LAG üyelerinin tüm şasilerde bundle olduğunu doğrula.');
    if (virt.layered) checks.push('14. İki çift arasındaki çift taraflı LAG\'ın (4 bağlantı) bundle olduğunu ve her iki çiftte up olduğunu doğrula.');
  }
  if (!virt || virt.kind === 'vpc' || virt.kind === 'mlag') { if (inv.fhrp !== 'none') checks.push('15. Gateway rollerini (active/standby veya master/backup) doğrula (show standby brief / show vrrp brief / show glbp brief / display vrrp).'); }
  if (inv.accesses.some(a => a.stack > 1)) checks.push('13. Stack üyelerini ve rollerini doğrula (show switch / show vsf / display stack).');
  const verify = [`${d.hostname} · ${d.role.toUpperCase()}`, '', ...checks].join('\n');
  return { delta: full, full, audit: campusReport(inv), verify, rollback: 'Yeni kurulumda rollback: startup-config yüklenmeden cihazı fabrika/önceki baseline durumuna döndür. Canlı sisteme uygulanacaksa her cihazın orijinal config snapshotını geri yükle.' };
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
      delta: ['system-view', ...huaweiNacLines([radius1, radius2].filter(Boolean)), 'interface GigabitEthernet0/0/5', ' authentication-profile NAC_AUTH_PROF', ' stp edged-port enable', ' stp bpdu-protection', 'quit', 'return'].join('\n'),
      verify: `display radius-server configuration\ndisplay dot1x interface GigabitEthernet0/0/5\ndisplay access-user interface GigabitEthernet0/0/5`,
      rollback: `system-view\ninterface GigabitEthernet0/0/5\n undo dot1x mac-bypass\n undo dot1x enable\nquit\nreturn`
    }
  };
  return data[vendor] || null;
}

function configFacts(info) {
  const parsed = window.parseConfig ? window.parseConfig(info.config) : { vlans: [], ifaces: [], vnis: [], usedIps: [], ospf: null, bgp: null, eigrp: null, nve: false, hostname: '', statics: [] };
  return {
    ospf: Boolean(parsed.ospf),
    bgp: Boolean(parsed.bgp),
    vxlan: Boolean(parsed.nve || parsed.vnis.length),
    live: Boolean(info.config),
    hostname: parsed.hostname,
    parsed
  };
}

// ---- Niyet parametreleri ve cakisma kontrolu ----
function intentParams(text) {
  const vid = Number((text.match(/vlan\s*(\d{1,4})/i) || [])[1]) || 40;
  const nm = text.match(/(?:\bad[ıi]|name it|named|called|name:?)\s+([A-Za-z0-9_\-]+)/i);
  return { vid: vid > 0 && vid < 4095 ? vid : 40, vname: nm ? nm[1] : 'BILGI_ISLEM' };
}
function nextFree(start, used) { let v = start; while (used.has(v)) v++; return v; }
function ipFree(base, used) {
  const parts = base.split('.'); let last = Number(parts[3]);
  while (used.has([parts[0], parts[1], parts[2], last].join('.')) && last < 254) last++;
  return [parts[0], parts[1], parts[2], last].join('.');
}
function maskFromLen(len) {
  const n = Math.max(0, Math.min(32, Number(len)));
  const bits = n === 0 ? 0 : (0xFFFFFFFF << (32 - n)) >>> 0;
  return [24, 16, 8, 0].map(sh => (bits >>> sh) & 255).join('.');
}
function buildParams(intent, ids, facts, devs) {
  const base = intentParams(intent);
  const parsed = id => facts[id].parsed;
  const label = id => id.toUpperCase();
  const notes = [];
  const usedVnis = new Set(); ids.forEach(i => parsed(i).vnis.forEach(v => usedVnis.add(v)));
  const wantVni = 10000 + base.vid;
  const vni = nextFree(wantVni, usedVnis);
  if (vni !== wantVni) notes.push(`VNI ${wantVni} cihazlarda kullanımda; ${vni} seçildi.`);
  const usedIps = new Set(); ids.forEach(i => (parsed(i).usedIps || []).forEach(x => usedIps.add(x)));
  const ip = {}, net = {}, pid = {}, asnBgp = {}, asnEvpn = {};
  let changed = false;
  ids.forEach((id, i) => {
    const want = `10.254.0.${11 + i}`;
    ip[id] = ipFree(want, usedIps); usedIps.add(ip[id]);
    if (ip[id] !== want) changed = true;
    net[id] = `10.${10 + 30 * i}.0.0`;
  });
  if (changed) notes.push(`Loopback adresleri çakışmayacak şekilde ${ids.map(i => ip[i]).join(', ')} seçildi.`);
  ids.forEach(id => {
    const p = parsed(id);
    const ex = p.vlans.find(v => v.id === base.vid);
    if (ex && ex.name && ex.name !== base.vname) notes.push(`${label(id)} cihazında VLAN ${base.vid} zaten '${ex.name}' adıyla var; plan '${base.vname}' adını ekliyor — adı kontrol edin.`);
    else if (ex) notes.push(`${label(id)} cihazında VLAN ${base.vid} zaten var; komutlar tekrar uygulanabilir (idempotent).`);
    if (p.ospf) notes.push(`${label(id)} cihazında mevcut OSPF process ${p.ospf.pid} korunacak.`);
    if (p.bgp) notes.push(`${label(id)} cihazında mevcut BGP AS ${p.bgp.asn} kullanılacak.`);
    pid[id] = (p.ospf && p.ospf.pid) || '10';
  });
  const parsedAsn = ids.map(i => parsed(i).bgp && parsed(i).bgp.asn).filter(Boolean);
  if (parsedAsn.length > 1 && new Set(parsedAsn).size < parsedAsn.length) notes.push('Bazı cihazlar aynı BGP AS değerini kullanıyor: eBGP için farklı AS gerekir; aynı AS iBGP (route-reflector) olarak değerlendirilir.');
  const iBgpDefault = ids.length > 2 || ids.some(i => devs[i].role === 'spine');
  const sharedAsn = parsedAsn[0] || '65000';
  ids.forEach((id, i) => {
    const pa = parsed(id).bgp && parsed(id).bgp.asn;
    asnBgp[id] = pa || String(65001 + i);
    asnEvpn[id] = pa || (iBgpDefault ? sharedAsn : String(65001 + i));
  });
  const cidr = intent.match(/(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})/);
  const via = intent.match(/(\d{1,3}(?:\.\d{1,3}){3})\s*(?:üzerinden|uzerinden|via|next-?hop)/i);
  const targetLen = cidr ? Number(cidr[2]) : 16;
  return {
    vid: base.vid, vname: base.vname, vni, ip, net, pid, asnBgp, asnEvpn,
    target: cidr ? cidr[1] : '10.50.0.0', targetLen, targetMask: maskFromLen(targetLen),
    nextHop: via ? via[1] : '192.168.1.1',
    notes
  };
}

function vendorConfigs(vendor, protocol, side) {
  if (protocol === 'campus') return campusConfig(vendor, side);
  if (protocol === 'wan') return wanConfig(vendor, side);
  if (protocol === 'hardening') return hardeningConfig(vendor, side);
  if (protocol === 'security') return securityConfig(vendor, side);
  if (protocol === 'cabling') protocol = 'vxlan';
  const ctx = state.ctx;
  return window.NETCUBE_FABRIC.fabricConfig(vendor, protocol, side, { ...ctx, asn: protocol === 'vxlan' ? ctx.P.asnEvpn : ctx.P.asnBgp });
}

function analyzePlan() {
  const intent = $('#intentInput').value.trim();
  if (state.module === 'routing' && !state.forced && /dmvpn|nhrp|mgre|site.?to.?site|\bs2s\b|ipsec|ikev2|\bvpn\b|gre tunnel/i.test(intent)) {
    setModule('wan'); $('#intentInput').value = intent; state.wanSwitched = true; return analyzePlan();
  }
  let ids = ['routing', 'cabling', 'security', 'audit'].includes(state.module) ? activeDeviceIds() : ['a', 'b'];
  let devsMap = {}; ids.forEach(i => { devsMap[i] = deviceInfo(i); });
  if (['security', 'hardening'].includes(state.module)) ids.forEach(i => { devsMap[i].role = 'leaf'; });
  if (state.module === 'wan') { wanApplyIntent(); const winv = wanInventory(); state.wanInv = winv; devsMap = {}; ids = winv.routers.map(r => { devsMap[r.id] = r; return r.id; }); }
  if (state.module === 'campus') { campusApplyIntent(); const inv = campusInventory(); state.campusInv = inv; devsMap = {}; ids = inv.devices.map(d => { devsMap[d.id] = d; return d.id; }); }
  const all = ids.map(i => devsMap[i]);
  const a = devsMap[ids[0]], b = devsMap[ids[1]];
  const facts = {}; ids.forEach(i => { facts[i] = configFacts(devsMap[i]); });
  const fa = facts[ids[0]], fb = facts[ids[1]];
  state.params = buildParams(intent, ids, facts, devsMap);
  const P = state.params;
  const topo = (state.module === 'campus' || state.module === 'wan') ? { mode: 'campus', spines: [], leaves: [], links: [], linksOf: () => [], parallel: 1 } : window.NETCUBE_FABRIC.buildTopology(ids, devsMap, $('#redundancy')?.value === 'Tek bağlantı' ? 'single' : 'dual');
  state.ctx = { P, topo, ids, devs: devsMap };
  const AU = window.NETCUBE_AUDIT;
  const auditProfiles = auditProfilesFor(state.module);
  const audits = {};
  if (auditProfiles.length) {
    const ap = auditParams();
    ids.forEach(i => { if (state.module === 'hardening' && i !== 'a') return; if (devsMap[i].config) audits[i] = AU.run(devsMap[i], auditProfiles, ap); });
  }
  const topoTag = topo.mode === 'leaf-spine' ? `${topo.spines.length} spine RR · ${topo.leaves.length} leaf` : (ids.length > 2 ? `${ids.length} cihaz mesh` : '2 cihaz');
  let protocol = state.module === 'routing' ? (state.forced || detectIntent(intent)) : state.module;
  const notes = [];
  if (state.module === 'routing' && FALLBACKS[protocol]) {
    const requested = protocol;
    const chain = [requested, ...FALLBACKS[requested]];
    protocol = chain.find(p => all.every(x => supports(x, p))) || 'static';
    if (protocol !== requested) {
      const who = all.filter(x => !supports(x, requested)).map(deviceLabel).join(' / ');
      notes.push(`${PROTO_NAME[requested]} uygun olurdu ama ${who} desteklemiyor; ${PROTO_NAME[protocol]} önerildi.`);
      if (requested === 'vxlan') notes.push('VXLAN olmadan VLAN Layer 2 olarak uzatılamaz; çözüm yalnızca Layer 3 erişim sağlar. Layer 2 uzatma gerekiyorsa VXLAN destekli modeller seçin.');
    }
  }
  if (state.module === 'cabling') all.filter(x => !supports(x, 'vxlan')).forEach(x => notes.push(`${deviceLabel(x)} VXLAN EVPN desteklemiyor; fiziksel plan geçerli ama overlay config bu cihazda uygulanamaz.`));
  if (state.module === 'security') all.filter(x => !supports(x, 'dot1x')).forEach(x => notes.push(`${deviceLabel(x)} kullanıcı portu 802.1X/MAB için uygun bir profil değil; access sınıfı bir model seçin.`));
  if (state.module !== 'campus') all.filter(x => x.vendor === 'cisco' && /^N\dK|^N9K|nexus/i.test(x.model)).forEach(x => notes.push(`${x.model}: bu modülde NX-OS yerine IOS-XE sözdizimi üretilir; NX-OS (vPC) yalnızca Campus Builder'da desteklenir.`));
  const fallbackCount = notes.length;
  if (state.module === 'campus') notes.push(...state.campusInv.notes);
  if (state.module === 'wan') {
    if (state.wanSwitched) { notes.push('Niyet VPN içerdiği için WAN / VPN modülüne geçildi.'); state.wanSwitched = false; }
    (state.wanIntentMsgs || []).forEach(m => notes.push(`Niyetten: ${m}.`)); notes.push(...state.wanInv.notes);
  }
  if (['vxlan', 'cabling', 'ospf', 'bgp'].includes(protocol)) notes.push(...P.notes);
  if (state.module !== 'audit') all.filter(x => !deviceCaps(x).known).forEach(x => notes.push(`${deviceLabel(x)} katalogda yok; yetenekler doğrulanmadı.`));
  const bothLoaded = ids.every(i => facts[i].live);
  const existingOspf = ids.every(i => facts[i].ospf);
  const definitions = {
    vxlan: { title: 'VXLAN EVPN', icon: 'VX', confidence: bothLoaded ? 94 : 86, reason: `Aynı VLAN ${ids.length} farklı cihaz arasında Layer 2 olarak uzatılmak isteniyor. ${existingOspf ? 'Mevcut OSPF underlay korunuyor; ' : ''}overlay MP-BGP EVPN ile kuruluyor.`, tags: [`VLAN ${P.vid}`, `VNI ${P.vni}`, 'BGP EVPN', 'VTEP /32', topoTag] },
    bgp: { title: 'eBGP', icon: 'BG', confidence: bothLoaded ? 92 : 84, reason: 'Farklı AS numaraları ve kontrollü prefix ilanı istendiği için eBGP en uygun yöntem. Yalnızca belirtilen ağlar ilan ediliyor.', tags: [`AS ${ids.map(i => P.asnBgp[i]).join(' · ')}`, 'IPv4 unicast', 'Prefix kontrollü'] },
    ospf: { title: 'OSPF', icon: 'OS', confidence: existingOspf ? 96 : 88, reason: `${existingOspf ? 'Her iki mevcut config içinde OSPF bulundu. ' : ''}Aynı yönetim alanındaki ağlar için minimum operasyonel yükle dinamik yönlendirme sağlıyor.`, tags: ['Process 10', 'Area 0', 'Minimum delta'] },
    static: { title: 'Static route', icon: 'SR', confidence: 97, reason: 'Tek hedef ağ ve açık bir next-hop bulunduğu için yeni bir dinamik protokol eklemeden en küçük değişiklik sağlanıyor.', tags: [`${P.target}/${P.targetLen}`, 'Tek next-hop', 'Düşük değişiklik'] },
    eigrp: { title: 'EIGRP', icon: 'EI', confidence: 89, reason: 'Her iki cihaz profili ve kullanıcı niyeti EIGRP ile uyumlu. Mevcut routing alanı genişletiliyor.', tags: ['AS 100', 'Named mode', 'Cisco profili'] }
    ,security: { title: 'Secure Access + NAC', icon: 'SA', confidence: bothLoaded ? 92 : 83, reason: `${$('#nacPlatform').value} için 802.1X birincil, MAB fallback olacak şekilde pilot port politikası hazırlanıyor. RADIUS secret çıktıya yazılmıyor.`, tags: ['802.1X → MAB', 'CoA', '8 saat reauth', $('#nacPlatform').value] }
    ,cabling: { title: 'Leaf–Spine Fiziksel Plan + VXLAN EVPN', icon: 'FP', confidence: bothLoaded ? 91 : 82, reason: 'Boş olduğu beyan edilen uplink portları yedekli bağlantı için eşlendi. Kablo, port, IP ve VXLAN değişikliği aynı uygulama planında birleştirildi.', tags: [$('#linkSpeed').value, $('#mediaType').value, $('#redundancy').value, `VNI ${P.vni}`] }
    ,hardening: { title: state.mode==='new'?'Tam Switch Hardening Baseline':'Mevcut Config Hardening Planı', icon: 'SH', confidence: fa.live||state.mode==='new'?93:72, reason: state.mode==='new'?'Seçilen vendor ve cihaz profili için yönetim, erişim, logging, zaman, SNMPv3 ve Layer 2 korumalarını içeren tam başlangıç config’i hazırlanıyor.':'Yüklenen config denetleniyor; eksik kontroller için delta ve birleştirilmiş hedef config birlikte hazırlanıyor.', tags: ['SSH only', 'AAA + fallback', 'Management ACL', 'NTP · Syslog · SNMPv3'] }
    ,campus: { title: 'Hardening Uygulanmış Campus Tasarımı', icon: 'CB', confidence: 90, reason: `${state.campusInv ? state.campusInv.coreCount : 0} core ve ${state.campusInv ? state.campusInv.accessCount : 0} access switch için management IP, VLAN, STP, trunk, DHCP Snooping, DAI, IP Source Guard ve port planı birlikte üretildi.`, tags: [`${state.campusInv ? state.campusInv.coreCount : 0} core`, `${state.campusInv ? state.campusInv.accessCount : 0} access`, `${campusVlans().length} VLAN`, inputValue('campusRedundancy','dual')==='dual'?'Çift uplink':'Tek uplink'] }
  };
  const loadedCount = ids.filter(i => facts[i].live).length;
  definitions.audit = {
    title: 'Config Denetimi ve Öneriler', icon: 'CD', confidence: Math.round(60 + 40 * loadedCount / ids.length),
    reason: loadedCount ? `${loadedCount} cihazın yüklenen config'i seçili profillerle denetleniyor. Bulgular ciddiyete göre sıralanır; düzeltme komutları yer tutucularla hazırlanır, secret değerleri yazılmaz.` : "Denetim için en az bir cihazın running-config'ini yükleyin.",
    tags: auditProfilesFor('audit').map(p => AU.PROFILES[p])
  };
  if (state.module === 'wan') {
    const wi = state.wanInv; const tn = WAN_TYPE_NAME[wi.type].replace('{0}', wi.phase);
    definitions.wan = { title: 'WAN / VPN Tasarımı', icon: 'VP', confidence: 88,
      reason: `${wi.hubs.length} hub ve ${wi.spokes.length} spoke router için ${tn} ve ${wi.type === 's2s' && wi.overlay === 'static' ? 'statik rota' : wi.overlay.toUpperCase()} overlay yapılandırması üretildi; kripto parametreleri sabit, anahtarlar yer tutucudur.`,
      tags: [tn, 'IKEv2 · AES-256', `${wi.routers.length} router`, wi.type === 's2s' && wi.overlay === 'static' ? 'statik rota' : wi.overlay.toUpperCase()] };
  }
  const d = definitions[protocol];
  let alternatives = [
    { key: protocol, name: d.title, note: 'Önerilen · mevcut niyete en uygun', score: d.confidence, enabled: true },
    ...[['ospf', 72], ['bgp', 70], ['static', 54], ['eigrp', 68]].filter(([k]) => k !== protocol).map(([k, base]) => {
      const missing = all.filter(x => !supports(x, k));
      const ok = missing.length === 0 && !(protocol === 'vxlan' && k === 'static');
      return { key: k, name: PROTO_NAME[k], enabled: ok,
        note: missing.length ? `${missing.map(deviceLabel).join(' / ')} desteklemiyor` : (k === 'static' ? 'Küçük topolojide uygulanabilir' : 'Uygulanabilir alternatif'),
        score: ok ? (protocol === 'vxlan' && k !== 'static' ? 58 : base) : 0 };
    })
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
  if (protocol === 'hardening') alternatives = [
    { key:'hardening', name:'Kurumsal hardening baseline', note:'Önerilen · tam kapsam', score:d.confidence, enabled:true },
    { key:'hardening', name:'Yalnız management plane', note:'SSH, AAA, ACL ve logging', score:74, enabled:false },
    { key:'security', name:'Secure Access ekle', note:'802.1X, MAB ve NAC katmanı · ayrı modül', score:68, enabled:false }
  ];
  if (protocol === 'campus') alternatives = [
    { key:'campus', name:'Dual-core campus', note:'Önerilen · STP ve first-hop redundancy', score:d.confidence, enabled:true },
    { key:'campus', name:'Tek core campus', note:'Daha düşük maliyet · formdan seçilebilir', score:65, enabled:false },
    { key:'vxlan', name:'VXLAN EVPN fabric', note:'Büyük ölçekli kampüs/veri merkezi alternatifi', score:70, enabled:true }
  ];
  if (fallbackCount && state.module === 'routing') d.reason = notes[0] + ' ' + d.reason;
  state.solution = protocol;
  const noCfg = 'Bu cihaz için config yüklenmedi; denetim yapılamadı. "Dosya seç" ile running-config yükleyin.';
  if (protocol === 'audit') alternatives = [
    { key: 'audit', name: 'Seçili profillerle denetim', note: "Önerilen · yüklenen config'e göre", score: d.confidence, enabled: true },
    { key: 'hardening', name: 'Sıfırdan hardening baseline', note: 'Config yoksa Switch Hardening modülü tam hedef config üretir', score: 60, enabled: false }
  ];
  if (protocol === 'wan') {
    const wi = state.wanInv;
    alternatives = [{ key: 'wan', name: WAN_TYPE_NAME[wi.type].replace('{0}', wi.phase), note: 'Önerilen · niyetine göre', score: d.confidence, enabled: true },
      ...['dmvpn', 'gre', 's2s'].filter(t => t !== wi.type).map(t => ({ key: 'wan', name: WAN_TYPE_NAME[t].replace('{0}', wi.phase), note: 'Niyetinde türü belirterek seçebilirsin', score: 0, enabled: false }))];
  }
  const outputs = {};
  ids.forEach(i => {
    const dev = devsMap[i], au = audits[i], lab = { ...dev, label: vendorName(dev.vendor) };
    if (protocol === 'audit') {
      outputs[i] = au ? { delta: AU.fixScript(au), verify: AU.verifyText(au), rollback: AU.rollbackText(au), audit: AU.report(lab, au) } : { delta: noCfg, verify: noCfg, rollback: noCfg, audit: noCfg };
    } else {
      outputs[i] = vendorConfigs(dev.vendor, protocol, i);
      if (outputs[i] && (protocol === 'hardening' || protocol === 'security')) {
        if (au) outputs[i] = { ...outputs[i], audit: AU.report(lab, au) };
        else if (protocol === 'security') outputs[i] = { ...outputs[i], audit: noCfg };
      }
    }
  });
  const cmx = window.NETCUBE_CM ? window.NETCUBE_CM.process(protocol, intent, ids, devsMap, outputs, notes) : { riskText: '', crText: '', preflight: [] };
  state.plan = { notes, intent, ids, devices: devsMap, facts, topo, a, b, fa, fb, definition: d, alternatives, outputs, audits, risk: cmx.risk, riskText: cmx.riskText, crText: cmx.crText, preflight: cmx.preflight };
  renderPlan();
  renderRiskBanner();
}

function renderPlan() {
  const p = state.plan; const d = p.definition;
  $('#protocolIcon').textContent = d.icon;
  $('#confidence').textContent = `%${d.confidence} güven`;
  $('#solutionTitle').textContent = d.title;
  $('#solutionReason').textContent = d.reason;
  $('#planTags').innerHTML = d.tags.map(t => `<span>${t}</span>`).join('');
  const total = p.ids.length; const missing = p.ids.filter(i => p.facts[i].live).length;
  $('#warningBox').innerHTML = missing === total
    ? '<b>Canlı config analiz edildi</b><span>Öneri, yüklenen snapshot üzerindeki en küçük değişiklik olarak hazırlandı.</span>'
    : `<b>${total - missing} config eksik</b><span>Eksik cihaz için model tabanlı varsayım kullanıldı; uygulamadan önce gerçek config ile yeniden doğrulanmalı.</span>`;
  if (state.intentGuessed && state.module === 'routing') {
    $('#warningBox').innerHTML = '<b>Niyet net anlaşılamadı</b><span>Metinde tanınan bir anahtar kelime bulunamadı; varsayılan olarak OSPF önerildi. Alternatiflerden doğru çözümü seçin veya niyeti daha açık yazın.</span>';
  }
  if (state.solution === 'hardening') {
    $('#warningBox').innerHTML = state.mode === 'live' && !p.fa.live
      ? '<b>Config gerekli</b><span>Canlı switch için güvenli delta ve gerçek rollback üretmek üzere mevcut running-config yüklenmelidir.</span>'
      : '<b>Secret koruması</b><span>Parola, RADIUS anahtarı, SNMPv3 auth/priv anahtarları ve private key değerleri placeholder olarak bırakıldı.</span>';
  }
  if (state.solution === 'audit') {
    const miss = p.ids.filter(i => !p.audits[i]).length;
    $('#warningBox').innerHTML = miss
      ? `<b>${miss} cihazın config'i eksik</b><span>Config yüklenmeyen cihazlar denetlenemez. Her cihaz kartında "Dosya seç" ile running-config yükleyin.</span>`
      : '<b>Denetim tamamlandı</b><span>Bulgular yüklenen config snapshot\'ına göre hesaplandı; çalışan sistemde (lisans, sürüm, runtime) doğrulayın.</span>';
  }
  if (state.solution === 'wan') $('#warningBox').innerHTML = '<b>Yeni kurulum</b><span>Her router için config, girdiğin üretici/model/hostname bilgilerinden ve niyetinden üretildi; arayüz adlarını ve WAN maskelerini doğrulayın.</span>';
  if (state.solution === 'campus') $('#warningBox').innerHTML = '<b>Yeni kurulum</b><span>Her cihaz için config, girdiğin üretici/model/hostname bilgilerinden ve niyetinden üretildi; port adlarını sahada doğrulayın.</span>';
  if (p.notes && p.notes.length) $('#warningBox').innerHTML += p.notes.map(n => `<span class="compat-note">⚠ ${n}</span>`).join('');
  $('#alternativeList').innerHTML = p.alternatives.map((a, i) => `<div class="alternative-row"><div><strong>${a.name}</strong><small>${a.note}</small></div><div class="score-track"><i style="width:${a.score}%"></i></div><span class="score">${a.enabled ? '%' + a.score : '—'}</span><button class="alt-action" data-alt="${a.key}" ${!a.enabled || i === 0 ? 'disabled' : ''}>${i === 0 ? 'Seçili' : 'İncele'}</button></div>`).join('');
  renderCablingPlan();
  renderCampusTopology();
  renderAuditCard();
  const now = new Intl.DateTimeFormat(window.I18N ? I18N.locale() : 'tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#snapshotLabel').textContent = `Config snapshot · ${now}`;
  updateDeviceTabs(); renderOutput();
  $('#results').hidden = false; { const lay = $('#layout'); if (lay) lay.classList.add('has-results'); }
  setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function devLabel(p, id) { const d = p.devices[id]; return `${id.toUpperCase()} · ${vendorName(d.vendor)} ${d.model}`; }

function renderCablingPlan() {
  const p = state.plan;
  const show = ['cabling', 'vxlan', 'ospf', 'bgp', 'eigrp'].includes(state.solution) && p.topo && p.topo.links.length > 0;
  $('#cablingCard').hidden = !show;
  if (!show) return;
  const media = $('#mediaType')?.value || 'QSFP28 DAC';
  const speed = $('#linkSpeed')?.value || '100 Gbps';
  const rows = p.topo.links.map(l => ({ id: l.id, source: devLabel(p, l.x), sp: l.xPort, target: devLabel(p, l.y), tp: l.yPort, media: `${speed} · ${media} · ${l.subnet}` }));
  $('#cableRows').innerHTML = rows.map(r => `<tr><td>${r.id}</td><td>${r.source}</td><td><code>${r.sp}</code></td><td>${r.target}</td><td><code>${r.tp}</code></td><td>${r.media}</td><td><span class="cable-state">Önerildi</span></td></tr>`).join('');
  $('#cablePlanStatus').textContent = `${rows.length} BAĞLANTI · SAHADA DOĞRULA`;
  $('#fieldOrderText').textContent = rows.map(r => `${r.id}: ${r.source} port ${r.sp} → ${r.target} port ${r.tp}`).join(' · ');
}

function svgNode(x, y, w, h, cls, lines) {
  const text = lines.map((t, i) => `<text class="${i === 0 ? 'node-label' : 'node-meta'} ${cls === 'node node-core' ? (i === 0 ? 'core-label' : 'core-meta') : ''}" x="${x}" y="${y - h / 2 + 22 + i * 17}" text-anchor="middle">${t}</text>`).join('');
  return `<g><rect class="${cls}" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="12"/>${text}</g>`;
}

function renderFabricTopology() {
  const card = $('#topologyCard'); const p = state.plan;
  const show = ['cabling', 'vxlan', 'ospf', 'bgp', 'eigrp'].includes(state.solution) && p.topo && p.topo.links.length > 0;
  card.hidden = !show; if (!show) return;
  const t = p.topo, ids = p.ids, W = 960, H = t.mode === 'leaf-spine' ? 360 : 400;
  const pos = {};
  if (t.mode === 'leaf-spine') {
    t.spines.forEach((id, i) => { pos[id] = { x: W * (i + 1) / (t.spines.length + 1), y: 90 }; });
    t.leaves.forEach((id, i) => { pos[id] = { x: W * (i + 1) / (t.leaves.length + 1), y: 270 }; });
  } else {
    ids.forEach((id, i) => { const ang = -Math.PI / 2 + 2 * Math.PI * i / ids.length; pos[id] = ids.length === 2 ? { x: W * (i + 1) / 3, y: 190 } : { x: W / 2 + 330 * Math.cos(ang), y: 190 + 125 * Math.sin(ang) }; });
  }
  const seen = {};
  const lines = t.links.map(l => {
    const key = l.x + l.y; seen[key] = (seen[key] || 0) + 1;
    const total = t.links.filter(z => z.x + z.y === key).length;
    const off = (seen[key] - 1 - (total - 1) / 2) * 12;
    return `<line class="link${seen[key] > 1 ? ' secondary' : ''}" x1="${pos[l.x].x + off}" y1="${pos[l.x].y}" x2="${pos[l.y].x + off}" y2="${pos[l.y].y}"><title>${l.id}: ${l.x.toUpperCase()} ${l.xPort} ↔ ${l.y.toUpperCase()} ${l.yPort} · ${l.subnet}</title></line>`;
  }).join('');
  const nodes = ids.map(id => {
    const d = p.devices[id]; const spine = window.NETCUBE_FABRIC.isSpine(t, id);
    return svgNode(pos[id].x, pos[id].y, 170, 62, spine ? 'node node-core' : 'node', [`${id.toUpperCase()} · ${spine ? 'SPINE' : (t.mode === 'leaf-spine' ? 'LEAF' : d.role.toUpperCase())}`, d.model, state.params.ip[id]]);
  }).join('');
  $('#topologyDiagram').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><title>${ids.length} cihazlı fabric topolojisi</title>${lines}${nodes}</svg>`;
  $('.subhead h3', card).textContent = 'Fabric topolojisi';
  $('.subhead p', card).textContent = t.mode === 'leaf-spine' ? 'Spine / leaf bağlantıları ve loopback adresleri' : 'Cihazlar arası bağlantılar (mesh) ve loopback adresleri';
  $('#topologySummary').textContent = t.mode === 'leaf-spine' ? `${t.spines.length} SPINE · ${t.leaves.length} LEAF · ${t.links.length} LINK` : `${ids.length} CİHAZ · ${t.links.length} LINK`;
  $('#topologyLegend').innerHTML = t.links.map(l => `<span>${l.id} · ${l.subnet}</span>`).join('');
}

function renderCampusTopology() {
  if (state.solution === 'wan') { renderWanTopology(); return; }
  const card = $('#topologyCard');
  if (state.solution !== 'campus') { renderFabricTopology(); return; }
  card.hidden = false;
  $('.subhead h3', card).textContent = 'Campus topolojisi'; $('.subhead p', card).textContent = 'Core, access, uplink ve VLAN kapsamı';
  const inv = state.campusInv || campusInventory(); const virt = inv.virt; const layered = Boolean(virt && virt.layered);
  const nc = Math.max(1, inv.coreCount), na = Math.max(1, inv.accessCount);
  const width = Math.max(960, 104 * Math.max(layered ? 2 : nc, na)), height = layered ? 470 : 380;
  const yCore = layered ? 70 : 87, yAgg = 205, yAcc = layered ? 392 : 279;
  const coreW = Math.min(190, layered ? 200 : width / nc - 16), accW = Math.min(160, width / na - 8);
  const pos = {};
  if (layered) virt.pairs.forEach((p, i) => { const y = i === 0 ? yCore : yAgg; pos[p.a.id] = { x: width * 0.38, y }; pos[p.b.id] = { x: width * 0.62, y }; });
  else inv.cores.forEach((c, i) => { pos[c.id] = { x: width * (i + 1) / (nc + 1), y: yCore }; });
  inv.accesses.forEach((a, i) => { pos[a.id] = { x: width * (i + 1) / (na + 1), y: yAcc }; });
  const count = {}; const lines = inv.links.map(l => {
    const key = l.access.id + '|' + l.core.id; const k = count[key] = (count[key] || 0) + 1;
    const off = (k - 1) * 7; const a = pos[l.core.id], b = pos[l.access.id];
    return `<line class="link ${l.u > 0 ? 'secondary' : ''}" x1="${a.x + off}" y1="${a.y + 33}" x2="${b.x + off}" y2="${b.y - 34}"><title>${escHtml(l.access.hostname)} ${escHtml(l.aPort)} → ${escHtml(l.core.hostname)} ${escHtml(l.cPort)}${l.lag ? ` (LAG ${l.lag})` : ''}</title></line>`;
  });
  inv.interLinks.forEach(il => { const a = pos[il.x.id], b = pos[il.y.id]; lines.push(`<line class="link lag" x1="${a.x}" y1="${a.y + 34}" x2="${b.x}" y2="${b.y - 34}"><title>${escHtml(il.x.hostname)} ${escHtml(il.xPort)} → ${escHtml(il.y.hostname)} ${escHtml(il.yPort)} (LAG 200)</title></line>`); });
  if (inv.interlink) { const a = pos[inv.interlink.a.id], b = pos[inv.interlink.b.id]; lines.push(`<line class="link lag" x1="${a.x + coreW / 2}" y1="${a.y}" x2="${b.x - coreW / 2}" y2="${b.y}"><title>INTER-CORE (Port-channel 255)</title></line>`); }
  const boxes = virt ? virt.pairs.map((p, i) => { const a = pos[p.a.id], b = pos[p.b.id]; const x0 = Math.min(a.x, b.x) - coreW / 2 - 12, x1 = Math.max(a.x, b.x) + coreW / 2 + 12; return `<rect class="pair-box" x="${x0}" y="${a.y - 50}" width="${x1 - x0}" height="100" rx="14"/><text class="node-meta" x="${x0 + 10}" y="${a.y - 56}">${escHtml(VIRT_NAME[virt.kind])} · ${i + 1}${layered ? (i === 0 ? ' · core' : ' · aggregation') : ''}</text>`; }).join('') : '';
  const cores = inv.cores.map(c => svgNode(pos[c.id].x, pos[c.id].y, coreW, 68, 'node node-core', [escHtml(c.hostname), escHtml(c.model), escHtml(ipOnly(c.mgmt))])).join('');
  const access = inv.accesses.map(a => svgNode(pos[a.id].x, pos[a.id].y, accW, 68, 'node', [escHtml(a.hostname) + (a.stack > 1 ? ` ×${a.stack}` : ''), escHtml(a.model), escHtml(ipOnly(a.mgmt))])).join('');
  $('#topologyDiagram').innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-labelledby="topologyTitle"><title id="topologyTitle">${inv.coreCount} core ve ${inv.accessCount} access switch campus topolojisi</title>${boxes}${lines.join('')}${cores}${access}<text class="node-meta" x="${width / 2}" y="${height - 28}" text-anchor="middle">Düz çizgi: primary uplink · Kesikli çizgi: secondary uplink · Hover: port eşleşmesi</text></svg>`;
  $('#topologySummary').textContent = `${inv.coreCount} CORE · ${inv.accessCount} ACCESS · ${inv.links.length + inv.interLinks.length} LINK`;
  $('#topologyLegend').innerHTML = inv.vlans.map(v => `<span>VLAN ${v.id} · ${escHtml(v.name)}</span>`).join('');
}

function fieldOrderText() {
  const p = state.plan; const links = p.topo ? p.topo.links : [];
  const lines = links.map((l, i) => `${i + 2}. ${l.id}: ${devLabel(p, l.x)} port ${l.xPort} → ${devLabel(p, l.y)} port ${l.yPort} (${l.subnet}).`).join('\n');
  const n = links.length;
  return `SAHA UYGULAMA EMRİ\n\n1. Cihaz adlarını, rack konumlarını ve portların boş olduğunu doğrulayın.\n${lines}\n${n + 2}. Her bağlantıda ${$('#linkSpeed')?.value || '100 Gbps'} link durumunu doğrulayın.\n${n + 3}. LLDP komşularını beklenen cihaz ve portlarla karşılaştırın.\n${n + 4}. Underlay komşuluğu kurulduktan sonra VXLAN/EVPN doğrulamasına geçin.\n\nKABLO: ${$('#cableLength')?.value || '3 m'} ${$('#mediaType')?.value || 'QSFP28 DAC'}\nDURUM: Portlar config/envanter beyanından önerildi; fiziksel boşluk sahada doğrulanmalı.`;
}

function updateDeviceTabs() {
  const p = state.plan;
  if (state.solution === 'hardening') state.outputDevice = 'a';
  if (!p.ids.includes(state.outputDevice)) state.outputDevice = p.ids[0];
  const visible = p.ids.filter(id => !(state.solution === 'hardening' && id !== 'a'));
  $('#deviceTabs').innerHTML = visible.map(id => {
    const info = p.devices[id];
    let label;
    if (state.solution === 'campus' || state.solution === 'wan') label = p.devices[id].hostname || id.toUpperCase();
    else {
      const spine = p.topo && window.NETCUBE_FABRIC.isSpine(p.topo, id);
      label = `${id.toUpperCase()}${spine ? ' · Spine' : ''}`;
    }
    return `<button type="button" class="${id === state.outputDevice ? 'active' : ''}" data-output-device="${id}">${label} · ${vendorName(info.vendor)}</button>`;
  }).join('');
}

function analysisText(id) {
  const p = state.plan; const info = p.devices[id]; const f = p.facts[id];
  return `CİHAZ ANALİZİ\n\nVendor        : ${vendorName(info.vendor)}\nModel         : ${info.model}\nİşletim sistemi: ${info.os || 'Belirtilmedi'} ${info.version}\nConfig durumu : ${f.live ? 'Yüklendi ve tarandı' : 'Yüklenmedi — profil varsayımı'}\nHostname      : ${f.hostname || 'Tespit edilemedi'}\nMevcut OSPF   : ${f.ospf ? 'Evet' : 'Tespit edilmedi'}\nMevcut BGP    : ${f.bgp ? 'Evet' : 'Tespit edilmedi'}\nMevcut VXLAN  : ${f.vxlan ? 'Evet' : 'Tespit edilmedi'}${f.live ? `\nVLAN sayısı   : ${f.parsed.vlans.length}\nArayüz sayısı : ${f.parsed.ifaces.length}\nOSPF process  : ${f.parsed.ospf ? f.parsed.ospf.pid + ' (area ' + (f.parsed.ospf.areas.join(', ') || '-') + ')' : '-'}\nBGP AS        : ${f.parsed.bgp ? f.parsed.bgp.asn + ' · ' + f.parsed.bgp.neighbors.length + ' komşu' : '-'}\nVNI           : ${f.parsed.vnis.join(', ') || '-'}\n` : ''}\nKONTROLLER\n${(p.notes && p.notes.length) ? p.notes.map(n => '• ' + n).join('\n') : '• Çakışma veya uyumsuzluk bulunmadı.'}\n\nKARAR\n${p.definition.title} önerildi. ${p.definition.reason}\n\nGÜVENLİK NOTU\nBu prototip config'i cihaza uygulamaz. Platform komutları model ve sürüm dokümanlarıyla doğrulanmadan üretimde kullanılmamalıdır.`;
}

function renderOutput() {
  const p = state.plan; if (!p) return;
  const info = p.devices[state.outputDevice];
  const output = p.outputs[state.outputDevice];
  let text;
  if (state.outputPanel === 'analysis') text = analysisText(state.outputDevice);
  else if (state.outputPanel === 'field') text = fieldOrderText();
  else if (state.outputPanel === 'risk') text = p.riskText || 'Risk değerlendirmesi üretilemedi.';
  else if (state.outputPanel === 'cr') text = p.crText || 'Değişiklik talebi üretilemedi.';
  else if (!output) text = `Bu çözüm ${vendorName(info.vendor)} ${info.model} profili için uygun görünmüyor.\n\nAlternatif olarak OSPF veya BGP planı seçin.`;
  else text = output[state.outputPanel] || 'Bu bölüm için çıktı bulunamadı.';
  if (state.outputPanel === 'diff' && output && output.diff) text = output.diff;
  const dtg = $('#diffToggle'); if (dtg) { dtg.hidden = !(state.outputPanel === 'diff' && output && output.diffOps); $$('button', dtg).forEach(b => b.classList.toggle('active', b.dataset.diffview === (state.diffView || 'side'))); }
  if (state.outputPanel === 'diff' && output && output.diffOps && (state.diffView || 'side') === 'side' && window.NETCUBE_CM) {
    $('#codeOutput').innerHTML = window.NETCUBE_CM.sideBySideHtml(output.diff, output.diffOps);
  } else if (state.outputPanel === 'diff' && output && output.diff) {
    const dt = window.NETCUBE_CM ? window.NETCUBE_CM.trDiff(output.diff) : output.diff;
    $('#codeOutput').innerHTML = dt.split('\n').map(l => `<span class="${l.startsWith('+ ') ? 'diff-add' : l.startsWith('- ') ? 'diff-del' : ''}">${escHtml(l)}</span>`).join('\n');
  } else $('#codeOutput').textContent = text;
  $('#codeLabel').textContent = `${vendorName(info.vendor).toUpperCase()} ${info.os.toUpperCase()} · ${state.outputPanel.toUpperCase()}`;
  $$('.output-nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === state.outputPanel));
  $('#deltaCaption').textContent = state.solution === 'hardening'
    ? (state.mode === 'new' ? 'Yeni switch için baştan sona uygulanabilir baseline' : 'Mevcut config’e göre delta, hedef config ve hardening raporu')
    : state.solution === 'campus' ? 'Tüm core ve access switchler için hardening uygulanmış tam config' : state.solution === 'wan' ? 'Her router için tam VPN config (anahtarlar yer tutucudur)' : state.solution === 'audit' ? 'Bulgulara göre önerilen düzeltme komutları (secret değerleri yer tutucudur)' : 'Mevcut config üzerine uygulanacak minimum komutlar';
  let orders = state.solution === 'vxlan' || state.solution === 'cabling'
    ? ['Underlay erişimini ve loopback rotalarını doğrula', 'Spine/route-reflector EVPN komşuluklarını hazırla', 'Leaf VTEP ve VLAN–VNI eşleşmesini uygula', 'EVPN route ve MAC öğrenimini doğrula']
    : state.solution === 'campus'
      ? ['Management IP, VLAN ve port planını onayla', 'Önce core switchleri ve STP root rollerini yapılandır', 'Access switchleri management VLAN üzerinden erişilebilir hale getir', 'Trunkları kablo/port planına göre bağla', 'DHCP Snooping, DAI ve IP Source Guard testlerini tamamla']
    : state.solution === 'hardening'
      ? ['Mevcut config ve OOB/konsol erişimini yedekle', 'Management IP, ACL ve AAA değerlerini doğrula', 'Önce SSH/logging/NTP, sonra AAA ve ACL uygula', 'Yeni oturumla yönetim erişimini test et', 'Layer 2 korumalarını pilot port/VLAN üzerinde etkinleştir']
    : state.solution === 'security'
      ? ['NAC/RADIUS politikasını hazırla', 'Tek pilot portta uygula', 'Başarılı, MAB ve RADIUS-down senaryolarını test et', 'Doğrulama sonrası port grubuna genişlet']
      : ['Ön kontrol komutlarını çalıştır', 'Hedef cihaz konfigürasyonunu uygula', 'Kaynak cihaz konfigürasyonunu uygula', 'Komşuluk ve route tablosunu doğrula'];
  if (state.solution === 'wan') orders = ['Router envanterini, WAN IP/maske ve LAN alt ağlarını doğrula', 'Önce hub router(lar)ı yapılandır (kripto + tünel + overlay)', 'Spoke router\'ları sırayla ekle; her birinde IKE/IPsec SA ve NHRP kaydını doğrula', 'Overlay komşuluklarını ve LAN rotalarını doğrula', 'MTU/MSS ve uygulama trafiği testlerini yap'];
  if (state.solution === 'audit') orders = ['Config yedeğini alın ve geri dönüş noktası oluşturun (Rollback sekmesi)', 'Kritik ve Yüksek bulguları önce pilot cihazda, konsol erişimi açıkken uygulayın', 'Yer tutucuları (<...>) kurumunuzun değerleriyle doldurun', 'Doğrulama komutlarını çalıştırın ve yeni config ile denetimi tekrarlayın', 'Puan ve bulguları onaylayıp diğer cihazlara yayın'];
  $('#applyOrder').innerHTML = orders.map(x => `<li>${x}</li>`).join('');
}

function switchAlternative(protocol) {
  if (!PROTO_NAME[protocol]) return;
  state.forced = protocol;
  analyzePlan();
}

$$('.segmented button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('.module-picker button').forEach(b => b.addEventListener('click', () => setModule(b.dataset.module)));
const MAX_DEVICES = 6;
function deviceIds() { return $$('.device-card').map(c => c.dataset.device); }
function activeDeviceIds() { return $$('.device-card').filter(c => !c.hidden).map(c => c.dataset.device); }

function bindCard(card) {
  const id = () => card.dataset.device;
  $('.vendor', card).addEventListener('change', e => {
    $('.vendor-dot', card).className = `vendor-dot ${e.target.value}`;
    fillModelSelect($('.model', card), e.target.value);
    delete $('.ports', card).dataset.touched;
    applyModelDefaults(card);
    if (state.module === 'audit') {
      $('.model', card).value = CUSTOM_MODEL; $('.custom-model', card).hidden = true;
      if (!$('.model-custom', card).value) $('.model-custom', card).value = 'config';
      $('.os', card).value = OS_BY_VENDOR[$('.vendor', card).value]; $('.version', card).value = '';
      renderDetectChip(card);
    }
  });
  $('.role', card).addEventListener('change', () => { if (state.module === 'audit') renderDetectChip(card); });
  const ovr = $('.audit-override-toggle', card); if (ovr) ovr.addEventListener('click', () => card.classList.toggle('show-override'));
  $('.model', card).addEventListener('change', () => { delete $('.ports', card).dataset.touched; applyModelDefaults(card); });
  $('.model-custom', card).addEventListener('input', () => renderCaps(card));
  $('.ports', card).addEventListener('input', e => { e.target.dataset.touched = '1'; });
  $('.sample-config', card).addEventListener('click', () => {
    state.configs[id()] = sampleConfig($('.vendor', card).value, id());
    if (state.module === 'audit') { delete card.dataset.detected; autoDetectCard(card); }
    const status = $('.config-status', card); status.textContent = `Örnek config · ${window.summarizeConfig(window.parseConfig(state.configs[id()]))}`; status.classList.add('loaded');
  });
  $('.config-file', card).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    state.configs[id()] = await file.text();
    if (state.module === 'audit') { delete card.dataset.detected; autoDetectCard(card); }
    const status = $('.config-status', card); status.textContent = `${file.name} · ${window.summarizeConfig(window.parseConfig(state.configs[id()]))}`; status.classList.add('loaded');
  });
  const rm = $('.remove-device', card);
  if (rm) rm.addEventListener('click', () => removeDevice(id()));
}

function refreshDeviceActions() {
  const n = activeDeviceIds().length;
  const note = $('#deviceCountNote'); if (note) note.textContent = `${n} / ${MAX_DEVICES} cihaz`;
  const btn = $('#addDeviceButton'); if (btn) btn.disabled = n >= MAX_DEVICES;
}

function addDevice(raw) {
  if (!raw && state.module === 'audit') { const hid = $$('.device-card').find(c => c.hidden); if (hid) { hid.dataset.shown = '1'; hid.hidden = false; refreshDeviceActions(); return; } }
  const ids = deviceIds(); if (ids.length >= MAX_DEVICES) return;
  let letter = 'a'; for (let i = 0; i < 26; i++) { const l = String.fromCharCode(97 + i); if (!ids.includes(l)) { letter = l; break; } }
  const card = document.querySelector('[data-device="b"]').cloneNode(true);
  card.dataset.device = letter; card.hidden = false;
  $('.device-index', card).textContent = letter.toUpperCase();
  $('.device-title strong', card).textContent = `Cihaz ${letter.toUpperCase()}`;
  $('.device-title small', card).textContent = `Leaf ${ids.length + 1}`;
  $('.config-status', card).textContent = 'Henüz yüklenmedi'; $('.config-status', card).classList.remove('loaded');
  $('.config-file', card).value = '';
  card.classList.remove('show-override'); delete card.dataset.detected; delete card.dataset.shown; const ar = $('.audit-remove', card); if (ar) ar.remove(); renderDetectChip(card);
  delete $('.ports', card).dataset.touched;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'remove-device'; btn.setAttribute('aria-label', `Cihaz ${letter.toUpperCase()} kaldır`); btn.textContent = '×';
  $('.device-title', card).appendChild(btn);
  state.configs[letter] = '';
  $('.device-grid').appendChild(card);
  const vendors = ['cisco', 'aruba', 'huawei']; const v = vendors[ids.length % 3];
  $('.vendor', card).value = v; $('.vendor-dot', card).className = `vendor-dot ${v}`;
  const pick = catalogFor(v).find(d => d.caps.vxlan && d.roles.includes('leaf')) || catalogFor(v)[0];
  fillModelSelect($('.model', card), v, pick && pick.model);
  $('.role', card).value = 'leaf';
  bindCard(card); applyModelDefaults(card); refreshDeviceActions(); retitleCards(state.module);
}

function removeDevice(id) {
  if (deviceIds().length <= 2 || ['a', 'b'].includes(id)) return;
  document.querySelector(`[data-device="${id}"]`).remove();
  delete state.configs[id]; refreshDeviceActions();
}

$$('.device-card').forEach(card => { tagCard(card); ensureAuditUi(card); });
$$('.device-card').forEach(card => {
  const defaults = { a: 'C9300X-24Y', b: 'CX 6300M' };
  fillModelSelect($('.model', card), $('.vendor', card).value, defaults[card.dataset.device]);
  applyModelDefaults(card);
  bindCard(card);
});
$('#addDeviceButton').addEventListener('click', () => addDevice());
refreshDeviceActions();
$('#intentInput').addEventListener('input', () => { state.forced = null; });
$('#exampleButton').addEventListener('click', () => {
  state.forced = null; const list = MODULE_EXAMPLES[state.module] || examples; const idx = ((state.exIdx = state.exIdx || {})[state.module] = ((state.exIdx[state.module] ?? -1) + 1) % list.length);
  $('#intentInput').value = window.I18N ? I18N.t(list[idx]) : list[idx];
});
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


// ---------- Config denetimi ----------
function escHtml(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function auditProfilesFor(module) {
  if (module === 'hardening') return ['hardening', 'l2'];
  if (module === 'security') return ['dot1x'];
  if (module === 'audit') {
    const map = { auditHardening: 'hardening', auditL2: 'l2', auditDot1x: 'dot1x', auditRouting: 'routing', auditVpn: 'vpn' };
    return Object.keys(map).filter(id => { const el = document.getElementById(id); return el && el.checked; }).map(id => map[id]);
  }
  return [];
}

function auditParams() {
  const list = t => t.split(',').map(x => x.trim()).filter(Boolean);
  const a = state.module === 'audit';
  const adminNet = inputValue(a ? 'auditAdminNet' : 'adminNetwork', '10.10.10.0/24');
  const parts = adminAclParts(adminNet);
  return {
    ntp: list(inputValue(a ? 'auditNtp' : 'ntpServers', '')),
    syslog: inputValue(a ? 'auditSyslog' : 'syslogServer', ''),
    radius: list(inputValue(a ? 'auditRadius' : 'radiusServers', '')),
    adminNet, adminIp: parts.ip, wildcard: parts.wildcard
  };
}

function renderAuditCard() {
  const card = $('#auditCard'); const p = state.plan; const AU = window.NETCUBE_AUDIT;
  const done = Object.keys(p.audits || {});
  const show = done.length > 0 || state.solution === 'audit';
  card.hidden = !show; if (!show) return;
  const avg = done.length ? Math.round(done.reduce((s, i) => s + p.audits[i].score, 0) / done.length) : 0;
  $('#auditSummary').textContent = done.length ? `${done.length} CİHAZ · ORTALAMA ${avg}/100` : 'CONFIG YÜKLENMEDİ';
  $('#auditBody').innerHTML = p.ids.filter(i => !(state.solution === 'hardening' && i !== 'a')).map(id => {
    const d = p.devices[id], au = p.audits[id];
    const head = `${id.toUpperCase()} · ${escHtml(vendorName(d.vendor))} ${escHtml(d.model)}`;
    if (!au) return `<div class="audit-dev"><div class="audit-dev-head"><strong>${head}</strong><span class="audit-nocfg">Config yüklenmedi</span></div></div>`;
    const fails = au.findings.filter(f => f.status === 'fail');
    const cls = au.score >= 80 ? 'good' : au.score >= 50 ? 'warn' : 'bad';
    const chips = ['critical', 'high', 'medium', 'low'].filter(k => au.counts[k]).map(k => `<span class="sev sev-${k}">${au.counts[k]} ${AU.SEV[k].label}</span>`).join('') || '<span class="sev sev-ok">Bulgu yok</span>';
    const top = fails.slice(0, 8).map(f => `<li><span class="sev sev-${f.sev}">${AU.SEV[f.sev].label}</span><div><b>${f.id} · ${escHtml(f.title)}</b>${f.detail ? `<small>${escHtml(f.detail)}</small>` : ''}</div></li>`).join('');
    return `<div class="audit-dev"><div class="audit-dev-head"><strong>${head}</strong><div class="audit-score ${cls}"><b>${au.score}</b><small>/100</small></div></div><div class="audit-bar ${cls}"><i style="width:${au.score}%"></i></div><div class="audit-counts">${chips}<span class="audit-pass">${au.counts.pass} başarılı · ${au.counts.na} uygulanamaz</span></div>${top ? `<ul class="audit-list">${top}</ul>` : ''}${fails.length > 8 ? `<p class="audit-more">+${fails.length - 8} bulgu daha: "Denetim raporu" sekmesinde</p>` : ''}</div>`;
  }).join('');
}

// Cihaz kartı başlıkları modüle göre: routing'de Kaynak/Hedef, diğerlerinde genel cihaz başlığı
function retitleCards(module) {
  const generic = { audit: 'Denetlenecek cihaz', security: "Erişim switch'i", hardening: 'Hardening uygulanacak switch' }[module];
  $$('.device-card').forEach((c, idx) => {
    const id = c.dataset.device, L = id.toUpperCase();
    const strong = $('.device-title strong', c), small = $('.device-title small', c);
    if (!strong || !small) return;
    if (generic) { strong.textContent = `Cihaz ${L}`; small.textContent = generic; }
    else if (id === 'a') { strong.textContent = 'Kaynak cihaz'; small.textContent = 'Merkez / Leaf 1'; }
    else if (id === 'b') { strong.textContent = 'Hedef cihaz'; small.textContent = 'Şube / Leaf 2'; }
    else { strong.textContent = `Cihaz ${L}`; small.textContent = `Leaf ${idx + 1}`; }
  });
}

// ---------- Denetim modu: yalnızca config yükleme kartı ----------
const OS_BY_VENDOR = { cisco: 'IOS-XE', aruba: 'AOS-CX', huawei: 'VRP' };

function tagCard(card) {
  [['vendor', 'f-vendor'], ['model', 'f-model'], ['os', 'f-os'], ['version', 'f-version'], ['role', 'f-role'], ['ports', 'f-ports']].forEach(([cls, f]) => {
    const el = $('.' + cls, card); const lab = el && el.closest('label'); if (lab) lab.classList.add(f);
  });
}

function ensureAuditUi(card) {
  if ($('.audit-detect', card)) return;
  const box = document.createElement('div'); box.className = 'audit-detect';
  box.innerHTML = '<span class="detect-chip"></span><button type="button" class="text-button audit-override-toggle">Algılananı değiştir</button>';
  const zone = $('.config-zone', card); zone.parentNode.insertBefore(box, zone.nextSibling);
  renderDetectChip(card);
}

function renderDetectChip(card) {
  const chip = $('.detect-chip', card); if (!chip) return;
  const id = card.dataset.device;
  if (!(state.configs[id] || '').trim()) { chip.textContent = 'Config yüklenince üretici ve rol otomatik algılanır'; return; }
  const v = $('.vendor', card).value;
  const host = $('.model', card).value === CUSTOM_MODEL ? $('.model-custom', card).value.trim() : '';
  const role = $('.role', card).value === 'leaf' ? 'Access / leaf' : 'Core / spine';
  const ver = $('.version', card).value.trim();
  chip.textContent = `Algılanan: ${vendorName(v)} · ${OS_BY_VENDOR[v]}${ver ? ' ' + ver : ''} · ${host || 'hostname yok'} · ${role}`;
}

function autoDetectCard(card) {
  const id = card.dataset.device, text = state.configs[id] || '';
  if (!text.trim()) { delete card.dataset.detected; renderDetectChip(card); return; }
  const d = window.NETCUBE_AUDIT.detect(text);
  $('.vendor', card).value = d.vendor; $('.vendor-dot', card).className = `vendor-dot ${d.vendor}`;
  fillModelSelect($('.model', card), d.vendor);
  $('.model', card).value = CUSTOM_MODEL;
  $('.model-custom', card).value = d.hostname || 'config';
  $('.custom-model', card).hidden = true;
  $('.os', card).value = OS_BY_VENDOR[d.vendor]; $('.version', card).value = d.version || '';
  $('.role', card).value = d.role;
  renderCaps(card); card.dataset.detected = '1';
  renderDetectChip(card);
}

// ---------- Campus Builder: cihaz envanteri arayüzü ----------
let campusSeq = 0;
function campusModelsFor(vendor, role) {
  const want = role === 'core' ? ['core', 'spine', 'distribution'] : ['access', 'leaf'];
  const list = catalogFor(vendor).filter(d => d.roles.some(r => want.includes(r)));
  return list.length ? list : catalogFor(vendor);
}
function newCampusRow(role, vendor, model) {
  vendor = vendor || 'cisco';
  const list = campusModelsFor(vendor, role);
  campusSeq++;
  return { id: `${role === 'core' ? 'c' : 'a'}${campusSeq}`, role, vendor, model: model || (list[0] ? list[0].model : CUSTOM_MODEL), custom: '', hostname: '', mgmt: '', ports: role === 'access' ? 48 : 0 };
}
function defaultCampusRows() {
  campusSeq = 0;
  return [newCampusRow('core', 'cisco', 'C9500-24Y4C'), newCampusRow('core', 'cisco', 'C9500-24Y4C'),
    newCampusRow('access', 'cisco', 'C9300-48P'), newCampusRow('access', 'cisco', 'C9300-48P'), newCampusRow('access', 'cisco', 'C9300-48P'), newCampusRow('access', 'cisco', 'C9300-48P')];
}
const CAMPUS_MAX = { core: 4, access: 24 };

function renderCampusRows() {
  const host = $('#campusRows'); if (!host) return;
  const counters = { core: 0, access: 0 };
  host.innerHTML = state.campus.map(r => {
    const n = ++counters[r.role];
    const auto = autoHost(r.role, n, `${r.role === 'core' ? 'CORE' : 'ACCESS'}-${String(n).padStart(2, '0')}`);
    const vendorOpts = ['cisco', 'aruba', 'huawei'].map(v => `<option value="${v}"${v === r.vendor ? ' selected' : ''}>${vendorName(v)}</option>`).join('');
    const modelOpts = campusModelsFor(r.vendor, r.role).map(m => `<option value="${escHtml(m.model)}"${m.model === r.model ? ' selected' : ''}>${escHtml(m.model)}</option>`).join('') + `<option value="${CUSTOM_MODEL}"${r.model === CUSTOM_MODEL ? ' selected' : ''}>Diğer (elle gir)…</option>`;
    const portsOpts = [24, 48].map(p => `<option value="${p}"${Number(r.ports) === p ? ' selected' : ''}>${p}</option>`).join('');
    return `<div class="campus-row ${r.role}" data-row="${r.id}"><span class="role-badge ${r.role}">${r.role === 'core' ? 'CORE' : 'ACCESS'}</span>
      <label>Üretici<select class="cr-vendor">${vendorOpts}</select></label>
      <label>Model<select class="cr-model">${modelOpts}</select></label>
      <label class="cr-custom-wrap"${r.model === CUSTOM_MODEL ? '' : ' hidden'}>Özel model adı<input class="cr-custom" value="${escHtml(r.custom)}"></label>
      <label>Hostname<input class="cr-host" placeholder="${auto}" value="${escHtml(r.hostname)}"></label>
      <label>Yönetim IP<input class="cr-mgmt" placeholder="otomatik" value="${escHtml(r.mgmt)}"></label>
      ${r.role === 'access' ? `<label>Kullanıcı portu<select class="cr-ports">${portsOpts}</select></label>` : ''}
      <button type="button" class="cr-remove" aria-label="Cihazı kaldır">×</button></div>`;
  }).join('');
  const nc = counters.core, na = counters.access;
  const count = $('#campusCount'); if (count) count.textContent = `${nc} core · ${na} access`;
  const ac = $('#addCoreButton'), aa = $('#addAccessButton');
  if (ac) ac.disabled = nc >= CAMPUS_MAX.core; if (aa) aa.disabled = na >= CAMPUS_MAX.access;
}

function campusRow(id) { return state.campus.find(r => r.id === id); }
function campusTouch() { state.campusTouched = true; }

function initCampusUi() {
  state.campus = defaultCampusRows(); state.campusTouched = false;
  const host = $('#campusRows'); if (!host) return;
  host.addEventListener('change', e => {
    const row = e.target.closest('.campus-row'); const r = row && campusRow(row.dataset.row); if (!r) return;
    campusTouch();
    if (e.target.classList.contains('cr-vendor')) { r.vendor = e.target.value; const l = campusModelsFor(r.vendor, r.role); r.model = l[0] ? l[0].model : CUSTOM_MODEL; renderCampusRows(); }
    else if (e.target.classList.contains('cr-model')) { r.model = e.target.value; renderCampusRows(); }
    else if (e.target.classList.contains('cr-ports')) r.ports = Number(e.target.value);
  });
  host.addEventListener('input', e => {
    const row = e.target.closest('.campus-row'); const r = row && campusRow(row.dataset.row); if (!r) return;
    campusTouch();
    if (e.target.classList.contains('cr-host')) r.hostname = e.target.value;
    else if (e.target.classList.contains('cr-mgmt')) r.mgmt = e.target.value;
    else if (e.target.classList.contains('cr-custom')) r.custom = e.target.value;
  });
  host.addEventListener('click', e => {
    const btn = e.target.closest('.cr-remove'); if (!btn) return;
    const row = btn.closest('.campus-row'); const r = row && campusRow(row.dataset.row); if (!r) return;
    const same = state.campus.filter(x => x.role === r.role).length; if (same <= 1) return;
    state.campus = state.campus.filter(x => x.id !== r.id); campusTouch(); renderCampusRows();
  });
  const add = role => () => {
    if (state.campus.filter(r => r.role === role).length >= CAMPUS_MAX[role]) return;
    const last = state.campus.filter(r => r.role === role).at(-1);
    const nr = newCampusRow(role, last && last.vendor, last && last.model);
    const idx = role === 'core' ? state.campus.filter(r => r.role === 'core').length : state.campus.length;
    state.campus.splice(idx, 0, nr); campusTouch(); renderCampusRows();
  };
  $('#addCoreButton').addEventListener('click', add('core'));
  $('#addAccessButton').addEventListener('click', add('access'));
  $('#campusPresetButton').addEventListener('click', () => { state.campus = defaultCampusRows(); state.campusTouched = false; renderCampusRows(); });
  renderCampusRows();
}
initCampusUi();
// ---------- WAN / VPN: router envanteri + niyet tabanlı üretim ----------
const WAN_TYPE_NAME = { dmvpn: 'DMVPN Phase {0}', gre: 'GRE over IPsec', s2s: 'Site-to-site IPsec' };

function wanFeatures(text) {
  const t = (text || '').toLocaleLowerCase('tr-TR') + '\n' + (text || '').toLowerCase();
  const f = { type: null, overlay: null, phase: 3, cryptoMap: false, labels: [] };
  if (/dmvpn|nhrp|mgre|hub.?(?:and|ve)?.?spoke|hub-spoke/.test(t)) f.type = 'dmvpn';
  else if (/\bgre\b/.test(t)) f.type = 'gre';
  else if (/site.?to.?site|\bs2s\b|ipsec|\bvti\b|ikev2|\bvpn\b/.test(t)) f.type = 's2s';
  if (/\bospf\b/.test(t)) f.overlay = 'ospf'; else if (/\bbgp\b/.test(t)) f.overlay = 'bgp'; else if (/eigrp/.test(t)) f.overlay = 'eigrp'; else if (/\bstatic\b|statik/.test(t)) f.overlay = 'static';
  if (/phase ?2|faz ?2/.test(t)) f.phase = 2;
  f.cryptoMap = /crypto map|policy.?based|politika tabanlı/.test(t);
  f.dualIsp = /dual.?isp|iki isp|çift isp|çift hat|iki hat|yedek (?:isp|hat)|ikinci (?:isp|hat)|isp (?:yedek|failover)|wan failover|failover/.test(t);
  f.qos = /\bqos\b|\bvoip\b|ses trafi|trafik öncelik|\bdscp\b/.test(t);
  if (f.dualIsp) f.labels.push('WAN çift ISP yedeklemesi');
  if (f.qos) f.labels.push('WAN QoS politikası');
  return f;
}

function wanAddOne(net) { const o = net.split('.').map(Number); o[3] += 1; return o.join('.'); }

function wanInventory() {
  const rows = state.wan && state.wan.length ? state.wan : defaultWanRows();
  const f = state.wanFeatures || wanFeatures('');
  const intentNets = (state.wanIntentNets || []).slice(); const usedNets = [];
  const notes = []; const seen = new Set(); const cnt = { hub: 0, spoke: 0 }; let autoWan = false;
  const routers = rows.map(r => {
    const role = r.role === 'hub' ? 'hub' : 'spoke'; const idx = cnt[role]++;
    const vendor = r.vendor;
    const model = (r.model === CUSTOM_MODEL ? (r.custom || '').trim() : r.model) || ((catalogFor(vendor).find(d => d.roles.includes('router')) || {}).model) || 'Router';
    const hostname = (r.hostname || '').trim().replace(/\s+/g, '-') || autoHost(role, idx + 1, `${role === 'hub' ? 'HUB' : 'SPOKE'}-${String(idx + 1).padStart(2, '0')}`);
    if (seen.has(hostname)) notes.push(`Hostname ${hostname} birden fazla cihazda kullanılıyor.`); seen.add(hostname);
    let wanTyped = (r.wan || '').trim().toLowerCase(); let dhcp = false; let wanIp = ''; let wanMask = '<WAN_MASK>';
    if (wanTyped === 'dhcp') { if (role === 'hub') { notes.push(`${hostname}: hub için statik WAN IP gerekir; örnek adres kullanıldı.`); wanTyped = ''; autoWan = true; } else dhcp = true; }
    if (!dhcp) {
      const ip = wanTyped.split('/')[0];
      if (ip && campusIsIp(ip)) { wanIp = ip; const pm = wanTyped.match(/\/(\d{1,2})$/); if (pm && Number(pm[1]) <= 30) wanMask = netInfo(wanTyped).mask; }
      else { if (wanTyped) notes.push(`${hostname}: WAN IP '${r.wan}' geçersiz; örnek adres kullanıldı.`); wanIp = role === 'hub' ? `203.0.113.${10 + idx}` : `203.0.113.${50 + idx}`; wanMask = '255.255.255.0'; autoWan = true; }
    }
    let lanCidr = role === 'hub' ? `10.255.${idx}.0/24` : `10.${101 + idx}.0.0/24`;
    let lanTyped = (r.lan || '').trim(); if (!lanTyped && intentNets.length) { lanTyped = intentNets.shift(); usedNets.push(`${hostname} ${lanTyped}`); }
    if (lanTyped) { const m = lanTyped.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/); if (m && campusIsIp(m[1]) && Number(m[2]) <= 30) lanCidr = `${netInfo(lanTyped).net}/${m[2]}`; else notes.push(`${hostname}: LAN alt ağı '${lanTyped}' geçersiz (örn. 10.20.0.0/24); otomatik alt ağ kullanıldı.`); }
    const lanNi = netInfo(lanCidr);
    return { id: r.id, role, idx, vendor, model, hostname, wan: wanIp, wanMask, dhcp, os: OS_BY_VENDOR[vendor], version: 'Profil tabanlı', config: '',
      wanIf: (r.wif || '').trim() || (vendor === 'cisco' ? 'GigabitEthernet0/0/0' : 'GigabitEthernet0/0/1'), lanIf: (r.lif || '').trim() || (vendor === 'cisco' ? 'GigabitEthernet0/0/1' : 'GigabitEthernet0/0/2'),
      lanNet: lanNi.net, lanMask: lanNi.mask, lanWildcard: lanNi.wildcard, lanPrefix: lanNi.prefix, lanGw: wanAddOne(lanNi.net),
      tun: role === 'hub' ? `172.31.0.${1 + idx}` : `172.31.0.${10 + idx}`, asn: 65001 + (role === 'hub' ? idx : 20 + idx) };
  });
  const hubs = routers.filter(r => r.role === 'hub'), spokes = routers.filter(r => r.role === 'spoke');
  const all = routers;
  // VPN türü ve yetenek kontrolü
  const typeAuto = !f.type; let type = f.type || (hubs.length && routers.length >= 3 ? 'dmvpn' : 's2s'); const requested = type;
  if (usedNets.length) notes.push(`LAN alt ağları niyetten alındı: ${usedNets.join(', ')}.`);
  if (typeAuto) notes.push(`Niyette VPN türü (DMVPN / IPsec / GRE) yok; ${WAN_TYPE_NAME[type].replace('{0}', f.phase)} varsayıldı. Yalnız routing veya VXLAN istiyorsan Routing & Overlay modülünü seç.`);
  const can = (k) => all.every(r => supports(r, k));
  if (type === 'dmvpn' && !can('dmvpn')) { type = can('gre') ? 'gre' : 's2s'; }
  if (type === 'gre' && !can('gre')) type = 's2s';
  if (type !== requested) {
    const who = all.filter(r => !supports(r, requested === 'dmvpn' ? 'dmvpn' : 'gre')).map(r => `${vendorName(r.vendor)} ${r.model}`).join(' / ');
    notes.push(typeAuto ? `Varsayılan ${WAN_TYPE_NAME[requested].replace('{0}', f.phase)} ${who} tarafından desteklenmiyor; ${WAN_TYPE_NAME[type].replace('{0}', f.phase)} önerildi.` : `${WAN_TYPE_NAME[requested].replace('{0}', f.phase)} istendi ama ${who} desteklemiyor; ${WAN_TYPE_NAME[type].replace('{0}', f.phase)} önerildi.`);
  }
  if (!all.every(r => supports(r, 'ipsec'))) notes.push('Bazı router modelleri IPsec desteklemiyor; tünel şifrelemesi bu cihazlarda uygulanamaz.');
  let overlay = f.overlay;
  if (type === 'dmvpn') { if (!overlay || overlay === 'static') { if (overlay === 'static') notes.push('DMVPN için statik rota uygun değil; dinamik overlay (EIGRP) kullanıldı.'); overlay = 'eigrp'; } }
  else if (type === 'gre') overlay = overlay || 'ospf';
  else overlay = overlay || 'static';
  if (overlay === 'eigrp' && !all.every(r => r.vendor === 'cisco')) { notes.push('EIGRP yalnız Cisco router\'larda çalışır; OSPF kullanıldı.'); overlay = 'ospf'; }
  if (autoWan) notes.push('Girilmeyen WAN IP\'leri için örnek adresler (203.0.113.0/24) kullanıldı; gerçek adresleri girin.');
  if (type === 'dmvpn' && !hubs.length) notes.push('DMVPN için en az bir hub gerekir.');
  if (!hubs.length && type !== 'dmvpn' && routers.length > 2) notes.push('Hub tanımlı değil; router\'lar birbirine tam mesh tünellerle bağlandı.');
  // tünel planı (DMVPN dışı)
  const links = [];
  if (type !== 'dmvpn') {
    const pairs = hubs.length ? spokes.flatMap(s => hubs.map(h => [h, s])) : routers.flatMap((a, i) => routers.slice(i + 1).map(b => [a, b]));
    const local = {}; routers.forEach(r => { local[r.id] = 0; });
    pairs.forEach(([x, y], k) => {
      const mixed = x.vendor !== y.vendor || x.vendor !== 'cisco';
      links.push({ k, x, y, net: `172.31.${100 + k}.0`, xIp: `172.31.${100 + k}.1`, yIp: `172.31.${100 + k}.2`,
        xTun: 100 + local[x.id]++, yTun: 100 + local[y.id]++, policy: type === 's2s' && (mixed || f.cryptoMap) });
    });
    if (type === 's2s' && links.some(l => l.policy && l.x.vendor !== l.y.vendor)) notes.push('Üretici karışık olduğu için bu tünellerde politika tabanlı IPsec (crypto map / ipsec policy) kullanıldı.');
  }
  const labels = [WAN_TYPE_NAME[type].replace('{0}', f.phase), `overlay: ${type === 's2s' && overlay === 'static' ? 'statik rota' : overlay.toUpperCase()}`];
  if (type === 'dmvpn' && hubs.length > 1) labels.push('çift hub');
  (f.cryptoMap && type === 's2s') && labels.push('crypto map');
  notes.push(`Niyetten algılanan: ${labels.join(', ')}.`);
  return { routers, hubs, spokes, type, overlay, phase: f.phase, links, notes, labels, f };
}

function wanKeyring(r, inv) {
  const peers = inv.type === 'dmvpn' ? null : inv.links.filter(l => l.x.id === r.id || l.y.id === r.id).map(l => (l.x.id === r.id ? l.y : l.x));
  return peers;
}

function wanCiscoIpsecObjects(r, inv, dmvpn) {
  const L = [];
  const peers = dmvpn ? null : wanKeyring(r, inv);
  const nm = dmvpn ? 'DMVPN' : 'S2S';
  L.push(`crypto ikev2 proposal ${nm}-PROP`, ' encryption aes-cbc-256', ' integrity sha256', ' group 14', `crypto ikev2 policy ${nm}-POL`, ` proposal ${nm}-PROP`);
  L.push(`crypto ikev2 keyring ${nm}-KEYS`);
  if (dmvpn) L.push(' peer ANY', '  address 0.0.0.0 0.0.0.0', '  pre-shared-key <IKE_PSK>');
  else peers.forEach(p => L.push(` peer ${p.hostname}`, `  address ${p.wan}`, `  pre-shared-key <IKE_PSK_${p.hostname.replace(/-/g, '_')}>`));
  L.push(`crypto ikev2 profile ${nm}-IKEV2`);
  if (dmvpn) L.push(' match identity remote address 0.0.0.0');
  else peers.forEach(p => L.push(` match identity remote address ${p.wan} 255.255.255.255`));
  L.push(' authentication remote pre-share', ' authentication local pre-share', ` keyring local ${nm}-KEYS`, ' dpd 30 5 on-demand');
  const mode = dmvpn || inv.type === 'gre' ? 'transport' : 'tunnel';
  L.push(`crypto ipsec transform-set ${nm}-TS esp-aes 256 esp-sha256-hmac`, ` mode ${mode}`, `crypto ipsec profile ${nm}-IPSEC`, ` set transform-set ${nm}-TS`, ` set ikev2-profile ${nm}-IKEV2`);
  return L;
}

function wanCiscoBase(r) {
  return [`hostname ${r.hostname}`, 'ip domain-name corp.local', 'ip ssh version 2',
    `interface ${r.wanIf}`, ' description WAN', r.dhcp ? ' ip address dhcp' : ` ip address ${r.wan} ${r.wanMask}`, ' no shutdown',
    `interface ${r.lanIf}`, ' description LAN', ` ip address ${r.lanGw} ${r.lanMask}`, ' no shutdown'];
}

function wanCiscoOverlay(r, inv, tunIfs) {
  const L = []; const ov = inv.overlay;
  const lanNet = `${r.lanNet} ${r.lanWildcard}`;
  if (ov === 'eigrp') L.push('router eigrp 100', ' network 172.31.0.0 0.0.255.255', ` network ${lanNet}`, ` passive-interface ${r.lanIf}`);
  if (ov === 'ospf') L.push('router ospf 10', ` router-id ${r.tun}`, ' network 172.31.0.0 0.0.255.255 area 0', ` network ${lanNet} area 0`, ` passive-interface ${r.lanIf}`);
  if (ov === 'bgp') {
    if (inv.type === 'dmvpn') {
      if (r.role === 'hub') L.push('router bgp 65000', ` bgp router-id ${r.tun}`, ' bgp listen range 172.31.0.0/24 peer-group DMVPN-SPOKES', ' neighbor DMVPN-SPOKES peer-group', ' neighbor DMVPN-SPOKES remote-as 65000', ' address-family ipv4', `  network ${r.lanNet} mask ${r.lanMask}`, '  neighbor DMVPN-SPOKES route-reflector-client', '  neighbor DMVPN-SPOKES activate');
      else L.push('router bgp 65000', ` bgp router-id ${r.tun}`, ...inv.hubs.flatMap(h => [` neighbor ${h.tun} remote-as 65000`]), ' address-family ipv4', `  network ${r.lanNet} mask ${r.lanMask}`, ...inv.hubs.map(h => `  neighbor ${h.tun} activate`));
    } else {
      const mine = inv.links.filter(l => l.x.id === r.id || l.y.id === r.id).map(l => { const x = l.x.id === r.id; return { peer: x ? l.y : l.x, peerIp: x ? l.yIp : l.xIp }; });
      L.push(`router bgp ${r.asn}`, ` bgp router-id ${r.tun}`, ...mine.map(m => ` neighbor ${m.peerIp} remote-as ${m.peer.asn}`), ' address-family ipv4', `  network ${r.lanNet} mask ${r.lanMask}`, ...mine.map(m => `  neighbor ${m.peerIp} activate`));
    }
  }
  return L;
}

function wanHubHostRoutes(r, inv, cisco) {
  if (r.role !== 'spoke' || !inv.hubs || !inv.hubs.length) return [];
  return inv.hubs.flatMap(h => (cisco
    ? ['ip route ' + h.wan + ' 255.255.255.255 <ISP1_NEXT_HOP> track 10', 'ip route ' + h.wan + ' 255.255.255.255 <ISP2_NEXT_HOP> 250']
    : ['ip route-static ' + h.wan + ' 255.255.255.255 <ISP1_NEXT_HOP> track nqa admin ISP1', 'ip route-static ' + h.wan + ' 255.255.255.255 <ISP2_NEXT_HOP> preference 100']));
}

function wanCiscoExtras(r, inv) {
  const f = inv.f || {}; const L = [];
  if (f.dualIsp) {
    L.push('! Dual-ISP: <...> değerlerini doldurun; ISP1 birincil, ISP2 yedek (floating static)', 'interface <WAN2_INTERFACE>', ' description WAN2-BACKUP', ' ip address <WAN2_IP> <WAN2_MASK>', ' no shutdown',
      'ip sla 10', ' icmp-echo <ISP1_PROBE_IP> source-interface ' + r.wanIf, ' frequency 10', 'ip sla schedule 10 life forever start-time now', 'track 10 ip sla 10 reachability',
      'ip route 0.0.0.0 0.0.0.0 <ISP1_NEXT_HOP> track 10', 'ip route 0.0.0.0 0.0.0.0 <ISP2_NEXT_HOP> 250', ...wanHubHostRoutes(r, inv, true),
      '! Tünel kaynağı birincil WAN arayüzüne bağlıdır; ISP değişiminde tünelin yeniden kurulması için tunnel source olarak loopback kullanmayı veya ikinci bir tünel tasarlamayı değerlendirin');
  }
  if (f.qos) {
    L.push('class-map match-any QOS-VOICE', ' match dscp ef', 'class-map match-any QOS-VIDEO', ' match dscp af41 af42', 'class-map match-any QOS-CRITICAL', ' match dscp af31 cs6',
      'policy-map WAN-QOS', ' class QOS-VOICE', '  priority percent 20', ' class QOS-VIDEO', '  bandwidth remaining percent 30', ' class QOS-CRITICAL', '  bandwidth remaining percent 30', ' class class-default', '  fair-queue',
      'policy-map WAN-SHAPER', ' class class-default', '  shape average <WAN_RATE_BPS>', '  service-policy WAN-QOS', 'interface ' + r.wanIf, ' service-policy output WAN-SHAPER',
      '! QoS: shape değerini ISP hattının gerçek hızına göre girin; DSCP işaretlemesinin uçtan uca korunduğunu doğrulayın');
  }
  return L;
}

function wanHuaweiExtras(r, inv) {
  const f = inv.f || {}; const L = [];
  if (f.dualIsp) {
    L.push('# Dual-ISP: <...> değerlerini doldurun; ISP1 birincil, ISP2 yedek', 'interface <WAN2_INTERFACE>', ' description WAN2_BACKUP', ' ip address <WAN2_IP> <WAN2_MASK>', 'quit',
      'nqa test-instance admin ISP1', ' test-type icmp', ' destination-address ipv4 <ISP1_PROBE_IP>', ' frequency 10', ' start now', 'quit',
      'ip route-static 0.0.0.0 0.0.0.0 <ISP1_NEXT_HOP> track nqa admin ISP1', 'ip route-static 0.0.0.0 0.0.0.0 <ISP2_NEXT_HOP> preference 100', ...wanHubHostRoutes(r, inv, false),
      '# NQA/track komutları AR model ve sürümüne göre doğrulanmalıdır');
  }
  if (f.qos) {
    L.push('traffic classifier QOS_VOICE operator or', ' if-match dscp ef', 'quit', 'traffic classifier QOS_CRITICAL operator or', ' if-match dscp af31', 'quit',
      'traffic behavior QOS_VOICE', ' queue ef bandwidth pct 20', 'quit', 'traffic behavior QOS_CRITICAL', ' queue af bandwidth pct 30', 'quit',
      'traffic policy WAN_QOS', ' classifier QOS_VOICE behavior QOS_VOICE', ' classifier QOS_CRITICAL behavior QOS_CRITICAL', 'quit', 'interface ' + r.wanIf, ' traffic-policy WAN_QOS outbound', 'quit',
      '# QoS komutları AR model ve sürümüne göre doğrulanmalıdır; WAN hızına göre shaping ayrıca tanımlanmalıdır');
  }
  return L;
}

function wanCiscoDevice(r, inv) {
  const L = [`! ===== ${r.hostname} · ${r.model} · ${r.role.toUpperCase()} =====`, '! Arayüz adlarını model ve port numaralandırmasına göre doğrulayın', ...wanCiscoBase(r)];
  const f = inv.f; const mtu = [' ip mtu 1400', ' ip tcp adjust-mss 1360'];
  if (inv.type === 'dmvpn') {
    L.push(...wanCiscoIpsecObjects(r, inv, true));
    const primary = inv.hubs[0];
    const tun = ['interface Tunnel100', ` description DMVPN-PHASE${inv.phase}`, ` ip address ${r.tun} 255.255.255.0`, ' no ip redirects', ...mtu, ' ip nhrp network-id 100', ' ip nhrp authentication <NHRP_KEY>'];
    if (r.role === 'hub') {
      tun.push(' ip nhrp map multicast dynamic');
      if (inv.phase === 3) tun.push(' ip nhrp redirect');
      if (r !== primary) tun.push(` ip nhrp nhs ${primary.tun} nbma ${primary.wan} multicast`);
    } else {
      inv.hubs.forEach(h => tun.push(` ip nhrp nhs ${h.tun} nbma ${h.wan} multicast`));
      if (inv.phase === 3) tun.push(' ip nhrp shortcut');
    }
    tun.push(` tunnel source ${r.wanIf}`, ' tunnel mode gre multipoint', ' tunnel key 100', ' tunnel protection ipsec profile DMVPN-IPSEC');
    if (inv.overlay === 'eigrp') {
      if (r.role === 'hub') tun.push(inv.phase === 3 ? ' ip summary-address eigrp 100 0.0.0.0 0.0.0.0' : ' no ip next-hop-self eigrp 100', ' no ip split-horizon eigrp 100');
    }
    if (inv.overlay === 'ospf') tun.push(' ip ospf network broadcast', ` ip ospf priority ${r.role === 'hub' ? (r === primary ? 255 : 200) : 0}`);
    L.push(...tun, ...wanCiscoOverlay(r, inv));
    if (r.role === 'hub' && inv.overlay === 'eigrp' && inv.phase === 3) L.push('! Phase 3: hub, spoke LAN\'lerini özetleyerek gönderir; spoke-to-spoke yollar NHRP shortcut ile kurulur');
    return L.concat(wanCiscoExtras(r, inv), 'end').join('\n');
  }
  // site-to-site / GRE over IPsec
  const mine = inv.links.filter(l => l.x.id === r.id || l.y.id === r.id).map(l => { const x = l.x.id === r.id; return { l, peer: x ? l.y : l.x, myIp: x ? l.xIp : l.yIp, peerIp: x ? l.yIp : l.xIp, tun: x ? l.xTun : l.yTun }; });
  const vti = mine.filter(m => !m.l.policy), pol = mine.filter(m => m.l.policy);
  if (mine.length) L.push(...wanCiscoIpsecObjects(r, { ...inv, links: mine.map(m => m.l) }, false));
  vti.forEach(m => L.push(`interface Tunnel${m.tun}`, ` description ${inv.type === 'gre' ? 'GRE-IPSEC' : 'S2S-VTI'}-TO-${m.peer.hostname}`, ` ip address ${m.myIp} 255.255.255.252`, ...mtu, ` tunnel source ${r.wanIf}`, inv.type === 'gre' ? ' tunnel mode gre ip' : ' tunnel mode ipsec ipv4', ` tunnel destination ${m.peer.wan}`, ` tunnel protection ipsec profile S2S-IPSEC`));
  if (pol.length) {
    pol.forEach((m, i) => {
      L.push(`ip access-list extended VPN-${m.peer.hostname}`, ` permit ip ${r.lanNet} ${r.lanWildcard} ${m.peer.lanNet} ${m.peer.lanWildcard}`);
    });
    // crypto map: her peer için ayrı sıra numarası
    pol.forEach((m, i) => L.push(`crypto map S2S-MAP ${10 * (i + 1)} ipsec-isakmp`, ` set peer ${m.peer.wan}`, ' set transform-set S2S-TS', ' set ikev2-profile S2S-IKEV2', ` match address VPN-${m.peer.hostname}`));
    L.push(`interface ${r.wanIf}`, ' crypto map S2S-MAP');
  }
  // yönlendirme
  if (inv.overlay === 'static' || (inv.type === 's2s' && pol.length && !vti.length)) {
    mine.forEach(m => {
      const remote = inv.hubs.length && r.role === 'spoke' ? inv.routers.filter(x => x.id !== r.id) : [m.peer];
      if (m.l.policy) return; // politika tabanlı: şifreleme ACL'si trafiği yakalar, rota WAN next-hop'a gider
      remote.forEach(x => { const ad = inv.hubs.length && r.role === 'spoke' && m.peer !== inv.hubs[0] ? ' 10' : ''; L.push(`ip route ${x.lanNet} ${x.lanMask} ${m.peerIp}${ad}`); });
    });
  } else L.push(...wanCiscoOverlay(r, inv));
  if (pol.length) L.push('! Politika tabanlı tünellerde uzak LAN\'e giden rota WAN next-hop üzerinden olmalı (ip route <REMOTE_LAN> <MASK> <WAN_NEXT_HOP>)');
  return L.concat(wanCiscoExtras(r, inv), 'end').join('\n');
}

function wanHuaweiDevice(r, inv) {
  const L = [`# ===== ${r.hostname} · ${r.model} · ${r.role.toUpperCase()} =====`, '# Arayüz adlarını model ve port numaralandırmasına göre doğrulayın', `sysname ${r.hostname}`, 'stelnet server enable',
    `interface ${r.wanIf}`, ' description WAN', r.dhcp ? ' ip address dhcp-alloc' : ` ip address ${r.wan} ${r.wanMask}`, 'quit',
    `interface ${r.lanIf}`, ' description LAN', ` ip address ${r.lanGw} ${r.lanMask}`, 'quit'];
  const mine = inv.links.filter(l => l.x.id === r.id || l.y.id === r.id).map(l => { const x = l.x.id === r.id; return { l, peer: x ? l.y : l.x, myIp: x ? l.xIp : l.yIp, peerIp: x ? l.yIp : l.xIp, tun: x ? l.xTun : l.yTun }; });
  L.push('ike proposal 10', ' encryption-algorithm aes-256', ' dh group14', ' authentication-algorithm sha2-256', ' integrity-algorithm hmac-sha2-256', 'quit',
    'ipsec proposal S2S', ' esp authentication-algorithm sha2-256', ' esp encryption-algorithm aes-256', ` encapsulation-mode ${inv.type === 'gre' ? 'transport' : 'tunnel'}`, 'quit');
  mine.forEach((m, i) => {
    const n = 3000 + m.l.k; const peerName = m.peer.hostname.replace(/-/g, '_');
    if (inv.type === 'gre') {
      L.push(`interface Tunnel0/0/${m.tun - 100}`, ` ip address ${m.myIp} 255.255.255.252`, ' tunnel-protocol gre', ` source ${r.wanIf}`, ` destination ${m.peer.wan}`, ' mtu 1400', ' tcp adjust-mss 1360', 'quit');
      L.push(`acl number ${n}`, ` rule 5 permit gre source ${r.wan} 0 destination ${m.peer.wan} 0`, 'quit');
    } else {
      L.push(`acl number ${n}`, ` rule 5 permit ip source ${r.lanNet} ${r.lanWildcard} destination ${m.peer.lanNet} ${m.peer.lanWildcard}`, 'quit');
    }
    L.push(`ike peer ${peerName} v2`, ' pre-shared-key cipher <IKE_PSK_' + peerName + '>', ' ike-proposal 10', ` remote-address ${m.peer.wan}`, ' dpd type periodic', ' dpd idle-time 30', 'quit');
    L.push(`ipsec policy S2S-POLICY ${10 * (i + 1)} isakmp`, ` security acl ${n}`, ` ike-peer ${peerName}`, ' proposal S2S', 'quit');
  });
  L.push(`interface ${r.wanIf}`, ' ipsec policy S2S-POLICY', 'quit');
  if (inv.overlay === 'static') {
    mine.forEach(m => { if (m.l.policy) return; const remote = inv.hubs.length && r.role === 'spoke' ? inv.routers.filter(x => x.id !== r.id) : [m.peer]; remote.forEach(x => L.push(`ip route-static ${x.lanNet} ${x.lanMask} ${m.peerIp}`)); });
    if (mine.some(m => m.l.policy)) L.push('# Politika tabanlı tünellerde uzak LAN\'e giden rota WAN next-hop üzerinden olmalı: ip route-static <REMOTE_LAN> <MASK> <WAN_NEXT_HOP>');
  }
  if (inv.overlay === 'ospf') L.push('ospf 10 router-id ' + r.tun, ' area 0.0.0.0', '  network 172.31.0.0 0.0.255.255', `  network ${r.lanNet} ${r.lanWildcard}`, ` silent-interface ${r.lanIf}`, 'quit');
  else if (inv.overlay === 'bgp') { L.push(`bgp ${r.asn}`, ...mine.map(m => ` peer ${m.peerIp} as-number ${m.peer.asn}`), ' ipv4-family unicast', `  network ${r.lanNet} ${r.lanMask}`, ...mine.map(m => `  peer ${m.peerIp} enable`), ' quit', 'quit'); }
  return L.concat(wanHuaweiExtras(r, inv), 'return').join('\n');
}

function wanReport(inv) {
  const L = ['WAN / VPN TASARIM RAPORU', '', `VPN türü: ${WAN_TYPE_NAME[inv.type].replace('{0}', inv.phase)}`, `Overlay yönlendirme: ${inv.type === 's2s' && inv.overlay === 'static' ? 'statik rota' : inv.overlay.toUpperCase()}`,
    `${inv.hubs.length} hub · ${inv.spokes.length} spoke`, '', 'ROUTER ENVANTERİ'];
  inv.routers.forEach(r => L.push(`- ${r.hostname} (${r.role}) · ${vendorName(r.vendor)} ${r.model} · WAN ${r.dhcp ? 'DHCP' : r.wan} · LAN ${r.lanNet}/${r.lanPrefix}`));
  L.push('', 'TÜNEL PLANI');
  if (inv.type === 'dmvpn') inv.routers.forEach(r => L.push(`${r.hostname} Tunnel100 ${r.tun}/24${r.role === 'hub' ? ' (NHS)' : ''}`));
  else inv.links.forEach(l => L.push(`${l.x.hostname} Tunnel${l.xTun} ${l.xIp} ↔ ${l.y.hostname} Tunnel${l.yTun} ${l.yIp}${l.policy ? ' (politika tabanlı)' : ''}`));
  L.push('', 'KRİPTO PARAMETRELERİ', '- IKEv2 · AES-256 · SHA-256 · DH group 14 · DPD açık', '- IPsec ESP · AES-256 · SHA-256', '- Tünel MTU 1400 · TCP MSS 1360');
  if (inv.f.dualIsp || inv.f.qos) { L.push('', 'EK ÖZELLİKLER'); if (inv.f.dualIsp) L.push('- Çift ISP: ISP1 birincil (IP SLA / NQA ile izlenir), ISP2 yedek (floating static); hub NBMA adresleri için ISP başına host rotası'); if (inv.f.qos) L.push('- QoS: VOICE (EF, priority %20), VIDEO (AF41/AF42), CRITICAL (AF31/CS6) ve default sınıfı; WAN çıkışında shaping'); }
  L.push('', 'GÜVENLİK NOTLARI', '- Pre-shared key ve NHRP anahtarları yer tutucudur; üretimde güçlü ve ayrı anahtarlar kullanın, mümkünse sertifika (PKI) tercih edin.');
  if (inv.type === 'dmvpn') L.push('- NHRP kimlik doğrulaması ve tunnel key tanımlıdır.', inv.phase === 3 ? '- Phase 3: hub özet rota gönderir, spoke-to-spoke tüneller NHRP redirect/shortcut ile kurulur.' : '- Phase 2: spoke-to-spoke yönlendirme için hub next-hop korur.');
  L.push('- Lisans: IPsec/DMVPN için Security (K9) lisansı ve şifreleme throughput lisansı gerekebilir.', '', 'VARSAYIM', 'Gerçek arayüz adları, WAN maskeleri, lisans ve komut desteği tam model/sürüm profiliyle doğrulanmalıdır.');
  return L.join('\n');
}

function wanConfig(vendor, side) {
  const inv = state.wanInv || wanInventory();
  const r = inv.routers.find(x => x.id === side);
  const full = vendor === 'cisco' ? wanCiscoDevice(r, inv) : wanHuaweiDevice(r, inv);
  const V = vendor === 'cisco'
    ? (inv.type === 'dmvpn' ? ['show dmvpn detail', 'show ip nhrp', 'show crypto ikev2 sa', 'show crypto ipsec sa', 'show interface tunnel 100', 'show ip route', inv.overlay === 'eigrp' ? 'show ip eigrp neighbors' : inv.overlay === 'ospf' ? 'show ip ospf neighbor' : 'show ip bgp summary'] : ['show crypto ikev2 sa', 'show crypto ipsec sa', 'show crypto map', 'show ip interface brief | include Tunnel', 'show ip route', 'ping <REMOTE_LAN_IP> source ' + r.lanIf])
    : ['display ike sa', 'display ipsec sa', 'display ipsec statistics', 'display ip routing-table', 'ping -a ' + r.lanGw + ' <REMOTE_LAN_IP>'];
  const verify = [`${r.hostname} · ${r.role.toUpperCase()}`, '', ...V.map((c, i) => c), '', '1. IKE/IPsec SA\'ların kurulduğunu ve sayaçların arttığını doğrula.', '2. Uzak LAN\'lere yönlendirme ve ping testi yap.', '3. MTU/MSS: büyük paketlerle (ping size 1400, DF) fragmentasyon olmadığını doğrula.', ...(inv.f.dualIsp ? ['4. ISP1 kesildiğinde varsayılan rotanın ISP2 hattına döndüğünü doğrula (show track / show ip route 0.0.0.0 / display ip routing-table 0.0.0.0).'] : []), ...(inv.f.qos ? ['5. QoS sınıf sayaçlarını doğrula (show policy-map interface / display traffic policy statistics).'] : [])];
  return { delta: full, full, audit: wanReport(inv), verify: verify.join('\n'), rollback: 'Yedek alın (copy running-config flash:pre-vpn.cfg / save pre-vpn.cfg). Geri dönüş: tünel arayüzlerini, crypto/ipsec nesnelerini ve crypto map\'i kaldırın veya yedek config\'i geri yükleyin; WAN erişimini (konsol/OOB) kaybetmeden önce yönlendirme değişikliklerini ayrı uygulayın.' };
}


// ---------- WAN / VPN: router envanteri arayüzü ----------
let wanSeq = 0;
const WAN_VENDORS = ['cisco', 'huawei'];
const WAN_MAX = { hub: 2, spoke: 12 };
function wanModelsFor(vendor) { return catalogFor(vendor).filter(d => d.roles.includes('router')); }
function newWanRow(role, vendor, model) {
  vendor = vendor || 'cisco'; const list = wanModelsFor(vendor); wanSeq++;
  return { id: `${role === 'hub' ? 'h' : 's'}${wanSeq}`, role, vendor, model: model || (list[0] ? list[0].model : CUSTOM_MODEL), custom: '', hostname: '', wan: '', lan: '', wif: '', lif: '' };
}
function defaultWanRows() {
  wanSeq = 0;
  return [newWanRow('hub', 'cisco', 'ISR4431'), newWanRow('spoke', 'cisco', 'ISR4331'), newWanRow('spoke', 'cisco', 'ISR4331'), newWanRow('spoke', 'cisco', 'ISR4331')];
}

function renderWanRows() {
  const host = $('#wanRows'); if (!host) return;
  const counters = { hub: 0, spoke: 0 };
  host.innerHTML = state.wan.map(r => {
    const n = ++counters[r.role];
    const auto = autoHost(r.role, n, `${r.role === 'hub' ? 'HUB' : 'SPOKE'}-${String(n).padStart(2, '0')}`);
    const vendorOpts = WAN_VENDORS.map(v => `<option value="${v}"${v === r.vendor ? ' selected' : ''}>${vendorName(v)}</option>`).join('');
    const modelOpts = wanModelsFor(r.vendor).map(m => `<option value="${escHtml(m.model)}"${m.model === r.model ? ' selected' : ''}>${escHtml(m.model)}</option>`).join('') + `<option value="${CUSTOM_MODEL}"${r.model === CUSTOM_MODEL ? ' selected' : ''}>Diğer (elle gir)…</option>`;
    return `<div class="campus-row wan-row ${r.role}" data-row="${r.id}"><span class="role-badge ${r.role === 'hub' ? 'core' : 'access'}">${r.role === 'hub' ? 'HUB' : 'SPOKE'}</span>
      <label>Üretici<select class="wr-vendor">${vendorOpts}</select></label>
      <label>Model<select class="wr-model">${modelOpts}</select></label>
      <label class="cr-custom-wrap"${r.model === CUSTOM_MODEL ? '' : ' hidden'}>Özel model adı<input class="wr-custom" value="${escHtml(r.custom)}"></label>
      <label>Hostname<input class="wr-host" placeholder="${auto}" value="${escHtml(r.hostname)}"></label>
      <label>WAN IP<input class="wr-wan" placeholder="${r.role === 'hub' ? 'örn. 203.0.113.10/29' : 'örn. 198.51.100.5/29 veya dhcp'}" value="${escHtml(r.wan)}"></label>
      <label>LAN alt ağı<input class="wr-lan" placeholder="otomatik" value="${escHtml(r.lan)}"></label>
      <label>WAN arayüzü<input class="wr-wif" placeholder="${r.vendor === 'cisco' ? 'GigabitEthernet0/0/0' : 'GigabitEthernet0/0/1'}" value="${escHtml(r.wif || '')}"></label>
      <label>LAN arayüzü<input class="wr-lif" placeholder="${r.vendor === 'cisco' ? 'GigabitEthernet0/0/1' : 'GigabitEthernet0/0/2'}" value="${escHtml(r.lif || '')}"></label>
      <button type="button" class="cr-remove wr-remove" aria-label="Cihazı kaldır">×</button></div>`;
  }).join('');
  const nh = counters.hub, ns = counters.spoke;
  const c = $('#wanCount'); if (c) c.textContent = `${nh} hub · ${ns} spoke`;
  const ah = $('#addHubButton'), as = $('#addSpokeButton'); if (ah) ah.disabled = nh >= WAN_MAX.hub; if (as) as.disabled = ns >= WAN_MAX.spoke;
}

function wanRow(id) { return state.wan.find(r => r.id === id); }

function wanApplyIntent() {
  const text = ($('#intentInput') || {}).value || '';
  const f = wanFeatures(text); state.wanFeatures = f;
  state.wanIntentNets = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g) || []).filter(c => Number(c.split('/')[1]) <= 30);
  const t = text.toLowerCase(); const msgs = [];
  const h = t.match(/(\d{1,2})\s*(?:adet\s*)?hub/), s = t.match(/(\d{1,2})\s*(?:adet\s*)?(?:spoke|şube|branch|site|uzak)/);
  if ((h || s) && !state.wanTouched) {
    const nh = state.wan.filter(r => r.role === 'hub').length, ns = state.wan.filter(r => r.role === 'spoke').length;
    const wh = h ? Math.max(1, Math.min(WAN_MAX.hub, Number(h[1]))) : nh, ws = s ? Math.max(1, Math.min(WAN_MAX.spoke, Number(s[1]))) : ns;
    if (wh !== nh || ws !== ns) {
      const lh = state.wan.filter(r => r.role === 'hub').at(-1) || { vendor: 'cisco' }, ls = state.wan.filter(r => r.role === 'spoke').at(-1) || { vendor: 'cisco' };
      const hubs = state.wan.filter(r => r.role === 'hub').slice(0, wh); while (hubs.length < wh) hubs.push(newWanRow('hub', lh.vendor, lh.model));
      const spokes = state.wan.filter(r => r.role === 'spoke').slice(0, ws); while (spokes.length < ws) spokes.push(newWanRow('spoke', ls.vendor, ls.model));
      state.wan = [...hubs, ...spokes]; renderWanRows(); msgs.push(`cihaz sayısı niyetten alındı (${wh} hub, ${ws} spoke)`);
    }
  }
  if (f.dualIsp) msgs.push('WAN çift ISP yedeklemesi');
  if (f.qos) msgs.push('WAN QoS politikası');
  state.wanIntentMsgs = msgs; return f;
}

function renderWanTopology() {
  const card = $('#topologyCard'); const inv = state.wanInv || wanInventory();
  card.hidden = false;
  $('.subhead h3', card).textContent = 'WAN / VPN topolojisi'; $('.subhead p', card).textContent = 'Hub, spoke ve tünel bağlantıları';
  const R = inv.routers, W = Math.max(960, 110 * Math.max(inv.hubs.length, inv.spokes.length)), H = 380; const pos = {};
  if (inv.hubs.length) {
    inv.hubs.forEach((r, i) => { pos[r.id] = { x: W * (i + 1) / (inv.hubs.length + 1), y: 87 }; });
    inv.spokes.forEach((r, i) => { pos[r.id] = { x: W * (i + 1) / (inv.spokes.length + 1), y: 279 }; });
  } else R.forEach((r, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / R.length; pos[r.id] = R.length === 2 ? { x: W * (i + 1) / 3, y: 190 } : { x: W / 2 + 320 * Math.cos(a), y: 190 + 120 * Math.sin(a) }; });
  const pairs = inv.type === 'dmvpn' ? inv.spokes.flatMap(s => inv.hubs.map((h, hi) => ({ a: h, b: s, sec: hi > 0, tip: `${s.hostname} Tunnel100 ${s.tun} → ${h.hostname} ${h.tun}` })))
    : inv.links.map(l => ({ a: l.x, b: l.y, sec: false, tip: `${l.x.hostname} Tunnel${l.xTun} ${l.xIp} ↔ ${l.y.hostname} Tunnel${l.yTun} ${l.yIp}${l.policy ? ' (policy)' : ''}` }));
  const lines = pairs.map(p => `<line class="link ${p.sec ? 'secondary' : ''}" x1="${pos[p.a.id].x}" y1="${pos[p.a.id].y}" x2="${pos[p.b.id].x}" y2="${pos[p.b.id].y}"><title>${escHtml(p.tip)}</title></line>`).join('');
  const nodes = R.map(r => svgNode(pos[r.id].x, pos[r.id].y, Math.min(180, W / Math.max(R.length, 2) - 12), 68, r.role === 'hub' ? 'node node-core' : 'node', [escHtml(r.hostname), escHtml(r.model), escHtml(r.dhcp ? 'WAN DHCP' : r.wan)])).join('');
  $('#topologyDiagram').innerHTML = `<svg viewBox="0 0 ${W} ${H}"><title>${R.length} routerlı WAN / VPN topolojisi</title>${lines}${nodes}<text class="node-meta" x="${W / 2}" y="352" text-anchor="middle">${escHtml(WAN_TYPE_NAME[inv.type].replace('{0}', inv.phase))} · Kesikli çizgi: ikinci hub tüneli · Hover: tünel adresleri</text></svg>`;
  $('#topologySummary').textContent = `${inv.hubs.length} HUB · ${inv.spokes.length} SPOKE · ${pairs.length} TÜNEL`;
  $('#topologyLegend').innerHTML = R.map(r => `<span>${escHtml(r.hostname)} · LAN ${escHtml(r.lanNet)}/${r.lanPrefix}</span>`).join('');
}

function initWanUi() {
  state.wan = defaultWanRows(); state.wanTouched = false;
  const host = $('#wanRows'); if (!host) return;
  const touch = () => { state.wanTouched = true; };
  host.addEventListener('change', e => {
    const row = e.target.closest('.wan-row'); const r = row && wanRow(row.dataset.row); if (!r) return; touch();
    if (e.target.classList.contains('wr-vendor')) { r.vendor = e.target.value; const l = wanModelsFor(r.vendor); r.model = l[0] ? l[0].model : CUSTOM_MODEL; renderWanRows(); }
    else if (e.target.classList.contains('wr-model')) { r.model = e.target.value; renderWanRows(); }
  });
  host.addEventListener('input', e => {
    const row = e.target.closest('.wan-row'); const r = row && wanRow(row.dataset.row); if (!r) return; touch();
    if (e.target.classList.contains('wr-host')) r.hostname = e.target.value;
    else if (e.target.classList.contains('wr-wan')) r.wan = e.target.value;
    else if (e.target.classList.contains('wr-lan')) r.lan = e.target.value;
    else if (e.target.classList.contains('wr-wif')) r.wif = e.target.value;
    else if (e.target.classList.contains('wr-lif')) r.lif = e.target.value;
    else if (e.target.classList.contains('wr-custom')) r.custom = e.target.value;
  });
  host.addEventListener('click', e => {
    const btn = e.target.closest('.wr-remove'); if (!btn) return;
    const r = wanRow(btn.closest('.wan-row').dataset.row); if (!r) return;
    if (state.wan.filter(x => x.role === r.role).length <= 1 && r.role === 'spoke') return;
    if (state.wan.length <= 2) return;
    state.wan = state.wan.filter(x => x.id !== r.id); touch(); renderWanRows();
  });
  const add = role => () => {
    if (state.wan.filter(r => r.role === role).length >= WAN_MAX[role]) return;
    const last = state.wan.filter(r => r.role === role).at(-1) || state.wan.at(-1);
    const nr = newWanRow(role, last && last.vendor, last && last.model);
    const idx = role === 'hub' ? state.wan.filter(r => r.role === 'hub').length : state.wan.length;
    state.wan.splice(idx, 0, nr); touch(); renderWanRows();
  };
  $('#addHubButton').addEventListener('click', add('hub'));
  $('#addSpokeButton').addEventListener('click', add('spoke'));
  $('#wanPresetButton').addEventListener('click', () => { state.wan = defaultWanRows(); state.wanTouched = false; renderWanRows(); });
  renderWanRows();
}
initWanUi();

// ---------- Kurumsal standartlar (golden config / isimlendirme) ----------
(function initStandards() {
  const CMX = window.NETCUBE_CM; if (!CMX || !$('#goldenEnabled')) return;
  const g = CMX.getGolden(), n = CMX.getNaming();
  $('#goldenEnabled').checked = g.enabled; $('#goldenCisco').value = g.cisco; $('#goldenAruba').value = g.aruba; $('#goldenHuawei').value = g.huawei;
  $('#namingPattern').value = n.pattern; $('#namingSite').value = n.site;
  if (g.enabled || n.pattern) $('#standardsBox').open = true;
  const save = () => {
    CMX.setGolden({ enabled: $('#goldenEnabled').checked, cisco: $('#goldenCisco').value, aruba: $('#goldenAruba').value, huawei: $('#goldenHuawei').value });
    CMX.setNaming({ pattern: $('#namingPattern').value.trim(), site: $('#namingSite').value.trim() });
  };
  ['goldenEnabled', 'goldenCisco', 'goldenAruba', 'goldenHuawei', 'namingPattern', 'namingSite'].forEach(id => $('#' + id).addEventListener('input', save));
})();

// ---------- Çalışma alanları: denetim modülü kendi cihaz kartlarını kullanır ----------
function clearResults() { state.plan = null; const r = $('#results'); if (r) r.hidden = true; const lay = $('#layout'); if (lay) lay.classList.remove('has-results'); }

function applyCardVisibility(module) {
  $$('.device-card').forEach((c, i) => {
    if (module === 'hardening') c.hidden = c.dataset.device !== 'a';
    else if (module === 'audit') c.hidden = !(i === 0 || (state.configs[c.dataset.device] || '').trim() || c.dataset.shown === '1');
    else c.hidden = false;
  });
  refreshDeviceActions();
}

function captureDeviceCards() {
  return $$('.device-card').map(c => ({
    id: c.dataset.device, vendor: $('.vendor', c).value, model: $('.model', c).value, custom: $('.model-custom', c).value,
    os: $('.os', c).value, version: $('.version', c).value, role: $('.role', c).value, ports: $('.ports', c).value,
    touched: Boolean($('.ports', c).dataset.touched), config: state.configs[c.dataset.device] || '',
    status: $('.config-status', c).textContent, loaded: $('.config-status', c).classList.contains('loaded'),
    detected: c.dataset.detected || '', override: c.classList.contains('show-override'), shown: c.dataset.shown || ''
  }));
}

function defaultDeviceCards(ws) {
  const base = (id, vendor, model, os, version) => ({ id, vendor, model, custom: '', os, version, role: 'leaf', ports: '49, 50', touched: false, config: '', status: 'Henüz yüklenmedi', loaded: false, detected: '', override: false, shown: '' });
  return [base('a', 'cisco', 'C9300X-24Y', 'IOS-XE', '17.12'), base('b', 'aruba', 'CX 6300M', 'AOS-CX', '10.13')];
}

function applyDeviceCards(list) {
  while (deviceIds().length < list.length) addDevice(true);
  while (deviceIds().length > list.length) { const last = deviceIds().filter(i => !['a', 'b'].includes(i)).pop(); if (!last) break; removeDevice(last); }
  state.configs = {};
  $$('.device-card').forEach((card, i) => {
    const d = list[i]; if (!d) return;
    card.dataset.device = d.id; $('.device-index', card).textContent = d.id.toUpperCase();
    $('.vendor', card).value = d.vendor; $('.vendor-dot', card).className = 'vendor-dot ' + d.vendor;
    fillModelSelect($('.model', card), d.vendor, d.model === CUSTOM_MODEL ? undefined : d.model);
    if (d.model === CUSTOM_MODEL) $('.model', card).value = CUSTOM_MODEL;
    $('.model-custom', card).value = d.custom || ''; applyModelDefaults(card);
    $('.os', card).value = d.os; $('.version', card).value = d.version; $('.role', card).value = d.role; $('.ports', card).value = d.ports;
    if (d.touched) $('.ports', card).dataset.touched = '1'; else delete $('.ports', card).dataset.touched;
    const cf = $('.config-file', card); if (cf) cf.value = '';
    state.configs[d.id] = d.config || '';
    const st = $('.config-status', card); st.textContent = d.status || 'Henüz yüklenmedi'; st.classList.toggle('loaded', Boolean(d.loaded));
    if (d.detected) card.dataset.detected = d.detected; else delete card.dataset.detected;
    if (d.shown) card.dataset.shown = d.shown; else delete card.dataset.shown;
    card.classList.toggle('show-override', Boolean(d.override));
    renderCaps(card); renderDetectChip(card);
  });
}

// Denetimde ikinci kartı gizleyebilmek için kaldır düğmesi
(function initAuditRemove() {
  const b = document.querySelector('[data-device="b"]'); if (!b || $('.audit-remove', b)) return;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'remove-device audit-remove'; btn.setAttribute('aria-label', 'Cihazı kaldır'); btn.textContent = '×';
  $('.device-title', b).appendChild(btn);
  btn.addEventListener('click', () => {
    if (activeDeviceIds().length <= 1) return;
    const id = b.dataset.device; state.configs[id] = ''; const st = $('.config-status', b); st.textContent = 'Henüz yüklenmedi'; st.classList.remove('loaded');
    const cf = $('.config-file', b); if (cf) cf.value = ''; delete b.dataset.detected; delete b.dataset.shown; b.classList.remove('show-override'); renderDetectChip(b);
    b.hidden = true; refreshDeviceActions();
  });
})();

// ---------- Nasıl kullanılır ----------
var HOWTO = {
  routing: ['Üstten bu modülü seç (Routing & Overlay).', 'Cihazların üreticisini, modelini ve rolünü seç; mevcut config varsa "Dosya seç" ile yükle.', 'Niyet kutusuna ne istediğini düz cümleyle yaz.', '"Planı hazırla"ya bas; delta config, doğrulama, rollback, fark ve risk sekmelerine bak.'],
  security: ['Secure Access modülünü seç.', 'Erişim switch(ler)ini ve NAC / RADIUS bilgilerini gir.', 'Niyete 802.1X / MAB isteğini yaz.', '"Planı hazırla"ya bas; config ve doğrulama adımlarını incele.'],
  cabling: ['Fiziksel Plan modülünü seç.', 'Cihazları ve boş uplink portlarını gir.', 'Niyete kablolama / VXLAN isteğini yaz.', '"Planı hazırla"ya bas; port, kablo ve saha emrini al.'],
  hardening: ['Switch Hardening modülünü seç.', 'Üreticiyi, hostname ve yönetim bilgilerini gir; varsa mevcut config\'i yükle.', 'Niyeti kontrol et.', '"Planı hazırla"ya bas; tam baseline, hardening raporu ve fark gelir.'],
  campus: ['Campus Builder\'ı seç.', 'Core ve access cihazlarını tek tek ekle (üretici, model, hostname, IP).', 'Niyete VLAN\'ları, 802.1X, OSPF, VSS / vPC / stack gibi isteklerini yaz.', '"Planı hazırla"ya bas; cihaz başına config, port planı ve topoloji gelir. "Lab paketi (ZIP)" ile dışa aktar.'],
  wan: ['WAN / VPN modülünü seç.', 'Hub ve spoke router\'larını ekle (üretici, model, WAN IP, LAN alt ağı).', 'Niyete DMVPN / IPsec / GRE, çift ISP veya QoS isteğini yaz.', '"Planı hazırla"ya bas; router config, tünel planı ve topoloji gelir.'],
  audit: ['Config Denetimi modülünü seç.', '"Dosya seç" ile bir cihazın running-config\'ini yükle (üretici ve rol otomatik algılanır). Başka cihaz için "+ Cihaz ekle".', 'Denetim profillerini ve NTP / syslog / RADIUS değerlerini kontrol et.', '"Planı hazırla"ya bas; güvenlik puanı, bulgular ve düzeltme komutları gelir.']
};
function renderHowTo(module) {
  const ol = $("#howtoSteps"); if (!ol || !HOWTO) return;
  const steps = HOWTO[module] || HOWTO.routing;
  ol.innerHTML = steps.map(x => '<li>' + escHtml(x) + '</li>').join('');
}

renderHowTo(state.module);

// ---------- Risk şeridi ve diff görünümü ----------
function renderRiskBanner() {
  const p = state.plan; const el = $('#riskBanner'); if (!el || !p || !p.risk) return;
  const r = p.risk; const lvl = r.level === 'YÜKSEK' ? 'high' : r.level === 'ORTA' ? 'mid' : 'low';
  el.dataset.level = lvl;
  $('#riskBadge').textContent = r.level + ' RİSK'; $('#riskBadge').className = 'risk-badge ' + lvl;
  $('#riskDevices').textContent = String(p.ids.length);
  $('#riskScore').textContent = r.score + ' / 100';
  const pre = p.preflight || [];
  $('#riskPre').textContent = pre.length ? pre.length + ' bulgu' : 'Çakışma yok'; $('#riskPre').className = pre.length ? 'warn' : 'ok';
  const al = $('#riskAlert'); const top = r.rows.slice().sort((a, b) => b.w - a.w)[0];
  if (pre.length) { al.hidden = false; al.textContent = 'Ön kontrol: ' + pre[0] + (pre.length > 1 ? ' (+' + (pre.length - 1) + ')' : ''); }
  else if (top) { al.hidden = false; al.innerHTML = '<b>' + escHtml(top.t) + '</b> ' + escHtml(top.m); }
  else al.hidden = true;
}
$('#diffToggle').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.diffView = b.dataset.diffview; renderOutput(); });

// ---------- Üst çubuk: sürüm ve tarih / saat ----------
(function initMeta() {
  const v = $('#appVersion'), c = $('#appClock'); if (!v || !c) return;
  v.textContent = 'v' + (window.NETCUBE_VERSION || '?');
  const tick = () => {
    const loc = window.I18N ? window.I18N.locale() : 'tr-TR';
    try { c.textContent = new Date().toLocaleString(loc, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { c.textContent = new Date().toLocaleString(); }
  };
  tick(); setInterval(tick, 1000);
})();

// ---------- TACACS+ ve Huawei NAC (802.1X / MAB) blokları ----------
function tacacsLines(vendor, ips) {
  ips = (ips && ips.length ? ips : ['<TACACS_IP>']).slice(0, 2);
  if (vendor === 'cisco') return [...ips.flatMap((ip, i) => ['tacacs server TAC-' + (i + 1), ' address ipv4 ' + ip, ' key <TACACS_KEY>', ' timeout 5']),
    'aaa group server tacacs+ TACACS_GRP', ...ips.map((ip, i) => ' server name TAC-' + (i + 1)),
    'aaa authentication login VTY_AUTH group TACACS_GRP local', 'aaa authorization exec VTY_AUTH group TACACS_GRP local if-authenticated', 'aaa authorization commands 15 VTY_AUTH group TACACS_GRP local if-authenticated',
    'aaa accounting exec default start-stop group TACACS_GRP', 'aaa accounting commands 15 default start-stop group TACACS_GRP',
    '! TACACS+ sunucuları RADIUS ile aynı IP\'lerde varsayıldı; gerçek adresleri ve anahtarı girin. Yerel breakglass kullanıcısı yedek olarak kalır'];
  if (vendor === 'aruba') return [...ips.map(ip => 'tacacs-server host ' + ip + ' key plaintext <TACACS_KEY>'), 'aaa group server tacacs TACACS_GRP', ...ips.map(ip => ' server ' + ip),
    'aaa authentication login ssh group TACACS_GRP local', 'aaa accounting all-mgmt channel ssh start-stop group TACACS_GRP',
    '! TACACS+ komutları AOS-CX sürümüne göre doğrulanmalıdır; sunucular RADIUS ile aynı IP\'lerde varsayıldı'];
  return ['hwtacacs-server template TACACS_TPL', ' undo hwtacacs-server user-name domain-included', ' hwtacacs-server authentication ' + ips[0], ...(ips[1] ? [' hwtacacs-server authentication ' + ips[1] + ' secondary'] : []),
    ' hwtacacs-server authorization ' + ips[0], ...(ips[1] ? [' hwtacacs-server authorization ' + ips[1] + ' secondary'] : []),
    ' hwtacacs-server accounting ' + ips[0], ...(ips[1] ? [' hwtacacs-server accounting ' + ips[1] + ' secondary'] : []), ' hwtacacs-server shared-key cipher <TACACS_KEY>', 'quit',
    'aaa', ' authentication-scheme TACACS_AUTH', '  authentication-mode hwtacacs local', ' authorization-scheme TACACS_AUTHZ', '  authorization-mode hwtacacs local', '  authorization-cmd 0 hwtacacs',
    ' accounting-scheme TACACS_ACC', '  accounting-mode hwtacacs', ' recording-scheme TACACS_REC', '  recording-mode hwtacacs TACACS_TPL',
    ' domain tacacs_dmn', '  authentication-scheme TACACS_AUTH', '  accounting-scheme TACACS_ACC', '  authorization-scheme TACACS_AUTHZ', '  hwtacacs-server TACACS_TPL', ' cmd recording-scheme TACACS_REC', 'quit',
    'domain tacacs_dmn admin', '# TACACS+ (hwtacacs) komutları model ve sürüme göre doğrulanmalıdır; sunucular RADIUS ile aynı IP\'lerde varsayıldı; yerel breakglass kullanıcısı yedek olarak kalır'];
}

function appendTacacs(vendor, text) {
  const lines = tacacsLines(vendor, campusRadius()); const arr = String(text).split(String.fromCharCode(10));
  let t = arr.length; while (t > 0 && !arr[t - 1].trim()) t--;
  const at = t > 0 && /^(end|return)$/i.test(arr[t - 1].trim()) ? t - 1 : t;
  arr.splice(at, 0, ...lines);
  let out = arr.join(String.fromCharCode(10));
  if (vendor === 'cisco') out = out.replace(/ login local/g, ' login authentication VTY_AUTH' + String.fromCharCode(10) + ' authorization exec VTY_AUTH' + String.fromCharCode(10) + ' authorization commands 15 VTY_AUTH');
  return out;
}

function huaweiNacLines(radius) {
  radius = (radius && radius.length ? radius : ['<RADIUS_IP>']).slice(0, 2); const dom = 'NAC_DOMAIN';
  return ['radius-server template NAC', ' radius-server shared-key cipher <RADIUS_SECRET>', ...radius.map(ip => ' radius-server authentication ' + ip + ' 1812 weight 80'), ...radius.map(ip => ' radius-server accounting ' + ip + ' 1813 weight 80'),
    ' undo radius-server user-name domain-included', ' radius-server detect-server up-server interval 300', ' calling-station-id mac-format hyphen-split mode2 uppercase', ' radius-attribute set Service-Type 10 auth-type mac', 'quit',
    ...radius.map(ip => 'radius-server authorization ' + ip + ' shared-key cipher <COA_KEY>'), 'radius-server authorization match-type all',
    'aaa', ' authentication-scheme NAC_AUTH', '  authentication-mode radius', ' accounting-scheme NAC_ACCT', '  accounting-mode radius', '  accounting realtime 3',
    ' service-scheme NAC_GUEST_SRV', '  user-vlan <GUEST_VLAN>', ' service-scheme NAC_DOWN_SRV', '  user-vlan <CRITICAL_VLAN>', ' service-scheme NAC_PRE_SRV', '  user-vlan <PREAUTH_VLAN>',
    ' domain ' + dom, '  authentication-scheme NAC_AUTH', '  accounting-scheme NAC_ACCT', '  radius-server NAC', 'quit',
    'dot1x enable', 'dot1x timer tx-period 10', 'authentication mac-move enable vlan all',
    'dot1x-access-profile name NAC_DOT1X', ' authentication event client-no-response action authorize service-scheme NAC_GUEST_SRV', ' dot1x timer reauthenticate-period 28800', ' dot1x reauthenticate', 'quit',
    'mac-access-profile name NAC_MAB', 'quit',
    'authentication-profile name NAC_AUTH_PROF', ' dot1x-access-profile NAC_DOT1X', ' mac-access-profile NAC_MAB', ' access-domain ' + dom + ' dot1x force', ' access-domain ' + dom + ' mac-authen force',
    ' authentication event authen-fail action authorize service-scheme NAC_GUEST_SRV', ' authentication event authen-server-down action authorize service-scheme NAC_DOWN_SRV', ' authentication event authen-server-up action re-authen',
    ' authentication event pre-authen action authorize service-scheme NAC_PRE_SRV', ' authentication order mac dot1x', ' authentication ip-address in-accounting-start', 'quit',
    '# 802.1X ayrıntıları (domain, service-scheme, event, VLAN\'lar) model ve sürüme göre doğrulanmalıdır; ISE kullanıyorsanız redirect ACL\'i ve authentication redirect-acl ayrıca tanımlanmalıdır'];
}

// ---------- Huawei hardening ekleri (gerçek bir üretim şablonundan uyarlanmıştır) ----------
function insertBeforeEnd(text, lines) {
  const arr = String(text).split(String.fromCharCode(10)); let t = arr.length; while (t > 0 && !arr[t - 1].trim()) t--;
  const at = t > 0 && /^(end|return)$/i.test(arr[t - 1].trim()) ? t - 1 : t;
  arr.splice(at, 0, ...lines); return arr.join(String.fromCharCode(10));
}

function huaweiHardExtras() {
  return ['ssh server publickey rsa rsa_sha2_256 rsa_sha2_512', 'ssh client publickey rsa rsa_sha2_256 rsa_sha2_512', 'ssh server rsa-key min-length 3072',
    '# rsa local-key-pair create komutunu etkileşimli çalıştırın ve 4096 bit seçin (komut onay ister)',
    'undo ftp server source all-interface', 'undo ftp ipv6 server source all-interface', 'stp tc-protection',
    'aaa', ' local-aaa-user password policy administrator', '  password history record number 5', '  undo password alert original', 'quit',
    '# Parola süresi (password expire) kurumsal politikanıza göre ayarlanmalıdır',
    'header login information "Unauthorized access is prohibited. All activity may be logged and may lead to legal action."'];
}
