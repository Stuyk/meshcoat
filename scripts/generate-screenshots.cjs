const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'production';

const screenshotsDir = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

require('../out/main/index.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simple base64 PNG checker texture used to populate the texture shelf without a folder dialog.
const CHECKER_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVQYV2NkYGD4z0AEYBxVSF+FAAhBAQBSl/CXAAAAAElFTkSuQmCC';

app.on('browser-window-created', (_, win) => {
  win.setSize(1440, 900);
  win.webContents.on('did-finish-load', async () => {
    try {
      console.log('Window loaded. Waiting for default model + app hooks...');
      await win.webContents.executeJavaScript(`
        (async () => {
          const start = Date.now();
          while ((!window.__app || !window.__viewportHandle) && Date.now() - start < 15000) {
            await new Promise(r => setTimeout(r, 100));
          }
        })()
      `);
      await delay(2000);

      // --- SCREENSHOT 1: Default viewport (test sphere, hero shot) ---
      console.log('Capturing 01-viewport-hero.png...');
      let img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '01-viewport-hero.png'), img.toPNG());

      // --- SCREENSHOT 2: Brush painting stroke ---
      console.log('Painting a brush stroke...');
      await win.webContents.executeJavaScript(`
        (() => {
          window.__app.setActiveTool('brush');
        })()
      `);
      await delay(300);
      await paintStroke(win, 0.35, 0.5, 0.62, 0.42);
      await delay(500);
      console.log('Capturing 02-brush-painting.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '02-brush-painting.png'), img.toPNG());

      // --- SCREENSHOT 3: Texture shelf + stamp tool ---
      console.log('Loading texture shelf and stamping...');
      await win.webContents.executeJavaScript(`
        (() => {
          window.__app.setTextures(['${CHECKER_TEXTURE}']);
        })()
      `);
      await delay(600);
      await win.webContents.executeJavaScript(`
        (() => {
          const card = document.querySelector('.shelf-card');
          if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          window.__app.setActiveTool('stamp');
        })()
      `);
      await delay(300);
      await paintStroke(win, 0.5, 0.5, 0.5, 0.5);
      await delay(500);
      console.log('Capturing 03-texture-stamp.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '03-texture-stamp.png'), img.toPNG());

      // --- SCREENSHOT 4: Layers panel (split view) ---
      console.log('Opening layers panel...');
      await win.webContents.executeJavaScript(`
        (() => {
          window.__app.setRightPanelTab('split');
        })()
      `);
      await delay(700);
      console.log('Capturing 04-layers-panel.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '04-layers-panel.png'), img.toPNG());

      // --- SCREENSHOT 5: Face selection / masking ---
      console.log('Selecting faces...');
      await win.webContents.executeJavaScript(`
        (() => {
          window.__app.setActiveTool('faceSelect');
          window.__viewportHandle.selectAllFaces();
        })()
      `);
      await delay(700);
      console.log('Capturing 05-face-masking.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '05-face-masking.png'), img.toPNG());
      await win.webContents.executeJavaScript(`
        (() => { window.__viewportHandle.invertFaceSelection(); window.__viewportHandle.invertFaceSelection(); })()
      `);

      // --- SCREENSHOT 6: Fill bucket ---
      console.log('Filling active layer...');
      await win.webContents.executeJavaScript(`
        (() => {
          window.__app.setActiveTool('fill');
          window.__viewportHandle.fillActive();
        })()
      `);
      await delay(700);
      console.log('Capturing 06-fill-bucket.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '06-fill-bucket.png'), img.toPNG());

      // --- SCREENSHOT 7: Lighting modes + wireframe ---
      console.log('Toggling flat lighting and wireframe...');
      await win.webContents.executeJavaScript(`
        (() => {
          const flatBtn = document.querySelector('.segmented-lighting-btn[title^="Flat lighting"]');
          if (flatBtn) flatBtn.click();
          window.__app.toggleWireframe();
        })()
      `);
      await delay(700);
      console.log('Capturing 07-wireframe-flat.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '07-wireframe-flat.png'), img.toPNG());
      await win.webContents.executeJavaScript(`
        (() => {
          const studioBtn = document.querySelector('.segmented-lighting-btn[title^="Studio lighting"]');
          if (studioBtn) studioBtn.click();
          window.__app.toggleWireframe();
        })()
      `);
      await delay(300);

      // --- SCREENSHOT 8: Help / shortcuts modal ---
      console.log('Opening shortcuts guide...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (document.activeElement) document.activeElement.blur();
          const btn = document.querySelector('.action-icon-btn[title*="Quick guide"]');
          if (btn) btn.click();
        })()
      `);
      await delay(700);
      console.log('Capturing 08-shortcuts-guide.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '08-shortcuts-guide.png'), img.toPNG());

      console.log('All 8 screenshots successfully captured!');
    } catch (err) {
      console.error('Error during capture:', err);
    } finally {
      app.quit();
    }
  });
});

async function paintStroke(win, x1, y1, x2, y2) {
  await win.webContents.executeJavaScript(`
    (() => {
      const canvas = document.querySelector('canvas.viewport-canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const p1 = { x: rect.left + rect.width * ${x1}, y: rect.top + rect.height * ${y1} };
      const p2 = { x: rect.left + rect.width * ${x2}, y: rect.top + rect.height * ${y2} };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: p1.x, clientY: p1.y, button: 0, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: (p1.x + p2.x) / 2, clientY: (p1.y + p2.y) / 2, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: p2.x, clientY: p2.y, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: p2.x, clientY: p2.y, button: 0, bubbles: true }));
    })()
  `);
}
