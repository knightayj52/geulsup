const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const server = http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}});
const ID='TEST_SERVER_12345678901234567890';
const criterion={id:'C1',name:'내용',group:'공통',levels:['처음','시작','잘함','성장']};
const feedback={criteria:[{id:'C1',name:'내용',level:3,evidence:'학교에는 나무가 있어요.',reason:'자세하게 설명했어요.',tip:'예를 더 넣어 보세요.'}],strengths:['나무의 모습을 설명했어요.'],improvements:['예를 넣어 보세요.'],nextTry:'둘째 문단에 예를 넣어 보세요.',summary:'읽는 사람을 생각한 글이에요.',corrections:[],finalLevels:{},teacherNote:'',createdAt:'2026-10-27 09:00:00'};
const task={taskId:'T1',classId:'C1',title:'우리 학교 소개하기',genre:'explain',genreLabel:'설명하는 글',band:'3-4',prompt:'우리 학교의 자랑을 소개해 보세요.',minChars:0,maxChars:1000,requiredWords:[],criteriaNames:['내용'],criteria:[criterion],status:'열림',maxRounds:3,progress:'피드백 도착'};
const klass={classId:'C1',name:'3학년 글숲반',grade:3,studentCount:2,taskCount:1,code:'ABC234',status:'활성',createdAt:'2026-10-27'};
const sub={submissionId:'S1',taskId:'T1',classId:'C1',no:'1',name:'가상학생',round:1,title:'학교',text:'학교에는 나무가 있어요.',charCount:15,status:'피드백완료',submittedAt:'2026-10-27 09:00:00',feedback};
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[]; let saved=[], submits=0, failSave=false, delaySave=0, mineDraft=null;
 async function pageFor(role,opts={}){
  const page=await browser.newPage({viewport:{width:1366,height:950}});
  page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  await page.route('https://**/*',async route=>{
   if(route.request().url().includes('fonts.googleapis.com') && process.env.FONT_FIXTURE_DIR) { const css=[400,700].map(w=>fs.readFileSync(path.join(process.env.FONT_FIXTURE_DIR,w+'.css'),'utf8')).join('\n').replace(/url\(([^)]+)\)/g,(_,file)=>'url(data:font/woff2;base64,'+fs.readFileSync(path.join(process.env.FONT_FIXTURE_DIR,file.replace(/[\"']/g,''))).toString('base64')+')'); return route.fulfill({contentType:'text/css',body:css}); }
   if(!route.request().url().includes('script.google.com')) return route.abort();
   const b=JSON.parse(route.request().postData()||'{}'); let d={};
   switch(b.action){
    case 'ping':d={version:'0.6.0',protocol:2};break;
    case 'task.listForStudent':d={tasks:[task]};break;
    case 'submission.mine':if(opts.delayMine)await new Promise(r=>setTimeout(r,opts.delayMine));d={taskOpen:true,maxRounds:3,finished:false,locked:false,nextRound:2,draft:mineDraft,submitted:[sub]};break;
    case 'submission.saveDraft': if(delaySave)await new Promise(r=>setTimeout(r,delaySave)); if(failSave)return route.fulfill({body:JSON.stringify({ok:false,error:'테스트 저장 실패'})}); saved.push(b);d={revision:b.revision+1,savedAt:'2026-10-27 10:00:00'};break;
    case 'submission.submit': submits++;await new Promise(r=>setTimeout(r,400));d={feedback};break;
    case 'class.list':d={classes:[klass]};break;
    case 'student.list':d={students:[{no:'1',name:'가상학생'},{no:'2',name:'둘째학생'}]};break;
    case 'student.codes':d={students:[{no:'1',name:'가상학생',pin:'ABC123DEF4'}]};break;
    case 'task.list':d={tasks:[task]};break;
    case 'rubric.defaults':d={criteria:[criterion]};break;
    case 'teacher.status':d={teacher:{name:'교사',model:'test'},checks:{apiKey:true,password:true,sheets:true,rubrics:true}};break;
    case 'submission.list':d={task,counts:{total:2,submitted:0,draft:0,none:1,done:1},rows:[{no:'1',name:'가상학생',state:'피드백완료',submissionId:'S1',round:1,feedback:{levels:[{id:'C1',name:'내용',level:3}],correctionKinds:[],correctionsCount:0,improvements:[],hasTeacherNote:false}},{no:'2',name:'둘째학생',state:'미작성',round:0}]};break;
    case 'submission.get':d={task,submission:sub,rounds:[sub]};break;
    case 'feedback.teacher': d={};break;
    default:d={};
   }
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:d})});
  });
  await page.addInitScript(({role,ID,opts})=>{
   localStorage.setItem('geulsup_api_id',ID);
   if(role==='student')sessionStorage.setItem('geulsup_student_v2',JSON.stringify({token:'student-token',classId:'C1',className:'3학년 글숲반',no:'1',name:'가상학생',code:'ABC234'}));
   if(role==='teacher')sessionStorage.setItem('geulsup_teacher_token','teacher-token');
   if(opts.local)localStorage.setItem('geulsup_draft_'+ID+'_C1_1_T1',JSON.stringify(opts.local));
   if(opts.storageFail){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('geulsup_draft'))throw Error('quota');return set.call(this,k,v)}}
  },{role,ID,opts});
  return page;
 }
 const entry=await pageFor('guest');await entry.goto(url);await entry.locator('.entry-layout').waitFor();await entry.screenshot({path:'/tmp/geulsup-entry-desktop.png',fullPage:true});await entry.setViewportSize({width:390,height:844});assert.ok(await entry.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await entry.screenshot({path:'/tmp/geulsup-entry-mobile.png',fullPage:true});await entry.close();
 const overview=await pageFor('student');await overview.goto(url+'/#/class');await overview.locator('.task-item').waitFor();await overview.screenshot({path:'/tmp/geulsup-student-home.png',fullPage:true});await overview.close();
 const dashboard=await pageFor('teacher');await dashboard.goto(url+'/#/teacher/classes');await dashboard.locator('.class-item').waitFor();await dashboard.screenshot({path:'/tmp/geulsup-dashboard.png',fullPage:true});await dashboard.setViewportSize({width:390,height:844});assert.ok(await dashboard.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await dashboard.screenshot({path:'/tmp/geulsup-dashboard-mobile.png',fullPage:true});await dashboard.close();
 const p=await pageFor('student',{local:{round:2,revision:0,title:'복원 제목',text:'복원된 새 글입니다.'}});
 await p.goto(url+'/#/class/task/T1');await p.locator('.essay-editor').waitFor();assert.equal(await p.locator('.essay-editor').inputValue(),'복원된 새 글입니다.');
 await p.waitForTimeout(3000);assert.equal(saved.at(-1).text,'복원된 새 글입니다.');assert.equal(saved.at(-1).token,'student-token');
 await p.locator('.essay-editor').fill('학교에는 커다란 나무가 있어요.');
 await p.getByRole('button',{name:'글 제출하기',exact:true}).click();
 assert.equal(await p.locator('.essay-editor').isDisabled(),true);
 await p.waitForTimeout(800);assert.equal(submits,1);assert.ok(saved.at(-1).revision>=1);
 await p.screenshot({path:'/tmp/geulsup-student-desktop.png',fullPage:true});
 await p.setViewportSize({width:768,height:1024});await p.getByRole('button',{name:'피드백 보기',exact:true}).click();assert.equal(await p.locator('.fb-card').isVisible(),true);assert.equal(await p.locator('.essay-editor').isVisible(),false);
 await p.screenshot({path:'/tmp/geulsup-student-tablet.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.close();
 failSave=true;const fail=await pageFor('student',{storageFail:true});await fail.goto(url+'/#/class/task/T1');await fail.locator('.essay-editor').fill('저장 실패 확인');await fail.getByRole('button',{name:'글 제출하기',exact:true}).click();await fail.waitForTimeout(150);assert.equal(submits,1);assert.match(await fail.locator('.save-state').textContent(),/글을 복사/);assert.equal(await fail.locator('.essay-editor').isDisabled(),false);await fail.close();failSave=false;
 const conflict=await pageFor('student',{local:{round:1,revision:0,title:'옛 글',text:'덮어쓰면 안 되는 글'}});await conflict.goto(url+'/#/class/task/T1');await conflict.locator('.essay-editor').waitFor();assert.equal(await conflict.locator('.essay-editor').inputValue(),sub.text);assert.equal(await conflict.locator('.recovery').count(),1);await conflict.close();
 delaySave=500;
 const leaving=await pageFor('student');await leaving.goto(url+'/#/class/task/T1');await leaving.locator('.essay-editor').fill('사용을 마치기 전의 글');await leaving.getByRole('button',{name:'지금 저장',exact:true}).click();await leaving.getByRole('button',{name:'사용 마치기',exact:true}).click();await leaving.waitForTimeout(800);assert.equal(await leaving.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('geulsup_draft_'))),false);await leaving.close();delaySave=0;
 const stale=await pageFor('student',{delayMine:500});await stale.goto(url+'/#/class/task/T1');await stale.waitForTimeout(80);await stale.goto(url+'/#/class');await stale.waitForTimeout(700);assert.equal(await stale.locator('.essay-editor').count(),0);assert.equal(await stale.locator('.student-home').count(),1);await stale.close();
 const t=await pageFor('teacher');await t.goto(url+'/#/teacher/class/C1/tasks/T1/submissions');await t.locator('.review-filters').waitFor();await t.getByRole('combobox',{name:'제출 상태 필터'}).selectOption('미작성');assert.equal(await t.locator('tr[data-state]:visible').count(),1);await t.getByRole('combobox',{name:'제출 상태 필터'}).selectOption('전체');await t.getByRole('link',{name:'보기',exact:true}).click();await t.locator('.review-workspace').waitFor();assert.equal(await t.locator('.student-review-nav a').count(),1);await t.screenshot({path:'/tmp/geulsup-teacher-desktop.png',fullPage:true});
 await t.goto(url+'/#/teacher/class/C1');await t.getByRole('button',{name:'개인 입장 코드 발급·확인'}).click();await t.locator('.code-row').waitFor();assert.equal(await t.locator('.code-row code').textContent(),'ABC123DEF4');
 await t.goto(url+'/#/teacher/class/C1/tasks/new');await t.locator('.wizard-tabs').waitFor();await t.getByRole('button',{name:'3. 미리보기·저장'}).click();assert.equal(await t.getByText('학생에게 이렇게 보여요',{exact:true}).isVisible(),true);
 await t.setViewportSize({width:390,height:844});assert.ok(await t.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.close();
 assert.deepEqual(errors,[]);console.log('PASS: recovery, conflict copy, sequential saves, single submit, storage failure, responsive tabs, teacher filters/navigation/codes/wizard; no browser exceptions.');
 await browser.close();server.close();
}
main().catch(e=>{console.error(e);server.close();process.exit(1)});
