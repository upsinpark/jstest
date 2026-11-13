import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base='https://www.dghma.org/pg/bbs/board.php?bo_table=recruit_new_3';
const dir='daegu-jobs/data';
await fs.mkdir(dir,{recursive:true});
let previous={jobs:[],lastSuccess:null};
try{previous=JSON.parse(await fs.readFile(dir+'/jobs.json','utf8'));}catch{}
const now=new Date().toISOString();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({locale:'ko-KR',timezoneId:'Asia/Seoul'});
const existing=new Map(previous.jobs.map(j=>[j.id,j]));
try{
 const found=new Map();
 for(let p=1;p<=5;p++){
  await page.goto(base+(p>1?'&page='+p:''),{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('table').filter({hasText:'채용정보'}).first().waitFor({timeout:30000});
  const items=await page.locator('tr').evaluateAll(rows=>rows.flatMap(row=>{
   const a=row.querySelector('a[href*="wr_id="]');if(!a)return[];
   const cells=[...row.querySelectorAll('td')].map(c=>c.innerText.trim());
   const id=Number(new URL(a.href).searchParams.get('wr_id'));return id?[{id,url:a.href,cells}]:[];
  }));
  if(!items.length)throw new Error('채용목록을 확인하지 못했습니다.');
  for(const item of items)found.set(item.id,item);
  if(items.some(i=>i.id<=2817))break;
 }
 const targets=new Set([...found.keys()].filter(id=>id>2830||existing.has(id)));
 for(const id of existing.keys())targets.add(id);
 const updated=new Map(existing);
 for(const id of targets){
  await page.goto(base+'&wr_id='+id,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('th').filter({hasText:/^단지명$/}).first().waitFor({timeout:25000});
  const fields=await page.locator('tr').evaluateAll(rows=>{
   const obj={};for(const r of rows){const cs=[...r.children];for(let i=0;i<cs.length;i++)if(cs[i].tagName==='TH'&&cs[i+1]?.tagName==='TD')obj[cs[i].innerText.trim()]=cs[i+1].innerText.trim();}return obj;
  });
  if(!fields['단지명']||!fields['마감여부'])throw new Error('상세정보 누락: '+id);
  const text=fields['기타사항']??'', lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const relevant=lines.filter(s=>/급여|월급|수당|근무시간|휴게시간|경력|자격|선임|교대|격일|비번|주간|야간|소방|기계설비|전기기능사/.test(s)&&!/@|이메일|전화|팩스|연락처|근무시작|출근 예정/.test(s));
  const payLines=lines.filter(s=>/급\s*여|월급/.test(s)&&/\d{3}/.test(s));
  const parsePay=s=>{const won=s.match(/([\d,]+)\s*원/),man=s.match(/([\d,.]+)\s*만(?:\s*원)?/),symbol=s.match(/[₩\\]\s*([\d,]{6,})/);return man?Math.floor(Number(man[1].replaceAll(',',''))):won?Math.floor(Number(won[1].replaceAll(',',''))/10000):symbol?Math.floor(Number(symbol[1].replaceAll(',',''))/10000):null;};
  const payOptions=payLines.map(line=>({description:line,salary:parsePay(line)})).filter(x=>x.salary);
  const salary=payOptions.length===1?payOptions[0].salary:null;
  const related=lines.filter(s=>/수당|식대|상여|명절|휴가비|검침비/.test(s)).map(s=>s.replace(/연차(?:수당)?[^/\n,·]*|퇴직금[^/\n,·]*/g,''));
  const included=related.some(s=>/포함/.test(s)), separate=related.some(s=>/별도/.test(s));
  const allowance=included&&separate?'수당 일부 포함·일부 별도':included?'수당 포함':separate?'수당 별도':'';
  const shift=/주당비|3교대|주[\s,.·]*(?:야|당)[\s,.·]*비/.test(text)?'주당비':/격일/.test(text+' '+fields['근무시간'])?'격일':'미확인';
  let conditionSection='';const requiredLines=[];
  for(const line of lines){if(/^■/.test(line))conditionSection=line;if(/우대/.test(conditionSection))continue;if(/필수|선임\s*가능/.test(line)&&!/우대|이력서|기재|제출|@|지원|팩스/.test(line))requiredLines.push(line);}
  const required=requiredLines.join(' / ');
  const old=existing.get(id)??{};
  updated.set(id,{...old,id,url:base+'&wr_id='+id,name:fields['단지명'],households:parseInt((fields['총세대수']??'').replaceAll(',',''))||null,company:fields['위탁사명']??'',address:(fields['주소']??'').replace(/^대구(?:광역시|시)?\s*/,''),status:fields['마감여부'],salary:salary??old.salary??null,salaryLine:salary?salary+'만원'+(allowance?' / '+allowance:''):old.salaryLine??'급여 미확인',shift,required,experience:lines.filter(s=>/경력|유경험/.test(s)).join(' / ')||fields['경력']||'',workTime:relevant.filter(s=>/근무시간|근무형태|교대|격일|휴게|주간|야간|비번/.test(s)).join('\n')||fields['근무시간']||'',sourceDetails:lines.filter(s=>!/@|이메일|전화|팩스|연락처|근무시작|출근.?예정|입사.?예정|필수.?기재|제출|이력서|접수|방문|지원서|채용시|채용 시|\d{2,3}-\d{3,4}-\d{4}/.test(s)).join('\n'),payOptions,multiRole:payOptions.length>1,lastVerified:now});
 }
 const result={schemaVersion:1,lastAttempt:now,lastSuccess:now,status:'success',message:'클라우드 수집 성공',jobs:[...updated.values()].sort((a,b)=>b.id-a.id)};
 await fs.writeFile(dir+'/jobs.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({status:'success',checked:targets.size,total:result.jobs.length}));
}catch(error){
 await fs.writeFile(dir+'/jobs.json',JSON.stringify({...previous,lastAttempt:now,status:'failed',message:'채용사이트 접근 또는 상세정보 확인 실패. 마지막 성공 자료를 유지합니다.'},null,2));
 console.error('수집 실패:',error.message);process.exitCode=1;
}finally{await browser.close();}
