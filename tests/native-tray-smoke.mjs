import assert from 'node:assert/strict';
import { copyFile, link, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// Optional native Windows smoke. It never runs the user's installed app,
// changes startup settings, registers protocols, or contacts the CRM backend.
if (process.platform !== 'win32') {
  console.log(JSON.stringify({ skipped: true, reason: 'Native Windows runtime required' }));
  process.exit(0);
}
const workspace = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const installed = process.env.GM_TEST_ELECTRON_RUNTIME || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'GM-CRM');
const sourceExecutable = path.join(installed, 'GM-CRM.exe');
try { await stat(sourceExecutable); } catch {
  console.log(JSON.stringify({ skipped: true, reason: 'Existing GM-CRM runtime unavailable; no software was installed' }));
  process.exit(0);
}
const fixtureRoot = path.join(workspace, 'work', `native-tray-smoke-${randomUUID()}`);
const runtime = path.join(fixtureRoot, 'runtime');
const appFolder = path.join(runtime, 'resources', 'app');
const artifacts = path.join(workspace, 'outputs', 'interface-qa');
await mkdir(appFolder, { recursive: true });
await mkdir(artifacts, { recursive: true });
await mkdir(path.join(fixtureRoot, 'user-data'), { recursive: true });
async function staticRuntimeEntry(source, destination) {
  const information = await stat(source);
  if (information.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) await staticRuntimeEntry(path.join(source, entry), path.join(destination, entry));
  } else {
    // The executable is copied. Other unmodified runtime files can safely
    // share bytes with the installation; this test never writes these links.
    try { await link(source, destination); } catch { await copyFile(source, destination); }
  }
}
for (const entry of await readdir(installed, { withFileTypes: true })) {
  if (entry.name === 'resources' || /^Uninstall /i.test(entry.name)) continue;
  const destination = path.join(runtime, entry.name);
  if (entry.name === 'GM-CRM.exe') await copyFile(sourceExecutable, destination);
  else await staticRuntimeEntry(path.join(installed, entry.name), destination);
}
await copyFile(path.join(workspace, 'public', 'gm-logo-512.png'), path.join(runtime, 'resources', 'gm-logo-512.png'));
await copyFile(path.join(workspace, 'desktop', 'background.cjs'), path.join(appFolder, 'background.cjs'));
await writeFile(path.join(appFolder, 'package.json'), JSON.stringify({ name: 'gm-manager-native-tray-qa', version: '0.0.0', main: 'harness.cjs' }));
const resultPath = path.join(artifacts, 'native-tray-smoke.json');
const screenshotPath = path.join(artifacts, 'native-tray-window.png');
const holdMilliseconds = Math.min(30000, Math.max(1000, Number(process.env.GM_TEST_NATIVE_HOLD_MS) || 1000));
const harness = `
const { app, BrowserWindow, Tray, Menu, nativeImage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBackgroundController } = require('./background.cjs');
const resultPath = ${JSON.stringify(resultPath)};
const screenshotPath = ${JSON.stringify(screenshotPath)};
app.setPath('userData', ${JSON.stringify(path.join(fixtureRoot, 'user-data'))});
app.setName('GM Manager Native Tray QA');
let window, tray, menu, controller, passed = false;
let startupWrites = 0;
let networkRequests = 0;
const fail = error => { fs.writeFileSync(resultPath, JSON.stringify({ passed:false,error:String(error.stack||error),startupWrites })); app.exit(2); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const deadline = setTimeout(() => fail(new Error('Native smoke deadline exceeded')), 45000);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{networkRequests++;callback({cancel:true});});
  const qaApp = {
    isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin:false,executableWillLaunchAtLogin:false }),
    setLoginItemSettings: () => { startupWrites++; throw new Error('Real startup writes forbidden in native smoke'); },
    quit: () => app.quit(),
  };
  const createWindow = () => {
    window = new BrowserWindow({width:720,height:420,show:false,title:'GM Manager · Kiểm tra khay hệ thống',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    controller.attachWindow(window);
    window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<meta charset="utf-8"><style>body{font-family:Segoe UI,sans-serif;background:#f5f7fb;color:#26334b;padding:44px}h1{color:#a32438}</style><h1>GM Manager</h1><h2>Kiểm tra khay hệ thống Windows</h2><p>Cửa sổ đã ẩn khi đóng và mở lại bằng biểu tượng khay.</p><p>Dữ liệu kiểm thử cục bộ. Không kết nối dữ liệu thật.</p>'));
    return window;
  };
  controller = createBackgroundController({
    app:qaApp,
    Tray:function(icon){tray=new Tray(icon);return tray;},
    Menu:{buildFromTemplate:template=>{menu=Menu.buildFromTemplate(template);return menu;}},
    nativeImage,platform:'win32',execPath:process.execPath,argv:[],
    iconPath:path.join(process.resourcesPath,'gm-logo-512.png'),getWindow:()=>window,createWindow,
  });
  assert.equal(controller.createTray(),true);
  assert.equal(tray.isDestroyed(),false);
  assert.ok(menu.items.some(item=>item.label==='Thoát GM Manager'));
  createWindow();
  await new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
  window.show();
  window.close();
  assert.equal(window.isDestroyed(),false);
  assert.equal(window.isVisible(),false);
  tray.emit('click');
  assert.equal(window.isVisible(),true);
  assert.equal(startupWrites,0);
  let screenshotError='';
  try {const image=await window.webContents.capturePage();fs.writeFileSync(screenshotPath,image.toPNG());} catch(error) {screenshotError=String(error.message||error);}
  assert.equal(networkRequests,0);
  const result={passed:true,nativeTrayCreated:true,nativeMenuCreated:true,closeHidesWindow:true,trayClickReopensWindow:true,startupWrites:0,networkRequests,trayBounds:tray.getBounds(),quitSelected:false,screenshotError};
  fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
  console.log(JSON.stringify({nativeProofReady:true,title:'GM Manager · Kiểm tra khay hệ thống'}));
  // Briefly retain this isolated native window so root can inspect it if needed.
  setTimeout(()=>{
    const quitItem=menu.items.find(item=>item.label==='Thoát GM Manager');
    result.quitSelected=true;
    passed=true;
    fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
    quitItem.click(quitItem,window);
  },${holdMilliseconds});
});
app.on('before-quit',()=>controller?.beginQuit());
app.on('will-quit',()=>{
  clearTimeout(deadline);
  controller?.dispose();
  if(passed){const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));result.explicitQuitCompleted=true;result.nativeTrayDestroyed=tray.isDestroyed();fs.writeFileSync(resultPath,JSON.stringify(result,null,2));}
});
`;
await writeFile(path.join(appFolder, 'harness.cjs'), harness);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(path.join(runtime, 'GM-CRM.exe'), [], { cwd: runtime, windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  let stderr = '';
  child.stdout.on('data', chunk => { process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.equal(result.passed, true, result.error);
  assert.equal(outcome.code, 0, stderr.slice(-2000));
  assert.equal(result.explicitQuitCompleted, true);
  assert.equal(result.nativeTrayDestroyed, true);
  assert.equal(result.startupWrites, 0);
  console.log(JSON.stringify({ ...result, existingApplicationChanged:false, screenshot:result.screenshotError ? null : screenshotPath }));
} finally {
  const resolved = path.resolve(fixtureRoot);
  const expectedParent = path.resolve(workspace, 'work');
  assert.equal(path.dirname(resolved), expectedParent);
  assert.ok(path.basename(resolved).startsWith('native-tray-smoke-'));
  await rm(resolved, { recursive:true,force:true,maxRetries:5,retryDelay:500 });
}
