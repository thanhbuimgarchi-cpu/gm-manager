import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
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
const fixtureScriptUrl = (await readFile(new URL('../app/page.tsx',import.meta.url),'utf8')).match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const adminSessionClaims = {version:1,account:'admin',purpose:'customer-admin',expiresAt:Date.parse('2026-11-28T02:00:00Z')};
const fixtureAdminToken = claims => `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture-signature`;
const adminSessionToken = fixtureAdminToken(adminSessionClaims);
const fixtureWorkflowToken = account => fixtureAdminToken({version:2,purpose:'workflow',account,expiresAt:Date.parse('2026-11-28T02:00:00Z'),nonce:`qa-${account}`});
const workflowTokens = Object.fromEntries(['admin','anh@example.com','manager@example.com'].map(account=>[account,fixtureWorkflowToken(account)]));
const personnel = { office: [{id:'p1',status:'Có',name:'Nguyễn Minh Anh',email:'anh@example.com',loginCode:'00123',birthDate:'20/09/1995',phone:'0912345678',role:'Nhân viên thiết kế',permissions,address:'Hà Nội'},{id:'p2',status:'Có',name:'Quản lý kiểm thử',email:'manager@example.com',loginCode:'manager-code',birthDate:'',phone:'',role:'Quản lý chung',permissions,address:''}] };
const records = [
  {id:'c1',name:'Chị Quỳnh',houseId:'DV-75',projectId:'GM28102026CQ',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Nguyễn Thị Quỳnh',SDT:'0912345678','NCT-KT':'Có','NCT-NT':'Có',ZALO_GROUP_NAME:'Nhóm Zalo DV-75'},designProgress:[{id:'d1',isCustom:false,content:'Triển khai hồ sơ kiến trúc',plannedDate:'10/11/2026',actualDate:'',assignee:'Nguyễn Minh Anh',assigneeEmail:'anh@example.com',note:'Kiểm tra phương án mặt bằng',publishedAt:'2026-10-28T00:00:00Z'}]},
  {id:'c2',name:'Anh Minh',houseId:'NT5-38',projectId:'GM28102026AM',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Trần Văn Minh',SDT:'0987654321'}},
];
const years = [{year:2026,months:Array.from({length:12},(_,i)=>({label:`T${i+1}`,records:i===9?records:[]}))}];
const notes = [{id:'n1',priority:'Cần lập tức',workType:'Thiết kế',assignee:'Nguyễn Minh Anh',assigneeEmail:'anh@example.com',creatorEmail:'admin',content:'Hoàn thiện phương án mặt bằng tầng 1.\nBổ sung bố trí nội thất phòng khách theo ý kiến khách hàng.',dueDate:'05/11/2026',actualDate:'',status:'Đen',acceptedAt:'',acceptedBy:''}];
const messages = [{id:'m1',year:2026,month:10,projectId:records[0].projectId,houseId:'DV-75',customerName:'Chị Quỳnh',groupName:'DV-75-GM-Thiết kế',status:'new',firstMessageAt:'2026-10-28T02:00:00Z',lastMessageAt:'2026-10-28T02:30:00Z',messageCount:2,messages:[{id:'ml1',senderName:'Chị Quỳnh',content:'Nhờ bên mình kiểm tra lại phương án mặt bằng phòng khách.',sentAt:'2026-10-28T02:00:00Z'},{id:'ml2',senderName:'Chị Quỳnh',content:'Mình muốn thêm một cửa sổ ở phía sân vườn nhé.',sentAt:'2026-10-28T02:30:00Z'}]}];
messages.push({id:'unlinked',year:2026,month:10,projectId:'',houseId:'',groupName:'Nhóm thử không có hồ sơ',status:'new',firstMessageAt:messages[0].firstMessageAt,lastMessageAt:messages[0].lastMessageAt,messageCount:1,messages:[{id:'unlinked-line',senderName:'Khách thử',content:'Tin nhắn độc lập.',sentAt:messages[0].lastMessageAt}]});
async function openMessage(groupName = 'DV-75-GM-Thiết kế') {
  const summary = page.locator('.customer-message-summary');
  const toggle = summary.locator('.sidebar-notes__toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const group = summary.locator('.sidebar-customer-group').filter({has:page.locator('.sidebar-note').filter({hasText:groupName})});
  const trigger = group.locator('.sidebar-customer-group__trigger');
  if (await trigger.getAttribute('aria-expanded') === 'false') await trigger.click();
  await group.locator('.sidebar-note').filter({hasText:groupName}).click();
  await page.locator('.customer-message__body').waitFor();
}
await context.addInitScript(({years,personnel,notes,fixtureScriptUrl,adminSessionToken,workflowToken}) => {
  if (localStorage.getItem('qa-seeded')) return;
  localStorage.setItem('qa-seeded','1');
  localStorage.setItem('gm-manager-consulting',JSON.stringify(years));
  localStorage.setItem('gm-manager-personnel-v1',JSON.stringify(personnel));
  localStorage.setItem('gm-manager-personnel-session-email','admin');
  localStorage.setItem('gm-manager-admin-session-v1',JSON.stringify({token:adminSessionToken,scriptUrl:fixtureScriptUrl}));
  localStorage.setItem('gm-manager-workflow-session-v1',JSON.stringify({token:workflowToken,scriptUrl:fixtureScriptUrl,account:'admin'}));
  localStorage.setItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-GM28102026CQ',JSON.stringify({savedAt:Date.now(),value:notes}));
}, {years,personnel,notes,fixtureScriptUrl,adminSessionToken,workflowToken:workflowTokens.admin});
await context.route('https://script.google.com/**', route => route.fulfill({ contentType:'text/html; charset=utf-8', body:`<meta charset="utf-8"><script>
const years=${JSON.stringify(years)}, personnel=${JSON.stringify(personnel)}, notes=${JSON.stringify(notes)}, messages=${JSON.stringify(messages)}, workflowTokens=${JSON.stringify(workflowTokens)};
window.qaMutationFail=false;window.qaMutationLog=[];window.qaAdminLoginCalls=[];window.qaCreateLog=[];window.qaMessageTargets=[];
addEventListener('message',event=>{if(event.data?.channel!=='gm-manager-apps-script')return; const {id,payload:p}=event.data; let r={ok:true};
if(p.action==='verify-employee-login'){
  window.qaAdminLoginCalls.push(p);
  const member=Object.values(personnel).flat().find(member=>member.name.toLocaleLowerCase('vi')===String(p.name||'').trim().toLocaleLowerCase('vi')&&member.loginCode===p.loginCode);
  r=p.name==='admin'&&p.loginCode==='1'?{ok:true,valid:true,account:'admin',adminSessionToken:${JSON.stringify(adminSessionToken)},workflowSessionToken:workflowTokens.admin}:member?{ok:true,valid:true,account:member.email,member,workflowSessionToken:workflowTokens[member.email]}:{ok:true,valid:false,error:'Tên nhân viên hoặc mã đăng nhập không đúng.'};
}
if(p.action==='workflow-command'){
  if(!Object.values(workflowTokens).includes(p.workflowSessionToken)&&p.adminSessionToken!==${JSON.stringify(adminSessionToken)})r={ok:false,error:'Phiên đăng nhập không hợp lệ.'};
  else if(p.operation==='message.status'){
    const message=messages.find(message=>message.id===(p.messageId||p.message?.id));
    if(message){Object.assign(message,{status:p.status,revision:(message.revision||0)+1});r={ok:true,message,revision:message.revision,archivePending:false};}
    else r={ok:false,error:'Không tìm thấy tin nhắn.'};
  }
}
if(p.action==='create-customer-folder'){
  window.qaCreateLog.push(p);
  r=p.adminSessionToken===${JSON.stringify(adminSessionToken)}?{ok:true,folderId:'fixture-created-folder'}:{ok:false,error:'Chỉ admin mới được tạo hoặc xóa khách hàng.'};
}
if(p.action==='rename-customer-folder'||p.action==='delete-customer-folder'){
  window.qaMutationLog.push(p);
  if(p.action==='delete-customer-folder'&&p.adminSessionToken!==${JSON.stringify(adminSessionToken)})r={ok:false,error:'Chỉ admin mới được tạo hoặc xóa khách hàng.'};
  else if(window.qaMutationFail)r={ok:false,error:'Drive từ chối thao tác kiểm thử'};
  else{
    const month=years.find(y=>y.year===p.year)?.months[p.month-1];const index=month?.records.findIndex(record=>record.projectId===p.projectId);
    if(index===undefined||index<0)r={ok:false,error:'Không tìm thấy thư mục'};
    else if(p.action==='delete-customer-folder'){month.records.splice(index,1);r={ok:true,deleted:true,trashed:true,folderId:'fixture-folder'};}
    else{Object.assign(month.records[index],{houseId:p.houseId,name:p.name});r={ok:true,folderId:'fixture-folder',folderName:p.houseId};}
  }
}
if(p.action==='load-consulting'||p.action==='load-workspace-cache')r.years=years;
if(p.action==='load-personnel')r.personnel=personnel;
if(p.action==='load-work-notes')r.notes=p.projectId==='GM28102026CQ'?notes:[];
if(p.action==='sync-work-notes'){notes.splice(0,notes.length,...p.notes);r.notes=notes;}
if(p.action==='load-assigned-work-notes')r.notes=notes.map(n=>({...n,year:2026,month:10,projectId:'GM28102026CQ',houseId:'DV-75'}));
if(p.action==='load-assigned-design-tasks')r.tasks=[];
if(p.action==='load-customer-messages'){window.qaMessageTargets=p.customerTargets;r.messages=messages;r.configured=true;}
if(p.action==='list-documents'){r.snapshots=[{id:'s1',name:'28-10-2026-DV-75',date:'28/10/2026'}];r.activeSnapshotId='s1';r.files=[{id:'f1',name:'Phương án kiến trúc.pdf',updatedAt:'28/10/2026 09:30',work:'Thiết kế',mimeType:'application/pdf',viewUrl:'https://drive.google.com/file/d/test/view',downloadUrl:'https://drive.google.com/file/d/test/view'}];}
if(p.action==='list-3d-library')r.folders=[];
setTimeout(()=>event.source.postMessage({channel:'gm-manager-apps-script-response',id,result:r},'*'),p.action==='rename-customer-folder'||p.action==='delete-customer-folder'?250:0);});parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>` }));
const workspaceHeader = page.locator('header.workspace-header');
const overviewBack = page.getByRole('button', { name: '← Tổng quan', exact: true });
const accountAction = () => workspaceHeader.getByRole('button', { name: /Đăng nhập|Đổi tài khoản/ });
const notificationAction = () => workspaceHeader.getByRole('button', { name: /Bật thông báo|Thông báo đã bật/i });
const settingsAction = page.getByRole('button', { name: /Thiết lập$/ });
const openPersonnel = () => page.getByRole('button', { name: 'Nhân lực', exact: true }).click();

async function backButtonPosition(width) {
  await overviewBack.waitFor();
  assert.equal(await workspaceHeader.getByRole('button', { name: '← Tổng quan', exact: true }).count(), 1);
  const logo = await workspaceHeader.getByRole('img', { name: 'GM', exact: true }).boundingBox();
  const back = await overviewBack.boundingBox();
  assert.ok(logo && back, 'logo and Tổng quan are visible in the shared header');
  if (width <= 390) {
    assert.ok(back.x >= logo.x + logo.width, 'Tổng quan sits alongside the logo');
    assert.ok(Math.abs(back.y + back.height / 2 - logo.y - logo.height / 2) <= 2, 'Tổng quan and the logo share the same row');
    assert.ok(back.height >= 44, 'Tổng quan remains easy to tap');
  }
  return back;
}

function assertSameBackPosition(project, personnel) {
  for (const coordinate of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(project[coordinate] - personnel[coordinate]) <= 2, `Tổng quan has the same ${coordinate} in both workspaces`);
  }
}

async function assertProjectHeaderName(expected, width) {
  const title = workspaceHeader.locator('.workspace-header__project strong');
  await title.waitFor();
  assert.equal(await title.innerText(), expected, 'the open profile is named in the workspace header');
  assert.equal(await settingsAction.count(), 0, 'settings stay on the overview');
  const [logo, name] = await Promise.all([
    workspaceHeader.locator('.brand--with-logo').boundingBox(),
    title.boundingBox(),
  ]);
  assert.ok(logo && name, 'the logo and profile name are both visible');
  if (width <= 390) {
    const gap = name.y - logo.y - logo.height;
    assert.ok(gap >= 0 && gap <= 26, 'the profile name is directly below the logo');
    assert.ok(Math.abs(name.x - logo.x) <= 2, 'the profile name is aligned under the logo');
  } else {
    assert.ok(name.x >= logo.x + logo.width, 'the profile name is to the right of the logo');
    assert.ok(Math.abs(name.y + name.height / 2 - logo.y - logo.height / 2) <= 2, 'the profile name shares the logo row');
  }
}

async function assertRestrictedCustomerActions(accountLabel) {
  const manager = accountLabel === 'manager';
  await page.locator('.overview-metrics').waitFor();
  assert.equal(await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Thiết lập/}).count(),0);
  const row=page.locator('.customer-result-row').filter({hasText:'DV-75'});
  const menu=row.getByRole('button',{name:/Tùy chọn khách hàng/});
  if(manager){await menu.click();assert.equal(await page.getByRole('menuitem',{name:'Delete',exact:true}).count(),0);assert.ok(await page.getByRole('menuitem',{name:'Rename',exact:true}).isVisible());await menu.click();}
  else assert.ok(await menu.isDisabled(),accountLabel+': customer identity is read only');
  await row.locator('.customer-result').click();
  const consulting=page.locator('.record-detail--inline');await consulting.waitFor();
  assert.equal(await accountAction().count(),0,accountLabel+': account controls are on the overview');
  assert.equal(await notificationAction().count(),0,accountLabel+': notification controls are on the overview');
  if(manager){const projectMenu=consulting.locator('.more-button');await projectMenu.click();assert.equal(await page.getByRole('button',{name:'Xóa hồ sơ',exact:true}).count(),0);assert.ok(await page.getByRole('button',{name:'Sửa thông tin',exact:true}).isVisible());await projectMenu.click();}
  else {assert.ok(await consulting.getByLabel('Tên khách hàng',{exact:true}).isDisabled());assert.equal(await consulting.getByRole('button',{name:'Export Excel'}).count(),0);assert.ok(await consulting.getByText('Chỉ xem · Quản lý cập nhật thông tin tư vấn',{exact:true}).isVisible());}
  await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
  await page.getByLabel('Tìm khách hàng',{exact:true}).fill('no-such-test-house');await page.locator('.customer-search-empty').waitFor();
  assert.equal(await page.getByRole('button',{name:'Tạo khách hàng mới',exact:true}).count(),0);await page.getByLabel('Tìm khách hàng',{exact:true}).fill('');
}
await page.goto(process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/');
await page.getByRole('heading',{name:'Tổng quan dự án'}).waitFor();
await page.locator('.customer-result').first().waitFor();
assert.ok(await settingsAction.isVisible(),'admin can open settings from the overview');
assert.ok(await accountAction().isVisible(),'account switching stays available on the overview');
assert.ok(await notificationAction().isVisible(),'notifications can still be enabled on the overview');
const groupedNotes=page.getByLabel('Tổng hợp ghi chú').first().locator('.sidebar-customer-group__trigger').first();
assert.equal(await groupedNotes.getAttribute('aria-expanded'),'false');
await groupedNotes.click();
assert.equal(await groupedNotes.getAttribute('aria-expanded'),'true');
assert.ok(await page.getByLabel('Tổng hợp ghi chú').first().locator('.sidebar-customer-group__items').first().isVisible());
await page.screenshot({path:'outputs/interface-qa/desktop-overview.png',fullPage:true});
const overflow = () => page.evaluate(()=>({body:document.documentElement.scrollWidth,width:innerWidth}));
const customerRowHeight = () => page.locator('.customer-result-row').first().evaluate(row => row.getBoundingClientRect().height);
assert.ok((await overflow()).body<=1440,'desktop overflow');
const desktopCustomerRowHeight = await customerRowHeight();
assert.ok(desktopCustomerRowHeight <= 64,`desktop customer rows are compact (${desktopCustomerRowHeight}px)`);
await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).click();
await page.getByRole('dialog',{name:'Thêm khách hàng'}).waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.getByRole('dialog').count(),0,'Escape closes dialog');
const bridgeFrame=page.frames().find(frame=>frame.url().startsWith('https://script.google.com/'));
const quynhRow=page.locator('.customer-result-row').filter({hasText:'DV-75'});
await quynhRow.getByRole('button',{name:/Tùy chọn khách hàng/}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-customer-menu.png',fullPage:true});
assert.ok(await page.getByRole('heading',{name:'Tổng quan dự án'}).isVisible(),'row menu must not open project');
await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
const renameDialog=page.getByRole('dialog',{name:'Rename thư mục Drive',exact:true});
await renameDialog.getByLabel('Tên thư mục Drive / Mã nhà',{exact:true}).fill('DV-76');
await bridgeFrame.evaluate(()=>window.qaMutationFail=true);
await renameDialog.getByRole('button',{name:'Rename trên Drive',exact:true}).click();
await renameDialog.getByRole('alert').waitFor();
assert.equal(await quynhRow.count(),1,'failed Drive rename keeps the old card');
assert.equal(await page.locator('.customer-result-row').filter({hasText:'DV-76'}).count(),0);
await bridgeFrame.evaluate(()=>window.qaMutationFail=false);
await renameDialog.getByRole('button',{name:'Rename trên Drive',exact:true}).click();
assert.equal(await quynhRow.count(),1,'card changes only after Drive confirmation');
await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
await page.locator('.customer-result-row').filter({hasText:'DV-76'}).getByRole('button',{name:/Tùy chọn khách hàng/}).click();
await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
await page.getByRole('dialog').getByLabel('Tên thư mục Drive / Mã nhà',{exact:true}).fill('DV-75');
await page.getByRole('button',{name:'Rename trên Drive',exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
const minhRow=page.locator('.customer-result-row').filter({hasText:'NT5-38'});
await minhRow.getByRole('button',{name:/Tùy chọn khách hàng/}).click();
await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
await bridgeFrame.evaluate(()=>window.qaMutationFail=true);
await page.getByRole('button',{name:'Delete trên Drive',exact:true}).click();
await page.getByRole('dialog').getByRole('alert').waitFor();
assert.equal(await minhRow.count(),1,'failed Drive delete keeps the old card');
await bridgeFrame.evaluate(()=>window.qaMutationFail=false);
await page.getByRole('button',{name:'Delete trên Drive',exact:true}).click();
assert.equal(await minhRow.count(),1,'card stays until trash is confirmed');
await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
assert.equal(await minhRow.count(),0);
const mutationCalls=await bridgeFrame.evaluate(()=>window.qaMutationLog);
assert.ok(mutationCalls.every(call=>call.year===2026&&call.month===10&&call.mutationId));
assert.ok(mutationCalls.filter(call=>call.action==='delete-customer-folder').every(call=>call.adminSessionToken===adminSessionToken),'admin delete carries server-issued authorization');
const messageToggle = page.locator('.customer-message-summary .sidebar-notes__toggle');
const messageList = page.locator('#customer-message-summary-list');
await messageToggle.click();
assert.equal(await messageToggle.getAttribute('aria-expanded'), 'false');
assert.equal(await messageList.isVisible(), false);
assert.ok(await page.getByLabel('Tổng hợp ghi chú').first().locator('.sidebar-notes__list').isVisible(),'message fold leaves notes open');
await page.locator('button.overview-metric').filter({hasText:'Tin nhắn khách'}).click();
assert.equal(await messageToggle.getAttribute('aria-expanded'), 'true');
assert.equal(await messageList.isVisible(), true);
assert.ok(await page.getByRole('heading',{name:'Tổng quan dự án'}).isVisible(),'toggling messages keeps the overview open');
await openMessage('Nhóm thử không có hồ sơ');
assert.ok(await page.getByRole('dialog',{name:'Nhóm thử không có hồ sơ'}).isVisible());
assert.ok(await page.getByRole('heading',{name:'Tổng quan dự án'}).isVisible(),'an unlinked message cannot open a nameless customer workspace');
await page.keyboard.press('Escape');
await page.locator('.customer-result').filter({hasText:'DV-75'}).click();
await page.locator('.record-detail--inline').waitFor();
const desktopProjectBack = await backButtonPosition(1440);
await assertProjectHeaderName('DV-75', 1440);
assert.ok(await workspaceHeader.getByRole('button', { name: /Phát hành/ }).isVisible(), 'project publishing remains accessible');
assert.equal(await accountAction().count(),0,'the project header omits the account action');
assert.equal(await notificationAction().count(),0,'the project header omits the notification action');
const zaloEditor = page.getByRole('group', {name:'Tên nhóm Zalo', exact:true});
assert.equal(await zaloEditor.getByRole('textbox').first().inputValue(),'Nhóm Zalo DV-75','the previous single name is preserved');
await zaloEditor.getByRole('button',{name:'Thêm dòng sau dòng 1 của Tên nhóm Zalo',exact:true}).click();
await zaloEditor.getByRole('textbox').nth(1).fill('Nhóm công trường');
await zaloEditor.getByRole('button',{name:'Thêm dòng sau dòng 2 của Tên nhóm Zalo',exact:true}).click();
await zaloEditor.getByRole('textbox').nth(2).fill('Nhóm bỏ đi');
await zaloEditor.getByRole('button',{name:'Bớt dòng 3 của Tên nhóm Zalo',exact:true}).click();
assert.equal(await zaloEditor.getByRole('textbox').count(),2);
await page.getByRole('button',{name:'Tin nhắn',exact:true}).click();
await page.getByRole('button',{name:'↻ Nạp lại',exact:true}).click();
await bridgeFrame.waitForFunction(() => window.qaMessageTargets.some(target => target.houseId === 'DV-75' && JSON.stringify(target.zaloGroupNames) === JSON.stringify(['Nhóm Zalo DV-75','Nhóm công trường'])));
await page.getByRole('button',{name:'Tư vấn',exact:true}).click();
assert.equal(await zaloEditor.getByRole('textbox').nth(1).inputValue(),'Nhóm công trường');
await page.screenshot({path:'outputs/interface-qa/desktop-consulting.png',fullPage:true});
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.locator('.work-note').first().waitFor();
await page.locator('.work-notes__actions button').click();
const composer = page.getByLabel('Ghi chú mới',{exact:true});
assert.ok(await composer.getByRole('button',{name:'Phát hành',exact:true}).isDisabled(),'requires assignee and date');
await composer.getByLabel('Người phụ trách',{exact:true}).selectOption('anh@example.com');
assert.ok(await composer.getByRole('button',{name:'Phát hành',exact:true}).isDisabled(),'requires due date');
await composer.getByRole('button',{name:'Mở lịch Hoàn thành dự kiến',exact:true}).click();
const dueCalendar = composer.getByRole('group',{name:'Lịch chọn ngày'});
assert.ok(await dueCalendar.getByRole('button',{name:'27/10/2026',exact:true}).isDisabled(),'new deadlines cannot be picked in the past');
await dueCalendar.getByRole('button',{name:'Tháng sau',exact:true}).click();
await dueCalendar.getByRole('button',{name:'03/11/2026',exact:true}).click();
assert.equal(await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).inputValue(),'03/11/2026');
assert.equal(await dueCalendar.count(),0,'picking a date closes the calendar');
await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).fill('30102026');
assert.equal(await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).inputValue(),'30/10/2026');
await composer.getByLabel('Nội dung công việc',{exact:true}).fill('Kiểm tra điều kiện phát hành ghi chú.');
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
await openMessage();
assert.ok((await page.locator('.customer-message__body').innerText()).includes('kiểm tra lại phương án'));
await page.getByRole('button',{name:'Đang xử lý',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-messages.png',fullPage:true});
await page.getByRole('button',{name:'Giao việc',exact:true}).click();
await page.locator('.message-task-dialog').waitFor();
await page.screenshot({path:'outputs/interface-qa/desktop-assignment.png',fullPage:true});
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
await openPersonnel();
assertSameBackPosition(desktopProjectBack, await backButtonPosition(1440));
await page.getByRole('button',{name:'Nhân viên văn phòng',exact:true}).click();
const personnelRow = page.getByRole('row', { name: /Nguyễn Minh Anh/ });
await personnelRow.waitFor();
const desktopPersonnelRowHeight = await personnelRow.evaluate(row => row.getBoundingClientRect().height);
assert.ok(desktopPersonnelRowHeight <= 64,`desktop personnel rows are compact (${desktopPersonnelRowHeight}px)`);
await page.getByRole('button',{name:'Thêm nhân lực',exact:true}).click();
await page.locator('.personnel-add-form').waitFor();
await page.locator('.personnel-add-form').getByRole('button',{name:'Hủy',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/desktop-personnel.png',fullPage:true});
await page.getByRole('button',{name:'← Tổng quan',exact:true}).click();
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'outputs/interface-qa/mobile-overview.png',fullPage:true});
const mobile = await overflow(); assert.ok(mobile.body<=390,JSON.stringify(mobile));
const mobileLayouts = [];
for (const width of [360,390]) {
  await page.setViewportSize({width,height:844});
  const rowHeight = await customerRowHeight();
  assert.ok(rowHeight <= 64,`customer rows stay compact at ${width}px (${rowHeight}px)`);
  await openPersonnel();
  await page.getByRole('button',{name:'Nhân viên văn phòng',exact:true}).click();
  await personnelRow.waitFor();
  const personnelBack = await backButtonPosition(width);
  assert.ok((await overflow()).body<=width,`personnel does not overflow at ${width}px`);
  if (width === 390) await page.screenshot({path:'outputs/interface-qa/mobile-personnel.png',fullPage:true});
  await overviewBack.click();
  await page.locator('.customer-result').first().click();
  await page.locator('.record-detail--inline').waitFor();
  assertSameBackPosition(await backButtonPosition(width), personnelBack);
  await assertProjectHeaderName('DV-75', width);
  assert.equal(await accountAction().count(),0,`the project header omits the account action at ${width}px`);
  assert.equal(await notificationAction().count(),0,`the project header omits the notification action at ${width}px`);
  assert.ok((await overflow()).body<=width,`consulting does not overflow at ${width}px`);
  if (width === 390) await page.screenshot({path:'outputs/interface-qa/mobile-consulting.png'});
  mobileLayouts.push({ width, customerRowHeight: rowHeight, back: personnelBack });
  await overviewBack.click();
}
await page.locator('.customer-result').first().click();
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.screenshot({path:'outputs/interface-qa/mobile-notes.png',fullPage:true});
const projectMobile = await overflow(); assert.ok(projectMobile.body<=390,JSON.stringify(projectMobile));
await page.locator('.work-notes__actions button').click();
await composer.getByRole('button',{name:'Mở lịch Hoàn thành dự kiến',exact:true}).click();
await dueCalendar.evaluate((panel) => {
  const start = new Touch({ identifier: 1, target: panel, clientX: 180, clientY: 100 });
  const end = new Touch({ identifier: 1, target: panel, clientX: 65, clientY: 110 });
  panel.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
  panel.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
});
await dueCalendar.getByText('Tháng 11/2026',{exact:true}).waitFor();
assert.ok((await overflow()).body<=390,'the open calendar stays inside the phone layout');
await page.keyboard.press('Escape');
assert.equal(await dueCalendar.count(),0);
await composer.getByRole('button',{name:'Hủy',exact:true}).click();
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
const createCalls=await bridgeFrame.evaluate(()=>window.qaCreateLog);
assert.ok(createCalls.length>=2,'admin creates both new fixture customers');
assert.ok(createCalls.every(call=>call.adminSessionToken===adminSessionToken),'admin creation carries server-issued authorization');
await page.evaluate(() => {
  window.qaRootChosen=false; window.qaNotificationCalls=0;
  window.gmDesktop={isDesktop:true,isWindows:true,platform:'win32',
    selectWorkspaceFolder:async()=>{window.qaRootChosen=true;return {ok:true,path:'I:\\Shared drives\\GM Manager\\GM Manager'};},
    validateWorkspaceFolder:async()=>({ok:window.qaRootChosen,path:window.qaRootChosen?'I:\\Shared drives\\GM Manager\\GM Manager':'',error:'Chọn thư mục GM Manager hợp lệ.'}),
    showNotification:async({body})=>{if(body.startsWith('Thông báo đã được bật.'))window.qaNotificationCalls++;return true;},
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
await login.getByRole('button',{name:'Chọn ổ / thư mục',exact:true}).click();
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
await assertRestrictedCustomerActions('ordinary employee');
await openMessage();
assert.equal(await page.getByRole('button',{name:'Giao việc',exact:true}).count(),0,'employee reads messages without action buttons');
assert.equal(await page.locator('.customer-message__status-actions').getByRole('button').count(),0,'employees cannot change message state');
await page.evaluate(()=>localStorage.setItem('gm-manager-personnel-session-email','manager@example.com'));
await page.reload();
await assertRestrictedCustomerActions('manager');
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
await assertRestrictedCustomerActions('phone employee');
await page.getByRole('button',{name:/Đổi tài khoản/}).click();
const adminLogin=page.getByRole('dialog',{name:'Đăng nhập',exact:true});
await adminLogin.getByLabel('Tên nhân viên',{exact:true}).fill('admin');
await adminLogin.getByLabel('Mã đăng nhập',{exact:true}).fill('1');
await adminLogin.getByRole('button',{name:'Đăng nhập',exact:true}).click();
await page.waitForFunction(()=>!document.querySelector('.login-dialog'));
assert.equal(await page.evaluate(()=>localStorage.getItem('gm-manager-personnel-session-email')),'admin');
const verifiedSession=await page.evaluate(()=>JSON.parse(localStorage.getItem('gm-manager-admin-session-v1')));
assert.equal(verifiedSession.token,adminSessionToken,'admin stores the token returned by server verification');
assert.equal(verifiedSession.scriptUrl,fixtureScriptUrl,'admin authorization is bound to this backend');
const mobileBridgeFrame=page.frames().find(frame=>frame.url().startsWith('https://script.google.com/'));
assert.equal((await mobileBridgeFrame.evaluate(()=>window.qaAdminLoginCalls)).filter(call=>call.name==='admin').length,1,'built-in admin login is verified by the server');
assert.ok((await mobileBridgeFrame.evaluate(()=>window.qaAdminLoginCalls)).some(call=>call.name==='Nguyễn Minh Anh'&&call.loginCode==='00123'),'employee login is verified by the server');
assert.ok(await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).isVisible(),'phone admin can create');
assert.ok(await page.getByRole('button',{name:/Thiết lập/}).isVisible(),'phone admin can open settings');
for (const [sessionLabel,token] of [['expired',fixtureAdminToken({...adminSessionClaims,expiresAt:Date.parse('2026-10-27T02:00:00Z')})],['missing',null]]) {
  await page.evaluate(({token,fixtureScriptUrl})=>{
    if(token)localStorage.setItem('gm-manager-admin-session-v1',JSON.stringify({token,scriptUrl:fixtureScriptUrl}));
    else localStorage.removeItem('gm-manager-admin-session-v1');
  },{token,fixtureScriptUrl});
  await page.reload();
  await page.locator('.customer-result').first().waitFor();
  const cachedProjects = () => page.evaluate(() => JSON.parse(localStorage.getItem('gm-manager-consulting') || '[]')
    .flatMap(year => year.months.flatMap(month => month.records.map(record => record.projectId))).sort());
  const cacheBefore=await cachedProjects();
  await page.getByRole('button',{name:'Thêm khách hàng',exact:true}).click();
  await page.getByRole('dialog',{name:'Đăng nhập',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Thêm khách hàng',exact:true}).count(),0,`${sessionLabel} admin authorization cannot open creation`);
  await page.keyboard.press('Escape');
  await page.locator('.customer-result-row').filter({hasText:'DV-75'}).getByRole('button',{name:/Tùy chọn khách hàng/}).click();
  await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
  await page.getByRole('dialog',{name:'Đăng nhập',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'Xác nhận xóa',exact:true}).count(),0,`${sessionLabel} admin authorization cannot open deletion`);
  const staleSessionBridge=page.frames().find(frame=>frame.url().startsWith('https://script.google.com/'));
  assert.equal((await staleSessionBridge.evaluate(()=>window.qaCreateLog)).length,0,`${sessionLabel} admin authorization cannot send create`);
  assert.equal((await staleSessionBridge.evaluate(()=>window.qaMutationLog)).length,0,`${sessionLabel} admin authorization cannot send delete`);
  assert.deepEqual(await cachedProjects(),cacheBefore,`${sessionLabel} authorization cannot create phantom cached customers`);
  await page.keyboard.press('Escape');
}
await page.evaluate(()=>{localStorage.removeItem('gm-manager-personnel-session-email');localStorage.removeItem('gm-manager-admin-session-v1');});
await page.reload();
await assertRestrictedCustomerActions('logged out');
assert.deepEqual(errors,[],'no browser runtime errors');
console.log(JSON.stringify({passed:true,errors,mobile,projectMobile,desktopCustomerRowHeight,desktopPersonnelRowHeight,desktopProjectBack,mobileLayouts,screenshots:'outputs/interface-qa'}));
await browser.close();
