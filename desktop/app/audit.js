// Config denetimi: yüklenen running-config'i Cisco IOS-XE, Aruba AOS-CX ve Huawei VRP için
// kural tabanlı tarar; bulgu, puan ve düzeltme komutları üretir. Cihaza bağlanmaz.
// Kurallar genel iyi uygulamalara dayanır; kurumunuzun standardına ve platform
// dokümanına göre doğrulanmalıdır.
(function () {
  const SEV = {
    critical: { w: 20, label: 'Kritik', order: 0 },
    high: { w: 10, label: 'Yüksek', order: 1 },
    medium: { w: 5, label: 'Orta', order: 2 },
    low: { w: 2, label: 'Düşük', order: 3 }
  };
  const PROFILES = {
    hardening: 'Yönetim düzlemi hardening',
    l2: 'Layer 2 koruma',
    dot1x: '802.1X / NAC hazırlığı',
    routing: 'Routing güvenliği'
  };

  // ---------- bağlam ----------
  function makeCtx(info, params) {
    const text = info.config || '';
    const raw = text.replace(/\r/g, '').split('\n');
    const blocks = []; let cur = null;
    raw.forEach(r => {
      if (!r.trim()) return;
      if (/^\s*[!#]/.test(r)) { if (!/^\s/.test(r)) cur = null; return; }
      if (/^\S/.test(r)) { cur = { head: r.trim(), body: [] }; blocks.push(cur); }
      else if (cur) cur.body.push(r.trim());
    });
    const lines = raw.map(l => l.trim()).filter(l => l && !/^[!#]/.test(l));
    const v = info.vendor;
    const physRe = v === 'cisco' ? /^interface\s+(?:Fast|Gigabit|TenGigabit|TwentyFiveGig|FortyGigabit|HundredGig)\S*/i
      : v === 'aruba' ? /^interface\s+\d+\/\d+\/\d+/i
        : /^interface\s+(?:Gigabit|XGigabit|MultiGE|Ethernet|10GE|25GE|40GE|100GE)\S*/i;
    const ifaces = blocks.filter(b => physRe.test(b.head));
    const bhas = (b, re) => b.body.some(l => re.test(l));
    const accessRe = v === 'cisco' ? /^switchport mode access$/i : v === 'aruba' ? /^vlan access \d+/i : /^port link-type access$/i;
    const trunkRe = v === 'cisco' ? /^switchport mode trunk$/i : v === 'aruba' ? /^vlan trunk (?:allowed|native)/i : /^port link-type trunk$/i;
    return {
      vendor: v, role: info.role, access: info.role === 'leaf', p: params, text, lines, blocks, ifaces,
      parsed: window.parseConfig ? window.parseConfig(text) : {},
      any: re => lines.some(l => re.test(l)),
      count: re => lines.filter(l => re.test(l)).length,
      blocksHead: re => blocks.filter(b => re.test(b.head)),
      bhas,
      accessPorts: ifaces.filter(b => bhas(b, accessRe)),
      trunkPorts: ifaces.filter(b => bhas(b, trunkRe))
    };
  }

  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const ok = (detail) => ({ ok: true, detail });
  const bad = (detail, sev) => ({ ok: false, detail, sev });
  const vtyBlocks = c => c.vendor === 'cisco' ? c.blocksHead(/^line vty/i) : c.vendor === 'huawei' ? c.blocksHead(/^user-interface vty/i) : [];
  const radiusCount = c => c.vendor === 'cisco' ? c.count(/^radius server\s/i) + c.count(/^radius-server host\s/i)
    : c.vendor === 'aruba' ? c.count(/^radius-server host\s/i) : c.count(/^radius-server authentication\s+\d/i);
  const hasCommunity = c => c.vendor === 'cisco' ? c.count(/^snmp-server community\s/i) : c.vendor === 'aruba' ? c.count(/^snmp-server community\s/i) : c.count(/^snmp-agent community\s/i);
  const ntpCount = c => c.vendor === 'cisco' ? c.count(/^ntp (?:server|peer)\s/i) : c.vendor === 'aruba' ? c.count(/^ntp server\s/i) : c.count(/^ntp-service (?:unicast-server|server)\s/i);
  const ntpList = c => (c.p.ntp && c.p.ntp.length ? c.p.ntp : ['<NTP_1>', '<NTP_2>']);
  const acc = '<ACCESS_PORTS>', upl = '<UPLINK_PORT>', vl = '<ACCESS_VLANS>';
  const radiusFix = c => {
    const r = (c.p.radius && c.p.radius.length ? c.p.radius : ['<RADIUS_IP_1>', '<RADIUS_IP_2>']);
    if (c.vendor === 'cisco') return r.flatMap((ip, i) => [`radius server NAC-${i + 1}`, ` address ipv4 ${ip} auth-port 1812 acct-port 1813`, ' key <RADIUS_SECRET>']);
    if (c.vendor === 'aruba') return r.map(ip => `radius-server host ${ip} key plaintext <RADIUS_SECRET>`);
    return ['radius-server template NAC', ' radius-server shared-key cipher <RADIUS_SECRET>', ...r.map(ip => ` radius-server authentication ${ip} 1812`), ' radius-server accounting ' + r[0] + ' 1813'];
  };

  // ---------- kurallar ----------
  const RULES = [];
  const rule = (id, profile, sev, title, why, def) => RULES.push({ id, profile, sev, title, why, ...def });
  const accessOnly = c => c.access;

  // === Yönetim düzlemi ===
  rule('H01', 'hardening', 'high', 'SSH ile yönetim etkin değil', 'Şifreli yönetim erişimi olmadan oturumlar ve parolalar açık ağda görünür.', {
    test: { cisco: c => c.any(/^ip ssh version 2$/i), aruba: c => c.any(/^ssh server vrf/i), huawei: c => c.any(/^stelnet server enable$/i) },
    fix: { cisco: () => ['ip domain-name <DOMAIN>', 'crypto key generate rsa modulus 4096', 'ip ssh version 2'], aruba: () => ['ssh server vrf default'], huawei: () => ['rsa local-key-pair create', 'stelnet server enable'] }
  });
  rule('H02', 'hardening', 'critical', 'Telnet erişimi açık veya SSH ile sınırlandırılmamış', 'Telnet parolaları ve komutları açık metin taşır.', {
    test: {
      cisco: c => { const v = vtyBlocks(c); if (!v.length) return bad('vty yapılandırması bulunamadı'); const n = v.filter(b => !c.bhas(b, /^transport input ssh$/i)).length; return n ? bad(`${n} vty satırı SSH ile sınırlı değil`) : ok(); },
      aruba: c => (c.any(/^telnet server/i) && !c.any(/^no telnet server/i)) ? bad('telnet server etkin') : ok(),
      huawei: c => { if (c.any(/^telnet server enable$/i)) return bad('telnet server etkin'); const v = vtyBlocks(c); if (v.some(b => !c.bhas(b, /^protocol inbound ssh$/i))) return bad('vty protocol inbound ssh değil'); return ok(); }
    },
    fix: { cisco: () => ['line vty 0 15', ' transport input ssh'], aruba: () => ['no telnet server vrf default', 'no telnet server vrf mgmt'], huawei: () => ['undo telnet server enable', 'user-interface vty 0 4', ' protocol inbound ssh'] }
  });
  rule('H03', 'hardening', 'high', 'HTTP yönetim arayüzü açık', 'Şifresiz web yönetimi saldırı yüzeyini genişletir.', {
    test: { cisco: c => c.any(/^ip http server$/i) ? bad('ip http server etkin') : ok(), aruba: () => null, huawei: c => c.any(/^http server enable$/i) ? bad('http server etkin') : ok() },
    fix: { cisco: () => ['no ip http server', 'no ip http secure-server'], huawei: () => ['undo http server enable'] }
  });
  rule('H04', 'hardening', 'high', 'Merkezi AAA (kimlik doğrulama) yapılandırılmamış', 'Cihaz bazlı yerel hesaplar denetlenemez ve tek tek yönetilir.', {
    test: {
      cisco: c => (c.any(/^aaa new-model$/i) && c.any(/^aaa authentication login/i)) || false,
      aruba: c => c.any(/^aaa authentication login/i),
      huawei: c => c.blocksHead(/^aaa$/i).some(b => c.bhas(b, /^authentication-scheme\b/i)) && vtyBlocks(c).some(b => c.bhas(b, /^authentication-mode aaa$/i))
    },
    fix: {
      cisco: () => ['aaa new-model', 'aaa authentication login default group <TACACS_OR_RADIUS_GROUP> local', 'aaa authorization exec default group <TACACS_OR_RADIUS_GROUP> local', 'aaa accounting exec default start-stop group <TACACS_OR_RADIUS_GROUP>'],
      aruba: () => ['aaa authentication login ssh group radius local'],
      huawei: () => ['aaa', ' authentication-scheme AUTH_RADIUS', '  authentication-mode radius local', ' quit', 'user-interface vty 0 4', ' authentication-mode aaa']
    }
  });
  rule('H05', 'hardening', 'medium', 'RADIUS/TACACS+ sunucusu tanımlı değil', 'AAA için merkezi bir kimlik sunucusu gerekir.', {
    test: {
      cisco: c => c.any(/^(?:tacacs server|radius server|tacacs-server host|radius-server host)\s/i),
      aruba: c => c.any(/^(?:radius-server host|tacacs-server host)\s/i),
      huawei: c => c.any(/^(?:radius-server template|hwtacacs-server template)\s/i)
    }, fix: { cisco: radiusFix, aruba: radiusFix, huawei: radiusFix }
  });
  rule('H06', 'hardening', 'high', 'Yerel parolalar zayıf korunuyor', 'Düz veya tersinir parolalar config yedeğinden kolayca çözülür.', {
    test: {
      cisco: c => { const n = c.count(/^enable password\b/i) + c.count(/^username\s+\S+.*\spassword\s/i); return n ? bad(`${n} düz/tersinir parola satırı`) : ok(); },
      aruba: c => c.any(/password plaintext/i) ? bad('plaintext parola bulundu') : ok(),
      huawei: c => c.any(/password (?:cipher|simple)\b/i) ? bad('tersinir (cipher/simple) parola bulundu') : ok()
    },
    fix: {
      cisco: () => ['enable secret <ENABLE_SECRET>', 'no enable password', 'username <ADMIN> privilege 15 algorithm-type scrypt secret <PASSWORD>'],
      aruba: () => ['user <ADMIN> group administrators password ciphertext <HASH>'],
      huawei: () => ['aaa', ' local-user <ADMIN> password irreversible-cipher <PASSWORD>', ' local-user <ADMIN> privilege level 15', ' local-user <ADMIN> service-type ssh']
    }
  });
  rule('H07', 'hardening', 'low', 'service password-encryption kapalı', 'Kalan 7-tipi parolalar için asgari koruma.', {
    test: { cisco: c => c.any(/^service password-encryption$/i), aruba: () => null, huawei: () => null }, fix: { cisco: () => ['service password-encryption'] }
  });
  rule('H08', 'hardening', 'medium', 'Oturum zaman aşımı yok veya devre dışı', 'Açık kalan yönetim oturumları yetkisiz kullanıma açıktır.', {
    test: {
      cisco: c => { const v = vtyBlocks(c); if (!v.length) return bad('vty yapılandırması yok'); const n = v.filter(b => !b.body.some(l => /^exec-timeout\s+(?!0\s+0$)\d+/i.test(l))).length; return n ? bad(`${n} vty satırında geçerli exec-timeout yok`) : ok(); },
      aruba: c => c.blocksHead(/^cli-session$/i).some(b => c.bhas(b, /^timeout\s+[1-9]/i)),
      huawei: c => { const v = vtyBlocks(c); if (!v.length) return bad('vty yapılandırması yok'); return v.every(b => b.body.some(l => /^idle-timeout\s+(?!0\s+0$)\d+/i.test(l))) ? ok() : bad('idle-timeout yok veya 0'); }
    },
    fix: { cisco: () => ['line vty 0 15', ' exec-timeout 10 0', 'line con 0', ' exec-timeout 10 0'], aruba: () => ['cli-session', ' timeout 10'], huawei: () => ['user-interface vty 0 4', ' idle-timeout 10 0'] }
  });
  rule('H09', 'hardening', 'high', 'Yönetim erişimi belirli kaynaklarla sınırlı değil', 'Yönetim arayüzü yalnızca yönetim ağından erişilebilir olmalıdır.', {
    test: {
      cisco: c => { const v = vtyBlocks(c); return v.length > 0 && v.every(b => c.bhas(b, /^access-class\s+\S+\s+in/i)); },
      aruba: c => c.any(/^access-list ip\s/i) && c.any(/^apply access-list ip\s/i),
      huawei: c => { const v = vtyBlocks(c); return v.length > 0 && v.every(b => c.bhas(b, /^acl\s+\S+\s+inbound/i)); }
    },
    fix: {
      cisco: c => ['ip access-list standard MGMT-ONLY', ` permit ${c.p.adminIp || '<ADMIN_NET>'} ${c.p.wildcard || '<WILDCARD>'}`, ' deny any log', 'line vty 0 15', ' access-class MGMT-ONLY in'],
      aruba: c => ['access-list ip MGMT-ONLY', ` 10 permit tcp ${c.p.adminNet || '<ADMIN_NET>'} any eq 22`, ' 20 deny any any any log', '! Listeyi yönetim arayüzüne/VRF’e uygulayın: apply access-list ip MGMT-ONLY in'],
      huawei: c => ['acl number 2000', ` rule 5 permit source ${c.p.adminIp || '<ADMIN_NET>'} ${c.p.wildcard || '<WILDCARD>'}`, ' rule 100 deny', 'user-interface vty 0 4', ' acl 2000 inbound']
    }
  });
  rule('H10', 'hardening', 'low', 'Yasal uyarı (banner) tanımlı değil', 'Yetkisiz erişim uyarısı hukuki ve kurumsal gereksinimdir.', {
    test: { cisco: c => c.any(/^banner (?:login|motd)\b/i), aruba: c => c.any(/^banner (?:motd|exec)\b/i), huawei: c => c.any(/^header (?:login|shell)\b/i) },
    fix: { cisco: () => ['banner login ^C Yetkisiz erisim yasaktir. Tum islemler kaydedilir. ^C'], aruba: () => ['banner motd %', 'Yetkisiz erisim yasaktir. Tum islemler kaydedilir.', '%'], huawei: () => ['header login information "Yetkisiz erisim yasaktir. Tum islemler kaydedilir."'] }
  });
  rule('H11', 'hardening', 'medium', 'NTP: en az iki sunucu tanımlı değil', 'Güvenilir zaman, log korelasyonu ve sertifika/oturum doğrulaması için gereklidir.', {
    test: { cisco: ntpOk, aruba: ntpOk, huawei: ntpOk },
    fix: {
      cisco: c => ntpList(c).map(s => `ntp server ${s}`), aruba: c => ntpList(c).map(s => `ntp server ${s}`),
      huawei: c => ntpList(c).map(s => `ntp-service unicast-server ${s}`)
    }
  });
  function ntpOk(c) { const n = ntpCount(c); return n >= 2 ? ok(`${n} sunucu`) : bad(`${n} sunucu tanımlı`); }
  rule('H12', 'hardening', 'low', 'NTP kimlik doğrulaması yok', 'Sahte zaman kaynağı saldırılarını önler.', {
    test: { cisco: c => c.any(/^ntp authenticate$/i), aruba: c => c.any(/^ntp authentication\s+enable/i), huawei: c => c.any(/^ntp-service authentication enable$/i) },
    fix: {
      cisco: () => ['ntp authenticate', 'ntp authentication-key 1 sha1 <NTP_KEY>', 'ntp trusted-key 1'],
      aruba: () => ['ntp authentication enable', 'ntp authentication-key 1 md5 <NTP_KEY>'],
      huawei: () => ['ntp-service authentication enable', 'ntp-service authentication-keyid 1 authentication-mode hmac-sha256 cipher <NTP_KEY>']
    }
  });
  rule('H13', 'hardening', 'medium', 'Merkezi syslog tanımlı değil', 'Olay kayıtları cihaz yeniden başladığında veya ele geçirildiğinde kaybolur.', {
    test: { cisco: c => c.any(/^logging (?:host\s+)?\d{1,3}(?:\.\d{1,3}){3}/i), aruba: c => c.any(/^logging\s+\d{1,3}(?:\.\d{1,3}){3}/i), huawei: c => c.any(/^info-center loghost\s/i) },
    fix: {
      cisco: c => [`logging host ${c.p.syslog || '<SYSLOG_IP>'}`, 'logging trap informational'], aruba: c => [`logging ${c.p.syslog || '<SYSLOG_IP>'}`],
      huawei: c => ['info-center enable', `info-center loghost ${c.p.syslog || '<SYSLOG_IP>'}`]
    }
  });
  rule('H14', 'hardening', 'low', 'Log zaman damgaları (datetime) etkin değil', 'Olayları ilişkilendirmek için milisaniyeli tarih/saat gerekir.', {
    test: { cisco: c => c.any(/^service timestamps log datetime/i), aruba: () => null, huawei: () => null }, fix: { cisco: () => ['service timestamps log datetime msec localtime show-timezone'] }
  });
  rule('H15', 'hardening', 'high', 'SNMP v1/v2c community kullanılıyor', 'Community dizeleri açık metin gider ve genellikle tahmin edilebilir.', {
    test: {
      cisco: snmpV2, aruba: snmpV2, huawei: snmpV2
    },
    fix: {
      cisco: () => ['! Mevcut community adlarını kaldırın (adları config içinde bulun):', 'no snmp-server community <COMMUNITY_NAME>'],
      aruba: () => ['no snmp-server community <COMMUNITY_NAME>'],
      huawei: () => ['undo snmp-agent community read <COMMUNITY_NAME>', 'undo snmp-agent community write <COMMUNITY_NAME>']
    }
  });
  function snmpV2(c) {
    const n = hasCommunity(c); if (!n) return ok();
    const weak = c.any(/community\s+(?:read\s+|write\s+)?(?:cipher\s+|simple\s+)?(?:public|private)\b/i);
    return bad(`${n} community tanımı${weak ? ' (varsayılan public/private)' : ''}`, weak ? 'critical' : 'high');
  }
  rule('H16', 'hardening', 'medium', 'SNMPv3 yapılandırılmamış', 'SNMP kullanılacaksa kimlik doğrulamalı ve şifreli v3 tercih edilmelidir.', {
    test: {
      cisco: c => { const any = hasCommunity(c) || c.any(/^snmp-server (?:group|user)\s/i); if (!any) return null; return c.any(/^snmp-server group\s+\S+\s+v3\s+(?:priv|auth)/i); },
      aruba: c => { const any = hasCommunity(c) || c.any(/^snmpv3\s/i); if (!any) return null; return c.any(/^snmpv3 user\s/i); },
      huawei: c => { const any = hasCommunity(c) || c.any(/^snmp-agent\s/i); if (!any) return null; return c.any(/^snmp-agent (?:sys-info version.*v3|usm-v3|group v3)/i); }
    },
    fix: {
      cisco: () => ['snmp-server group NETOPS v3 priv', 'snmp-server user <SNMP_USER> NETOPS v3 auth sha <AUTH_KEY> priv aes 128 <PRIV_KEY>'],
      aruba: () => ['snmpv3 user <SNMP_USER> auth sha auth-pass <AUTH_KEY> priv aes priv-pass <PRIV_KEY>'],
      huawei: () => ['snmp-agent sys-info version v3', 'snmp-agent group v3 NETOPS privacy', 'snmp-agent usm-v3 user <SNMP_USER> group NETOPS']
    }
  });
  rule('H17', 'hardening', 'low', 'CDP tüm arayüzlerde açık', 'CDP cihaz ve topoloji bilgisini yayınlar; yalnızca gerekli portlarda açık olmalı.', {
    test: { cisco: c => c.any(/^no cdp run$/i), aruba: () => null, huawei: () => null }, fix: { cisco: () => ['no cdp run', '! Telefon/AP uplink portlarında gerekiyorsa: interface <PORT> / cdp enable'] }
  });
  rule('H18', 'hardening', 'low', 'Başarısız giriş denemeleri sınırlandırılmamış', 'Kaba kuvvet saldırılarını yavaşlatır.', {
    test: { cisco: c => c.any(/^login block-for\b/i), aruba: () => null, huawei: () => null }, fix: { cisco: () => ['login block-for 120 attempts 5 within 60'] }
  });

  // === Layer 2 ===
  rule('L01', 'l2', 'medium', 'Spanning-tree modu hızlı yakınsamalı değil', 'Klasik STP yavaş yakınsar; RSTP/MST önerilir.', {
    test: { cisco: c => c.any(/^spanning-tree mode (?:rapid-pvst|mst)$/i), aruba: c => c.any(/^spanning-tree mode (?:rpvst|mstp)$/i) && !c.any(/^no spanning-tree$/i), huawei: c => c.any(/^stp mode (?:rstp|mstp|vbst)$/i) && !c.any(/^stp disable$/i) },
    fix: { cisco: () => ['spanning-tree mode rapid-pvst'], aruba: () => ['spanning-tree', 'spanning-tree mode rpvst'], huawei: () => ['stp enable', 'stp mode rstp'] }
  });
  rule('L02', 'l2', 'high', 'BPDU koruması yok', 'Erişim portuna takılan switch veya sahte BPDU STP topolojisini bozar.', {
    applies: accessOnly,
    test: {
      cisco: c => c.any(/^spanning-tree portfast bpduguard default$/i) || c.ifaces.some(b => c.bhas(b, /^spanning-tree bpduguard enable$/i)),
      aruba: c => c.ifaces.some(b => c.bhas(b, /^spanning-tree bpdu-guard$/i)),
      huawei: c => c.any(/^stp bpdu-protection$/i)
    },
    fix: { cisco: () => ['spanning-tree portfast default', 'spanning-tree portfast bpduguard default'], aruba: () => [`interface ${acc}`, ' spanning-tree port-type admin-edge', ' spanning-tree bpdu-guard'], huawei: () => ['stp bpdu-protection', `interface ${acc}`, ' stp edged-port enable'] }
  });
  rule('L03', 'l2', 'low', 'Root guard / loop koruması yok', 'Uplink portlarında yetkisiz root ve döngü riskini azaltır.', {
    test: { cisco: c => c.any(/^spanning-tree loopguard default$/i) || c.ifaces.some(b => c.bhas(b, /^spanning-tree guard (?:root|loop)$/i)), aruba: c => c.ifaces.some(b => c.bhas(b, /^(?:spanning-tree root-guard|loop-protect)\b/i)), huawei: c => c.any(/^stp root-protection$/i) || c.ifaces.some(b => c.bhas(b, /^(?:stp root-protection|loopback-detect enable)/i)) },
    fix: { cisco: () => ['spanning-tree loopguard default'], aruba: () => [`interface ${upl}`, ' spanning-tree root-guard'], huawei: () => [`interface ${upl}`, ' stp root-protection'] }
  });
  rule('L04', 'l2', 'high', 'DHCP snooping yok veya VLAN\'lara uygulanmamış', 'Sahte DHCP sunucuları istemcilere yanlış ağ ayarı dağıtabilir.', {
    applies: accessOnly,
    test: {
      cisco: c => c.any(/^ip dhcp snooping$/i) && c.any(/^ip dhcp snooping vlan\s/i),
      aruba: c => c.any(/^dhcpv4-snooping$/i) && c.blocksHead(/^vlan\s+\d+/i).some(b => c.bhas(b, /^dhcpv4-snooping$/i)),
      huawei: c => c.any(/^dhcp snooping enable$/i) && (c.any(/^dhcp snooping enable vlan\s/i) || c.blocksHead(/^vlan\s+\d+/i).some(b => c.bhas(b, /^dhcp snooping enable$/i)))
    },
    fix: {
      cisco: () => ['ip dhcp snooping', `ip dhcp snooping vlan ${vl}`, `interface ${upl}`, ' ip dhcp snooping trust'],
      aruba: () => ['dhcpv4-snooping', `vlan ${vl}`, ' dhcpv4-snooping', `interface ${upl}`, ' dhcpv4-snooping trust'],
      huawei: () => ['dhcp enable', 'dhcp snooping enable', `vlan ${vl}`, ' dhcp snooping enable', `interface ${upl}`, ' dhcp snooping trusted']
    }
  });
  rule('L05', 'l2', 'medium', 'Dynamic ARP Inspection (ARP koruması) yok', 'ARP spoofing ile araya girme saldırılarını engeller.', {
    applies: accessOnly,
    test: { cisco: c => c.any(/^ip arp inspection vlan\s/i), aruba: c => c.any(/^arp[ -]inspection\b/i) || c.blocksHead(/^vlan\s+\d+/i).some(b => c.bhas(b, /^arp inspection$/i)), huawei: c => c.any(/^arp anti-attack check user-bind enable$/i) },
    fix: { cisco: () => [`ip arp inspection vlan ${vl}`, `interface ${upl}`, ' ip arp inspection trust'], aruba: () => [`arp inspection vlan ${vl}`, `interface ${upl}`, ' arp inspection trust'], huawei: () => ['arp anti-attack check user-bind enable'] }
  });
  rule('L06', 'l2', 'low', 'IP Source Guard yok', 'Kaynak IP sahteciliğini (spoofing) erişim portunda keser.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^ip verify source/i)), aruba: c => c.ifaces.some(b => c.bhas(b, /^ip source-lockdown/i)), huawei: c => c.ifaces.some(b => c.bhas(b, /^ip source check user-bind enable$/i)) },
    fix: { cisco: () => [`interface ${acc}`, ' ip verify source'], aruba: () => [`interface ${acc}`, ' ip source-lockdown'], huawei: () => [`interface ${acc}`, ' ip source check user-bind enable'] }
  });
  rule('L07', 'l2', 'low', 'Storm control yok', 'Broadcast/multicast fırtınası ağı kilitleyebilir.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^storm-control\b/i)), aruba: c => c.ifaces.some(b => c.bhas(b, /^rate-limit\s+(?:broadcast|multicast)/i)), huawei: c => c.ifaces.some(b => c.bhas(b, /^(?:storm-control|broadcast-suppression)\b/i)) },
    fix: { cisco: () => [`interface ${acc}`, ' storm-control broadcast level 1.00', ' storm-control action trap'], aruba: () => [`interface ${acc}`, ' rate-limit broadcast 1000 kbps'], huawei: () => [`interface ${acc}`, ' storm-control broadcast min-rate 1000 max-rate 2000', ' storm-control action block'] }
  });
  rule('L08', 'l2', 'medium', 'Trunk portlarında dinamik pazarlık (DTP) açık', 'DTP ile saldırgan portu trunk yapıp VLAN hopping yapabilir.', {
    test: {
      cisco: c => { const dyn = c.ifaces.filter(b => c.bhas(b, /^switchport mode dynamic/i)).length; const tr = c.trunkPorts.filter(b => !c.bhas(b, /^switchport nonegotiate$/i)).length; return dyn || tr ? bad(`${dyn} dinamik port, ${tr} trunk'ta nonegotiate yok`) : ok(); },
      aruba: () => null, huawei: () => null
    },
    fix: { cisco: () => ['interface <TRUNK_PORT>', ' switchport mode trunk', ' switchport nonegotiate'] }
  });
  rule('L09', 'l2', 'medium', 'Kullanılmayan portlar kapalı değil', 'Boş ve açık portlar yetkisiz cihaz bağlantısına davetiyedir.', {
    applies: accessOnly,
    test: {
      cisco: c => { const n = c.ifaces.filter(b => !b.body.some(l => /^(?:shutdown|description\b|switchport mode|no switchport|channel-group|ip address)/i.test(l))).length; return n ? bad(`${n} yapılandırılmamış ve açık port`) : ok(); },
      aruba: () => null,
      huawei: c => { const n = c.ifaces.filter(b => !b.body.some(l => /^(?:shutdown|description\b|port link-type|ip address|eth-trunk)/i.test(l))).length; return n ? bad(`${n} yapılandırılmamış ve açık port`) : ok(); }
    },
    fix: { cisco: () => ['interface range <UNUSED_PORTS>', ' description UNUSED', ' switchport access vlan 999', ' shutdown'], huawei: () => ['interface <UNUSED_PORT>', ' description UNUSED', ' shutdown'] }
  });
  rule('L10', 'l2', 'medium', 'Trunk native VLAN varsayılan (VLAN 1)', 'Native VLAN 1 kullanımı VLAN hopping ve beklenmeyen trafik riskidir.', {
    test: {
      cisco: c => { const n = c.trunkPorts.filter(b => !c.bhas(b, /^switchport trunk native vlan\s+(?!1$)\d+/i)).length; return n ? bad(`${n} trunk'ta native VLAN ayarlanmamış`) : ok(); },
      aruba: c => { const n = c.trunkPorts.filter(b => !c.bhas(b, /^vlan trunk native\s+(?!1$)\d+/i)).length; return n ? bad(`${n} trunk'ta native VLAN ayarlanmamış`) : ok(); },
      huawei: c => { const n = c.trunkPorts.filter(b => !c.bhas(b, /^port trunk pvid vlan\s+(?!1$)\d+/i)).length; return n ? bad(`${n} trunk'ta pvid ayarlanmamış`) : ok(); }
    },
    fix: { cisco: () => ['interface <TRUNK_PORT>', ' switchport trunk native vlan 999'], aruba: () => ['interface <TRUNK_PORT>', ' vlan trunk native 999'], huawei: () => ['interface <TRUNK_PORT>', ' port trunk pvid vlan 999'] }
  });
  rule('L11', 'l2', 'low', 'Trunk\'larda izinli VLAN listesi sınırlanmamış', 'Gereksiz VLAN\'lerin taşınması saldırı yüzeyini ve broadcast alanını büyütür.', {
    test: {
      cisco: c => { const n = c.trunkPorts.filter(b => !c.bhas(b, /^switchport trunk allowed vlan\b/i)).length; return n ? bad(`${n} trunk'ta allowed vlan yok`) : ok(); },
      aruba: () => null,
      huawei: c => { const n = c.trunkPorts.filter(b => !c.bhas(b, /^port trunk allow-pass vlan\b/i)).length; return n ? bad(`${n} trunk'ta allow-pass vlan yok`) : ok(); }
    },
    fix: { cisco: () => ['interface <TRUNK_PORT>', ' switchport trunk allowed vlan <VLAN_LIST>'], huawei: () => ['interface <TRUNK_PORT>', ' port trunk allow-pass vlan <VLAN_LIST>'] }
  });

  // === 802.1X / NAC ===
  const dotCoverage = (c, re) => {
    const covered = c.ifaces.filter(b => c.bhas(b, re)).length;
    const total = Math.max(c.accessPorts.length, covered);
    return { covered, total };
  };
  rule('D01', 'dot1x', 'high', '802.1X global olarak etkin değil', 'Global etkinleştirme olmadan port bazlı kimlik doğrulama çalışmaz.', {
    applies: accessOnly,
    test: { cisco: c => c.any(/^dot1x system-auth-control$/i), aruba: c => c.any(/^aaa authentication port-access (?:dot1x|mac-auth)/i), huawei: c => c.any(/^dot1x enable$/i) || c.any(/^dot1x-access-profile\s/i) || c.any(/^authentication-profile\s/i) },
    fix: { cisco: () => ['aaa new-model', 'dot1x system-auth-control'], aruba: () => ['aaa authentication port-access dot1x authenticator', ' enable'], huawei: () => ['dot1x enable', 'dot1x authentication-method eap'] }
  });
  rule('D02', 'dot1x', 'high', 'AAA 802.1X/ağ yetkilendirme yöntem listeleri eksik', 'RADIUS’un kimlik doğrulama, yetkilendirme ve muhasebe için kullanılacağı tanımlanmalıdır.', {
    applies: accessOnly,
    test: {
      cisco: c => c.any(/^aaa authentication dot1x default group\s/i) && c.any(/^aaa authorization network default group\s/i),
      aruba: () => null,
      huawei: c => c.blocksHead(/^aaa$/i).some(b => c.bhas(b, /^authentication-scheme\b/i))
    },
    fix: { cisco: () => ['aaa authentication dot1x default group radius', 'aaa authorization network default group radius', 'aaa accounting dot1x default start-stop group radius'], huawei: () => ['aaa', ' authentication-scheme DOT1X', '  authentication-mode radius', ' quit', 'authentication-profile name DOT1X_PROFILE', ' dot1x-access-profile DOT1X'] }
  });
  rule('D03', 'dot1x', 'high', 'En az iki RADIUS sunucusu tanımlı değil', 'Tek sunucu arızasında tüm kullanıcılar ağa giremez.', {
    applies: accessOnly,
    test: { cisco: radiusTwo, aruba: radiusTwo, huawei: radiusTwo },
    fix: { cisco: radiusFix, aruba: radiusFix, huawei: radiusFix }
  });
  function radiusTwo(c) { const n = radiusCount(c); return n >= 2 ? ok(`${n} sunucu`) : bad(`${n} sunucu tanımlı`, n === 0 ? 'high' : 'medium'); }
  rule('D04', 'dot1x', 'medium', 'RADIUS sunucu sağlık/dead-criteria ayarı yok', 'Erişilemeyen sunucuyu hızlı tespit edip yedeğe geçmek için gerekir.', {
    applies: accessOnly,
    test: { cisco: c => c.any(/^radius-server (?:dead-criteria|deadtime)\b/i) || c.any(/automate-tester/i), aruba: c => c.any(/^radius-server tracking\b/i), huawei: () => null },
    fix: { cisco: () => ['radius-server dead-criteria time 5 tries 3', 'radius-server deadtime 5'], aruba: () => ['radius-server tracking enable'] }
  });
  rule('D05', 'dot1x', 'high', 'RADIUS CoA (Dynamic Authorization) yapılandırılmamış', 'NAC politikasını sonradan değiştirmek/oturumu kesmek (posture, karantina) için CoA gerekir.', {
    applies: accessOnly,
    test: { cisco: c => c.any(/^aaa server radius dynamic-author$/i), aruba: c => c.any(/^radius dyn-authorization enable$/i), huawei: c => c.any(/^radius-server authorization\s/i) },
    fix: {
      cisco: c => ['aaa server radius dynamic-author', ` client ${(c.p.radius && c.p.radius[0]) || '<RADIUS_IP>'} server-key <COA_KEY>`],
      aruba: c => ['radius dyn-authorization enable', `radius dyn-authorization client ${(c.p.radius && c.p.radius[0]) || '<RADIUS_IP>'} secret-key plaintext <COA_KEY>`],
      huawei: c => [`radius-server authorization ${(c.p.radius && c.p.radius[0]) || '<RADIUS_IP>'} shared-key cipher <COA_KEY>`]
    }
  });
  rule('D06', 'dot1x', 'high', '802.1X erişim portlarında etkin değil', 'Kimlik doğrulama yalnızca etkinleştirilmiş portlarda zorunlu olur.', {
    applies: accessOnly,
    test: {
      cisco: c => dotPorts(c, dotCoverage(c, /^authentication port-control auto$|^dot1x pae authenticator$/i)),
      aruba: c => dotPorts(c, dotCoverage(c, /^aaa authentication port-access (?:dot1x|mac-auth)/i)),
      huawei: c => dotPorts(c, dotCoverage(c, /^(?:authentication-profile\b|dot1x enable$)/i))
    },
    fix: {
      cisco: () => [`interface range ${acc}`, ' switchport mode access', ' authentication port-control auto', ' dot1x pae authenticator', ' spanning-tree portfast'],
      aruba: () => [`interface ${acc}`, ' aaa authentication port-access dot1x authenticator', '  enable'],
      huawei: () => [`interface ${acc}`, ' authentication-profile DOT1X_PROFILE']
    }
  });
  function dotPorts(c, { covered, total }) {
    if (!total) return bad('erişim portu tanımı bulunamadı');
    const p = pct(covered, total);
    if (p >= 90) return ok(`${covered}/${total} port (%${p})`);
    return bad(`${covered}/${total} erişim portunda (%${p})`, p === 0 ? 'high' : 'medium');
  }
  rule('D07', 'dot1x', 'medium', 'MAB (MAC doğrulama) yedeği yok', '802.1X desteklemeyen cihazlar (yazıcı, IoT) için MAB gerekir.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^mab$/i)), aruba: c => c.any(/^aaa authentication port-access mac-auth/i), huawei: c => c.any(/^mac-access-profile\s/i) || c.any(/^mac-authen\b/i) },
    fix: { cisco: () => [`interface range ${acc}`, ' mab', ' authentication order dot1x mab', ' authentication priority dot1x mab'], aruba: () => ['aaa authentication port-access mac-auth', ' enable'], huawei: () => ['mac-access-profile name MAB_PROFILE'] }
  });
  rule('D08', 'dot1x', 'low', 'Çoklu cihaz (host-mode/client-limit) ayarı yok', 'Telefon + PC aynı portta ise çoklu domain/auth modu gerekir.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^authentication host-mode multi-(?:domain|auth)$/i)), aruba: c => c.ifaces.some(b => c.bhas(b, /client-limit/i)), huawei: () => null },
    fix: { cisco: () => [`interface range ${acc}`, ' authentication host-mode multi-domain'], aruba: () => [`interface ${acc}`, ' aaa authentication port-access client-limit 5'] }
  });
  rule('D09', 'dot1x', 'medium', 'RADIUS erişilemezse (critical VLAN/fail-open) politikası yok', 'Sunucu arızasında kullanıcıların ne olacağı önceden belirlenmelidir.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^authentication event server dead action/i)), aruba: c => c.any(/critical-role|critical-vlan/i), huawei: c => c.any(/authen-server-down|critical-vlan/i) },
    fix: { cisco: () => [`interface range ${acc}`, ' authentication event server dead action authorize vlan <CRITICAL_VLAN>', ' authentication event server alive action reinitialize'], aruba: () => ['! Kritik rol/VLAN tanımı için platform dokümanına bakın: port-access role <CRITICAL_ROLE>'], huawei: () => ['authentication event authen-server-down action authorize vlan <CRITICAL_VLAN>'] }
  });
  rule('D10', 'dot1x', 'low', 'Periyodik yeniden doğrulama (reauth) yok', 'Oturumların belirli aralıklarla yeniden doğrulanması yetki değişimini yansıtır.', {
    applies: accessOnly,
    test: { cisco: c => c.ifaces.some(b => c.bhas(b, /^authentication (?:periodic|timer reauthenticate)/i)), aruba: c => c.any(/^reauth\b/i), huawei: c => c.any(/^dot1x timer reauthenticate-period/i) },
    fix: { cisco: () => [`interface range ${acc}`, ' authentication periodic', ' authentication timer reauthenticate server'], aruba: () => ['aaa authentication port-access dot1x authenticator', ' reauth', ' reauth-period 28800'], huawei: () => ['dot1x timer reauthenticate-period 28800'] }
  });
  rule('D11', 'dot1x', 'medium', 'Portlar açık (open) modda: kimlik doğrulama zorunlu değil', 'authentication open, doğrulama başarısız olsa da erişime izin verir (izleme modu).', {
    applies: accessOnly,
    test: { cisco: c => { const n = c.ifaces.filter(b => c.bhas(b, /^authentication open$/i)).length; return n ? bad(`${n} portta authentication open`) : ok(); }, aruba: () => null, huawei: () => null },
    fix: { cisco: () => [`interface range ${acc}`, ' no authentication open'] }
  });

  // === Routing güvenliği ===
  const hasOspf = c => Boolean(c.parsed.ospf), hasBgp = c => Boolean(c.parsed.bgp), hasEigrp = c => Boolean(c.parsed.eigrp);
  const naIf = (cond, fn) => c => (cond(c) ? fn(c) : null);
  const pid = c => (c.parsed.ospf && c.parsed.ospf.pid) || '<PID>';
  const asn = c => (c.parsed.bgp && c.parsed.bgp.asn) || '<ASN>';
  rule('R01', 'routing', 'medium', 'OSPF kimlik doğrulaması yok', 'Kimliği doğrulanmamış OSPF ile sahte komşu rota enjekte edebilir.', {
    test: {
      cisco: naIf(hasOspf, c => c.any(/^ip ospf authentication\b/i) || c.any(/^area\s+\S+\s+authentication\b/i)),
      aruba: naIf(hasOspf, c => c.any(/^ip ospf authentication\b/i)),
      huawei: naIf(hasOspf, c => c.any(/^authentication-mode (?:md5|hmac|simple)/i) || c.any(/^ospf authentication-mode/i))
    },
    fix: {
      cisco: () => ['interface <ROUTED_INTERFACE>', ' ip ospf authentication message-digest', ' ip ospf message-digest-key 1 md5 <OSPF_KEY>'],
      aruba: () => ['interface <ROUTED_INTERFACE>', ' ip ospf authentication message-digest', ' ip ospf message-digest-key 1 md5 plaintext <OSPF_KEY>'],
      huawei: c => [`ospf ${pid(c)}`, ' area 0.0.0.0', '  authentication-mode hmac-sha256 1 cipher <OSPF_KEY>']
    }
  });
  rule('R02', 'routing', 'low', 'OSPF passive-interface default kullanılmıyor', 'Kullanıcı VLAN\'larında OSPF hello yayınlamak komşuluk saldırısına kapı açar.', {
    test: {
      cisco: naIf(hasOspf, c => c.any(/^passive-interface default$/i)),
      aruba: naIf(hasOspf, c => c.any(/^passive-interface\b/i)),
      huawei: naIf(hasOspf, c => c.any(/^silent-interface\b/i))
    },
    fix: {
      cisco: c => [`router ospf ${pid(c)}`, ' passive-interface default', ' no passive-interface <UPLINK_INTERFACE>'],
      aruba: c => [`router ospf ${pid(c)}`, ' passive-interface default'],
      huawei: c => [`ospf ${pid(c)}`, ' silent-interface all', ' undo silent-interface <UPLINK_INTERFACE>']
    }
  });
  rule('R03', 'routing', 'high', 'BGP komşularında parola/kimlik doğrulama yok', 'MD5/TCP-AO olmadan BGP oturumu ele geçirilebilir.', {
    test: {
      cisco: naIf(hasBgp, c => c.any(/^neighbor\s+\S+\s+password\b/i)),
      aruba: naIf(hasBgp, c => c.any(/^neighbor\s+\S+\s+password\b/i)),
      huawei: naIf(hasBgp, c => c.any(/^peer\s+\S+\s+password\b/i))
    },
    fix: {
      cisco: c => [`router bgp ${asn(c)}`, ' neighbor <PEER_IP> password <BGP_KEY>'],
      aruba: c => [`router bgp ${asn(c)}`, ' neighbor <PEER_IP> password plaintext <BGP_KEY>'],
      huawei: c => [`bgp ${asn(c)}`, ' peer <PEER_IP> password cipher <BGP_KEY>']
    }
  });
  rule('R04', 'routing', 'medium', 'BGP maximum-prefix sınırı yok', 'Komşudan gelen aşırı prefix (leak) tablonuzu ve CPU\'yu tüketebilir.', {
    test: {
      cisco: naIf(hasBgp, c => c.any(/maximum-prefix\b/i)),
      aruba: naIf(hasBgp, c => c.any(/maximum-prefix\b/i)),
      huawei: naIf(hasBgp, c => c.any(/^peer\s+\S+\s+route-limit\b/i))
    },
    fix: {
      cisco: c => [`router bgp ${asn(c)}`, ' address-family ipv4', '  neighbor <PEER_IP> maximum-prefix <LIMIT> 80 restart 5'],
      aruba: c => [`router bgp ${asn(c)}`, ' address-family ipv4 unicast', '  neighbor <PEER_IP> maximum-prefix <LIMIT>'],
      huawei: c => [`bgp ${asn(c)}`, ' ipv4-family unicast', '  peer <PEER_IP> route-limit <LIMIT>']
    }
  });
  rule('R05', 'routing', 'low', 'BGP TTL güvenliği yok', 'Doğrudan bağlı eBGP komşularında uzaktan sahte paketleri engeller.', {
    test: {
      cisco: naIf(hasBgp, c => c.any(/ttl-security\b/i)),
      aruba: () => null,
      huawei: naIf(hasBgp, c => c.any(/^peer\s+\S+\s+valid-ttl-hops\b/i))
    },
    fix: { cisco: c => [`router bgp ${asn(c)}`, ' neighbor <PEER_IP> ttl-security hops 1'], huawei: c => [`bgp ${asn(c)}`, ' peer <PEER_IP> valid-ttl-hops 1'] }
  });
  rule('R06', 'routing', 'medium', 'EIGRP kimlik doğrulaması yok', 'Doğrulamasız EIGRP ile sahte komşu rota enjekte edebilir.', {
    test: { cisco: naIf(hasEigrp, c => c.any(/^(?:ip )?authentication mode\b/i) || c.any(/^authentication mode\b/i)), aruba: () => null, huawei: () => null },
    fix: { cisco: () => ['key chain EIGRP-KEYS', ' key 1', '  key-string <EIGRP_KEY>', 'interface <ROUTED_INTERFACE>', ' ip authentication mode eigrp 100 md5', ' ip authentication key-chain eigrp 100 EIGRP-KEYS'] }
  });

  // Başarılı/uygulanamaz satırlarında kullanılan olumlu başlıklar
  const OK_TITLE = {
    H01: 'SSH ile yönetim etkin', H02: 'Telnet kapalı, yalnızca SSH', H03: 'HTTP yönetim arayüzü kapalı', H04: 'Merkezi AAA yapılandırılmış',
    H05: 'RADIUS/TACACS+ sunucusu tanımlı', H06: 'Yerel parolalar güçlü korunuyor', H07: 'service password-encryption açık', H08: 'Oturum zaman aşımı ayarlı',
    H09: 'Yönetim erişimi kaynaklarla sınırlı', H10: 'Yasal uyarı (banner) tanımlı', H11: 'NTP: en az iki sunucu tanımlı', H12: 'NTP kimlik doğrulaması açık',
    H13: 'Merkezi syslog tanımlı', H14: 'Log zaman damgaları etkin', H15: 'SNMP v1/v2c community kullanılmıyor', H16: 'SNMPv3 yapılandırılmış',
    H17: 'CDP kapalı', H18: 'Giriş denemeleri sınırlandırılmış',
    L01: 'Spanning-tree modu hızlı yakınsamalı', L02: 'BPDU koruması etkin', L03: 'Root guard / loop koruması etkin', L04: 'DHCP snooping etkin',
    L05: 'Dynamic ARP Inspection etkin', L06: 'IP Source Guard etkin', L07: 'Storm control etkin', L08: 'Trunk portlarında DTP kapalı',
    L09: 'Kullanılmayan portlar kapalı', L10: 'Trunk native VLAN değiştirilmiş', L11: 'Trunk izinli VLAN listesi sınırlı',
    D01: '802.1X global olarak etkin', D02: 'AAA 802.1X yöntem listeleri tanımlı', D03: 'En az iki RADIUS sunucusu tanımlı', D04: 'RADIUS sunucu sağlık ayarı tanımlı',
    D05: 'RADIUS CoA yapılandırılmış', D06: '802.1X erişim portlarında etkin', D07: 'MAB yedeği tanımlı', D08: 'Çoklu cihaz (host-mode/client-limit) ayarlı',
    D09: 'Critical VLAN/fail-open politikası tanımlı', D10: 'Periyodik reauth ayarlı', D11: 'Portlar kapalı (closed) modda',
    R01: 'OSPF kimlik doğrulaması açık', R02: 'OSPF passive-interface default kullanılıyor', R03: 'BGP komşu parolası tanımlı', R04: 'BGP maximum-prefix tanımlı',
    R05: 'BGP TTL güvenliği açık', R06: 'EIGRP kimlik doğrulaması açık'
  };

  // ---------- değerlendirme ----------
  function evaluate(ctx, profiles) {
    const findings = [];
    RULES.filter(r => profiles.includes(r.profile)).forEach(r => {
      const base = { id: r.id, profile: r.profile, title: r.title, why: r.why };
      if (r.applies && !r.applies(ctx)) { findings.push({ ...base, status: 'na', sev: r.sev, reason: 'Access/leaf rolü gerektirir' }); return; }
      const fn = r.test[ctx.vendor];
      if (!fn) { findings.push({ ...base, status: 'na', sev: r.sev, reason: 'Bu platform için uygulanamaz' }); return; }
      let res; try { res = fn(ctx); } catch (e) { res = null; }
      if (res === null || res === undefined) { findings.push({ ...base, status: 'na', sev: r.sev, reason: 'Uygulanamaz veya kullanılmıyor' }); return; }
      if (typeof res === 'boolean') res = res ? ok() : bad();
      const sev = res.sev || r.sev;
      findings.push({ ...base, status: res.ok ? 'pass' : 'fail', sev, detail: res.detail || '', fixLines: res.ok ? [] : ((r.fix && r.fix[ctx.vendor]) ? r.fix[ctx.vendor](ctx) : []) });
    });
    return findings;
  }

  function run(info, profiles, params) {
    const ctx = makeCtx(info, params || {});
    const findings = evaluate(ctx, profiles);
    const fails = findings.filter(f => f.status === 'fail');
    const counts = { critical: 0, high: 0, medium: 0, low: 0, pass: findings.filter(f => f.status === 'pass').length, na: findings.filter(f => f.status === 'na').length };
    fails.forEach(f => { counts[f.sev]++; });
    const score = Math.max(0, 100 - fails.reduce((s, f) => s + SEV[f.sev].w, 0));
    findings.sort((a, b) => (a.status === b.status ? SEV[a.sev].order - SEV[b.sev].order : (a.status === 'fail' ? -1 : a.status === 'pass' ? (b.status === 'fail' ? 1 : -1) : 1)));
    return { vendor: info.vendor, profiles, findings, counts, score, applicable: fails.length + counts.pass };
  }

  // ---------- çıktılar ----------
  const WRAP = { cisco: ['configure terminal', 'end'], aruba: ['configure terminal', ''], huawei: ['system-view', 'return'] };
  const COMMENT = { cisco: '!', aruba: '!', huawei: '#' };

  function fixScript(result) {
    const v = result.vendor, cm = COMMENT[v];
    const fails = result.findings.filter(f => f.status === 'fail' && f.fixLines && f.fixLines.length);
    if (!fails.length) return `${cm} Seçili profillerde düzeltilecek bulgu yok.`;
    const out = [WRAP[v][0], `${cm} NETCUBE INTENT — config denetimi düzeltme taslağı. <...> değerlerini doldurun; secret değerleri yer tutucudur.`, `${cm} Değişikliği önce pilot cihazda ve konsol erişimi açıkken uygulayın.`];
    Object.keys(PROFILES).filter(p => result.profiles.includes(p)).forEach(p => {
      const items = fails.filter(f => f.profile === p); if (!items.length) return;
      out.push(`${cm}`, `${cm} ===== ${PROFILES[p].toLocaleUpperCase('tr-TR')} =====`);
      items.forEach(f => { out.push(`${cm} [${f.id}] ${SEV[f.sev].label}: ${f.title}`); f.fixLines.forEach(l => out.push(l)); });
    });
    if (WRAP[v][1]) out.push(WRAP[v][1]);
    return out.join('\n');
  }

  const VERIFY = {
    cisco: { hardening: ['show ip ssh', 'show running-config | section line vty', 'show aaa servers', 'show ntp status', 'show logging | include Log Host|Trap'], l2: ['show spanning-tree summary', 'show ip dhcp snooping', 'show ip arp inspection', 'show interfaces trunk', 'show interfaces status | include notconnect'], dot1x: ['show dot1x all summary', 'show authentication sessions', 'show aaa servers', 'show running-config | section aaa server radius dynamic-author'], routing: ['show ip ospf interface | include Authentication', 'show ip bgp neighbors | include password|ttl'] },
    aruba: { hardening: ['show ssh server', 'show aaa authentication', 'show ntp status', 'show logging'], l2: ['show spanning-tree summary', 'show dhcpv4-snooping', 'show arp inspection'], dot1x: ['show aaa authentication port-access interface all client-status', 'show radius-server', 'show port-access clients'], routing: ['show ip ospf interface', 'show bgp ipv4 unicast summary'] },
    huawei: { hardening: ['display ssh server status', 'display aaa configuration', 'display ntp-service status', 'display logbuffer'], l2: ['display stp brief', 'display dhcp snooping', 'display arp anti-attack configuration check user-bind'], dot1x: ['display dot1x', 'display access-user', 'display radius-server configuration'], routing: ['display ospf interface', 'display bgp peer'] }
  };
  function verifyText(result) {
    const v = result.vendor, cm = COMMENT[v];
    const out = [`${cm} Düzeltmeler uygulandıktan sonra kontrol komutları`];
    result.profiles.forEach(p => { out.push(`${cm} --- ${PROFILES[p]}`, ...(VERIFY[v][p] || [])); });
    out.push(`${cm}`, `${cm} Ardından aynı running-config'i tekrar yükleyip denetimi yeniden çalıştırın; puanın yükseldiğini doğrulayın.`);
    return out.join('\n');
  }
  function rollbackText(result) {
    const v = result.vendor;
    if (v === 'cisco') return '! Uygulamadan ÖNCE yedek alın:\ncopy running-config flash:pre-audit.cfg\n\n! Geri dönüş (gerekirse):\nconfigure replace flash:pre-audit.cfg force\n\n! Uygulama sırasında otomatik geri alma için:\nconfigure terminal revert timer 10\n! ... değişiklikler ...\nconfigure confirm   ! onaylarsanız timer iptal olur';
    if (v === 'aruba') return '# Uygulamadan ÖNCE kontrol noktası alın:\ncheckpoint create pre-audit\n\n# Geri dönüş (gerekirse):\ncheckpoint rollback pre-audit\n\n# Otomatik geri alma için:\nconfigure terminal\n# ... değişiklikler ...\ncheckpoint auto confirm 10';
    return '# Uygulamadan ÖNCE kayıt noktası alın:\nsave pre-audit.cfg\n\n# Geri dönüş (gerekirse):\nstartup saved-configuration pre-audit.cfg\nreboot\n\n# Veya değişikliği kademeli uygulayıp her adımda "display current-configuration" ile karşılaştırın.';
  }
  function report(info, result, hasConfig) {
    const v = result.vendor;
    const L = [];
    L.push('CONFIG DENETİM RAPORU', '');
    L.push(`Cihaz          : ${info.label ? info.label + ' ' : ''}${info.model}`);
    L.push(`Rol            : ${info.role}`);
    L.push(`Profiller      : ${result.profiles.map(p => PROFILES[p]).join(', ')}`);
    L.push(`Güvenlik puanı : ${result.score}/100  (${result.counts.critical} kritik · ${result.counts.high} yüksek · ${result.counts.medium} orta · ${result.counts.low} düşük)`);
    L.push(`Başarılı       : ${result.counts.pass} kontrol · Uygulanamaz: ${result.counts.na}`, '');
    const fails = result.findings.filter(f => f.status === 'fail');
    L.push('BULGULAR (düzeltilmesi gerekenler)');
    if (!fails.length) L.push('  Hiç bulgu yok.');
    fails.forEach(f => { L.push(`  [${SEV[f.sev].label.toLocaleUpperCase('tr-TR')}] ${f.id} · ${f.title}${f.detail ? ' — ' + f.detail : ''}`, `      Neden: ${f.why}`); });
    L.push('', 'BAŞARILI KONTROLLER');
    result.findings.filter(f => f.status === 'pass').forEach(f => L.push(`  [OK] ${f.id} · ${OK_TITLE[f.id] || f.title}${f.detail ? ' — ' + f.detail : ''}`));
    L.push('', 'UYGULANAMAYAN KONTROLLER');
    result.findings.filter(f => f.status === 'na').forEach(f => L.push(`  [--] ${f.id} · ${OK_TITLE[f.id] || f.title} — ${f.reason}`));
    L.push('', 'NOTLAR', '  - Denetim yüklenen config metnine dayanır; çalışan sistemdeki durumu (örn. runtime, lisans, donanım) doğrulamaz.', '  - Kurallar genel iyi uygulamadır; kurumsal standardınıza göre ağırlıkları değerlendirin.', '  - Düzeltme komutlarını pilot cihazda, konsol erişimi açıkken ve geri dönüş planıyla uygulayın.', '  - Parola, anahtar ve community değerleri çıktıya yazılmaz; yer tutucular doldurulmalıdır.');
    return L.join('\n');
  }

  window.NETCUBE_AUDIT = { PROFILES, SEV, RULES, run, fixScript, verifyText, rollbackText, report };
})();
