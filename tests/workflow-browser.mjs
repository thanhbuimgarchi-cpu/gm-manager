import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Synthetic command server. Every Google Apps Script navigation/request is
// intercepted: this suite never edits real customers, Drive or Pancake.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
const pageSource = await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
const scriptUrl = pageSource.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const fixedNow = '2026-10-28T02:00:00.000Z';
const permissions = ['Ghi chú','Tư vấn','Thiết kế','Dự toán','Thi công','Nghiệm thu','Bảo hành','Tài liệu','3D'];
const member = {id:'workflow-employee',status:'Có',name:'Nguyễn Minh Anh',email:'anh@example.com',loginCode:'00123',role:'Nhân viên thiết kế',permissions,birthDate:'',phone:'',address:''};
const manager = {...member,id:'workflow-manager',name:'Quản lý kiểm thử',email:'manager@example.com',loginCode:'manager-code',role:'Quản lý chung'};
const personnel = {office:[member,manager]};
const token = (account, purpose='workflow', version=2) => `${Buffer.from(JSON.stringify({version,purpose,account,expiresAt:Date.parse('2026-11-28T02:00:00Z'),nonce:`qa-${account}`})).toString('base64url')}.fixture-signature`;
const tokens = Object.fromEntries(['admin',member.email,manager.email].map(account=>[account,token(account)]));
const adminToken = token('admin','customer-admin',1);
const clone = value => JSON.parse(JSON.stringify(value));
const records = [
  {id:'workflow-house-a',name:'Khách A',houseId:'QA-A',projectId:'WORKFLOW-QA-A',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Khách A','NCT-KT':'Có'},designProgress:[{id:'design-qa-a',isCustom:true,content:'Thiết kế kiểm thử',plannedDate:'10/11/2026',actualDate:'',assignee:member.name,assigneeEmail:member.email,note:'',publishedAt:'',acceptedAt:'',acceptedBy:''}]},
  {id:'workflow-house-b',name:'Khách B',houseId:'QA-B',projectId:'WORKFLOW-QA-B',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Khách B'}},
];
const years = [{year:2026,months:Array.from({length:12},(_,i)=>({label:`T${i+1}`,records:i===9?records:[]}))}];
const message = {id:'message-qa-a',conversationId:'conversation-qa-a',year:2026,month:10,projectId:records[0].projectId,houseId:'QA-A',customerName:'Khách A',groupName:'QA-A-GM-Thiết kế',status:'new',revision:0,firstMessageAt:fixedNow,lastMessageAt:'2026-10-28T02:30:00.000Z',messageCount:2,messages:[
  {id:'line-selected',senderName:'Khách A',content:'Chọn dòng giao việc này.',sentAt:fixedNow},
  {id:'line-unselected',senderName:'Khách A',content:'Dòng chưa chọn để tham khảo.',sentAt:'2026-10-28T02:30:00.000Z'},
]};
const notes = new Map(records.map(record=>[record.projectId,[]]));
const notesRevision = new Map(records.map(record=>[record.projectId,0]));
const commandLog = [];
const committed = new Map();
const control = {transportOffline:false,noteArchivePending:false,designArchivePending:false,messageArchivePending:false,hold:null};
function holdNext(operation) {
  let entered,release;
  const gate = new Promise(resolve=>{release=resolve;});
  const observed = new Promise(resolve=>{entered=resolve;});
  control.hold={operation,gate,entered};
  return {entered:observed,release};
}
const actorFor = payload => Object.keys(tokens).find(account=>tokens[account]===payload.workflowSessionToken) || (payload.adminSessionToken===adminToken?'admin':'');
function scopeRecord(payload) { return records.find(record=>record.projectId===payload.projectId); }
function noteResult(payload,note) {
  const revision=(notesRevision.get(payload.projectId)||0)+1;
  notesRevision.set(payload.projectId,revision);
  return {ok:true,note:clone(note),notes:clone(notes.get(payload.projectId)),revision,deletedIds:[],archivePending:Boolean(note?.archivePending)};
}
async function dispatch(payload) {
  if(payload.action==='verify-employee-login') {
    if(payload.name==='admin'&&payload.loginCode==='1') return {ok:true,valid:true,account:'admin',adminSessionToken:adminToken,workflowSessionToken:tokens.admin};
    const found=Object.values(personnel).flat().find(person=>person.name===payload.name&&person.loginCode===payload.loginCode);
    return found?{ok:true,valid:true,account:found.email,member:clone(found),workflowSessionToken:tokens[found.email]}:{ok:true,valid:false,error:'Tên nhân viên hoặc mã đăng nhập không đúng.'};
  }
  if(payload.action==='load-personnel')return {ok:true,personnel:clone(personnel)};
  if(['load-consulting','load-workspace-cache'].includes(payload.action))return {ok:true,years:clone(years)};
  if(payload.action==='save-workspace-cache')return {ok:true};
  if(payload.action==='load-work-notes')return {ok:true,notes:clone(notes.get(payload.projectId)||[]),revision:notesRevision.get(payload.projectId)||0,deletedIds:[]};
  if(payload.action==='load-assigned-work-notes')return {ok:true,notes:records.flatMap(record=>(notes.get(record.projectId)||[]).filter(note=>!note.actualDate&&(payload.email==='admin'||payload.email===manager.email||note.assigneeEmail===payload.email)).map(note=>({...clone(note),year:2026,month:10,projectId:record.projectId,houseId:record.houseId,customerName:record.name})))};
  if(payload.action==='load-assigned-design-tasks')return {ok:true,tasks:records.flatMap(record=>(record.designProgress||[]).filter(row=>row.publishedAt&&!row.actualDate&&(payload.email==='admin'||payload.email===manager.email||row.assigneeEmail===payload.email)).map(row=>({...clone(row),kind:'architecture',title:'Tiến độ thiết kế kiến trúc',year:2026,month:10,projectId:record.projectId,houseId:record.houseId,customerName:record.name})))};
  if(payload.action==='load-customer-messages')return {ok:true,configured:true,messages:message.status!=='resolved'||message.archivePending?[clone(message)]:[]};
  if(payload.action==='list-documents')return {ok:true,snapshots:[],files:[]};
  if(payload.action==='list-3d-library')return {ok:true,folders:[]};
  if(payload.action!=='workflow-command') {
    if(['sync-work-notes','sync-design-tasks','complete-work-note','update-customer-message-status'].includes(payload.action))throw new Error(`Legacy workflow mutation remains: ${payload.action}`);
    return {ok:true};
  }
  commandLog.push(clone(payload));
  if(control.transportOffline)return {ok:false,code:'NETWORK_ERROR',error:'Mất kết nối kiểm thử; yêu cầu vẫn ở hàng đợi.'};
  const actor=actorFor(payload);
  if(!actor)return {ok:false,code:'AUTH_REQUIRED',error:'Hãy đăng nhập lại.'};
  if(committed.has(payload.requestId))return {...clone(committed.get(payload.requestId)),repeated:true};
  const record=scopeRecord(payload);
  if(!record)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy khách hàng.'};
  const collection=notes.get(record.projectId);
  const operation=payload.operation;
  let result;
  if(operation==='note.publish') {
    const draft=payload.note;
    if(!draft?.assigneeEmail||!draft.dueDate||!draft.content?.trim())return {ok:false,code:'VALIDATION',error:'Thiếu nội dung, Người phụ trách hoặc ngày dự kiến.'};
    if(collection.some(note=>note.id===draft.id))return {ok:false,code:'CONFLICT',error:'Ghi chú đã được tạo.'};
    const note={...clone(draft),revision:1,creatorEmail:actor,creatorName:actor==='admin'?'Admin':member.name,publishedAt:fixedNow,acceptedAt:'',acceptedBy:'',actualDate:'',completedAt:'',archivedAt:'',archivePending:false};
    collection.push(note);result=noteResult(payload,note);
  } else if(operation==='note.accept'||operation==='note.complete') {
    const note=collection.find(note=>note.id===payload.noteId);
    if(!note||note.assigneeEmail!==actor)return {ok:false,code:'FORBIDDEN',error:'Chỉ Người phụ trách mới được cập nhật.'};
    if(operation==='note.accept')Object.assign(note,{acceptedAt:fixedNow,acceptedBy:actor,revision:note.revision+1});
    else {
      if(!note.acceptedAt)return {ok:false,code:'VALIDATION',error:'Hãy nhận việc trước.'};
      Object.assign(note,{actualDate:'28/10/2026',completedAt:fixedNow,revision:note.revision+1,archivePending:control.noteArchivePending,archivedAt:control.noteArchivePending?'':fixedNow});
    }
    result=noteResult(payload,note);
  } else if(operation==='design.publish') {
    const assigned=payload.rows.filter(row=>row.content?.trim()&&(row.assigneeEmail||row.plannedDate||row.publishedAt));
    if(assigned.some(row=>!row.assigneeEmail||!row.plannedDate))return {ok:false,code:'VALIDATION',error:'Thiếu Người phụ trách hoặc ngày dự kiến.'};
    const canonical=assigned.map(row=>({...clone(row),publishedAt:row.publishedAt||fixedNow,revision:(row.revision||0)+1,creatorEmail:actor,acceptedAt:row.acceptedAt||'',acceptedBy:row.acceptedBy||'',actualDate:row.actualDate||''}));
    record.designProgress=payload.rows.map(row=>canonical.find(item=>item.id===row.id)||clone(row));
    result={ok:true,rows:clone(canonical),revision:1,tasks:[]};
  } else if(operation==='design.accept'||operation==='design.complete') {
    const row=(record.designProgress||[]).find(row=>row.id===payload.rowId);
    if(!row||row.assigneeEmail!==actor)return {ok:false,code:'FORBIDDEN',error:'Chỉ Người phụ trách mới được cập nhật.'};
    if(operation==='design.accept')Object.assign(row,{acceptedAt:fixedNow,acceptedBy:actor,revision:row.revision+1});
    else {
      if(!row.acceptedAt)return {ok:false,code:'VALIDATION',error:'Hãy nhận việc trước.'};
      Object.assign(row,{actualDate:'28/10/2026',completedAt:fixedNow,revision:row.revision+1,archivePending:control.designArchivePending,archivedAt:control.designArchivePending?'':fixedNow});
    }
    result={ok:true,rows:clone(record.designProgress.filter(row=>row.publishedAt)),revision:row.revision,row:clone(row),archivePending:Boolean(row.archivePending)};
  } else if(operation==='archive.retry') {
    if(payload.noteId){const note=collection.find(note=>note.id===payload.noteId);if(!note)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy ghi chú.'};Object.assign(note,{archivePending:control.noteArchivePending,archivedAt:control.noteArchivePending?'':fixedNow,revision:note.revision+1});result=noteResult(payload,note);}
    else {const row=record.designProgress?.find(row=>row.id===payload.rowId);if(!row)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy thiết kế.'};Object.assign(row,{archivePending:control.designArchivePending,archivedAt:control.designArchivePending?'':fixedNow,revision:row.revision+1});result={ok:true,rows:clone(record.designProgress.filter(row=>row.publishedAt)),revision:row.revision,archivePending:Boolean(row.archivePending)};}
  } else if(operation==='message.assign') {
    if(!['admin',manager.email].includes(actor))return {ok:false,code:'FORBIDDEN',error:'Chỉ quản lý mới giao việc.'};
    const selected=message.messages.filter(line=>payload.selectedLineIds?.includes(line.id));
    if(!selected.length)return {ok:false,code:'VALIDATION',error:'Hãy chọn dòng tin nhắn.'};
    const assignment=payload.assignment||payload.note||{};
    const note={...clone(assignment),id:assignment.id||`message-assignment-${payload.requestId}`,content:assignment.content||assignment.request,revision:1,creatorEmail:actor,assigneeEmail:assignment.assigneeEmail,sourceMessageId:message.id,messageContext:selected.map(line=>`${line.senderName}: ${line.content}`).join('\n'),publishedAt:fixedNow,acceptedAt:'',acceptedBy:'',actualDate:'',completedAt:'',archivePending:false};
    collection.push(note);result=noteResult(payload,note);
  } else if(operation==='message.status') {
    Object.assign(message,{status:payload.status,statusUpdatedAt:fixedNow,resolvedAt:payload.status==='resolved'?fixedNow:'',revision:message.revision+1,archivePending:payload.status==='resolved'&&control.messageArchivePending,archivedAt:payload.status==='resolved'&&!control.messageArchivePending?fixedNow:''});
    result={ok:true,message:clone(message),revision:message.revision,archivePending:Boolean(message.archivePending)};
  } else return {ok:false,code:'VALIDATION',error:`Unsupported fixture operation: ${operation}`};
  committed.set(payload.requestId,clone(result));
  if(control.hold?.operation===operation) {
    const hold=control.hold;control.hold=null;hold.entered(clone(payload));await hold.gate;
  }
  return result;
}

await mkdir('outputs/interface-qa',{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.GM_TEST_BROWSER_PATH?{executablePath:process.env.GM_TEST_BROWSER_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.exposeBinding('qaWorkflowRequest',async(_source,payload)=>dispatch(payload));
await context.addInitScript(({years,personnel,scriptUrl,adminToken,workflowToken})=>{
  window.gmDesktop={isDesktop:true,isWindows:true,platform:'win32',validateWorkspaceFolder:async()=>({ok:true,path:'I:\\Shared drives\\GM Manager\\GM Manager'}),showNotification:async()=>true};
  window.qaReadOutbox=()=>{
    const entries=JSON.parse(localStorage.getItem('gm-manager-workflow-outbox-v1')||'{"entries":[]}').entries||[];
    for(const key of Object.keys(localStorage).filter(key=>key.startsWith('gm-manager-workflow-outbox-v1:command:'))){const value=JSON.parse(localStorage.getItem(key)||'null');if(value?.entry)entries.push(value.entry);}
    return [...new Map(entries.map(entry=>[entry.requestId,entry])).values()];
  };
  if(localStorage.getItem('qa-workflow-seeded'))return;
  localStorage.setItem('qa-workflow-seeded','1');
  localStorage.setItem('gm-manager-consulting',JSON.stringify(years));
  localStorage.setItem('gm-manager-personnel-v1',JSON.stringify(personnel));
  localStorage.setItem('gm-manager-personnel-session-email','admin');
  localStorage.setItem('gm-manager-admin-session-v1',JSON.stringify({token:adminToken,scriptUrl}));
  localStorage.setItem('gm-manager-workflow-session-v1',JSON.stringify({token:workflowToken,scriptUrl,account:'admin'}));
},{years,personnel,scriptUrl,adminToken,workflowToken:tokens.admin});
await context.route('https://script.google.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><script>
addEventListener('message',async event=>{if(event.data?.channel!=='gm-manager-apps-script')return;const {id,payload}=event.data;let result;try{result=await window.qaWorkflowRequest(payload);}catch(error){result={ok:false,code:'NETWORK_ERROR',error:error.message};}event.source.postMessage({channel:'gm-manager-apps-script-response',id,result},'*');});parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>`}));
const page=await context.newPage();
await page.clock.setFixedTime(new Date(fixedNow));
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const baseUrl=process.env.GM_TEST_BASE_URL||'http://127.0.0.1:5173/gm-manager/';
let phase='bootstrap';
try {
await page.goto(baseUrl);
await page.locator('.overview-metrics').waitFor();
async function overview(){const back=page.getByRole('button',{name:'← Tổng quan',exact:true});if(await back.count())await back.click();await page.locator('.overview-metrics').waitFor();}
async function openHouse(code){await overview();await page.locator('.customer-result-row').filter({hasText:code}).locator('.customer-result').click();await page.locator('.record-detail--inline').waitFor();}
async function login(name,code){await page.getByRole('button',{name:/Đổi tài khoản|Đăng nhập/}).first().click();const dialog=page.getByRole('dialog',{name:'Đăng nhập',exact:true});await dialog.getByLabel('Tên nhân viên',{exact:true}).fill(name);await dialog.getByLabel('Mã đăng nhập',{exact:true}).fill(code);await dialog.getByRole('button',{name:'Đăng nhập',exact:true}).click();await dialog.waitFor({state:'hidden'});}
async function compose(content){await page.locator('.work-notes__actions button').first().click();const composer=page.getByLabel('Ghi chú mới',{exact:true});await composer.getByLabel('Người phụ trách',{exact:true}).selectOption(member.email);await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).fill('10112026');await composer.getByLabel('Nội dung công việc',{exact:true}).fill(content);return composer;}
const cachedNotes=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value||[]);
const outbox=()=>page.evaluate(()=>window.qaReadOutbox());

await openHouse('QA-A');
phase='note publish';
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
const firstComposer=await compose('Công việc kiểm thử nguyên tử');
const publishHold=holdNext('note.publish');
await firstComposer.getByRole('button',{name:'Phát hành',exact:true}).evaluate(button=>{button.click();button.click();});
await publishHold.entered;
assert.equal((await cachedNotes()).filter(note=>note.content==='Công việc kiểm thử nguyên tử').length,0,'publication is not confirmed before the server acknowledges');
publishHold.release();
await firstComposer.waitFor({state:'hidden'});
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value?.some(note=>note.content==='Công việc kiểm thử nguyên tử'));
assert.equal([...committed.values()].filter(result=>result.note?.content==='Công việc kiểm thử nguyên tử').length,1,'double click commits one note');
assert.equal(commandLog.filter(command=>command.operation==='note.publish').length,1,'double click sends a single intent');

await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
phase='design publish';
const designSection=page.locator('.design-schedule').first();
await designSection.getByRole('button',{name:'Phát hành',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-consulting')).flatMap(year=>year.months.flatMap(month=>month.records)).find(record=>record.projectId==='WORKFLOW-QA-A')?.designProgress?.[0]?.publishedAt);
assert.equal(commandLog.filter(command=>command.operation==='design.publish').length,1);

await login(member.name,member.loginCode);
phase='note accept/complete';
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.locator('.work-note').first().waitFor();
const activeNoteIndex=await page.locator('.work-note').evaluateAll(cards=>cards.findIndex(card=>card.querySelector('textarea[aria-label="Nội dung công việc"]')?.value==='Công việc kiểm thử nguyên tử'));
assert.ok(activeNoteIndex>=0,'assigned note is visible');
const activeNote=page.locator('.work-note').nth(activeNoteIndex);
await activeNote.waitFor();
assert.equal(await activeNote.getByRole('button',{name:'Tùy chọn ghi chú',exact:true}).count(),0,'assignee cannot edit or delete the creator’s note');
const acceptance=holdNext('note.accept');
await activeNote.getByRole('button',{name:'Xác nhận nhận việc',exact:true}).click();
await acceptance.entered;
assert.equal((await cachedNotes()).find(note=>note.content==='Công việc kiểm thử nguyên tử').acceptedAt,'','acceptance waits for canonical confirmation');
acceptance.release();
await activeNote.getByRole('checkbox',{name:'Đánh dấu hoàn thành',exact:true}).waitFor({state:'visible'});
assert.ok(await activeNote.getByLabel('Trạng thái Xanh',{exact:true}).isVisible(),'accepted assignment immediately uses the deadline color');
control.noteArchivePending=true;
const completion=holdNext('note.complete');
await activeNote.getByRole('checkbox',{name:'Đánh dấu hoàn thành',exact:true}).click();
await page.getByRole('dialog',{name:/Xác nhận hoàn thành/}).getByRole('button',{name:'Có, hoàn thành',exact:true}).click();
await completion.entered;
assert.equal((await cachedNotes()).find(note=>note.content==='Công việc kiểm thử nguyên tử').actualDate,'','completion is not fabricated before the server reply');
completion.release();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value?.some(note=>note.actualDate==='28/10/2026'&&note.archivePending));
assert.ok((await cachedNotes()).some(note=>note.content==='Công việc kiểm thử nguyên tử'&&note.archivePending),'completed work survives a Drive archive failure');
await activeNote.getByRole('button',{name:'Thử lưu Drive',exact:true}).waitFor();
control.noteArchivePending=false;
await activeNote.getByRole('button',{name:'Thử lưu Drive',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value?.some(note=>note.actualDate==='28/10/2026'&&!note.archivePending&&note.archivedAt));

await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
phase='design accept/complete';
const designRow=page.locator('.design-schedule').first().getByRole('row').filter({hasText:'Thiết kế kiểm thử'});
await designRow.getByRole('button',{name:'Xác nhận nhận việc',exact:true}).click();
await designRow.getByLabel('Trạng thái Xanh',{exact:true}).waitFor();
control.designArchivePending=true;
await designRow.getByRole('checkbox',{name:'Đánh dấu hoàn thành Thiết kế kiểm thử',exact:true}).click();
await page.getByRole('dialog',{name:/Xác nhận hoàn thành/}).getByRole('button',{name:'Có, hoàn thành',exact:true}).click();
await designRow.getByText('28/10/2026',{exact:true}).waitFor();
assert.equal(records[0].designProgress[0].actualDate,'28/10/2026');
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).waitFor();
control.designArchivePending=false;
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).click();
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).waitFor({state:'hidden'});

await login('admin','1');
phase='message assignment';
await overview();
await page.locator('.customer-message-summary .sidebar-notes__toggle').click();
await page.locator('.customer-message__body').waitFor();
await page.getByRole('button',{name:'Giao việc',exact:true}).click();
const assignment=page.locator('.message-task-dialog');
await assignment.getByRole('checkbox').first().check();
await assignment.getByLabel('Người phụ trách').selectOption(member.email);
await assignment.getByLabel('Hoàn thành dự kiến',{exact:true}).fill('10112026');
await assignment.getByLabel('Yêu cầu giao việc',{exact:true}).fill('Xử lý đúng dòng khách đã chọn.');
await assignment.getByRole('button',{name:'Phát hành giao việc',exact:true}).click();
await assignment.waitFor({state:'hidden'});
const messageAssignment=notes.get(records[0].projectId).find(note=>note.sourceMessageId===message.id);
assert.ok(messageAssignment,'message assignment creates a normal work note');
assert.ok(messageAssignment.messageContext.includes('Chọn dòng giao việc này.'));
assert.ok(!messageAssignment.messageContext.includes('Dòng chưa chọn để tham khảo.'));
assert.equal(messageAssignment.actualDate,'');
assert.equal(messageAssignment.acceptedAt,'');

control.messageArchivePending=true;
phase='message archive pending';
await overview();
await page.locator('.customer-message-summary .sidebar-notes__toggle').click();
await page.locator('.customer-message__body').waitFor();
await page.getByRole('button',{name:'Đã hoàn thành',exact:true}).click();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('.customer-message')).some(element=>element.textContent.includes('Chọn dòng giao việc này.')));
assert.ok(message.archivePending,'failed message archive remains pending');
assert.ok(await page.locator('.customer-message__body').isVisible(),'message is retained while its Excel archive is pending');
await page.screenshot({path:'outputs/interface-qa/workflow-archive-pending.png',fullPage:true});
control.messageArchivePending=false;
await page.getByRole('button',{name:'Thử lưu Drive',exact:true}).click();
await page.locator('.customer-message__body').waitFor({state:'hidden'});
assert.equal(message.archivePending,false,'message disappears only after the archive is confirmed');

// A delayed response is applied to its captured customer, never the current tab.
await openHouse('QA-A');
phase='customer-scoped delayed acknowledgement';
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
const delayedComposer=await compose('Chỉ thuộc khách A, không được sang B');
const delayed=holdNext('note.publish');
await delayedComposer.getByRole('button',{name:'Phát hành',exact:true}).click();
await delayed.entered;
await page.keyboard.press('Escape');
await openHouse('QA-B');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
delayed.release();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value?.some(note=>note.content==='Chỉ thuộc khách A, không được sang B'));
assert.equal(await page.locator('textarea[aria-label="Nội dung công việc"]').evaluateAll(inputs=>inputs.some(input=>input.value==='Chỉ thuộc khách A, không được sang B')),false,'late customer A acknowledgement does not overwrite customer B');

await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
control.transportOffline=true;
phase='offline durable outbox';
const offlineComposer=await compose('Giữ nguyên mã yêu cầu khi mất mạng và tải lại');
await offlineComposer.getByRole('button',{name:'Phát hành',exact:true}).click();
await page.waitForFunction(()=>window.qaReadOutbox().some(entry=>entry.payload.operation==='note.publish'&&entry.state==='retrying'));
const queued=(await outbox()).find(entry=>entry.payload.note?.content==='Giữ nguyên mã yêu cầu khi mất mạng và tải lại');
assert.ok(queued?.requestId,'offline intent has a durable request id');
assert.ok(!notes.get(records[0].projectId).some(note=>note.content==='Giữ nguyên mã yêu cầu khi mất mạng và tải lại'),'offline request is not advertised as a real published note');
await page.reload();
await page.locator('.overview-metrics').waitFor();
assert.equal((await outbox()).find(entry=>entry.payload.note?.content==='Giữ nguyên mã yêu cầu khi mất mạng và tải lại')?.requestId,queued.requestId,'reload keeps the same intent identity');
control.transportOffline=false;
await page.clock.setFixedTime(new Date('2026-10-28T02:00:10.000Z'));
await page.evaluate(()=>window.dispatchEvent(new Event('online')));
await page.waitForFunction(()=>window.qaReadOutbox().length===0);
assert.equal(notes.get(records[0].projectId).filter(note=>note.content==='Giữ nguyên mã yêu cầu khi mất mạng và tải lại').length,1,'reconnection commits one copy');
assert.ok(commandLog.filter(command=>command.note?.content==='Giữ nguyên mã yêu cầu khi mất mạng và tải lại').every(command=>command.requestId===queued.requestId),'all retries use the original id');
assert.deepEqual(errors,[],'no browser runtime errors');
console.log(JSON.stringify({passed:true,commands:commandLog.length,uniqueCommits:committed.size,noRuntimeErrors:true,archivePendingRetained:true,customerScopedReplies:true,offlineReplayIdStable:true}));
} catch(error) {
  await page.screenshot({path:'outputs/interface-qa/workflow-failure.png',fullPage:true}).catch(()=>{});
  console.error(JSON.stringify({phase,commands:commandLog.map(command=>({operation:command.operation,requestId:command.requestId})),pageText:(await page.locator('body').innerText().catch(()=>'' )).slice(-5000)}));
  throw error;
} finally { await browser.close(); }
