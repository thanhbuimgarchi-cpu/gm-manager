import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
// All Google Apps Script requests below are intercepted with synthetic data.
// Run against a local preview; no customer, Drive, or Pancake data is changed.
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
await mkdir('outputs/interface-qa', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? {executablePath:process.env.GM_TEST_BROWSER_PATH} : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-10-28T02:00:00Z'));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const permissions = ['Ghi chú', 'Tư vấn', 'Thiết kế', 'Dự toán', 'Thi công', 'Nghiệm thu', 'Bảo hành', 'Tài liệu', '3D'];
const personnel = { office: [{id:'p1',status:'Có',name:'Nguyễn Minh Anh',email:'anh@example.com',loginCode:'00123',birthDate:'20/09/1995',phone:'0912345678',role:'Nhân viên thiết kế',permissions,address:'Hà Nội'}] };
const records = [
  {id:'c1',name:'Chị Quỳnh',houseId:'DV-75',projectId:'GM28102026CQ',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Nguyễn Thị Quỳnh',SDT:'0912345678','NCT-KT':'Có','NCT-NT':'Có'},designProgress:[{id:'d1',isCustom:false,content:'Triển khai hồ sơ kiến trúc',plannedDate:'10/11/2026',actualDate:'',assignee:'Nguyễn Minh Anh',assigneeEmail:'anh@example.com',note:'Kiểm tra phương án mặt bằng',publishedAt:'2026-10-28T00:00:00Z'}]},
  {id:'c2',name:'Anh Minh',houseId:'NT5-38',projectId:'GM28102026AM',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Trần Văn Minh',SDT:'0987654321'}},
];
const years = [{year:2026,months:Array.from({length:12},(_,i)=>({label:`T${i+1}`,records:i===9?records:[]}))}];
const notes = [{id:'n1',priority:'Cần lập tức',workType:'Thiết kế',assignee:'Nguyễn Minh Anh',assigneeEmail:'anh@example.com',creatorEmail:'admin',content:'Hoàn thiện phương án mặt bằng tầng 1.\nBổ sung bố trí nội thất phòng khách theo ý kiến khách hàng.',dueDate:'05/11/2026',actualDate:'',status:'Đen',acceptedAt:'',acceptedBy:''}];
const messages = [{id:'m1',projectId:records[0].projectId,houseId:'DV-75',customerName:'Chị Quỳnh',groupName:'DV-75-GM-Thiết kế',status:'new',firstMessageAt:'2026-10-28T02:00:00Z',lastMessageAt:'2026-10-28T02:30:00Z',messageCount:2,messages:[{id:'ml1',senderName:'Chị Quỳnh',content:'Nhờ bên mình kiểm tra lại phương án mặt bằng phòng khách.',sentAt:'2026-10-28T02:00:00Z'},{id:'ml2',senderName:'Chị Quỳnh',content:'Mình muốn thêm một cửa sổ ở phía sân vườn nhé.',sentAt:'2026-10-28T02:30:00Z'}]}];
await context.addInitScript(({years,personnel,notes}) => {
  if (localStorage.getItem('qa-seeded')) return;
  localStorage.setItem('qa-seeded','1');
  localStorage.setItem('gm-manager-consulting',JSON.stringify(years));
  localStorage.setItem('gm-manager-personnel-v1',JSON.stringify(personnel));
  localStorage.setItem('gm-manager-personnel-session-email','admin');
  localStorage.setItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-GM28102026CQ',JSON.stringify({savedAt:Date.now(),value:notes}));
}, {years,personnel,notes});
await context.route('https://script.google.com/**', route => route.fulfill({ contentType:'text/html; charset=utf-8', body:`<meta charset="utf-8"><script>
const years=${JSON.stringify(years)}, personnel=${JSON.stringify(personnel)}, notes=${JSON.stringify(notes)}, messages=${JSON.stringify(messages)};
addEventListener('message',event=>{if(event.data?.channel!=='gm-manager-apps-script')return; const {id,payload:p}=event.data; let r={ok:true};
if(p.action==='load-consulting'||p.action==='load-workspace-cache')r.years=years;
if(p.action==='load-personnel')r.personnel=personnel;
if(p.action==='load-work-notes')r.notes=p.projectId==='GM28102026CQ'?notes:[];
if(p.action==='sync-work-notes'){notes.splice(0,notes.length,...p.notes);r.notes=notes;}
if(p.action==='load-assigned-work-notes')r.notes=notes.map(n=>({...n,year:2026,month:10,projectId:'GM28102026CQ',houseId:'DV-75'}));
if(p.action==='load-assigned-design-tasks')r.tasks=[];
if(p.action==='load-customer-messages'){r.messages=messages;r.configured=true;}
if(p.action==='list-documents'){r.snapshots=[{id:'s1',name:'28-10-2026-DV-75',date:'28/10/2026'}];r.activeSnapshotId='s1';r.files=[{id:'f1',name:'Phương án kiến trúc.pdf',updatedAt:'28/10/2026 09:30',work:'Thiết kế',mimeType:'application/pdf',viewUrl:'https://drive.google.com/file/d/test/view',downloadUrl:'https://drive.google.com/file/d/test/view'}];}
if(p.action==='list-3d-library')r.folders=[];
event.source.postMessage({channel:'gm-manager-apps-script-response',id,result:r},'*');});parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>` }));
await page.goto(process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/');
await page.getByRole('heading',{name:'Tổng quan dự án'}).waitFor();
await page.locator('.customer-result').first().waitFor();
const groupedNotes=page.getByLabel('Tổng hợp ghi chú chưa hoàn thành').first().locator('.sidebar-customer-group__trigger').first();
assert.equal(await groupedNotes.getAttribute('aria-expanded'),'false');
await groupedNotes.click();
assert.equal(await groupedNotes.getAttribute('aria-expanded'),'true');
assert.ok(await page.getByLabel('Tổng hợp ghi chú chưa hoàn thành').first().locator('.sidebar-customer-group__items').first().isVisible());
await page.screenshot({path:'outputs/interface-qa/desktop-overview.png',fullPage:true});
const overflow = () => page.evaluate(()=>({body:document.documentElement.scrollWidth,width:innerWidth}));
assert.ok((await overflow()).body<=1440,'desktop overflow');
await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).click();
await page.getByRole('dialog',{name:'Thêm khách hàng'}).waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.getByRole('dialog').count(),0,'Escape closes dialog');
await page.getByRole('button',{name:'Thu gọn Tin nhắn khách'}).click();
assert.ok(await page.getByLabel('Tổng hợp ghi chú chưa hoàn thành').first().locator('.sidebar-notes__list').isVisible(),'message fold leaves notes open');
await page.getByRole('button',{name:'Mở danh sách Tin nhắn khách'}).click();
await page.locator('.customer-result').filter({hasText:'DV-75'}).click();
await page.locator('.record-detail--inline').waitFor();
await page.screenshot({path:'outputs/interface-qa/desktop-consulting.png',fullPage:true});
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.locator('.work-note').first().waitFor();
await page.locator('.work-notes__actions button').click();
const composer = page.getByLabel('Ghi chú mới',{exact:true});
assert.ok(await composer.getByRole('button',{name:'Phát hành',exact:true}).isDisabled(),'requires assignee and date');
await composer.getByLabel('Người phụ trách',{exact:true}).selectOption('anh@example.com');
assert.ok(await composer.getByRole('button',{name:'Phát hành',exact:true}).isDisabled(),'requires due date');
await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).fill('30102026');
assert.equal(await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).inputValue(),'30/10/2026');
assert.ok(await composer.getByRole('button',{name:'Phát hành',exact:true}).isEnabled(),'ready after required fields');
await composer.getByRole('button',{name:'Hủy',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-notes.png',fullPage:true});
await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
await page.locator('.design-schedule').first().waitFor();
await page.screenshot({path:'outputs/interface-qa/desktop-design.png',fullPage:true});
await page.getByRole('button',{name:'Tài liệu',exact:true}).click();
await page.locator('.document-library').waitFor();
await page.screenshot({path:'outputs/interface-qa/desktop-documents.png',fullPage:true});
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
await page.locator('.customer-message-summary .sidebar-notes__toggle').click();
await page.locator('.customer-message__body').waitFor();
assert.ok((await page.locator('.customer-message__body').innerText()).includes('kiểm tra lại phương án'));
await page.getByRole('button',{name:'Đang xử lý',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-messages.png',fullPage:true});
await page.getByRole('button',{name:'Giao việc',exact:true}).click();
await page.locator('.message-task-dialog').waitFor();
await page.screenshot({path:'outputs/interface-qa/desktop-assignment.png',fullPage:true});
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
await page.getByRole('button',{name:/Nhân lực.*Thông tin/}).click();
await page.getByRole('button',{name:'Nhân viên văn phòng',exact:true}).click();
await page.getByRole('button',{name:'Thêm nhân lực',exact:true}).click();
await page.locator('.personnel-add-form').waitFor();
await page.locator('.personnel-add-form').getByRole('button',{name:'Hủy',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-personnel.png',fullPage:true});
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'outputs/interface-qa/mobile-overview.png',fullPage:true});
const mobile = await overflow(); assert.ok(mobile.body<=390,JSON.stringify(mobile));
await page.locator('.customer-result').first().click();
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/mobile-notes.png',fullPage:true});
const projectMobile = await overflow(); assert.ok(projectMobile.body<=390,JSON.stringify(projectMobile));
for (const width of [360,768,1366]) {
  await page.setViewportSize({width,height:900});
  for(const folder of ['Tư vấn','Thiết kế','Tài liệu']) {
    await page.getByRole('button',{name:folder,exact:true}).click();
    const dimensions = await overflow();
    if(dimensions.body>width){await page.screenshot({path:`outputs/interface-qa/overflow-${width}.png`,fullPage:true});console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+1).slice(0,20)));}
    assert.ok(dimensions.body<=width,`${folder} at ${width}: ${JSON.stringify(dimensions)}`);
  }
}
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
for(const houseCode of ['QA-101','QA-102','QA-102']) {
  await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Thêm khách hàng'});
  await dialog.getByLabel('Tên khách hàng').fill('Nguyễn Văn An');
  await dialog.getByLabel('Mã nhà').fill(houseCode);
  await dialog.getByRole('button',{name:'Tạo thư mục',exact:true}).click();
  await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
}
const created=await page.evaluate(()=>JSON.parse(localStorage.getItem('gm-manager-consulting')).flatMap(y=>y.months.flatMap(m=>m.records)).filter(r=>r.houseId?.startsWith('QA-')));
assert.equal(created.length,2,'repeat submit reuses the same house');
assert.equal(new Set(created.map(r=>r.projectId)).size,2,'same-day same-initial customers retain independent projects');
await page.evaluate(() => {
  window.qaRootChosen=false; window.qaNotificationCalls=0;
  window.gmDesktop={isDesktop:true,isWindows:true,platform:'win32',
    selectWorkspaceFolder:async()=>{window.qaRootChosen=true;return {ok:true,path:'I:\\Shared drives\\GM Manager\\GM Manager'};},
    validateWorkspaceFolder:async()=>({ok:window.qaRootChosen,path:window.qaRootChosen?'I:\\Shared drives\\GM Manager\\GM Manager':'',error:'Chọn thư mục GM Manager hợp lệ.'}),
    showNotification:async()=>{window.qaNotificationCalls++;return true;},
    openDocumentFolder:async payload=>{window.qaOpenedFolder=payload;return '';},
  };
});
await page.getByRole('button',{name:/Đổi tài khoản/}).click();
const login=page.getByRole('dialog',{name:'Đăng nhập',exact:true});
assert.equal(await login.getByRole('button',{name:'Tạo tài khoản',exact:true}).count(),0,'no self registration');
await login.getByLabel('Tên nhân viên',{exact:true}).fill('Nguyễn Minh Anh');
await login.getByLabel('Mã đăng nhập',{exact:true}).fill('00123');
await login.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await login.getByRole('alert').waitFor();
assert.ok((await login.getByRole('alert').innerText()).includes('thư mục'),'PC rejects missing workspace folder');
await login.getByRole('button',{name:'Chọn thư mục',exact:true}).click();
await login.getByLabel('Mã đăng nhập',{exact:true}).fill('wrong-code');
await login.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('.login-dialog [role=alert]')?.textContent.includes('mã đăng nhập'));
await login.getByLabel('Mã đăng nhập',{exact:true}).fill('00123');
await page.screenshot({path:'outputs/interface-qa/desktop-login.png',fullPage:true});
await login.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('.login-dialog'));
assert.equal(await page.evaluate(()=>localStorage.getItem('gm-manager-personnel-session-email')),'anh@example.com');
const notificationCalls=await page.evaluate(()=>window.qaNotificationCalls);
await page.getByRole('button',{name:/Bật thông báo|Thông báo đã bật/}).click();
await page.getByRole('button',{name:/Thông báo đã bật/}).waitFor();
assert.equal(await page.evaluate(()=>window.qaNotificationCalls),notificationCalls+1);
assert.equal(await page.evaluate(()=>localStorage.getItem('gm-manager-notifications-enabled-v1')),'enabled');
await page.evaluate(()=>localStorage.setItem('gm-manager-personnel-session-email','anh@example.com'));
await page.reload();
await page.locator('.overview-metrics').waitFor();
await page.locator('.customer-message-summary .sidebar-notes__toggle').click();
await page.locator('.customer-message__body').waitFor();
assert.ok(await page.getByRole('button',{name:'Giao việc',exact:true}).isDisabled(),'employee reads messages without assigning');
const cdp=await context.newCDPSession(page);
await cdp.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
await page.reload();
await page.getByRole('button',{name:/Đổi tài khoản/}).click();
const mobileLogin=page.getByRole('dialog',{name:'Đăng nhập',exact:true});
assert.equal(await mobileLogin.getByLabel('Vị trí GM Manager',{exact:true}).count(),0,'phone login has no drive selector');
await mobileLogin.getByLabel('Tên nhân viên',{exact:true}).fill('Nguyễn Minh Anh');
await mobileLogin.getByLabel('Mã đăng nhập',{exact:true}).fill('00123');
await mobileLogin.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('.login-dialog'));
assert.deepEqual(errors,[],'no browser runtime errors');
console.log(JSON.stringify({passed:true,errors,mobile,projectMobile,screenshots:'outputs/interface-qa'}));
await browser.close();
