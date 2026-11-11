// Fabric: N cihaz için topoloji (leaf-spine veya mesh), link adreslemesi ve
// OSPF / eBGP / EIGRP / static / VXLAN EVPN config üreticileri.
// Cihaza bağlanmaz; yalnızca metin üretir.
(function () {
  const MASK30 = '255.255.255.252';

  function nextPorts(info, n) {
    const base = (info.ports && info.ports.length ? info.ports : ['49', '50']).slice(0, n);
    while (base.length < n) {
      const last = base[base.length - 1];
      const m = String(last).match(/^(.*?)(\d+)$/);
      base.push(m ? m[1] + (Number(m[2]) + 1) : last + '+1');
    }
    return base;
  }

  function ifName(vendor, port) {
    const p = String(port);
    if (vendor === 'cisco') return /^\d+$/.test(p) ? `GigabitEthernet1/0/${p}` : `GigabitEthernet${p}`;
    if (vendor === 'aruba') return /^\d+$/.test(p) ? `1/1/${p}` : p;
    if (vendor === 'huawei') return /^\d+$/.test(p) ? `GigabitEthernet0/0/${p}` : `GigabitEthernet${p}`;
    return p;
  }

  // redundancy: 'dual' | 'single'
  function buildTopology(ids, devs, redundancy) {
    const spines = ids.filter(i => devs[i].role === 'spine');
    const leaves = ids.filter(i => devs[i].role !== 'spine');
    const mode = spines.length && leaves.length ? 'leaf-spine' : 'mesh';
    const pairs = [];
    if (mode === 'leaf-spine') {
      leaves.forEach((l, li) => {
        const sp = redundancy === 'single' ? [spines[li % spines.length]] : spines;
        sp.forEach(s => pairs.push([s, l]));
      });
    } else {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
    }
    const parallel = redundancy === 'dual' && (mode === 'mesh' ? ids.length <= 3 : spines.length < 2) ? 2 : 1;
    const links = [];
    pairs.forEach(([x, y]) => { for (let r = 0; r < parallel; r++) links.push({ x, y }); });
    // port ihtiyacı
    const need = {}; ids.forEach(i => { need[i] = 0; });
    links.forEach(l => { need[l.x]++; need[l.y]++; });
    const ports = {}; ids.forEach(i => { ports[i] = nextPorts(devs[i], Math.max(need[i], 1)); });
    const used = {}; ids.forEach(i => { used[i] = 0; });
    links.forEach((l, k) => {
      const n = k + 1;
      l.id = `CBL-${String(n).padStart(3, '0')}`;
      l.subnet = `192.168.${50 + k}.0/30`;
      l.net = `192.168.${50 + k}.0`;
      l.xIp = `192.168.${50 + k}.1`; l.yIp = `192.168.${50 + k}.2`;
      l.xPort = ports[l.x][used[l.x]++]; l.yPort = ports[l.y][used[l.y]++];
    });
    const linksOf = id => links.filter(l => l.x === id || l.y === id).map(l => {
      const isX = l.x === id;
      return { id: l.id, peerId: isX ? l.y : l.x, localIp: isX ? l.xIp : l.yIp, peerIp: isX ? l.yIp : l.xIp, localPort: isX ? l.xPort : l.yPort, peerPort: isX ? l.yPort : l.xPort, net: l.net, subnet: l.subnet };
    });
    return { mode, spines, leaves, links, linksOf, parallel };
  }

  function isSpine(topo, id) { return topo.mode === 'leaf-spine' && topo.spines.includes(id); }

  function evpnPeers(id, topo, ctx) {
    const asn = ctx.asn;
    const ibgp = new Set(ctx.ids.map(i => asn[i])).size === 1;
    const others = topo.mode === 'leaf-spine' ? (topo.spines.includes(id) ? topo.leaves : topo.spines) : ctx.ids.filter(i => i !== id);
    return others.map(o => ({ id: o, ip: ctx.P.ip[o], ras: asn[o], rr: ibgp && topo.mode === 'leaf-spine' && topo.spines.includes(id), ibgp }));
  }

  // ---------- link arayüzleri ----------
  function linkIfaces(vendor, id, ctx, ospf) {
    const L = ctx.topo.linksOf(id);
    if (!L.length) return '';
    const pid = ctx.P.pid[id];
    const out = [vendor === 'huawei' ? '# Arayüz adlarını model ve port numaralandırmasına göre doğrulayın' : '! Arayüz adlarını model ve port numaralandırmasına göre doğrulayın'];
    L.forEach(l => {
      const nm = ifName(vendor, l.localPort);
      if (vendor === 'cisco') out.push(`interface ${nm}`, ` description ${l.id} to ${l.peerId.toUpperCase()}`, ' no switchport', ` ip address ${l.localIp} ${MASK30}`, ' no shutdown', '!');
      if (vendor === 'aruba') {
        out.push(`interface ${nm}`, ` description ${l.id} to ${l.peerId.toUpperCase()}`, ' no shutdown', ' routing', ` ip address ${l.localIp}/30`);
        if (ospf) out.push(` ip ospf ${pid} area 0.0.0.0`, ' ip ospf network point-to-point');
        out.push('!');
      }
      if (vendor === 'huawei') out.push(`interface ${nm}`, ` description ${l.id} to ${l.peerId.toUpperCase()}`, ' undo portswitch', ` ip address ${l.localIp} ${MASK30}`, '#');
    });
    return out.join('\n');
  }

  function linkRollback(vendor, id, ctx) {
    const L = ctx.topo.linksOf(id);
    return L.map(l => {
      const nm = ifName(vendor, l.localPort);
      if (vendor === 'cisco') return `default interface ${nm}`;
      if (vendor === 'aruba') return `interface ${nm}\n no ip address\n no routing`;
      return `interface ${nm}\n undo ip address\n portswitch`;
    }).join('\n');
  }

  // ---------- OSPF gövdeleri ----------
  function ospfBody(vendor, id, ctx, opts) {
    const o = opts || {};
    const pid = ctx.P.pid[id], net = ctx.P.net[id], ip = ctx.P.ip[id];
    const L = ctx.topo.linksOf(id);
    if (vendor === 'cisco') {
      const l = [`router ospf ${pid}`];
      if (o.loopback) l.push(` network ${ip} 0.0.0.0 area 0`);
      if (!o.underlayOnly) l.push(` network ${net} 0.0.255.255 area 0`);
      L.forEach(x => l.push(` network ${x.net} 0.0.0.3 area 0`));
      return l.join('\n');
    }
    if (vendor === 'aruba') {
      const l = [`router ospf ${pid}`, ' area 0.0.0.0', '!'];
      const extra = [];
      if (o.loopback) extra.push('interface loopback 1', ` ip ospf ${pid} area 0.0.0.0`);
      return l.concat(extra).join('\n');
    }
    const l = [`ospf ${pid}`, ' area 0.0.0.0'];
    if (o.loopback) l.push(`  network ${ip} 0.0.0.0`);
    if (!o.underlayOnly) l.push(`  network ${net} 0.0.255.255`);
    L.forEach(x => l.push(`  network ${x.net} 0.0.0.3`));
    return l.join('\n');
  }

  const PRE = { cisco: ['configure terminal', 'end'], aruba: ['configure terminal', ''], huawei: ['system-view', 'return'] };
  const wrap = (vendor, body) => [PRE[vendor][0], body, PRE[vendor][1]].filter(x => x !== '').join('\n');

  // ---------- protokoller ----------
  function genOspf(vendor, id, c) {
    const links = linkIfaces(vendor, id, c.ctx, true);
    const body = ospfBody(vendor, id, c.ctx);
    const delta = wrap(vendor, [links, body].filter(Boolean).join('\n'));
    const verify = vendor === 'cisco' ? `show ip ospf neighbor\nshow ip ospf interface brief\nshow ip route ospf\nshow ip route ${c.net}`
      : vendor === 'aruba' ? 'show ip ospf neighbors\nshow ip ospf interface brief\nshow ip route ospf'
        : 'display ospf peer brief\ndisplay ospf interface\ndisplay ip routing-table protocol ospf';
    const nets = c.ctx.topo.linksOf(id);
    const rb = vendor === 'cisco' ? `router ospf ${c.pid}\n no network ${c.net} 0.0.255.255 area 0\n${nets.map(x => ` no network ${x.net} 0.0.0.3 area 0`).join('\n')}\n!\n${linkRollback(vendor, id, c.ctx)}`
      : vendor === 'aruba' ? `${linkRollback(vendor, id, c.ctx)}\nno router ospf ${c.pid}`
        : `ospf ${c.pid}\n area 0.0.0.0\n  undo network ${c.net} 0.0.255.255\n${nets.map(x => `  undo network ${x.net} 0.0.0.3`).join('\n')}\nquit\nquit\n${linkRollback(vendor, id, c.ctx)}`;
    return { delta, verify, rollback: wrap(vendor, rb) };
  }

  function genEbgp(vendor, id, c) {
    const L = c.ctx.topo.linksOf(id);
    const ras = l => c.ctx.asn[l.peerId];
    const links = linkIfaces(vendor, id, c.ctx, false);
    let bgp;
    if (vendor === 'cisco') bgp = [`router bgp ${c.asn}`, ...L.map(l => ` neighbor ${l.peerIp} remote-as ${ras(l)}`), ' address-family ipv4', `  network ${c.net} mask 255.255.0.0`, ...L.map(l => `  neighbor ${l.peerIp} activate`), ' exit-address-family'].join('\n');
    else if (vendor === 'aruba') bgp = [`router bgp ${c.asn}`, ...L.map(l => ` neighbor ${l.peerIp} remote-as ${ras(l)}`), ' address-family ipv4 unicast', `  network ${c.net}/16`, ...L.map(l => `  neighbor ${l.peerIp} activate`), ' exit-address-family'].join('\n');
    else bgp = [`bgp ${c.asn}`, ...L.map(l => ` peer ${l.peerIp} as-number ${ras(l)}`), ' ipv4-family unicast', `  network ${c.net} 255.255.0.0`, ...L.map(l => `  peer ${l.peerIp} enable`), ' quit', 'quit'].join('\n');
    const verify = vendor === 'cisco' ? `show ip route ${c.net}\nshow bgp ipv4 unicast summary\n${L.map(l => `show bgp ipv4 unicast neighbors ${l.peerIp} advertised-routes`).join('\n')}`
      : vendor === 'aruba' ? `show ip route ${c.net}/16\nshow bgp ipv4 unicast summary\nshow bgp ipv4 unicast`
        : `display ip routing-table ${c.net}\ndisplay bgp peer\ndisplay bgp routing-table`;
    const rb = vendor === 'cisco' ? `router bgp ${c.asn}\n${L.map(l => ` no neighbor ${l.peerIp}`).join('\n')}\n address-family ipv4\n  no network ${c.net} mask 255.255.0.0\n!\n${linkRollback(vendor, id, c.ctx)}`
      : vendor === 'aruba' ? `router bgp ${c.asn}\n${L.map(l => ` no neighbor ${l.peerIp}`).join('\n')}\n address-family ipv4 unicast\n  no network ${c.net}/16\n!\n${linkRollback(vendor, id, c.ctx)}`
        : `bgp ${c.asn}\n${L.map(l => ` undo peer ${l.peerIp}`).join('\n')}\n ipv4-family unicast\n  undo network ${c.net} 255.255.0.0\n quit\nquit\n${linkRollback(vendor, id, c.ctx)}`;
    return { delta: wrap(vendor, [links, bgp].filter(Boolean).join('\n')), verify, rollback: wrap(vendor, rb) };
  }

  function genStatic(vendor, id, c) {
    const P = c.ctx.P;
    const t = P.target, nh = P.nextHop;
    const mask = P.targetMask;
    if (vendor === 'cisco') return { delta: wrap(vendor, `ip route ${t} ${mask} ${nh}`), verify: `show ip route ${nh}\nshow ip route ${t}\nshow ip cef ${t}`, rollback: wrap(vendor, `no ip route ${t} ${mask} ${nh}`) };
    if (vendor === 'aruba') return { delta: wrap(vendor, `ip route ${t}/${P.targetLen} ${nh}`), verify: `show ip route ${nh}\nshow ip route ${t}/${P.targetLen}`, rollback: wrap(vendor, `no ip route ${t}/${P.targetLen} ${nh}`) };
    return { delta: wrap(vendor, `ip route-static ${t} ${mask} ${nh}`), verify: `display ip routing-table ${nh}\ndisplay ip routing-table ${t}`, rollback: wrap(vendor, `undo ip route-static ${t} ${mask} ${nh}`) };
  }

  function genEigrp(vendor, id, c) {
    if (vendor !== 'cisco') return null;
    const L = c.ctx.topo.linksOf(id);
    const links = linkIfaces(vendor, id, c.ctx, false);
    const body = ['router eigrp 100', ` network ${c.net} 0.0.255.255`, ...L.map(l => ` network ${l.net} 0.0.0.3`), ' passive-interface default', ...L.map(l => ` no passive-interface ${ifName(vendor, l.localPort)}`)].join('\n');
    return {
      delta: wrap(vendor, [links, body].filter(Boolean).join('\n')),
      verify: 'show ip eigrp neighbors\nshow ip eigrp topology\nshow ip route eigrp',
      rollback: wrap(vendor, `router eigrp 100\n no network ${c.net} 0.0.255.255\n${L.map(l => ` no network ${l.net} 0.0.0.3`).join('\n')}\n!\n${linkRollback(vendor, id, c.ctx)}`)
    };
  }

  function genVxlan(vendor, id, c) {
    const ctx = c.ctx, topo = ctx.topo;
    const spine = isSpine(topo, id);
    const peers = evpnPeers(id, topo, ctx);
    const ibgp = peers.length && peers[0].ibgp;
    const links = linkIfaces(vendor, id, ctx, true);
    const ospf = ospfBody(vendor, id, ctx, { loopback: true, underlayOnly: true });
    const vid = c.vid, vname = c.vname, vni = c.vni, ip = c.ip;
    let loop, l2, bgp, nve = '';
    if (vendor === 'cisco') {
      loop = ['interface Loopback1', ' description VTEP', ` ip address ${ip} 255.255.255.255`, '!'].join('\n');
      l2 = spine ? '' : `vlan ${vid}\n name ${vname}\n!`;
      bgp = [`router bgp ${c.asn}`,
        ...peers.flatMap(p => [` neighbor ${p.ip} remote-as ${p.ras}`, ` neighbor ${p.ip} update-source Loopback1`, ...(p.ibgp ? [] : [` neighbor ${p.ip} ebgp-multihop 5`])]),
        ' address-family l2vpn evpn', ...peers.flatMap(p => [`  neighbor ${p.ip} activate`, `  neighbor ${p.ip} send-community both`, ...(p.rr ? [`  neighbor ${p.ip} route-reflector-client`] : [])]), ' exit-address-family'].join('\n');
      if (!spine) nve = `! VLAN ${vid} → VNI ${vni} eşlemesi platform profiline göre eklenir (l2vpn evpn instance / member vni)`;
    } else if (vendor === 'aruba') {
      loop = ['interface loopback 1', ` ip address ${ip}/32`, '!'].join('\n');
      l2 = spine ? '' : `vlan ${vid}\n name ${vname}\n!`;
      bgp = [`router bgp ${c.asn}`,
        ...peers.flatMap(p => [` neighbor ${p.ip} remote-as ${p.ras}`, ` neighbor ${p.ip} update-source loopback 1`, ...(p.ibgp ? [] : [` neighbor ${p.ip} ebgp-multihop 5`])]),
        ' address-family l2vpn evpn', ...peers.flatMap(p => [`  neighbor ${p.ip} activate`, `  neighbor ${p.ip} send-community both`, ...(p.rr ? [`  neighbor ${p.ip} route-reflector-client`] : [])]), ' exit-address-family'].join('\n');
      if (!spine) nve = ['evpn', ` vlan ${vid}`, '  rd auto', '  route-target both auto', '!', 'interface vxlan 1', ` source ip ${ip}`, ' no shutdown', ` vni ${vni}`, `  vlan ${vid}`].join('\n');
    } else {
      loop = ['interface LoopBack1', ` ip address ${ip} 255.255.255.255`, '#'].join('\n');
      l2 = spine ? '' : `vlan ${vid}\n description ${vname}\n#\nbridge-domain ${vid}\n vxlan vni ${vni}\n#`;
      bgp = [`bgp ${c.asn}`,
        ...peers.flatMap(p => [` peer ${p.ip} as-number ${p.ras}`, ` peer ${p.ip} connect-interface LoopBack1`, ...(p.ibgp ? [] : [` peer ${p.ip} ebgp-max-hop 5`])]),
        ' l2vpn-family evpn', ...peers.flatMap(p => [`  peer ${p.ip} enable`, `  peer ${p.ip} advertise-community`, ...(p.rr ? [`  peer ${p.ip} reflect-client`] : [])]), '  quit', 'quit'].join('\n');
      if (!spine) nve = ['interface Nve1', ` source ${ip}`, ` vni ${vni} head-end peer-list protocol bgp`, '#'].join('\n');
    }
    const role = spine ? '! Rol: spine / route-reflector (VLAN-VNI eşlemesi gerekmez)' : (topo.mode === 'leaf-spine' ? '! Rol: leaf / VTEP' : '! Rol: VTEP (mesh)');
    const delta = wrap(vendor, [role.replace(/^!/, vendor === 'huawei' ? '#' : '!'), links, loop, ospf, l2, bgp, nve].filter(Boolean).join('\n'));
    const verify = vendor === 'cisco' ? `show vlan id ${vid}\nshow ip interface brief | include Loopback1\nshow ip ospf neighbor\nshow bgp l2vpn evpn summary\nshow bgp l2vpn evpn\nshow platform software fed switch active vxlan`
      : vendor === 'aruba' ? `show vlan ${vid}\nshow interface loopback 1\nshow ip ospf neighbors\nshow bgp l2vpn evpn summary\nshow bgp l2vpn evpn\nshow interface vxlan 1`
        : `display vlan ${vid}\ndisplay interface LoopBack1\ndisplay ospf peer brief\ndisplay bgp evpn peer\ndisplay bgp evpn routing-table\ndisplay vxlan vni`;
    const rb = vendor === 'cisco' ? `router bgp ${c.asn}\n address-family l2vpn evpn\n${peers.map(p => `  no neighbor ${p.ip} activate`).join('\n')}\n exit-address-family\n${peers.map(p => ` no neighbor ${p.ip}`).join('\n')}\n!\nno interface Loopback1\n${spine ? '' : `no vlan ${vid}\n`}${linkRollback(vendor, id, ctx)}`
      : vendor === 'aruba' ? `no interface vxlan 1\nno evpn\nrouter bgp ${c.asn}\n no address-family l2vpn evpn\nno interface loopback 1\n${spine ? '' : `no vlan ${vid}\n`}${linkRollback(vendor, id, ctx)}`
        : `bgp ${c.asn}\n${peers.map(p => ` undo peer ${p.ip}`).join('\n')}\nquit\n${spine ? '' : `undo interface Nve1\nundo bridge-domain ${vid}\nundo vlan ${vid}\n`}undo interface LoopBack1\n${linkRollback(vendor, id, ctx)}`;
    return { delta, verify, rollback: wrap(vendor, rb) };
  }

  const GEN = { ospf: genOspf, bgp: genEbgp, static: genStatic, eigrp: genEigrp, vxlan: genVxlan };

  function fabricConfig(vendor, protocol, id, ctx) {
    const gen = GEN[protocol];
    if (!gen || !PRE[vendor]) return null;
    const P = ctx.P;
    const c = {
      ctx, ip: P.ip[id], net: P.net[id], asn: ctx.asn[id], pid: P.pid[id],
      vid: P.vid, vname: P.vname, vni: P.vni
    };
    return gen(vendor, id, c);
  }

  window.NETCUBE_FABRIC = { buildTopology, fabricConfig, nextPorts, ifName, evpnPeers, isSpine };
})();
