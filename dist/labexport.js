// Lab paketi: üretilen config'leri, topolojiyi ve kablolama tablosunu tek ZIP olarak dışa aktarır.
// Cihaz imajı içermez; Packet Tracer / GNS3 / EVE-NG gibi araçlarda elle kurulum içindir.
(function () {
  const enc = new TextEncoder();
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  // Bağımlılıksız, sıkıştırmasız (store) ZIP yazıcı
  function zip(files) {
    const parts = [], central = []; let off = 0; const now = new Date();
    const dt = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    const tm = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.data), c = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, c, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
      ch.setUint32(16, c, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    const csize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  const safe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'device';
  const csv = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  function readme(en, solution, n) {
    return en
      ? `NETCUBE INTENT - LAB BUNDLE\n\nModule: ${solution} · ${n} device(s)\n\nFILES\n  configs/<device>.cfg      Generated config per device (fill in every <...> placeholder first)\n  docs/                     Verification, rollback, diff and report text per device, plus change-request.txt and risk-assessment.txt\n  automation/               Example Ansible inventory/playbook and a Netmiko script (dry-run by default)\n  topology.json             Devices and links (machine readable)\n  cabling.csv               Link / port table (open in Excel)\n\nIMPORTANT\n  - No device images are included; bring your own.\n  - Everything here is a DRAFT generated offline. It has not been tested on devices. Check interface names and syntax for your exact model and version.\n  - Secrets are placeholders. Never reuse the example values in production.\n\nPACKET TRACER\n  Only Cisco IOS devices with a limited feature set work (no NX-OS, StackWise Virtual, vPC, most of DMVPN, Aruba or Huawei).\n  Place the devices, cable them per cabling.csv, open each CLI and paste the matching .cfg. Remove commands PT rejects.\n\nGNS3 / EVE-NG / CML\n  Add the nodes with your own images, cable them per cabling.csv, then paste each .cfg into the node console (or load it as startup config).\n`
      : `NETCUBE INTENT - LAB PAKETİ\n\nModül: ${solution} · ${n} cihaz\n\nDOSYALAR\n  configs/<cihaz>.cfg      Cihaz başına üretilen config (önce tüm <...> yer tutucularını doldurun)\n  docs/                    Cihaz başına doğrulama, rollback, fark ve rapor metinleri; change-request.txt ve risk-assessment.txt\n  automation/              Örnek Ansible envanter/playbook ve Netmiko betiği (varsayılan dry-run)\n  topology.json            Cihazlar ve bağlantılar (makine okunur)\n  cabling.csv              Bağlantı / port tablosu (Excel'de açılır)\n\nÖNEMLİ\n  - Cihaz imajı içermez; kendi imajlarınızı kullanın.\n  - Buradaki her şey çevrimdışı üretilmiş TASLAKTIR; cihazda denenmemiştir. Arayüz adlarını ve sözdizimini kendi model/sürümünüze göre kontrol edin.\n  - Secret'lar yer tutucudur. Örnek değerleri üretimde kullanmayın.\n\nPACKET TRACER\n  Yalnızca sınırlı özellikli Cisco IOS cihazlar çalışır (NX-OS, StackWise Virtual, vPC, DMVPN'in çoğu, Aruba ve Huawei desteklenmez).\n  Cihazları yerleştirin, cabling.csv'ye göre bağlayın, her CLI'ya ilgili .cfg'yi yapıştırın; PT'nin reddettiği komutları silin.\n\nGNS3 / EVE-NG / CML\n  Düğümleri kendi imajlarınızla ekleyin, cabling.csv'ye göre bağlayın, her .cfg'yi düğüm konsoluna yapıştırın (veya startup config olarak yükleyin).\n`;
  }

  function collect() {
    const p = state.plan; if (!p) return null;
    const I = window.I18N; const T = s => (I ? I.t(s) : s); const en = Boolean(I && I.lang === 'en');
    const sol = state.solution; const used = new Set();
    const uniq = n => { const b = safe(n); let x = b, i = 2; while (used.has(x)) x = `${b}-${i++}`; used.add(x); return x; };
    const campus = sol === 'campus' ? state.campusInv : null; const wan = sol === 'wan' ? state.wanInv : null;
    const files = []; const devices = []; const names = {};
    p.ids.forEach(id => {
      const info = p.devices[id] || {}; const label = info.hostname || 'DEVICE-' + id.toUpperCase();
      const name = uniq(label); names[id] = label;
      let role = info.role || '';
      if (campus) { const d = campus.devices.find(x => x.id === id); if (d) role = d.role; }
      else if (wan) { const r = wan.routers.find(x => x.id === id); if (r) role = r.role; }
      else if (p.topo && window.NETCUBE_FABRIC) role = window.NETCUBE_FABRIC.isSpine(p.topo, id) ? 'spine' : 'leaf';
      const mgmt = campus ? ((campus.devices.find(x => x.id === id) || {}).mgmt || '') : '';
      devices.push({ name: label, file: `configs/${name}.cfg`, vendor: info.vendor || '', model: info.model || '', os: info.os || '', role, mgmt });
      const out = p.outputs[id]; if (!out) return;
      const main = out.full || out.delta; if (main) files.push({ name: `configs/${name}.cfg`, data: T(main) + '\n' });
      if (out.verify) files.push({ name: `docs/${name}-verify.txt`, data: T(out.verify) + '\n' });
      if (out.rollback) files.push({ name: `docs/${name}-rollback.txt`, data: T(out.rollback) + '\n' });
      if (out.audit) files.push({ name: `docs/${name}-report.txt`, data: T(out.audit) + '\n' });
      if (out.diff && /FARK ÖZETİ/.test(out.diff)) files.push({ name: `docs/${name}-diff.txt`, data: (window.NETCUBE_CM ? window.NETCUBE_CM.trDiff(out.diff) : T(out.diff)) + '\n' });
    });
    const links = [];
    const add = (a, aPort, b, bPort, note) => links.push({ a, aPort, b, bPort, note: note || '' });
    if (campus) {
      campus.links.forEach(l => add(l.access.hostname, l.aPort, l.core.hostname, l.cPort, l.lag ? `LAG ${l.lag}` : ''));
      campus.interLinks.forEach(il => add(il.x.hostname, il.xPort, il.y.hostname, il.yPort, 'LAG 200'));
      try {
        if (campus.virt) campus.virt.pairs.forEach(pr => { const pa = campusInterPorts(pr.a.vendor, 1, campusIsNxos(pr.a)), pb = campusInterPorts(pr.b.vendor, 2, campusIsNxos(pr.b)); pa.forEach((x, i) => add(pr.a.hostname, x, pr.b.hostname, pb[i] || '', VIRT_NAME[campus.virt.kind])); });
        else if (campus.interlink) { const a = campus.interlink.a, b = campus.interlink.b; const pa = campusInterPorts(a.vendor), pb = campusInterPorts(b.vendor); pa.forEach((x, i) => add(a.hostname, x, b.hostname, pb[i] || '', 'INTER-CORE Port-channel 255')); }
      } catch (e) { /* ayrıntı yoksa atla */ }
    } else if (wan) {
      if (wan.type === 'dmvpn') wan.spokes.forEach(s => wan.hubs.forEach(h => add(s.hostname, `Tunnel100 ${s.tun}`, h.hostname, `Tunnel100 ${h.tun}`, 'tunnel (logical)')));
      else wan.links.forEach(l => add(l.x.hostname, `Tunnel${l.xTun} ${l.xIp}`, l.y.hostname, `Tunnel${l.yTun} ${l.yIp}`, 'tunnel (logical)'));
    } else if (p.topo && p.topo.links) {
      p.topo.links.forEach(l => add(names[l.x] || l.x, l.xPort, names[l.y] || l.y, l.yPort, l.subnet || ''));
    }
    if (p.topo && p.topo.links && !campus && !wan) { try { files.push({ name: 'docs/field-order.txt', data: T(fieldOrderText()) + '\n' }); } catch (e) { /* yok */ } }
    if (p.crText) files.push({ name: 'docs/change-request.txt', data: T(p.crText) + '\n' });
    if (p.riskText) files.push({ name: 'docs/risk-assessment.txt', data: T(p.riskText) + '\n' });
    if (window.NETCUBE_CM) window.NETCUBE_CM.automation(devices).forEach(f => files.push(f));
    files.push({ name: 'topology.json', data: JSON.stringify({ app: 'netcube-intent', module: sol, exportedAt: new Date().toISOString(), devices, links }, null, 2) + '\n' });
    files.push({ name: 'cabling.csv', data: '﻿' + ['link,device_a,port_a,device_b,port_b,note', ...links.map((l, i) => [i + 1, l.a, l.aPort, l.b, l.bPort, l.note].map(csv).join(','))].join('\r\n') + '\r\n' });
    files.unshift({ name: 'README.txt', data: readme(en, sol, devices.length) });
    return files;
  }

  function download() {
    const files = collect(); if (!files) return false;
    const blob = zip(files); const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `netcube-lab-${state.solution}-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  }

  window.NETCUBE_LAB = { zip, collect, download };
  const btn = document.getElementById('labExportButton');
  if (btn) btn.addEventListener('click', () => { if (download()) { const old = btn.textContent; btn.textContent = window.I18N && window.I18N.lang === 'en' ? 'Downloaded' : 'İndirildi'; setTimeout(() => { btn.textContent = old; }, 1500); } });
})();
