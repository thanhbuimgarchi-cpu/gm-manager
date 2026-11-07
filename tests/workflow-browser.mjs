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
const colleague = {...member,id:'workflow-colleague',name:'Trần Văn Bình',email:'binh@example.com',loginCode:'colleague-code'};
const manager = {...member,id:'workflow-manager',name:'Quản lý kiểm thử',email:'manager@example.com',loginCode:'manager-code',role:'  QUẢN   LÝ '.normalize('NFD'),permissions:[]};
const personnel = {office:[member,colleague,manager]};
const token = (account, purpose='workflow', version=2) => `${Buffer.from(JSON.stringify({version,purpose,account,expiresAt:Date.parse('2026-11-28T02:00:00Z'),nonce:`qa-${account}`})).toString('base64url')}.fixture-signature`;
const tokens = Object.fromEntries(['admin',member.email,colleague.email,manager.email].map(account=>[account,token(account)]));
const adminToken = token('admin','customer-admin',1);
const clone = value => JSON.parse(JSON.stringify(value));
const privateAdminNote = { id:'private-admin-note', workType:'Thiết kế', priority:'Bình thường', content:'Ghi chú riêng do Admin giao', creatorEmail:'admin', assignee:colleague.name, assigneeEmail:colleague.email, dueDate:'10/11/2026', actualDate:'', status:'Xanh', acceptedAt:fixedNow, acceptedBy:colleague.email, completionRequestedAt:fixedNow, completionRequestedBy:colleague.email, revision:1 };
const privateAdminDesign = { id:'private-admin-design', isCustom:true, content:'Thiết kế riêng do Admin giao', plannedDate:'10/11/2026', actualDate:'', note:'', creatorEmail:'admin', assignee:colleague.name, assigneeEmail:colleague.email, publishedAt:fixedNow, acceptedAt:fixedNow, acceptedBy:colleague.email, completionRequestedAt:fixedNow, completionRequestedBy:colleague.email, revision:1 };
const records = [
  {id:'workflow-house-a',name:'Khách A',houseId:'QA-A',projectId:'WORKFLOW-QA-A',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Khách A','NCT-KT':'Có'},designProgress:[{id:'design-qa-a',isCustom:true,content:'Thiết kế kiểm thử',plannedDate:'10/11/2026',actualDate:'',assignee:member.name,assigneeEmail:member.email,note:'',publishedAt:'',acceptedAt:'',acceptedBy:''},privateAdminDesign]},
  {id:'workflow-house-b',name:'Khách B',houseId:'QA-B',projectId:'WORKFLOW-QA-B',createdAt:'28/10/2026',isHydrated:true,progressHydrated:true,details:{HVT:'Khách B'}},
];
const years = [{year:2026,months:Array.from({length:12},(_,i)=>({label:`T${i+1}`,records:i===9?records:[]}))}];
const message = {id:'message-qa-a',conversationId:'conversation-qa-a',year:2026,month:10,projectId:records[0].projectId,houseId:'QA-A',customerName:'Khách A',groupName:'QA-A-GM-Thiết kế',status:'new',revision:0,firstMessageAt:fixedNow,lastMessageAt:'2026-10-28T02:30:00.000Z',messageCount:2,messages:[
  {id:'line-selected',senderName:'Khách A',content:'Chọn dòng giao việc này.',sentAt:fixedNow},
  {id:'line-unselected',senderName:'Khách A',content:'Dòng chưa chọn để tham khảo.',sentAt:'2026-10-28T02:30:00.000Z'},
]};
const notes = new Map([[records[0].projectId,[privateAdminNote]],[records[1].projectId,[]]]);
const notesRevision = new Map([[records[0].projectId,1],[records[1].projectId,0]]);
const deletedNoteIds = new Map(records.map(record=>[record.projectId,[]]));
const commandLog = [];
const readLog = [];
const committed = new Map();
const control = {transportOffline:false,noteArchivePending:false,designArchivePending:false,messageArchivePending:false,staleAssignedFeed:false,hold:null};
let feedSerial=0;
function holdNext(operation) {
  let entered,release;
  const gate = new Promise(resolve=>{release=resolve;});
  const observed = new Promise(resolve=>{entered=resolve;});
  control.hold={operation,gate,entered};
  return {entered:observed,release};
}
const actorFor = payload => Object.keys(tokens).find(account=>tokens[account]===payload.workflowSessionToken) || (payload.adminSessionToken===adminToken?'admin':'');
const managerAccount = actor => actor === 'admin' || actor === manager.email;
const visibleTo = (actor, item) => Boolean(actor && (managerAccount(actor) ? item.creatorEmail === actor : item.assigneeEmail === actor));
function scopeRecord(payload) { return records.find(record=>record.projectId===payload.projectId); }
function noteResult(payload,note) {
  const revision=(notesRevision.get(payload.projectId)||0)+1;
  notesRevision.set(payload.projectId,revision);
  return {ok:true,note:clone(note),notes:clone(notes.get(payload.projectId).filter(item=>visibleTo(actorFor(payload),item))),revision,deletedIds:clone(deletedNoteIds.get(payload.projectId)||[]),archivePending:Boolean(note?.archivePending)};
}
function applyAssignmentDecision(item, action, actor, payload, dateField, archivePending) {
  if (Number(payload.expectedRevision) !== item.revision) return {ok:false,code:'CONFLICT',error:'Hãy tải lại công việc.'};
  const isManager = managerAccount(actor);
  if (action === 'approve' || action === 'return') {
    if (!isManager || !visibleTo(actor,item)) return {ok:false,code:'FORBIDDEN',error:'Chỉ người giao việc được duyệt.'};
    if (!item.completionRequestedAt || item.actualDate) return {ok:false,code:'CONFLICT',error:'Công việc không còn chờ xác nhận.'};
  } else if (item.assigneeEmail !== actor && !(isManager && dateField === 'plannedDate')) return {ok:false,code:'FORBIDDEN',error:'Chỉ Người phụ trách mới được cập nhật.'};
  const now = new Date(Date.parse(fixedNow) + item.revision * 1000).toISOString();
  if (action === 'accept') Object.assign(item,{acceptedAt:now,acceptedBy:actor});
  if (action === 'complete') {
    if (!item.acceptedAt) return {ok:false,code:'VALIDATION',error:'Hãy nhận việc trước.'};
    Object.assign(item,{completionRequestedAt:now,completionRequestedBy:actor,completionRequestedByName:member.name});
  }
  if (action === 'approve') Object.assign(item,{actualDate:'28/10/2026',completedAt:now,archivePending,archivedAt:archivePending?'':now});
  if (action === 'return') Object.assign(item,{[dateField]:payload.dueDate,reviewComment:payload.reviewComment,reassignedAt:now,completionRequestedAt:'',completionRequestedBy:'',completionRequestedByName:'',acceptedAt:'',acceptedBy:''});
  item.revision += 1;
  return null;
}
async function dispatch(payload) {
  if(payload.action.startsWith('load-'))readLog.push({action:payload.action,project:clone(payload.project||null)});
  if(payload.action==='verify-employee-login') {
    if(payload.name==='admin'&&payload.loginCode==='1') return {ok:true,valid:true,account:'admin',adminSessionToken:adminToken,workflowSessionToken:tokens.admin};
    const found=Object.values(personnel).flat().find(person=>person.name===payload.name&&person.loginCode===payload.loginCode);
    return found?{ok:true,valid:true,account:found.email,member:clone(found),workflowSessionToken:tokens[found.email]}:{ok:true,valid:false,error:'Tên nhân viên hoặc mã đăng nhập không đúng.'};
  }
  if(payload.action==='load-personnel')return {ok:true,personnel:clone(personnel)};
  if(['load-consulting','load-workspace-cache'].includes(payload.action))return {ok:true,years:clone(years)};
  if(payload.action==='save-workspace-cache')return {ok:true};
  if(payload.action==='load-work-notes')return {ok:true,notes:clone(notes.get(payload.projectId)||[]),revision:notesRevision.get(payload.projectId)||0,deletedIds:clone(deletedNoteIds.get(payload.projectId)||[])};
  if(payload.action==='load-assigned-work-notes'){
    const actor=actorFor(payload);
    if(!actor)return {ok:false,code:'AUTH_REQUIRED',error:'Hãy đăng nhập lại.'};
    const visible=note=>visibleTo(actor,note);
    const projectRevisions=records.map(record=>({year:2026,month:10,projectId:record.projectId,revision:Math.max(0,(notesRevision.get(record.projectId)||0)-(control.staleAssignedFeed?1:0))}));
    const selected=payload.project&&records.find(record=>payload.project.year===2026&&payload.project.month===10&&payload.project.projectId===record.projectId);
    const projectSnapshot=selected?{year:2026,month:10,projectId:selected.projectId,revision:projectRevisions.find(item=>item.projectId===selected.projectId).revision,notes:control.staleAssignedFeed?[]:clone(notes.get(selected.projectId).filter(visible)),deletedIds:control.staleAssignedFeed?[]:clone(deletedNoteIds.get(selected.projectId)||[]),legacyImportPending:false}:undefined;
    return {ok:true,notes:control.staleAssignedFeed?[]:records.flatMap(record=>(notes.get(record.projectId)||[]).filter(note=>!note.actualDate&&visible(note)).map(note=>({...clone(note),year:2026,month:10,projectId:record.projectId,houseId:record.houseId,customerName:record.name}))),projectRevisions,...(projectSnapshot?{projectSnapshot}:{}),qaFeedSerial:++feedSerial};
  }
  if(payload.action==='load-assigned-design-tasks')return {ok:true,tasks:records.flatMap(record=>(record.designProgress||[]).filter(row=>row.publishedAt&&!row.actualDate&&visibleTo(actorFor(payload),row)).map(row=>({...clone(row),kind:'architecture',title:'Tiến độ thiết kế kiến trúc',year:2026,month:10,projectId:record.projectId,houseId:record.houseId,customerName:record.name})))};
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
  } else if(/^note\.(accept|complete|approve|return)$/.test(operation)) {
    const note=collection.find(note=>note.id===payload.noteId);
    if(!note)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy công việc.'};
    const failure=applyAssignmentDecision(note,operation.split('.')[1],actor,payload,'dueDate',control.noteArchivePending);
    if(failure)return failure;
    result=noteResult(payload,note);
  } else if(operation==='design.publish') {
    const assigned=payload.rows.filter(row=>row.content?.trim()&&(row.assigneeEmail||row.plannedDate||row.publishedAt));
    if(assigned.some(row=>!row.assigneeEmail||!row.plannedDate))return {ok:false,code:'VALIDATION',error:'Thiếu Người phụ trách hoặc ngày dự kiến.'};
    const canonical=assigned.map(row=>({...clone(row),publishedAt:row.publishedAt||fixedNow,revision:(row.revision||0)+1,creatorEmail:actor,acceptedAt:row.acceptedAt||'',acceptedBy:row.acceptedBy||'',actualDate:row.actualDate||''}));
    const foreign = (record.designProgress||[]).filter(row=>row.publishedAt&&!visibleTo(actor,row));
    if(payload.rows.some(row=>foreign.some(other=>other.id===row.id)))return {ok:false,code:'FORBIDDEN',error:'Không được phát hành lại hạng mục của người khác.'};
    record.designProgress=[...payload.rows.map(row=>canonical.find(item=>item.id===row.id)||clone(row)),...foreign];
    result={ok:true,rows:clone(canonical),revision:1,tasks:[]};
  } else if(/^design\.(accept|complete|approve|return)$/.test(operation)) {
    const row=(record.designProgress||[]).find(row=>row.id===payload.rowId);
    if(!row)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy hạng mục.'};
    const failure=applyAssignmentDecision(row,operation.split('.')[1],actor,payload,'plannedDate',control.designArchivePending);
    if(failure)return failure;
    result={ok:true,rows:clone(record.designProgress.filter(row=>row.publishedAt&&visibleTo(actor,row))),revision:row.revision,row:clone(row),archivePending:Boolean(row.archivePending)};
  } else if(operation==='archive.retry') {
    if(payload.noteId){const note=collection.find(note=>note.id===payload.noteId);if(!note)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy ghi chú.'};Object.assign(note,{archivePending:control.noteArchivePending,archivedAt:control.noteArchivePending?'':fixedNow,revision:note.revision+1});result=noteResult(payload,note);}
    else {const row=record.designProgress?.find(row=>row.id===payload.rowId);if(!row)return {ok:false,code:'NOT_FOUND',error:'Không tìm thấy thiết kế.'};Object.assign(row,{archivePending:control.designArchivePending,archivedAt:control.designArchivePending?'':fixedNow,revision:row.revision+1});result={ok:true,rows:clone(record.designProgress.filter(row=>row.publishedAt&&visibleTo(actor,row))),revision:row.revision,archivePending:Boolean(row.archivePending)};}
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
  window.qaNotifications=[];
  window.gmDesktop={isDesktop:true,isWindows:true,platform:'win32',validateWorkspaceFolder:async()=>({ok:true,path:'I:\\Shared drives\\GM Manager\\GM Manager'}),showNotification:async(payload)=>{window.qaNotifications.push(payload);return true;}};
  window.qaFeedSerial=0;
  addEventListener('message',event=>{if(event.data?.channel==='gm-manager-apps-script-response'&&event.data.result?.qaFeedSerial)window.qaFeedSerial=event.data.result.qaFeedSerial;});
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
  localStorage.setItem('gm-manager-notifications-enabled-v1','enabled');
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
async function login(name,code){await overview();await page.locator('.workspace-header .pwa-action--login').click();const dialog=page.getByRole('dialog',{name:'Đăng nhập',exact:true});await dialog.getByLabel('Tên nhân viên',{exact:true}).fill(name);await dialog.getByLabel('Mã đăng nhập',{exact:true}).fill(code);await dialog.getByRole('button',{name:'Đăng nhập',exact:true}).click();await dialog.waitFor({state:'hidden'});}
async function compose(content){await page.locator('.work-notes__actions button').first().click();const composer=page.getByLabel('Ghi chú mới',{exact:true});await composer.getByLabel('Người phụ trách',{exact:true}).selectOption(member.email);await composer.getByLabel('Hoàn thành dự kiến',{exact:true}).fill('10112026');await composer.getByLabel('Nội dung công việc',{exact:true}).fill(content);return composer;}
const cachedNotes=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value||[]);
const visibleNoteContents=()=>page.locator('.work-note textarea[aria-label="Nội dung công việc"]').evaluateAll(inputs=>inputs.map(input=>input.value));
const designAssigneeField=content=>page.getByLabel(`Người phụ trách ${content}`,{exact:true});
const reviewPanel=page.getByLabel('Công việc chờ xác nhận',{exact:true});
const outbox=()=>page.evaluate(()=>window.qaReadOutbox());
async function focusPoll(){const previous=await page.evaluate(()=>window.qaFeedSerial);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(value=>window.qaFeedSerial>value,previous,{timeout:8000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}

phase='admin-to-manager assignment isolation';
await reviewPanel.getByText(privateAdminNote.content,{exact:true}).waitFor();
await reviewPanel.getByText(privateAdminDesign.content,{exact:true}).waitFor();
await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.waitForFunction(content=>Array.from(document.querySelectorAll('.work-note textarea[aria-label="Nội dung công việc"]')).some(input=>input.value===content),privateAdminNote.content);
await login(manager.name,manager.loginCode);
await focusPoll();
assert.equal(await reviewPanel.count(),0,'switching to another manager clears the previous account’s review queue');

await openHouse('QA-A');
phase='note publish';
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await focusPoll();
assert.ok(!(await visibleNoteContents()).includes(privateAdminNote.content),'a manager cannot read another assigning account’s note from a broad legacy response or cache');
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
assert.equal(await designAssigneeField(privateAdminDesign.content).count(),0,'foreign published design is hidden even when present in the shared project record');
await designSection.getByRole('button',{name:'Phát hành',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-consulting')).flatMap(year=>year.months.flatMap(month=>month.records)).find(record=>record.projectId==='WORKFLOW-QA-A')?.designProgress?.[0]?.publishedAt);
assert.equal(commandLog.filter(command=>command.operation==='design.publish').length,1);

await login(member.name,member.loginCode);
phase='note accept/complete';
await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await page.locator('.work-note').first().waitFor();
const activeNoteIndex=await page.locator('.work-note').evaluateAll(cards=>cards.findIndex(card=>card.querySelector('textarea[aria-label="Nội dung công việc"]')?.value==='Công việc kiểm thử nguyên tử'));
assert.ok(activeNoteIndex>=0,'assigned note is visible');
const activeNote=page.locator('.work-note').nth(activeNoteIndex);
await activeNote.waitFor();
assert.ok(!(await visibleNoteContents()).includes(privateAdminNote.content),'an employee cannot read a colleague’s note in the same customer');
assert.equal(await activeNote.getByRole('button',{name:'Tùy chọn ghi chú',exact:true}).count(),0,'assignee cannot edit or delete the creator’s note');
const acceptance=holdNext('note.accept');
await activeNote.getByRole('button',{name:'Xác nhận nhận việc',exact:true}).click();
await acceptance.entered;
assert.equal((await cachedNotes()).find(note=>note.content==='Công việc kiểm thử nguyên tử').acceptedAt,'','acceptance waits for canonical confirmation');
acceptance.release();
await activeNote.getByRole('checkbox',{name:'Đánh dấu hoàn thành',exact:true}).waitFor({state:'visible'});
assert.ok(await activeNote.getByLabel('Trạng thái Xanh',{exact:true}).isVisible(),'accepted assignment immediately uses the deadline color');
const completion=holdNext('note.complete');
await activeNote.getByRole('checkbox',{name:'Đánh dấu hoàn thành',exact:true}).click();
await page.getByRole('dialog',{name:/Xác nhận hoàn thành/}).getByRole('button',{name:'Có, hoàn thành',exact:true}).click();
await completion.entered;
assert.equal((await cachedNotes()).find(note=>note.content==='Công việc kiểm thử nguyên tử').actualDate,'','completion is not fabricated before the server reply');
completion.release();
await activeNote.getByText('Chờ quản lý xác nhận',{exact:true}).waitFor();
assert.equal(await activeNote.getByLabel('Hoàn thành thực tế',{exact:true}).inputValue(),'');
assert.equal(await activeNote.getByRole('button',{name:'Xác nhận',exact:true}).count(),0);
assert.ok((await cachedNotes()).some(note=>note.completionRequestedAt&&!note.actualDate&&!note.archivePending),'a report enters review without archiving');

await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
phase='employee consultation, design and messages permissions';
await page.getByRole('button',{name:'Tư vấn',exact:true}).click();
assert.ok(await page.locator('.record-detail--inline').getByLabel('Tên khách hàng',{exact:true}).isDisabled());
await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
const employeeDesign=page.locator('.design-schedule').first();
assert.equal(await employeeDesign.getByRole('button',{name:'Phát hành',exact:true}).count(),0);
assert.equal(await designAssigneeField(privateAdminDesign.content).count(),0,'an employee cannot read a colleague’s design in the same customer');
const employeeDesignRow=employeeDesign.getByRole('row').filter({hasText:'Thiết kế kiểm thử'});
assert.ok(await employeeDesignRow.getByLabel('Người phụ trách Thiết kế kiểm thử').isDisabled());
await employeeDesignRow.getByRole('button',{name:'Xác nhận nhận việc',exact:true}).click();
await employeeDesignRow.getByLabel('Trạng thái Xanh',{exact:true}).waitFor();
await employeeDesignRow.getByRole('checkbox',{name:'Đánh dấu hoàn thành Thiết kế kiểm thử',exact:true}).click();
await page.getByRole('dialog',{name:/Xác nhận hoàn thành/}).getByRole('button',{name:'Có, hoàn thành',exact:true}).click();
await employeeDesignRow.getByText('Chờ quản lý xác nhận',{exact:true}).waitFor();
assert.equal(await employeeDesignRow.getByRole('button',{name:'Nhận xét',exact:true}).count(),0);
assert.equal(records[0].designProgress[0].actualDate,'');
const beforeRead=commandLog.length;
await overview();await page.locator('.customer-message-summary .sidebar-notes__toggle').click();await page.locator('.customer-message__body').waitFor();
assert.equal(await page.locator('.customer-message__status-actions').getByRole('button').count(),0);
assert.equal(commandLog.length,beforeRead,'reading as an employee cannot submit workflow commands');
await login(manager.name,manager.loginCode);
phase='manager feedback and design approval';
const noteReview=reviewPanel.locator('article').filter({hasText:'Công việc kiểm thử nguyên tử'});
const designReview=reviewPanel.locator('article').filter({hasText:'Thiết kế kiểm thử'});
await noteReview.waitFor();
await designReview.waitFor();
assert.equal(await reviewPanel.getByText(privateAdminNote.content,{exact:true}).count(),0);
assert.equal(await reviewPanel.getByText(privateAdminDesign.content,{exact:true}).count(),0);
await page.waitForFunction(()=>window.qaNotifications.some(({title,body})=>title.includes('Công việc chờ xác nhận')&&body.includes('Công việc kiểm thử nguyên tử')));
await noteReview.getByRole('button',{name:'Nhận xét',exact:true}).click();
const feedbackDialog=page.getByRole('dialog',{name:'Nhận xét công việc',exact:true});
const reassign=feedbackDialog.getByRole('button',{name:'Giao việc',exact:true});
assert.ok(await reassign.isDisabled());
await feedbackDialog.getByLabel('Hoàn thành dự kiến mới',{exact:true}).fill('14112026');
await feedbackDialog.getByLabel('Nội dung nhận xét',{exact:true}).fill('Bổ sung ảnh kiểm tra trước khi gửi lại.');
await reassign.click();
await noteReview.waitFor({state:'hidden'});
const returnedNote=notes.get(records[0].projectId).find(note=>note.content==='Công việc kiểm thử nguyên tử');
assert.equal(returnedNote.dueDate,'14/11/2026');
assert.equal(returnedNote.acceptedAt,'');
assert.equal(returnedNote.actualDate,'');
control.designArchivePending=true;
await designReview.getByRole('button',{name:'Xác nhận',exact:true}).click();
await designReview.waitFor({state:'hidden'});
await openHouse('QA-A');await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
const designRow=page.locator('.design-schedule').first().getByRole('row').filter({hasText:'Thiết kế kiểm thử'});
await designRow.getByText('28/10/2026',{exact:true}).waitFor();
assert.equal(records[0].designProgress[0].actualDate,'28/10/2026');
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).waitFor();
control.designArchivePending=false;
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).click();
await designRow.getByRole('button',{name:'Chờ lưu Drive · Thử lại',exact:true}).waitFor({state:'hidden'});

phase='employee re-submits after feedback and manager closes note';
await login(member.name,member.loginCode);
await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
const returnedCard=page.locator('.work-note').filter({hasText:'Bổ sung ảnh kiểm tra trước khi gửi lại.'});
await returnedCard.waitFor();
assert.equal(await returnedCard.getByLabel('Hoàn thành dự kiến',{exact:true}).inputValue(),'14/11/2026');
await returnedCard.getByRole('button',{name:'Xác nhận nhận việc',exact:true}).click();
await returnedCard.getByRole('checkbox',{name:'Đánh dấu hoàn thành',exact:true}).click();
await page.getByRole('dialog',{name:/Xác nhận hoàn thành/}).getByRole('button',{name:'Có, hoàn thành',exact:true}).click();
await returnedCard.getByText('Chờ quản lý xác nhận',{exact:true}).waitFor();
await login(manager.name,manager.loginCode);
await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
control.noteArchivePending=true;
await returnedCard.getByRole('button',{name:'Xác nhận',exact:true}).click();
await returnedCard.getByRole('button',{name:'Thử lưu Drive',exact:true}).waitFor();
assert.ok((await cachedNotes()).some(note=>note.id===returnedNote.id&&note.actualDate==='28/10/2026'&&note.archivePending),'approved work closes even if the Drive archive fails');
control.noteArchivePending=false;
await returnedCard.getByRole('button',{name:'Thử lưu Drive',exact:true}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gm-manager-drive-cache-v1:work-notes-draft-v1:2026-10-WORKFLOW-QA-A')||'null')?.value?.some(note=>note.actualDate==='28/10/2026'&&!note.archivePending&&note.archivedAt));

await login('admin','1');
phase='admin remains scoped to own work';
await openHouse('QA-A');
await page.getByRole('button',{name:'Ghi chú',exact:true}).click();
await focusPoll();
assert.ok((await visibleNoteContents()).includes(privateAdminNote.content),'admin still sees their own note');
assert.ok(!(await visibleNoteContents()).includes('Công việc kiểm thử nguyên tử'),'admin cannot read another manager’s note history');
await page.getByRole('button',{name:'Thiết kế',exact:true}).click();
assert.ok(await designAssigneeField(privateAdminDesign.content).isVisible(),'admin still sees their own design');
assert.equal(await designAssigneeField('Thiết kế kiểm thử').count(),0,'admin cannot read another manager’s design history');
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
phase='stale assignment feed after local acknowledgement';
const delayedNote=notes.get(records[0].projectId).find(note=>note.content==='Chỉ thuộc khách A, không được sang B');
assert.ok(delayedNote);
control.staleAssignedFeed=true;
await focusPoll();
assert.ok((await cachedNotes()).some(note=>note.id===delayedNote.id),'an older assignment feed cannot remove a locally acknowledged note');
assert.ok(await page.locator('textarea[aria-label="Nội dung công việc"]').evaluateAll(inputs=>inputs.some(input=>input.value==='Chỉ thuộc khách A, không được sang B')),'the open editor retains a note acknowledged at a newer project revision');
const sidebar=page.getByLabel('Tổng hợp ghi chú chưa hoàn thành').first();
assert.equal(await sidebar.locator('.sidebar-note').filter({hasText:delayedNote.content}).count(),1,'an older feed cannot hide the acknowledged note from the sidebar');
control.staleAssignedFeed=false;

phase='remote completion reconciles an open project';
const directReadsBeforeCompletion=readLog.filter(request=>request.action==='load-work-notes').length;
Object.assign(messageAssignment,{acceptedAt:fixedNow,acceptedBy:member.email,actualDate:'28/10/2026',completedAt:fixedNow,archivedAt:fixedNow,archivePending:false,revision:messageAssignment.revision+1});
notesRevision.set(records[0].projectId,notesRevision.get(records[0].projectId)+1);
await focusPoll();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('.work-note')).some(card=>card.querySelector('textarea[aria-label="Nội dung công việc"]')?.value==='Xử lý đúng dòng khách đã chọn.'&&card.querySelector('input[aria-label="Hoàn thành thực tế"]')?.value==='28/10/2026'),undefined,{timeout:8000});
assert.equal(await sidebar.locator('.sidebar-note').filter({hasText:messageAssignment.content}).count(),0,'completed remote work is removed from the pending sidebar without reloading');
assert.equal(readLog.filter(request=>request.action==='load-work-notes').length,directReadsBeforeCompletion,'the existing assignment response updates the editor without an extra project GET');

phase='remote deletion reconciles an open project';
const directReadsBeforeDeletion=readLog.filter(request=>request.action==='load-work-notes').length;
notes.set(records[0].projectId,notes.get(records[0].projectId).filter(note=>note.id!==delayedNote.id));
deletedNoteIds.get(records[0].projectId).push(delayedNote.id);
notesRevision.set(records[0].projectId,notesRevision.get(records[0].projectId)+1);
await focusPoll();
await page.waitForFunction(()=>!Array.from(document.querySelectorAll('textarea[aria-label="Nội dung công việc"]')).some(input=>input.value==='Chỉ thuộc khách A, không được sang B'),undefined,{timeout:8000});
assert.ok(!(await cachedNotes()).some(note=>note.id===delayedNote.id),'remote deletion removes the canonical cached row');
assert.equal(await sidebar.locator('.sidebar-note').filter({hasText:delayedNote.content}).count(),0,'the deleted note also leaves the sidebar without reloading');
assert.equal(readLog.filter(request=>request.action==='load-work-notes').length,directReadsBeforeDeletion,'remote deletion is reconciled from the existing assignment response');

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
console.log(JSON.stringify({passed:true,commands:commandLog.length,uniqueCommits:committed.size,noRuntimeErrors:true,archivePendingRetained:true,customerScopedReplies:true,offlineReplayIdStable:true,remoteCompletionReconciled:true,remoteDeletionReconciled:true,staleFeedPreservesAcknowledgedNotes:true,noExtraProjectReads:true}));
} catch(error) {
  await page.screenshot({path:'outputs/interface-qa/workflow-failure.png',fullPage:true}).catch(()=>{});
  console.error(JSON.stringify({phase,errors,commands:commandLog.map(command=>({operation:command.operation,requestId:command.requestId})),pageText:(await page.locator('body').innerText().catch(()=>'' )).slice(-5000)}));
  throw error;
} finally { await browser.close(); }
