// Config çözümleyici: Cisco IOS-XE, Aruba AOS-CX ve Huawei VRP running-config
// metninden planlamada kullanılan olguları çıkarır. Cihaza bağlanmaz.
(function () {
  const IP = '(\\d{1,3}(?:\\.\\d{1,3}){3})';

  function expandVlanList(str) {
    const ids = [];
    str.replace(/(\d+)\s+to\s+(\d+)/gi, '$1-$2').replace(/,/g, ' ').split(/\s+/).filter(Boolean).forEach(tok => {
      const m = tok.match(/^(\d+)(?:-|to)(\d+)$/i);
      if (m) { for (let i = Number(m[1]); i <= Number(m[2]) && i - Number(m[1]) < 4094; i++) ids.push(i); }
      else if (/^\d+$/.test(tok)) ids.push(Number(tok));
    });
    return ids.filter(n => n > 0 && n < 4095);
  }

  function parseConfig(text) {
    const facts = {
      hostname: '', vlans: [], ifaces: [], ospf: null, bgp: null, eigrp: null,
      vnis: [], nve: false, statics: [], ssh: false, lines: 0
    };
    if (!text || !text.trim()) return facts;
    const lines = text.replace(/\r/g, '').split('\n');
    facts.lines = lines.length;
    const vlanMap = new Map();
    const setVlan = (id, name) => {
      if (!vlanMap.has(id)) vlanMap.set(id, { id, name: '' });
      if (name) vlanMap.get(id).name = name;
    };

    let ctx = null; // { type, ref }
    for (const raw of lines) {
      if (!raw.trim() || /^\s*[!#]/.test(raw)) { if (/^[!#]/.test(raw)) ctx = null; continue; }
      const indented = /^\s/.test(raw);
      const line = raw.trim();
      let m;

      if (!indented) {
        ctx = null;
        if ((m = line.match(/^(?:hostname|sysname)\s+(\S+)/i))) { facts.hostname = m[1]; continue; }
        if ((m = line.match(/^vlan\s+batch\s+(.+)$/i))) { expandVlanList(m[1]).forEach(id => setVlan(id)); continue; }
        if ((m = line.match(/^vlan\s+(?:id\s+)?(\d+)\s*$/i))) { const id = Number(m[1]); setVlan(id); ctx = { type: 'vlan', ref: id }; continue; }
        if ((m = line.match(/^vlan\s+([\d,\-\s]+)$/i))) { expandVlanList(m[1]).forEach(id => setVlan(id)); continue; }
        if ((m = line.match(/^interface\s+(\S+(?:\s+\d+)?)/i))) {
          const iface = { name: m[1], ip: '', desc: '' };
          facts.ifaces.push(iface); ctx = { type: 'iface', ref: iface };
          if (/^vxlan|^nve/i.test(m[1])) facts.nve = true;
          const vm = m[1].match(/^vlan\s*(\d+)/i) || line.match(/^interface\s+vlan(?:if)?\s*(\d+)/i);
          if (vm) setVlan(Number(vm[1]));
          continue;
        }
        if ((m = line.match(/^router\s+ospf\s+(\d+)/i)) || (m = line.match(/^ospf\s+(\d+)(?:\s+router-id\s+(\S+))?/i))) {
          facts.ospf = facts.ospf || { pid: m[1], routerId: '', areas: [] };
          if (m[2]) facts.ospf.routerId = m[2];
          ctx = { type: 'ospf', ref: facts.ospf }; continue;
        }
        if ((m = line.match(/^router\s+bgp\s+(\d+)/i)) || (m = line.match(/^bgp\s+(\d+)\s*$/i))) {
          facts.bgp = facts.bgp || { asn: m[1], neighbors: [] };
          ctx = { type: 'bgp', ref: facts.bgp }; continue;
        }
        if ((m = line.match(/^router\s+eigrp\s+(\S+)/i))) { facts.eigrp = { asn: m[1] }; ctx = { type: 'eigrp', ref: facts.eigrp }; continue; }
        if (/^evpn\b/i.test(line) || /^vxlan\b/i.test(line) || /^bridge-domain\b/i.test(line)) { facts.nve = true; ctx = { type: 'evpn' }; if ((m = line.match(/vni\s+(\d+)/i))) facts.vnis.push(Number(m[1])); continue; }
        if ((m = line.match(/^ip\s+route(?:-static)?\s+(?:vrf\s+\S+\s+)?(\S+)\s+(\S+)/i))) { facts.statics.push(m[1] + ' ' + m[2]); continue; }
        if (/^(?:ip\s+)?ssh\s+(?:server|version|enable)|^ip ssh version|^stelnet server enable|^ssh server/i.test(line)) facts.ssh = true;
        if ((m = line.match(/vni\s+(\d+)/i))) { facts.vnis.push(Number(m[1])); facts.nve = true; }
        continue;
      }

      // girintili satırlar: mevcut bağlama göre
      if (!ctx) continue;
      if (ctx.type === 'vlan') {
        if ((m = line.match(/^(?:name|description)\s+(\S+)/i))) setVlan(ctx.ref, m[1]);
      } else if (ctx.type === 'iface') {
        if ((m = line.match(new RegExp('^ip\\s+address\\s+' + IP + '(?:\\s+' + IP + '|/(\\d+))?', 'i')))) {
          if (!ctx.ref.ip) ctx.ref.ip = m[1];
          (ctx.ref.ips = ctx.ref.ips || []).push(m[1]);
        }
        if ((m = line.match(/^description\s+(.+)/i))) ctx.ref.desc = m[1];
        if ((m = line.match(/^(?:vni|vxlan vni|member vni)\s+(\d+)/i))) { facts.vnis.push(Number(m[1])); facts.nve = true; }
        if ((m = line.match(/^source\s+ip\s+(\S+)/i))) facts.nve = true;
      } else if (ctx.type === 'ospf') {
        if ((m = line.match(/^router-id\s+(\S+)/i))) ctx.ref.routerId = m[1];
        if ((m = line.match(/^area\s+(\S+)/i)) && !ctx.ref.areas.includes(m[1])) ctx.ref.areas.push(m[1]);
        if ((m = line.match(/^network\s+\S+\s+\S+\s+area\s+(\S+)/i)) && !ctx.ref.areas.includes(m[1])) ctx.ref.areas.push(m[1]);
      } else if (ctx.type === 'bgp') {
        if ((m = line.match(new RegExp('^neighbor\\s+' + IP + '\\s+remote-as\\s+(\\d+)', 'i'))) || (m = line.match(new RegExp('^peer\\s+' + IP + '\\s+as-number\\s+(\\d+)', 'i'))))
          ctx.ref.neighbors.push({ ip: m[1], remoteAs: m[2] });
      } else if (ctx.type === 'evpn') {
        if ((m = line.match(/vni\s+(\d+)/i))) facts.vnis.push(Number(m[1]));
      }
    }
    facts.vlans = [...vlanMap.values()].sort((a, b) => a.id - b.id);
    facts.vnis = [...new Set(facts.vnis)].sort((a, b) => a - b);
    facts.usedIps = facts.ifaces.flatMap(i => i.ips || (i.ip ? [i.ip] : []));
    return facts;
  }

  function summarize(f) {
    if (!f.lines) return '';
    const parts = [];
    parts.push(f.hostname ? `host ${f.hostname}` : 'hostname yok');
    parts.push(`${f.vlans.length} VLAN`);
    parts.push(`${f.ifaces.length} arayüz`);
    if (f.ospf) parts.push(`OSPF ${f.ospf.pid}`);
    if (f.bgp) parts.push(`BGP AS ${f.bgp.asn}`);
    if (f.eigrp) parts.push(`EIGRP ${f.eigrp.asn}`);
    if (f.vnis.length) parts.push(`${f.vnis.length} VNI`);
    return parts.join(' · ');
  }

  window.parseConfig = parseConfig;
  window.summarizeConfig = summarize;
})();
