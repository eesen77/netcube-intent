const state = {
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
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const CATALOG = window.NETCUBE_DEVICES || [];
const CUSTOM_MODEL = '__custom';
const PROTO_NAME = { ospf: 'OSPF', bgp: 'eBGP', eigrp: 'EIGRP', static: 'Static route', vxlan: 'VXLAN EVPN', dot1x: '802.1X / MAB' };
const FALLBACKS = { vxlan: ['ospf', 'bgp', 'static'], eigrp: ['ospf', 'bgp', 'static'], bgp: ['ospf', 'static'], ospf: ['bgp', 'static'], static: [] };

function catalogFor(vendor) { return CATALOG.filter(d => d.vendor === vendor); }
function findDevice(vendor, model) { return CATALOG.find(d => d.vendor === vendor && d.model === model) || null; }
function deviceCaps(info) {
  const d = findDevice(info.vendor, info.model);
  if (d) return { ...d.caps, known: true, note: d.note };
  return { ospf: true, bgp: true, eigrp: info.vendor === 'cisco', static: true, vxlan: true, dot1x: true, known: false, note: 'Özel model: yetenekler doğrulanamadı, varsayım kullanıldı.' };
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
    const roleMap = { access: 'leaf', core: 'spine' };
    const wanted = d.roles.map(r => roleMap[r] || r);
    if (!wanted.includes(roleSel.value)) roleSel.value = wanted[0];
  }
  renderCaps(card);
}

function renderCaps(card) {
  const vendor = $('.vendor', card).value; const model = $('.model', card).value;
  const info = { vendor, model: model === CUSTOM_MODEL ? ($('.model-custom', card).value.trim() || 'Özel model') : model };
  const caps = deviceCaps(info);
  $('.cap-chips', card).innerHTML = ['ospf', 'bgp', 'eigrp', 'static', 'vxlan', 'dot1x'].map(k => `<span class="cap ${caps[k] ? 'on' : 'off'}">${caps[k] ? '✓' : '✕'} ${PROTO_NAME[k]}</span>`).join('');
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
  state.module = module; state.forced = null;
  state.outputPanel = module === 'audit' ? 'audit' : 'delta';
  state.outputDevice = 'a';
  $$('.module-picker button').forEach(b => b.classList.toggle('active', b.dataset.module === module));
  $('#securityContext').hidden = module !== 'security';
  $('#cablingContext').hidden = module !== 'cabling';
  $('#hardeningContext').hidden = module !== 'hardening';
  $('#campusContext').hidden = module !== 'campus';
  $('#auditContext').hidden = module !== 'audit';
  $('.device-grid').hidden = module === 'campus';
  $$('.device-card').forEach(c => { c.hidden = module === 'hardening' && c.dataset.device !== 'a'; });
  const actions = $('#deviceActions'); if (actions) actions.hidden = !['routing', 'cabling', 'security', 'audit'].includes(module);
  const navVisible = { hardening: ['full', 'audit'], campus: ['full', 'audit'], audit: ['audit'], security: ['audit'] }[module] || [];
  $$('.hardening-only').forEach(x => { x.hidden = !navVisible.includes(x.dataset.panel); });
  const auditBtn = $('.hardening-only[data-panel="audit"]'); if (auditBtn) auditBtn.textContent = ['audit', 'security'].includes(module) ? 'Denetim raporu' : 'Hardening raporu';
  const deltaBtn = $('.output-nav [data-panel="delta"]'); if (deltaBtn) deltaBtn.textContent = module === 'audit' ? 'Düzeltme komutları' : 'Delta config';
  const text = {
    audit: "Yüklediğim config'leri güvenlik açısından denetle; hardening, Layer 2 koruma, 802.1X hazırlığı ve routing güvenliği için eksikleri ve düzeltme komutlarını ver.",
    routing: "İki cihazdaki VLAN 40'ı aynı Layer 2 ağ olarak uzat. Adı BILGI_ISLEM olsun. VNI ve gerekli loopback adreslerini sen belirle. Mevcut yapıyı bozmadan VXLAN EVPN kullan.",
    security: "Kullanıcı portlarında 802.1X olsun, başarısız olursa MAB denensin. ClearPass RADIUS kullan, telefon ve bilgisayar aynı portta çalışsın. 8 saatte reauth ve CoA etkin olsun.",
    cabling: "İki leaf cihazı yedekli olarak spine katmanına bağla. Boş uplink portlarını seç, 100G DAC kablo ve etiketleriyle saha iş emri hazırla. Ardından VXLAN EVPN config'ini üret.",
    hardening: "Bu switchi kurumsal erişim switchi olarak güvenli hale getir. SSH, AAA, yönetim ACL, NTP, syslog, SNMPv3, spanning-tree korumaları ve Layer 2 güvenlik ayarlarıyla tam config hazırla.",
    campus: "2 core ve 4 access switch için VLAN 10 USERS, VLAN 20 VOICE, VLAN 40 BILGI_ISLEM ve VLAN 99 MANAGEMENT olacak şekilde yedekli campus topolojisi ve hardening uygulanmış tam config hazırla."
  };
  $('#intentInput').value = window.I18N ? I18N.t(text[module]) : text[module];
  if (module === 'audit') setMode('live');
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
  const t = text.toLocaleLowerCase('tr-TR') + ' ' + text.toLowerCase(); // tr-TR: I -> ı olduğundan EIGRP vb. ASCII kısaltmalar için ikinci biçim şart
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
  const full=configs[vendor];
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

function campusInventory() {
  const osMap={cisco:'IOS-XE',aruba:'AOS-CX',huawei:'VRP'};
  const coreVendor=inputValue('coreVendor','cisco'), accessVendor=inputValue('accessVendor','cisco');
  return {
    coreCount:Math.max(1,Math.min(4,Number(inputValue('coreCount','2')))),
    accessCount:Math.max(1,Math.min(24,Number(inputValue('accessCount','4')))),
    core:{vendor:coreVendor,model:inputValue('coreModel',(catalogFor(coreVendor)[0]||{}).model||'Core'),os:osMap[coreVendor],version:'Profil tabanlı',config:'',ports:[],role:'core'},
    access:{vendor:accessVendor,model:inputValue('accessModel',(catalogFor(accessVendor)[0]||{}).model||'Access'),os:osMap[accessVendor],version:'Profil tabanlı',config:'',ports:['49','50'],role:'access'},
    vlans:campusVlans(), dual:inputValue('campusRedundancy','dual')==='dual'
  };
}

function gatewayAddress(vlan,host) {
  const template=inputValue('gatewayTemplate','10.{VLAN}.0.1/24').replace('{VLAN}',String(vlan));
  const [ip,prefix='24']=template.split('/'); const parts=ip.split('.'); parts[3]=String(host); return `${parts.join('.')}/${prefix}`;
}
function managementAddress(host) {
  const subnet=inputValue('campusMgmtSubnet','10.99.0.0/24'); const [ip,prefix='24']=subnet.split('/'); const parts=ip.split('.'); parts[3]=String(host); return `${parts.join('.')}/${prefix}`;
}
function isManagementVlan(v) { return /MANAGEMENT|MGMT/i.test(v.name); }

function campusCiscoConfig(role, inv) {
  const vlanDefs=inv.vlans.map(v=>`vlan ${v.id}\n name ${v.name}`).join('\n');
  const admin=adminAclParts(inputValue('adminNetwork','10.10.10.0/24'));
  const common=`service timestamps log datetime msec localtime show-timezone\nservice password-encryption\nno ip http server\nno ip http secure-server\nip domain-name corp.local\nip ssh version 2\naaa new-model\nusername breakglass privilege 15 secret <LOCAL_SECRET_FROM_VAULT>\nip access-list standard MGMT_ACCESS\n permit ${admin.ip} ${admin.wildcard}\n deny any log\nspanning-tree mode rapid-pvst\nspanning-tree portfast bpduguard default\nntp server 10.10.20.10 prefer\nlogging host 10.10.30.20\nlogging trap warnings\nsnmp-server group NMS v3 priv access MGMT_ACCESS\nsnmp-server user <SNMPV3_USER> NMS v3 auth sha <AUTH_FROM_VAULT> priv aes 256 <PRIV_FROM_VAULT>\nline vty 0 15\n access-class MGMT_ACCESS in\n transport input ssh\n login local\n exec-timeout 10 0`;
  if(role==='core') return Array.from({length:inv.coreCount},(_,i)=>{
    const protectedVlans=inv.vlans.filter(v=>!isManagementVlan(v)).map(v=>v.id).join(',');
    const svis=inv.vlans.map(v=>{const vip=isManagementVlan(v)?managementAddress(1):gatewayAddress(v.id,1),pip=isManagementVlan(v)?managementAddress(i+2):gatewayAddress(v.id,i+2);return `interface Vlan${v.id}\n description GW_${v.name}\n ip address ${ipOnly(pip)} ${maskFor(pip)}\n standby ${v.id%256||1} ip ${ipOnly(vip)}\n standby ${v.id%256||1} priority ${i===0?110:100}\n standby ${v.id%256||1} preempt\n no shutdown`;}).join('\n');
    const trunks=Array.from({length:inv.accessCount},(_,a)=>`interface TenGigabitEthernet1/0/${a+1}\n description TO-ACCESS-${String(a+1).padStart(2,'0')}-TE1/1/${i+1}\n switchport mode trunk\n switchport trunk allowed vlan ${inv.vlans.map(v=>v.id).join(',')}\n ip dhcp snooping trust\n ip arp inspection trust\n no shutdown`).join('\n');
    return `! ===== CORE-${String(i+1).padStart(2,'0')} · ${inv.core.model} =====\nhostname CORE-${String(i+1).padStart(2,'0')}\n${common}\nip routing\n${vlanDefs}\nip dhcp snooping\nip dhcp snooping vlan ${protectedVlans}\nip arp inspection vlan ${protectedVlans}\n${svis}\n${trunks}\nspanning-tree vlan ${inv.vlans.map(v=>v.id).join(',')} root ${i===0?'primary':'secondary'}\nend`;
  }).join('\n\n');
  return Array.from({length:inv.accessCount},(_,i)=>{
    const mgmt=inv.vlans.find(v=>/MANAGEMENT|MGMT/i.test(v.name))||inv.vlans.at(-1); const uplinks=inv.dual?['49','50']:['49'];
    const protectedVlans=inv.vlans.filter(v=>!isManagementVlan(v)).map(v=>v.id).join(',');
    return `! ===== ACCESS-${String(i+1).padStart(2,'0')} · ${inv.access.model} =====\nhostname ACCESS-${String(i+1).padStart(2,'0')}\n${common}\n${vlanDefs}\nip dhcp snooping\nip dhcp snooping vlan ${protectedVlans}\nip arp inspection vlan ${protectedVlans}\ninterface Vlan${mgmt.id}\n description MANAGEMENT\n ip address ${ipOnly(managementAddress(20+i))} ${maskFor(managementAddress(20+i))}\n no shutdown\nip default-gateway ${ipOnly(managementAddress(1))}\ninterface range GigabitEthernet1/0/1-24\n description USER_AND_VOICE\n switchport mode access\n switchport access vlan ${inv.vlans[0].id}\n switchport voice vlan ${(inv.vlans.find(v=>/VOICE/i.test(v.name))||inv.vlans[0]).id}\n ip verify source\n spanning-tree portfast\n spanning-tree bpduguard enable\ninterface range GigabitEthernet1/0/25-44\n description ${inv.vlans[2]?.name||inv.vlans[0].name}\n switchport mode access\n switchport access vlan ${inv.vlans[2]?.id||inv.vlans[0].id}\n ip verify source\n spanning-tree portfast\n spanning-tree bpduguard enable\ninterface range GigabitEthernet1/0/45-48\n description UNUSED_SHUTDOWN\n shutdown\n${uplinks.map((p,u)=>`interface TenGigabitEthernet1/1/${u+1}\n description TO-CORE-${String(u+1).padStart(2,'0')}-TE1/0/${i+1}\n switchport mode trunk\n switchport trunk allowed vlan ${inv.vlans.map(v=>v.id).join(',')}\n ip dhcp snooping trust\n ip arp inspection trust\n no shutdown`).join('\n')}\nend`;
  }).join('\n\n');
}

function campusGenericConfig(vendor,role,inv) {
  const comment=vendor==='huawei'?'#':'!'; const label=vendor==='aruba'?'AOS-CX':'VRP';
  const count=role==='core'?inv.coreCount:inv.accessCount, model=role==='core'?inv.core.model:inv.access.model;
  const vlanLines=inv.vlans.map(v=>vendor==='aruba'?`vlan ${v.id}\n name ${v.name}`:`vlan ${v.id}\n description ${v.name}\nquit`).join('\n');
  return Array.from({length:count},(_,i)=>`${comment} ===== ${role.toUpperCase()}-${String(i+1).padStart(2,'0')} · ${model} · ${label} =====\n${vendor==='aruba'?`hostname ${role.toUpperCase()}-${String(i+1).padStart(2,'0')}\nno telnet-server\nssh server vrf default\nuser breakglass group administrators password ciphertext <LOCAL_SECRET_FROM_VAULT>\nspanning-tree\nspanning-tree bpdu-guard\nntp server 10.10.20.10 iburst prefer\nlogging 10.10.30.20\n${vlanLines}`:`sysname ${role.toUpperCase()}-${String(i+1).padStart(2,'0')}\nundo telnet server enable\nstelnet server enable\nstp enable\nstp bpdu-protection\nntp-service unicast-server 10.10.20.10 preferred\ninfo-center loghost 10.10.30.20\n${vlanLines}`}\n${comment} Uplink ve SVI blokları ${inv.dual?'çift core':'tek core'} topolojisine göre cihaz profiliyle üretilir.\n${vendor==='aruba'?'':'return'}`).join('\n\n');
}

function campusConfig(vendor,side) {
  const inv=campusInventory(), role=side==='a'?'core':'access';
  const full=vendor==='cisco'?campusCiscoConfig(role,inv):campusGenericConfig(vendor,role,inv);
  const label=role==='core'?'CORE SWITCH CONFIGLERİ':'ACCESS SWITCH CONFIGLERİ';
  return {delta:full,full,audit:`CAMPUS TASARIM RAPORU\n\n${inv.coreCount} core · ${inv.accessCount} access · ${inv.vlans.length} VLAN\nTopoloji: ${inv.dual?'Her access iki core’a yedekli bağlı':'Tek uplink'}\nManagement gateway: ${managementAddress(1)}\nCore management IP’leri: ${Array.from({length:inv.coreCount},(_,i)=>`CORE-${String(i+1).padStart(2,'0')}=${managementAddress(i+2)}`).join(', ')}\nAccess management IP’leri: ${Array.from({length:inv.accessCount},(_,i)=>`ACCESS-${String(i+1).padStart(2,'0')}=${managementAddress(i+20)}`).join(', ')}\n\nVLANLAR\n${inv.vlans.map(v=>`${v.id}\t${v.name}\tGateway ${isManagementVlan(v)?managementAddress(1):gatewayAddress(v.id,1)}`).join('\n')}\n\nPORT PLANI\n${Array.from({length:inv.accessCount},(_,i)=>`ACCESS-${String(i+1).padStart(2,'0')} Te1/1/1 → CORE-01 Te1/0/${i+1}${inv.dual?`; Te1/1/2 → CORE-02 Te1/0/${i+1}`:''}`).join('\n')}\n\nGÜVENLİK\n- Core-01 STP root primary, Core-02 root secondary.\n- DHCP Snooping ve DAI kullanıcı VLANlarında etkin.\n- Yalnız uplink portları DHCP/ARP trusted.\n- Access portlarında IP Source Guard ve BPDU Guard etkin.\n- Kullanılmayan 45-48 portları kapalı.\n- Secret değerleri vault placeholder olarak bırakıldı.\n\nVARSAYIM\nGerçek port kapasitesi ve komut desteği tam model/sürüm profiliyle doğrulanmalıdır.`,verify:`${label}\n\n1. VLAN ve trunk kapsamını doğrula.\n2. STP root primary/secondary ve blocked yedek yolu doğrula.\n3. Core gateway/first-hop redundancy durumunu doğrula.\n4. Her access switchten ${managementAddress(1)} management gateway ping testi yap.\n5. DHCP Snooping binding ve DAI drop sayaçlarını doğrula.\n6. Trusted portların yalnız uplinkler olduğunu doğrula.\n7. SSH, NTP, syslog ve SNMPv3 yönetim servislerini doğrula.`,rollback:'Yeni kurulumda rollback: startup-config yüklenmeden cihazı fabrika/önceki baseline durumuna döndür. Canlı sisteme uygulanacaksa her cihazın orijinal config snapshotını geri yükle.'};
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
  if (protocol === 'hardening') return hardeningConfig(vendor, side);
  if (protocol === 'security') return securityConfig(vendor, side);
  if (protocol === 'cabling') protocol = 'vxlan';
  const ctx = state.ctx;
  return window.NETCUBE_FABRIC.fabricConfig(vendor, protocol, side, { ...ctx, asn: protocol === 'vxlan' ? ctx.P.asnEvpn : ctx.P.asnBgp });
}

function analyzePlan() {
  const intent = $('#intentInput').value.trim();
  let ids = ['routing', 'cabling', 'security', 'audit'].includes(state.module) ? deviceIds() : ['a', 'b'];
  let devsMap = {}; ids.forEach(i => { devsMap[i] = deviceInfo(i); });
  if (state.module === 'campus') { const inv = campusInventory(); devsMap = { a: inv.core, b: inv.access }; ids = ['a', 'b']; }
  const all = ids.map(i => devsMap[i]);
  const a = devsMap[ids[0]], b = devsMap[ids[1]];
  const facts = {}; ids.forEach(i => { facts[i] = configFacts(devsMap[i]); });
  const fa = facts[ids[0]], fb = facts[ids[1]];
  state.params = buildParams(intent, ids, facts, devsMap);
  const P = state.params;
  const topo = window.NETCUBE_FABRIC.buildTopology(ids, devsMap, $('#redundancy')?.value === 'Tek bağlantı' ? 'single' : 'dual');
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
  const fallbackCount = notes.length;
  if (['vxlan', 'cabling', 'ospf', 'bgp'].includes(protocol)) notes.push(...P.notes);
  all.filter(x => !deviceCaps(x).known).forEach(x => notes.push(`${deviceLabel(x)} katalogda yok; yetenekler doğrulanmadı.`));
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
    ,campus: { title: 'Hardening Uygulanmış Campus Tasarımı', icon: 'CB', confidence: 90, reason: `${inputValue('coreCount','2')} core ve ${inputValue('accessCount','4')} access switch için management IP, VLAN, STP, trunk, DHCP Snooping, DAI, IP Source Guard ve port planı birlikte üretildi.`, tags: [`${inputValue('coreCount','2')} core`, `${inputValue('accessCount','4')} access`, `${campusVlans().length} VLAN`, inputValue('campusRedundancy','dual')==='dual'?'Çift uplink':'Tek uplink'] }
  };
  const loadedCount = ids.filter(i => facts[i].live).length;
  definitions.audit = {
    title: 'Config Denetimi ve Öneriler', icon: 'CD', confidence: Math.round(60 + 40 * loadedCount / ids.length),
    reason: loadedCount ? `${loadedCount} cihazın yüklenen config'i seçili profillerle denetleniyor. Bulgular ciddiyete göre sıralanır; düzeltme komutları yer tutucularla hazırlanır, secret değerleri yazılmaz.` : "Denetim için en az bir cihazın running-config'ini yükleyin.",
    tags: auditProfilesFor('audit').map(p => AU.PROFILES[p])
  };
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
  state.plan = { notes, intent, ids, devices: devsMap, facts, topo, a, b, fa, fb, definition: d, alternatives, outputs, audits };
  renderPlan();
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
  if (p.notes && p.notes.length) $('#warningBox').innerHTML += p.notes.map(n => `<span class="compat-note">⚠ ${n}</span>`).join('');
  $('#alternativeList').innerHTML = p.alternatives.map((a, i) => `<div class="alternative-row"><div><strong>${a.name}</strong><small>${a.note}</small></div><div class="score-track"><i style="width:${a.score}%"></i></div><span class="score">${a.enabled ? '%' + a.score : '—'}</span><button class="alt-action" data-alt="${a.key}" ${!a.enabled || i === 0 ? 'disabled' : ''}>${i === 0 ? 'Seçili' : 'İncele'}</button></div>`).join('');
  renderCablingPlan();
  renderCampusTopology();
  renderAuditCard();
  const now = new Intl.DateTimeFormat(window.I18N ? I18N.locale() : 'tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#snapshotLabel').textContent = `Config snapshot · ${now}`;
  updateDeviceTabs(); renderOutput();
  $('#results').hidden = false;
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
  const card=$('#topologyCard'); if(state.solution!=='campus'){ renderFabricTopology(); return; } card.hidden=false; $('.subhead h3', card).textContent='Campus topolojisi'; $('.subhead p', card).textContent='Core, access, uplink ve VLAN kapsamı';
  const inv=campusInventory(), width=960, height=380;
  const coreY=80, accessY=265; const coreXs=Array.from({length:inv.coreCount},(_,i)=>width*(i+1)/(inv.coreCount+1));
  const accessXs=Array.from({length:inv.accessCount},(_,i)=>width*(i+1)/(inv.accessCount+1));
  const links=[];
  accessXs.forEach((ax,ai)=>coreXs.forEach((cx,ci)=>{if(!inv.dual&&ci>0)return;links.push(`<line class="link ${ci>0?'secondary':''}" x1="${cx}" y1="120" x2="${ax}" y2="245"><title>ACCESS-${String(ai+1).padStart(2,'0')} Te1/1/${ci+1} → CORE-${String(ci+1).padStart(2,'0')} Te1/0/${ai+1}</title></line>`);}));
  const cores=coreXs.map((x,i)=>`<g><rect class="node node-core" x="${x-92}" y="55" width="184" height="65" rx="12"/><text class="node-label core-label" x="${x}" y="80" text-anchor="middle">CORE-${String(i+1).padStart(2,'0')}</text><text class="node-meta core-meta" x="${x}" y="98" text-anchor="middle">${inv.core.model} · ${managementAddress(i+2)}</text><text class="node-meta core-meta" x="${x}" y="112" text-anchor="middle">STP ${i===0?'PRIMARY':'SECONDARY'}</text></g>`).join('');
  const access=accessXs.map((x,i)=>`<g><rect class="node" x="${x-78}" y="245" width="156" height="68" rx="12"/><text class="node-label" x="${x}" y="269" text-anchor="middle">ACCESS-${String(i+1).padStart(2,'0')}</text><text class="node-meta" x="${x}" y="287" text-anchor="middle">${inv.access.model}</text><text class="node-meta" x="${x}" y="302" text-anchor="middle">${managementAddress(i+20)}</text></g>`).join('');
  $('#topologyDiagram').innerHTML=`<svg viewBox="0 0 ${width} ${height}" aria-labelledby="topologyTitle"><title id="topologyTitle">${inv.coreCount} core ve ${inv.accessCount} access switch campus topolojisi</title>${links.join('')}${cores}${access}<text class="node-meta" x="480" y="352" text-anchor="middle">Düz çizgi: primary uplink · Kesikli çizgi: secondary uplink · Hover: port eşleşmesi</text></svg>`;
  $('#topologySummary').textContent=`${inv.coreCount} CORE · ${inv.accessCount} ACCESS · ${links.length} LINK`;
  $('#topologyLegend').innerHTML=inv.vlans.map(v=>`<span>VLAN ${v.id} · ${v.name}</span>`).join('');
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
    if (state.solution === 'campus') label = id === 'a' ? 'Core' : 'Access';
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
  else if (!output) text = `Bu çözüm ${vendorName(info.vendor)} ${info.model} profili için uygun görünmüyor.\n\nAlternatif olarak OSPF veya BGP planı seçin.`;
  else text = output[state.outputPanel] || 'Bu bölüm için çıktı bulunamadı.';
  $('#codeOutput').textContent = text;
  $('#codeLabel').textContent = `${vendorName(info.vendor).toUpperCase()} ${info.os.toUpperCase()} · ${state.outputPanel.toUpperCase()}`;
  $$('.output-nav button').forEach(b => b.classList.toggle('active', b.dataset.panel === state.outputPanel));
  $('#deltaCaption').textContent = state.solution === 'hardening'
    ? (state.mode === 'new' ? 'Yeni switch için baştan sona uygulanabilir baseline' : 'Mevcut config’e göre delta, hedef config ve hardening raporu')
    : state.solution === 'campus' ? 'Tüm core ve access switchler için hardening uygulanmış tam config' : state.solution === 'audit' ? 'Bulgulara göre önerilen düzeltme komutları (secret değerleri yer tutucudur)' : 'Mevcut config üzerine uygulanacak minimum komutlar';
  let orders = state.solution === 'vxlan' || state.solution === 'cabling'
    ? ['Underlay erişimini ve loopback rotalarını doğrula', 'Spine/route-reflector EVPN komşuluklarını hazırla', 'Leaf VTEP ve VLAN–VNI eşleşmesini uygula', 'EVPN route ve MAC öğrenimini doğrula']
    : state.solution === 'campus'
      ? ['Management IP, VLAN ve port planını onayla', 'Önce core switchleri ve STP root rollerini yapılandır', 'Access switchleri management VLAN üzerinden erişilebilir hale getir', 'Trunkları kablo/port planına göre bağla', 'DHCP Snooping, DAI ve IP Source Guard testlerini tamamla']
    : state.solution === 'hardening'
      ? ['Mevcut config ve OOB/konsol erişimini yedekle', 'Management IP, ACL ve AAA değerlerini doğrula', 'Önce SSH/logging/NTP, sonra AAA ve ACL uygula', 'Yeni oturumla yönetim erişimini test et', 'Layer 2 korumalarını pilot port/VLAN üzerinde etkinleştir']
    : state.solution === 'security'
      ? ['NAC/RADIUS politikasını hazırla', 'Tek pilot portta uygula', 'Başarılı, MAB ve RADIUS-down senaryolarını test et', 'Doğrulama sonrası port grubuna genişlet']
      : ['Ön kontrol komutlarını çalıştır', 'Hedef cihaz konfigürasyonunu uygula', 'Kaynak cihaz konfigürasyonunu uygula', 'Komşuluk ve route tablosunu doğrula'];
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

function bindCard(card) {
  const id = () => card.dataset.device;
  $('.vendor', card).addEventListener('change', e => {
    $('.vendor-dot', card).className = `vendor-dot ${e.target.value}`;
    fillModelSelect($('.model', card), e.target.value);
    delete $('.ports', card).dataset.touched;
    applyModelDefaults(card);
  });
  $('.model', card).addEventListener('change', () => { delete $('.ports', card).dataset.touched; applyModelDefaults(card); });
  $('.model-custom', card).addEventListener('input', () => renderCaps(card));
  $('.ports', card).addEventListener('input', e => { e.target.dataset.touched = '1'; });
  $('.sample-config', card).addEventListener('click', () => {
    state.configs[id()] = sampleConfig($('.vendor', card).value, id());
    const status = $('.config-status', card); status.textContent = `Örnek config · ${window.summarizeConfig(window.parseConfig(state.configs[id()]))}`; status.classList.add('loaded');
  });
  $('.config-file', card).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    state.configs[id()] = await file.text();
    const status = $('.config-status', card); status.textContent = `${file.name} · ${window.summarizeConfig(window.parseConfig(state.configs[id()]))}`; status.classList.add('loaded');
  });
  const rm = $('.remove-device', card);
  if (rm) rm.addEventListener('click', () => removeDevice(id()));
}

function refreshDeviceActions() {
  const n = deviceIds().length;
  const note = $('#deviceCountNote'); if (note) note.textContent = `${n} / ${MAX_DEVICES} cihaz`;
  const btn = $('#addDeviceButton'); if (btn) btn.disabled = n >= MAX_DEVICES;
}

function addDevice() {
  const ids = deviceIds(); if (ids.length >= MAX_DEVICES) return;
  let letter = 'a'; for (let i = 0; i < 26; i++) { const l = String.fromCharCode(97 + i); if (!ids.includes(l)) { letter = l; break; } }
  const card = document.querySelector('[data-device="b"]').cloneNode(true);
  card.dataset.device = letter; card.hidden = false;
  $('.device-index', card).textContent = letter.toUpperCase();
  $('.device-title strong', card).textContent = `Cihaz ${letter.toUpperCase()}`;
  $('.device-title small', card).textContent = `Leaf ${ids.length + 1}`;
  $('.config-status', card).textContent = 'Henüz yüklenmedi'; $('.config-status', card).classList.remove('loaded');
  $('.config-file', card).value = '';
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
  bindCard(card); applyModelDefaults(card); refreshDeviceActions();
}

function removeDevice(id) {
  if (deviceIds().length <= 2 || ['a', 'b'].includes(id)) return;
  document.querySelector(`[data-device="${id}"]`).remove();
  delete state.configs[id]; refreshDeviceActions();
}

[['coreVendor', 'coreModel', 'C9500-24Y4C'], ['accessVendor', 'accessModel', 'C9300-48P']].forEach(([v, m, def]) => {
  fillModelSelect($('#' + m), $('#' + v).value, def);
  $('#' + v).addEventListener('change', () => fillModelSelect($('#' + m), $('#' + v).value));
});
$$('.device-card').forEach(card => {
  const defaults = { a: 'C9300X-24Y', b: 'CX 6300M' };
  fillModelSelect($('.model', card), $('.vendor', card).value, defaults[card.dataset.device]);
  applyModelDefaults(card);
  bindCard(card);
});
$('#addDeviceButton').addEventListener('click', addDevice);
refreshDeviceActions();
$('#intentInput').addEventListener('input', () => { state.forced = null; });
$('#exampleButton').addEventListener('click', () => { state.forced = null; exampleIndex = (exampleIndex + 1) % examples.length; $('#intentInput').value = window.I18N ? I18N.t(examples[exampleIndex]) : examples[exampleIndex]; });
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
    const map = { auditHardening: 'hardening', auditL2: 'l2', auditDot1x: 'dot1x', auditRouting: 'routing' };
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
