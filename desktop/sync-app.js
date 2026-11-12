// dist/ tek kaynaktır; desktop/app/ buradan kopyalanır.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'app');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['index.html', 'app.js', 'styles.css', 'devices.js', 'parser.js', 'fabric.js', 'history.js', 'audit.js', 'i18n.js', 'i18n-en.js']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('synced', f);
}
