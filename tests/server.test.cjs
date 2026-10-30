const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server/Code.gs'), 'utf8');
function fixture() {
  const sheets = {}, cache = new Map(), props = new Map();
  let locked = false;
  const storage = m => ({get:k=>m.get(k)||null,put:(k,v)=>m.set(k,v),remove:k=>m.delete(k),getProperty:k=>m.get(k)||null,setProperty:(k,v)=>m.set(k,v),deleteProperty:k=>m.delete(k)});
  const c = { Date, Math, JSON, console,
    Utilities: { getUuid:crypto.randomUUID, DigestAlgorithm:{SHA_256:'sha256'}, computeDigest:(_,v)=>Array.from(crypto.createHash('sha256').update(v).digest()), formatDate:()=>new Date().toISOString().slice(0,19).replace('T',' '), sleep:()=>{} },
    CacheService:{getScriptCache:()=>storage(cache)}, PropertiesService:{getScriptProperties:()=>storage(props)},
    LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false,'recursive lock');locked=true},releaseLock(){assert.equal(locked,true);locked=false}})},
    SpreadsheetApp:{flush:()=>{},getActiveSpreadsheet:()=>({getSheetByName:n=>sheet(n)})}
  };
  function sheet(n) {
    if (!sheets[n]) return null;
    const rows=sheets[n];
    return {getLastRow:()=>rows.length,getLastColumn:()=>Math.max(...rows.map(r=>r.length)),
      getRange(r,col,nr=1,nc=1){ return {
        getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>rows[r-1+i]?.[col-1+j]??'')),
        getValue:()=>rows[r-1]?.[col-1]??'',
        setValues(vals){assert.equal(vals.length,nr);for(let i=0;i<nr;i++){assert.equal(vals[i].length,nc);rows[r-1+i]??=[];for(let j=0;j<nc;j++)rows[r-1+i][col-1+j]=vals[i][j]}},
        setValue(v){rows[r-1]??=[];rows[r-1][col-1]=v},
        clearContent(){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)if(rows[r-1+i])rows[r-1+i][col-1+j]=''}
      } }
    };
  }
  vm.createContext(c);vm.runInContext(source,c);
  for(const [n,headers] of Object.entries(c.HEADERS)) sheets[n]=[Array.from(headers)];
  sheets['설정']=[['항목','값'],['Gemini API 키','fake'],['교사 비밀번호','test-password'],['모델','test-model']];
  sheets['학급'].push(['C1','ABC234','가상 학급',3,'2026-10-27','활성']);
  sheets['학생'].push(['C1','1','가상학생',''],['C1','2','둘째학생','']);
  const criteria=[{id:'C1',name:'내용',group:'공통',levels:['1','2','3','4']}];
  sheets['과제'].push(['T1','C1','학교 소개','explain','학교를 소개해요','3-4',0,0,'',JSON.stringify(criteria),'열림','2026-10-27',3,3]);
  const request=(action,body={})=>{c.requestCache_={};return c.route_(action,body)};
  const teacher=request('teacher.login',{pw:'test-password'}).data.token;
  const codes=[];
  const student=request('student.join',{code:'ABC234',no:'1',name:'가상학생'}).data.token;
  const raw=()=>({criteria:[{id:'C1',level:3,evidence:'학교에는 나무가 있어요.',reason:'설명했어요.',tip:'예를 들어요.'}],strengths:['좋아요'],improvements:['예시'],nextTry:'예시를 써요',summary:'좋은 글이에요',corrections:[],growth:[]});
  c.callGemini_=raw;
  const base={token:student,taskId:'T1',round:1,revision:0,text:'학교에는 나무가 있어요.',title:'학교'};
  return {c,sheets,cache,props,request,teacher,student,codes,raw,base};
}
test('password only cannot access teacher actions; tokens are required',()=>{const f=fixture();assert.throws(()=>f.request('class.list',{pw:'test-password'}),/인증/);assert.equal(f.request('class.list',{token:f.teacher}).ok,true)});
test('class code + roster number/name is enough to join; wrong name is not',()=>{const f=fixture();assert.equal(f.request('student.join',{code:'ABC234',no:'1',name:'가상학생'}).ok,true);assert.equal(f.request('student.join',{code:'ABC234',no:'1',name:'엉뚱'}).ok,false);assert.equal(f.request('student.join',{code:'XXXXXX',no:'1',name:'가상학생'}).ok,false)});
test('token identity cannot be replaced with another student payload',()=>{const f=fixture();f.request('submission.saveDraft',{...f.base,no:'2',name:'둘째학생',classId:'OTHER'});assert.equal(f.sheets['제출글'][1][3],'1')});
test('removing the student from the roster revokes the session',()=>{const f=fixture();f.request('student.set',{token:f.teacher,classId:'C1',students:[{no:'2',name:'둘째학생'}]});assert.equal(f.request('submission.mine',{token:f.student,taskId:'T1'}).ok,false)});
test('logout removes token and wrong passwords are throttled',()=>{const f=fixture();f.request('auth.logout',{token:f.student});assert.throws(()=>f.request('submission.mine',{token:f.student,taskId:'T1'}),/인증/);for(let i=0;i<8;i++)assert.equal(f.request('teacher.login',{pw:'wrong'}).ok,false);assert.throws(()=>f.request('teacher.login',{pw:'test-password'}),/15분/)});
test('password change invalidates teacher token',()=>{const f=fixture();f.sheets['설정'][2][1]='changed';assert.throws(()=>f.request('class.list',{token:f.teacher}),/변경/)});
test('draft revision prevents stale tab overwrites',()=>{const f=fixture();const first=f.request('submission.saveDraft',f.base);assert.equal(first.data.revision,1);assert.equal(f.request('submission.saveDraft',{...f.base,text:'오래된 글'}).ok,false);assert.equal(f.sheets['제출글'][1][6],f.base.text)});
test('old 12-column sheets gain version header without losing records',()=>{const f=fixture();f.sheets['제출글'][0].pop();f.sheets['제출글'].push(['old','T1','C1','1','가상학생',1,'이전 글',4,'','임시저장','이전 제목','2026-10-26']);assert.equal(f.request('submission.saveDraft',f.base).ok,true);assert.equal(f.sheets['제출글'][0][12],'버전');assert.equal(f.sheets['제출글'][1][0],'old')});
test('successful submit rejects delayed save from the previous round',()=>{const f=fixture();assert.equal(f.request('submission.submit',f.base).ok,true);assert.equal(f.request('submission.saveDraft',f.base).ok,false);assert.equal(f.sheets['제출글'].length,2)});
test('AI failure preserves submitted text and supports retry',()=>{const f=fixture();f.c.callGemini_=()=>{throw Error('fake outage')};const res=f.request('submission.submit',f.base);assert.equal(res.ok,true);assert.equal(res.data.feedback,null);assert.equal(f.sheets['제출글'][1][9],'제출됨');f.c.callGemini_=f.raw;assert.equal(f.request('feedback.request',{token:f.student,submissionId:res.data.submissionId}).ok,true)});
test('second generation of same submission is blocked while AI is running',()=>{const f=fixture();let attempts=0;f.c.callGemini_=()=>{attempts++;const id=f.sheets['제출글'][1][0];const result=f.c.generateFeedbackSafe_(id);assert.match(result.error,/만들고/);return f.raw()};assert.equal(f.request('submission.submit',f.base).ok,true);assert.equal(attempts,1)});
test('reopening while AI is running discards stale feedback',()=>{const f=fixture();f.c.callGemini_=()=>{const id=f.sheets['제출글'][1][0];assert.equal(f.request('submission.reopen',{token:f.teacher,submissionId:id}).ok,true);return f.raw()};const result=f.request('submission.submit',f.base);assert.match(result.data.feedbackError,/변경/);assert.equal(f.sheets['제출글'][1][9],'임시저장');assert.equal(f.sheets['피드백'].length,1)});
test('changing task during AI generation discards result',()=>{const f=fixture();f.c.callGemini_=()=>{f.sheets['과제'][1][4]='새 글감';return f.raw()};assert.match(f.request('submission.submit',f.base).data.feedbackError,/변경/)});
test('regenerate preserves teacher note and final level',()=>{const f=fixture();const id=f.request('submission.submit',f.base).data.submissionId;f.request('feedback.teacher',{token:f.teacher,submissionId:id,teacherNote:'잘했어요',finalLevels:{C1:4}});const r=f.request('feedback.regenerate',{token:f.teacher,submissionId:id});assert.equal(r.data.feedback.teacherNote,'잘했어요');assert.equal(r.data.feedback.finalLevels.C1,4)});
test('invented evidence/corrections rejected; teacher level is growth baseline',()=>{const f=fixture(),task=f.c.findTask_('T1');const raw=f.raw();raw.criteria[0].evidence='없는 문장';raw.corrections=[{original:'없는 표현',fixed:'수정'},{original:'나무',fixed:'큰 나무'}];raw.growth=[{id:'C1',before:1,after:3,comment:'변화'}];const fb=f.c.normalizeFeedback_(raw,task,{text:f.base.text,name:'가상학생'},true,{criteria:[{id:'C1',level:1}],finalLevels:{C1:4}});assert.equal(fb.criteria[0].evidence,'');assert.equal(fb.corrections.length,1);assert.equal(fb.growth.items[0].before,4)});
test('AI prompt minimizes names and common identifiers and uses final levels',()=>{const f=fixture();const p=f.c.buildFeedbackPrompt_(f.c.findTask_('T1'),{name:'가상학생',round:2,text:'가상학생 010-1234-5678 test@example.com'}, {'학년':3},{round:1,text:'이전 글'},{criteria:[{id:'C1',name:'내용',level:1,tip:'연습'}],finalLevels:{C1:4}});assert.ok(!p.user.includes('가상학생'));assert.ok(!p.user.includes('010-1234-5678'));assert.ok(!p.user.includes('test@example.com'));assert.ok(p.user.includes('4단계'))});
test('student tasks expose progress and finished rounds',()=>{const f=fixture();assert.equal(f.request('task.listForStudent',{token:f.student}).data.tasks[0].progress,'시작 전');f.request('submission.saveDraft',f.base);assert.equal(f.request('task.listForStudent',{token:f.student}).data.tasks[0].progress,'작성 중')});

test('only teacher can trash and restore tasks',()=>{const f=fixture();for(const action of ['task.trash','task.restore'])assert.throws(()=>f.request(action,{token:f.student,taskId:'T1'}),/인증/)});
test('trash hides tasks and blocks student access without deleting essays or feedback; restore is closed',()=>{
 const f=fixture(); const id=f.request('submission.submit',f.base).data.submissionId;
 const records=JSON.stringify([f.sheets['제출글'],f.sheets['피드백']]);
 assert.equal(f.request('task.trash',{token:f.teacher,taskId:'T1'}).ok,true);
 assert.equal(f.request('task.list',{token:f.teacher,classId:'C1'}).data.tasks.length,0);
 assert.equal(f.request('task.list',{token:f.teacher,classId:'C1',trash:true}).data.tasks.length,1);
 assert.equal(f.request('task.listForStudent',{token:f.student}).data.tasks.length,0);
 for(const action of ['submission.mine','submission.saveDraft','submission.submit'])assert.equal(f.request(action,f.base).ok,false);
 assert.equal(f.request('feedback.request',{token:f.student,submissionId:id}).ok,false);
 assert.equal(f.request('task.setStatus',{token:f.teacher,taskId:'T1',status:'열림'}).ok,false);
 assert.equal(f.request('task.restore',{token:f.teacher,taskId:'T1'}).data.status,'닫힘');
 assert.equal(JSON.stringify([f.sheets['제출글'],f.sheets['피드백']]),records);
 assert.equal(f.request('task.setStatus',{token:f.teacher,taskId:'T1',status:'열림'}).ok,true);
 assert.equal(f.request('submission.mine',f.base).data.submitted[0].feedback.criteria[0].level,3);
});
test('trash while AI is running discards result',()=>{const f=fixture();f.c.callGemini_=()=>{f.request('task.trash',{token:f.teacher,taskId:'T1'});return f.raw()};assert.match(f.request('submission.submit',f.base).data.feedbackError,/변경/);assert.equal(f.sheets['피드백'].length,1)});
test('new genre rubrics fall back safely alongside customized old rubric sheet',()=>{
 const f=fixture();f.sheets['루브릭'].push(['공통','3-4','C3','우리반 표현','공통','a','b','c','d']);
 const before=JSON.stringify(f.sheets['루브릭']);
 for(const genre of ['reflect','experience','report','letter'])for(const band of ['3-4','5-6']){
  const r=f.request('rubric.defaults',{token:f.teacher,genre,band});assert.equal(r.ok,true);
  assert.ok(r.data.criteria.length>=3);assert.equal(new Set(r.data.criteria.map(c=>c.id)).size,r.data.criteria.length);
  for(const c of r.data.criteria){assert.equal(c.levels.length,4);assert.ok(c.levels.every(Boolean))}
 }
 const reflect=f.request('rubric.defaults',{token:f.teacher,genre:'reflect',band:'3-4'}).data.criteria;
 assert.ok(reflect.some(c=>c.name==='우리반 표현'));assert.ok(reflect.some(c=>c.id==='R4'));assert.ok(!reflect.some(c=>c.id==='C2'));
 assert.equal(JSON.stringify(f.sheets['루브릭']),before);
 assert.match(f.c.GENRE_GUIDE.reflect,/강요하지/);
});
