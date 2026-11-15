# NetCube Intent

**Free, offline network change planner.** Describe what you want in plain language, pick your devices, and get a change plan with config drafts, verification commands and rollback for Cisco, Aruba and Huawei switches.

[English](#english) · [Türkçe](#türkçe)

> ⚠️ **Prototype.** It never connects to a device and never applies anything. Generated commands must be validated against your exact model, software version, licensing and existing topology before production use.

---

## English

### What it does

- **Intent to plan:** write the change you want ("extend VLAN 120 across the fabric, name it SERVERS, use VXLAN EVPN"); the tool picks a protocol and produces the plan.
- **Device catalog with capability matrix:** 43 models (incl. 3 Nexus 9300 on NX-OS), including routers (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). If a selected device cannot do the requested protocol (OSPF, eBGP, EIGRP, VXLAN EVPN, 802.1X), it recommends a supported alternative and explains why.
- **Multi-device fabrics (2–6 devices):** spine/leaf (spine = route-reflector) or full mesh, with `/30` link addressing, a cabling plan, a field work order and a topology diagram.
- **Existing config awareness:** upload a running-config; it parses VLANs, interfaces, OSPF, BGP and VNIs, reuses your OSPF process and BGP AS, and avoids VNI / loopback / VLAN clashes.
- **Complete change package per device:** delta config, verification commands, rollback and an analysis report.
- **Config audit (bring your own config):** just upload a running-config. Vendor, OS version, hostname and role (access vs. core) are detected from the file, so there is nothing to select. You get a security score, prioritized findings and fix commands with placeholders for secrets: 55 rules across management-plane hardening, Layer 2 protection, 802.1X / NAC readiness, routing security and VPN / IPsec, for Cisco IOS-XE, Aruba AOS-CX and Huawei VRP. The same engine also reports on uploaded configs in the Switch Hardening and Secure Access modules.
- **Campus Builder (Packet Tracer style):** add the devices you are going to install one by one — core or access, vendor, model, hostname, management IP and port count — and mix vendors freely. Configs are generated **per device** and **follow your intent**: write "802.1X and MAB, DHCP server on the core, OSPF, default route via 172.16.0.1, VLAN 10 USERS, VLAN 30 GUEST" and those features, VLANs and (while the inventory is untouched) device counts are applied; say "no hardening" and the management hardening block is skipped. You also get a port plan, a topology diagram with real hostnames and a design report.
- **Campus gateway redundancy and virtualization:** pick FHRP (HSRP / VRRP / GLBP / none; Aruba and Huawei fall back to VRRP with a note) or say it in the intent. Core virtualization per vendor: Catalyst StackWise Virtual (VSS), Nexus vPC (vPC domain, peer-link, keepalive), Aruba CX VSX, Huawei CSS / iStack / M-LAG. Four cores build two pairs (core + aggregation) joined by a double-sided multi-chassis LAG (multi-vPC). Access switches can be grouped into stacks (StackWise, VSF, iStack) with one hostname and per-member port ranges. Aruba/Huawei virtualization output is best-effort and must be lab-verified.
- **WAN / VPN (routers):** add hub and spoke routers one by one (vendor, model, hostname, WAN IP, LAN subnet) and describe the VPN you want. **DMVPN Phase 2/3** (mGRE, NHRP, IPsec profile, dual hub, EIGRP / OSPF / BGP overlay), **site-to-site IPsec** (IKEv2 VTI or crypto map / ipsec policy) and **GRE over IPsec** are generated per router, with a tunnel plan, topology and design report. If a router cannot do what you asked (for example DMVPN on Huawei AR) the tool falls back to a supported alternative and says why; mixed Cisco/Huawei links use policy-based IPsec. Pre-shared keys and NHRP keys are placeholders. Writing "DMVPN" or "IPsec VPN" in the Routing module switches to this module automatically.
- **Change management:** every plan also gets a colored **diff** against the uploaded running-config, a heuristic **risk score** (low / medium / high with mitigation hints), a **change request / MOP** draft, a static **pre-flight check** (duplicate hostnames / IPs / VLANs, overlapping subnets, access VLANs missing from trunks), a corporate **golden config** (NTP, syslog, banner, SNMP… injected into every output) and a **hostname pattern** (e.g. `{site}-{role}-{nn}`).
- **Lab bundle (ZIP):** one click exports per-device configs, verification / rollback / diff / risk / change-request texts, `topology.json`, `cabling.csv` and example **Ansible** and **Netmiko** files (dry-run by default). No device images are included; use it with Packet Tracer (limited Cisco IOS subset), GNS3, EVE-NG or CML.
- **WAN extras:** optional **dual-ISP failover** (IP SLA / NQA tracked default routes, per-ISP host routes for hub addresses) and a **WAN QoS** policy (voice / video / critical classes, shaper), asked for in the intent text.
- **Device cards fit the module:** the audit module shows only a config upload, hardening and secure access show vendor/model/version and upload, routing and cabling show the full card.
- **More modules:** switch hardening baseline and 802.1X / MAB / RADIUS access planning.
- **English and Turkish:** switch the language with the TR / EN button; the intent text, results, reports and fix comments follow the selected language.
- **Saved jobs:** every plan is stored with its inputs; reopen, delete, export or import jobs as JSON.
- **Private by design:** everything runs locally; nothing is uploaded.

### Download (Windows x64)

Get `NetCube-Intent-<version>-Setup.exe` (installer) or `NetCube-Intent-<version>-Portable.exe` from the [Releases](../../releases) page.

The builds are **unsigned**, so Windows SmartScreen may show "Publisher unknown": click **More info → Run anyway**. Verify the SHA-256 hash listed in the release notes if you like.

### Run in a browser

The app is static HTML/JS. Open `dist/index.html`, or serve the `dist/` folder with any static web server.

### Build from source

```bash
cd desktop
npm install
npm run build:installer   # NSIS installer
npm run build:portable    # single-file portable exe
npm run build:win         # both
```

`dist/` is the single source of truth; `desktop/app/` is copied from it by `npm run sync` (run automatically before each build). Output goes to `desktop/release/`.

### Project layout

| Path | Purpose |
| --- | --- |
| `dist/index.html`, `styles.css` | UI |
| `dist/app.js` | Intent detection, plan logic, rendering |
| `dist/devices.js` | Device catalog and capability matrix |
| `dist/parser.js` | Config parser (IOS-XE, AOS-CX, VRP) |
| `dist/fabric.js` | Topology, link addressing, per-vendor config generators |
| `dist/history.js` | Saved jobs |
| `dist/audit.js` | Config audit rule engine (rules, scoring, fix scripts, reports) |
| `dist/i18n.js`, `i18n-en.js` | Language layer and English dictionary (Turkish is the source language) |
| `desktop/` | Electron wrapper and installer config |

### Known limitations

- Intent detection is **rule-based** (keywords), not AI. Turkish and English phrasing are recognized; unusual wording may fall back to a default (OSPF) and the tool says so. Common technical terms (OSPF, BGP, VXLAN, EVPN, EIGRP) work in any phrasing.
- The audit rules are general good practice and are evaluated from the config text only; they cannot see runtime state, licensing or hardware, so weigh the findings against your own standard.
- The English UI is a translation layer over Turkish source text. If you spot a string that stayed Turkish, please open an issue.
- The capability matrix reflects general product-family information. License tier (for example Network Advantage), software version and hardware revision can change what a device supports: always check the vendor documentation.
- Campus configs for Aruba AOS-CX and Huawei VRP are best-effort templates (VRRP, DHCP, 802.1X, port groups); the Cisco IOS-XE output is the most complete. Always check interface names and syntax against your platform.
- WAN / VPN: DMVPN is generated for Cisco IOS-XE only (Huawei DSVPN is not implemented); IKEv2 with pre-shared keys is the default, certificates (PKI) are only recommended in the notes. Aruba is not offered for routers. Exact syntax, licensing (Security K9 / throughput) and interface names must be verified per platform.
- Link interface names are derived from port numbers (for example `GigabitEthernet1/0/49`) and may differ from your platform's real names; the output flags this.
- Only IOS-XE, AOS-CX and VRP syntax is generated. NX-OS, Junos and others are not supported yet.

### Roadmap ideas

Huawei DSVPN, FlexVPN and certificate-based IPsec, more router models, more models and vendors, richer config parsing and diffing, config export bundles (ZIP), automated tests.

Feedback and issues are welcome: tell me which vendor, platform or protocol you need next.

### Disclaimer

NetCube Intent is not affiliated with, endorsed by or sponsored by Cisco, Hewlett Packard Enterprise (Aruba) or Huawei. Product and vendor names are used only to describe compatibility and belong to their respective owners. The software is provided "as is" without warranty (see [LICENSE](LICENSE)); you are responsible for validating all generated output before use.

---

## Türkçe

### Ne yapar

- **Niyetten plana:** Yapmak istediğin değişikliği Türkçe yaz; araç protokolü seçer ve planı üretir.
- **Yetenek matrisli cihaz kataloğu:** 43 model (3 Nexus 9300 / NX-OS dahil), router'lar dahil (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). Seçilen cihaz istenen protokolü desteklemiyorsa (OSPF, eBGP, EIGRP, VXLAN EVPN, 802.1X) desteklenen bir alternatifi nedenini açıklayarak önerir.
- **Çoklu cihaz (2–6):** spine/leaf (spine = route-reflector) veya mesh; `/30` link adresleri, kablo planı, saha iş emri ve topoloji çizimi.
- **Mevcut config'i anlar:** running-config yükle; VLAN, arayüz, OSPF, BGP ve VNI okunur, mevcut OSPF process ve BGP AS kullanılır, VNI / loopback / VLAN çakışmaları önlenir.
- **Cihaz başına tam değişiklik paketi:** delta config, doğrulama komutları, rollback ve analiz raporu.
- **Config denetimi (kendi config'in):** running-config yükle; güvenlik puanı, öncelikli bulgular ve secret'lar için yer tutuculu düzeltme komutları al. Beş profilde 55 kural: yönetim düzlemi hardening, Layer 2 koruma, 802.1X / NAC hazırlığı, routing güvenliği ve VPN / IPsec (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). Aynı motor Switch Hardening ve Secure Access modüllerinde yüklenen config'leri de raporlar.
- **Türkçe ve İngilizce:** TR / EN düğmesiyle dil değişir; niyet metni, sonuçlar, raporlar ve düzeltme yorumları seçilen dili izler.
- **Campus Builder (Packet Tracer tarzı):** kuracağın cihazları tek tek ekle: core/access, üretici, model, hostname, yönetim IP'si, port sayısı; üreticileri karıştırabilirsin. Config'ler **cihaz bazında** ve **niyetine göre** üretilir: "802.1X ve MAB olsun, DHCP sunucusu core'da, OSPF çalışsın, varsayılan rota 172.16.0.1 üzerinden, VLAN 10 USERS, VLAN 30 GUEST" yazarsan bu özellikler, VLAN'lar ve (envanter elle değiştirilmediyse) cihaz sayıları uygulanır; "hardening olmasın" dersen yönetim hardening bloğu atlanır. Port planı, gerçek hostname'li topoloji çizimi ve tasarım raporu da çıkar.
- **Campus gateway yedekliliği ve sanallaştırma:** FHRP seç (HSRP / VRRP / GLBP / yok; Aruba ve Huawei notla VRRP'ye düşer) ya da niyette yaz. Üreticiye göre core sanallaştırma: Catalyst StackWise Virtual (VSS), Nexus vPC (domain, peer-link, keepalive), Aruba CX VSX, Huawei CSS / iStack / M-LAG. Dört core iki çift kurar (core + aggregation) ve aralarına çift taraflı çok-şasili LAG (multi-vPC) çeker. Access switchler stack (StackWise, VSF, iStack) olarak tek hostname ve üye başına port aralığıyla gruplanabilir. Aruba/Huawei sanallaştırma çıktısı best-effort'tur, lab'da doğrulanmalıdır.
- **WAN / VPN (router'lar):** hub ve spoke router'larını tek tek ekle (üretici, model, hostname, WAN IP, LAN alt ağı) ve istediğin VPN'i yaz. **DMVPN Phase 2/3** (mGRE, NHRP, IPsec profili, çift hub, EIGRP / OSPF / BGP overlay), **site-to-site IPsec** (IKEv2 VTI veya crypto map / ipsec policy) ve **GRE over IPsec** her router için üretilir; tünel planı, topoloji ve tasarım raporu da çıkar. Router istediğin şeyi desteklemiyorsa (örn. Huawei AR'da DMVPN) desteklenen alternatife düşülür ve nedeni söylenir; Cisco/Huawei karışık bağlantılarda politika tabanlı IPsec kullanılır. PSK ve NHRP anahtarları yer tutucudur. Routing modülüne "DMVPN" veya "IPsec VPN" yazmak otomatik olarak bu modüle geçirir.
- **Değişiklik yönetimi:** her plan için yüklenen running-config'e göre renkli **fark (diff)**, sezgisel **risk puanı** (düşük / orta / yüksek ve azaltma önerileri), **değişiklik talebi / MOP** taslağı, statik **ön kontrol** (tekrar eden hostname / IP / VLAN, çakışan alt ağlar, trunk'ta eksik erişim VLAN'ları), kurumsal **golden config** (NTP, syslog, banner, SNMP… tüm çıktılara eklenir) ve **hostname şablonu** (örn. `{site}-{role}-{nn}`).
- **Lab paketi (ZIP):** tek tıkla cihaz başına config, doğrulama / rollback / fark / risk / değişiklik talebi metinleri, `topology.json`, `cabling.csv` ve örnek **Ansible** ile **Netmiko** dosyalarını (varsayılan dry-run) dışa aktarır. Cihaz imajı içermez; Packet Tracer (sınırlı Cisco IOS), GNS3, EVE-NG veya CML ile kullanılır.
- **WAN ek özellikleri:** niyette istenirse **çift ISP yedekleme** (IP SLA / NQA izlemeli varsayılan rotalar, hub adresleri için ISP başına host rotası) ve **WAN QoS** politikası (ses / video / kritik sınıflar, shaper).
- **Kart modüle uyar:** denetim modülünde yalnızca config yükleme görünür; hardening ve secure access'te üretici/model/sürüm ve yükleme; routing ve kablolamada tam kart.
- **Diğer modüller:** switch hardening baseline ve 802.1X / MAB / RADIUS planı.
- **Kayıtlı işler:** her plan girdileriyle saklanır; tekrar açılır, silinir, JSON olarak dışa/içe aktarılır.
- **Gizlilik:** her şey yerelde çalışır, hiçbir veri yüklenmez.

### İndirme (Windows x64)

[Releases](../../releases) sayfasından `NetCube-Intent-<sürüm>-Setup.exe` (kurulum) veya `...-Portable.exe` indir. Paketler **imzasızdır**: SmartScreen "Yayıncı bilinmiyor" derse **Daha fazla bilgi → Yine de çalıştır**.

### Kaynak koddan derleme

```bash
cd desktop
npm install
npm run build:win
```

### Sınırlamalar

Niyet çözümü kural tabanlıdır (yapay zekâ değil). Yetenek matrisi genel ürün ailesi bilgisidir; lisans ve yazılım sürümünü üretici dokümanıyla doğrulayın. Arayüz adları port numarasından türetilir. Yalnızca IOS-XE, AOS-CX ve VRP sözdizimi üretilir.

### Sorumluluk reddi

Cihazlara bağlanmaz ve config uygulamaz. Üretilen komutlar canlı ortamda kullanılmadan önce doğrulanmalıdır. Cisco, HPE Aruba ve Huawei ile bağlantılı değildir; marka adları yalnızca uyumluluğu belirtmek için kullanılır.

## License

[MIT](LICENSE)
