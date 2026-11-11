# NetCube Intent Desktop

Windows x64 portable prototipi. Kurulum gerektirmez; `npm run build:win` sonrası `release/NetCube-Intent-0.7.0-Portable.exe` dosyasını çalıştırın.

Kaynak: `../dist` tek kaynaktır. `app/` klasörü `npm run sync` (veya `build:win`) ile oradan kopyalanır; `app/` içinde elle değişiklik yapmayın.

Desteklenen prototip akışları:

- OSPF, BGP, static route ve VXLAN EVPN planlama
- Cisco, Aruba ve Huawei config taslakları
- Switch hardening ve mevcut config denetimi
- Secure Access / NAC / RADIUS planlama
- Fiziksel port ve kablo planı
- Campus Builder: core/access envanteri, VLAN, management IP, STP, DHCP Snooping, DAI ve IP Source Guard

Uygulama cihazlara bağlanmaz ve config uygulamaz. Üretilen komutlar gerçek model, yazılım sürümü, lisans ve mevcut topolojiye göre doğrulanmadan üretim ortamında kullanılmamalıdır. Secret alanları placeholder olarak bırakılır.
