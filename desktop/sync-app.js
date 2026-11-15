// dist/ tek kaynaktır; desktop/app/ buradan kopyalanır.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'app');
fs.mkdirSync(dst, { recursive: true });
const ver = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(src, 'version.js'), "// desktop/sync-app.js bu dosyayı package.json sürümünden üretir.\nwindow.NETCUBE_VERSION = '" + ver + "';\n");
for (const f of ['index.html', 'app.js', 'styles.css', 'devices.js', 'parser.js', 'fabric.js', 'history.js', 'labexport.js', 'changemgmt.js', 'audit.js', 'i18n.js', 'i18n-en.js', 'version.js']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('synced', f);
}
