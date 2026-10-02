// Renders assets/app-icon.svg to assets/app-icon.png (512px) using Electron's own renderer.
// Usage: xvfb-run -a npx electron scripts/make-icon.js --no-sandbox
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{width:512px;height:512px;display:block}</style>${svg}`));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'app-icon.png'), img.toPNG());
  console.log('icon written', img.getSize());
  app.quit();
});
