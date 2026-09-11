
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'production';

const screenshotsDir = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

require('../out/main/index.js');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.on('browser-window-created', (_, win) => {
  win.setSize(1440, 900);
  win.webContents.on('did-finish-load', async () => {
    try {
      console.log('Window loaded. Ensuring folder is loaded...');
      await win.webContents.executeJavaScript(`
        (async () => {
          const cur = await window.api.getCurrentFolder();
          if (!cur) {
            await window.api.openFolder('/media/stuyk/Side2/sounds');
          }
        })()
      `);

      // Wait for initial data load (facets, list, waveform)
      await delay(3500);

      // Select a sound that has an interesting waveform and category badge (#12 Cave Horn.wav at index 11)
      await win.webContents.executeJavaScript(`
        (() => {
          const rows = document.querySelectorAll('.sound-row');
          if (rows[11]) rows[11].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()
      `);
      await delay(1200);

      // --- SCREENSHOT 1: Library Browse ---
      console.log('Capturing 01-library-browse.png...');
      let img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '01-library-browse.png'), img.toPNG());

      // --- SCREENSHOT 2: Waveform Slicing ---
      console.log('Setting up waveform slice...');
      await win.webContents.executeJavaScript(`
        (() => {
          const canvas = document.querySelector('canvas');
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const startX = rect.left + rect.width * 0.28;
            const endX = rect.left + rect.width * 0.65;
            const y = rect.top + rect.height * 0.5;

            canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: y, bubbles: true }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: y, bubbles: true }));
            window.dispatchEvent(new MouseEvent('mouseup', { clientX: endX, clientY: y, bubbles: true }));
          }
        })()
      `);
      await delay(800);
      console.log('Capturing 02-waveform-slicing.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '02-waveform-slicing.png'), img.toPNG());

      // Clear slice
      await win.webContents.executeJavaScript(`
        (() => {
          const clearBtn = document.querySelector('button[title*="Clear selection"], .waveform-clear-btn');
          if (clearBtn) clearBtn.click();
        })()
      `);
      await delay(400);

      // --- SCREENSHOT 3: Instant Search ---
      console.log('Performing search for laser sounds...');
      await win.webContents.executeJavaScript(`
        (() => {
          const input = document.querySelector('.search-input');
          if (input) {
            input.focus();
            input.value = 'laser';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
      `);
      await delay(1200);
      // Select the first laser sound
      await win.webContents.executeJavaScript(`
        (() => {
          const rows = document.querySelectorAll('.sound-row');
          if (rows[0]) rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()
      `);
      await delay(1000);
      console.log('Capturing 03-instant-search.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '03-instant-search.png'), img.toPNG());

      // --- SCREENSHOT 5: Batch Exporter (with laser sounds) ---
      console.log('Selecting multiple sounds and opening batch export...');
      await win.webContents.executeJavaScript(`
        (() => {
          const rows = document.querySelectorAll('.sound-row');
          if (rows[0]) rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
          if (rows[4]) rows[4].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }));
        })()
      `);
      await delay(1000);
      console.log('Capturing 05-batch-exporter.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '05-batch-exporter.png'), img.toPNG());

      // Close export modal
      await win.webContents.executeJavaScript(`
        (() => {
          const closeBtn = document.querySelector('.modal-close-btn');
          if (closeBtn) closeBtn.click();
        })()
      `);
      await delay(500);

      // --- SCREENSHOT 4: Category Filter ---
      console.log('Clearing search and selecting Impacts category...');
      await win.webContents.executeJavaScript(`
        (() => {
          // Clear search
          const input = document.querySelector('.search-input');
          if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Click Impacts category header
          const headers = Array.from(document.querySelectorAll('.accordion-header'));
          const impactsHeader = headers.find(h => h.textContent.includes('Impacts'));
          if (impactsHeader) {
            impactsHeader.click();
            const item = impactsHeader.closest('.category-accordion-item');
            const chevron = item ? item.querySelector('.accordion-chevron-btn') : null;
            if (chevron && !chevron.classList.contains('expanded')) {
              chevron.click();
            }
          }
        })()
      `);
      await delay(1400);
      // Select first impact row
      await win.webContents.executeJavaScript(`
        (() => {
          const rows = document.querySelectorAll('.sound-row');
          if (rows[0]) rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()
      `);
      await delay(1000);
      console.log('Capturing 04-category-browsing.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '04-category-browsing.png'), img.toPNG());

      // --- SCREENSHOT 6: Shortcuts Guide ---
      console.log('Opening shortcuts guide...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (document.activeElement) document.activeElement.blur();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
        })()
      `);
      await delay(1000);
      console.log('Capturing 06-shortcuts-guide.png...');
      img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(screenshotsDir, '06-shortcuts-guide.png'), img.toPNG());

      console.log('All 6 updated screenshots successfully captured!');
    } catch (err) {
      console.error('Error during capture:', err);
    } finally {
      app.quit();
    }
  });
});
