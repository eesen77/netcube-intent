# NetCube Intent

**Free, offline network change planner.** Describe what you want in plain language, pick your devices, and get a change plan with config drafts, verification commands and rollback for Cisco, Aruba and Huawei switches.

[English](#english) · [Türkçe](#türkçe)

> ⚠️ **Prototype.** It never connects to a device and never applies anything. Generated commands must be validated against your exact model, software version, licensing and existing topology before production use.

---

## English

### What it does

- **Intent to plan:** write the change you want ("extend VLAN 120 across the fabric, name it SERVERS, use VXLAN EVPN"); the tool picks a protocol and produces the plan.
- **Device catalog with capability matrix:** 31 models (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). If a selected device cannot do the requested protocol (OSPF, eBGP, EIGRP, VXLAN EVPN, 802.1X), it recommends a supported alternative and explains why.
- **Multi-device fabrics (2–6 devices):** spine/leaf (spine = route-reflector) or full mesh, with `/30` link addressing, a cabling plan, a field work order and a topology diagram.
- **Existing config awareness:** upload a running-config; it parses VLANs, interfaces, OSPF, BGP and VNIs, reuses your OSPF process and BGP AS, and avoids VNI / loopback / VLAN clashes.
- **Complete change package per device:** delta config, verification commands, rollback and an analysis report.
- **Config audit (bring your own config):** upload a running-config and get a security score, prioritized findings and fix commands with placeholders for secrets. 46 rules across four profiles — management-plane hardening, Layer 2 protection, 802.1X / NAC readiness and routing security — for Cisco IOS-XE, Aruba AOS-CX and Huawei VRP. The same engine also reports on uploaded configs in the Switch Hardening and Secure Access modules.
- **More modules:** switch hardening baseline, 802.1X / MAB / RADIUS access planning, campus builder (core/access inventory, VLANs, STP, DHCP snooping, DAI, IP source guard).
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
- Link interface names are derived from port numbers (for example `GigabitEthernet1/0/49`) and may differ from your platform's real names; the output flags this.
- Only IOS-XE, AOS-CX and VRP syntax is generated. NX-OS, Junos and others are not supported yet.

### Roadmap ideas

English UI, more models and vendors, richer config parsing and diffing, config export bundles (ZIP), automated tests.

Feedback and issues are welcome: tell me which vendor, platform or protocol you need next.

### Disclaimer

NetCube Intent is not affiliated with, endorsed by or sponsored by Cisco, Hewlett Packard Enterprise (Aruba) or Huawei. Product and vendor names are used only to describe compatibility and belong to their respective owners. The software is provided "as is" without warranty (see [LICENSE](LICENSE)); you are responsible for validating all generated output before use.

---

## Türkçe

### Ne yapar

- **Niyetten plana:** Yapmak istediğin değişikliği Türkçe yaz; araç protokolü seçer ve planı üretir.
- **Yetenek matrisli cihaz kataloğu:** 31 model (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). Seçilen cihaz istenen protokolü desteklemiyorsa (OSPF, eBGP, EIGRP, VXLAN EVPN, 802.1X) desteklenen bir alternatifi nedenini açıklayarak önerir.
- **Çoklu cihaz (2–6):** spine/leaf (spine = route-reflector) veya mesh; `/30` link adresleri, kablo planı, saha iş emri ve topoloji çizimi.
- **Mevcut config'i anlar:** running-config yükle; VLAN, arayüz, OSPF, BGP ve VNI okunur, mevcut OSPF process ve BGP AS kullanılır, VNI / loopback / VLAN çakışmaları önlenir.
- **Cihaz başına tam değişiklik paketi:** delta config, doğrulama komutları, rollback ve analiz raporu.
- **Config denetimi (kendi config'in):** running-config yükle; güvenlik puanı, öncelikli bulgular ve secret'lar için yer tutuculu düzeltme komutları al. Dört profilde 46 kural: yönetim düzlemi hardening, Layer 2 koruma, 802.1X / NAC hazırlığı ve routing güvenliği (Cisco IOS-XE, Aruba AOS-CX, Huawei VRP). Aynı motor Switch Hardening ve Secure Access modüllerinde yüklenen config'leri de raporlar.
- **Türkçe ve İngilizce:** TR / EN düğmesiyle dil değişir; niyet metni, sonuçlar, raporlar ve düzeltme yorumları seçilen dili izler.
- **Diğer modüller:** switch hardening baseline, 802.1X / MAB / RADIUS planı, Campus Builder.
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
