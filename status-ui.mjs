import {world,STAT_KEYS} from './session.mjs';
import {threshold} from './engine.mjs';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?(v!==0&&Math.abs(v)<0.001?v.toExponential(2):v.toLocaleString('ko-KR',{maximumFractionDigits:3})):'미설정';
const info=(k,v)=>`<div class="ro6-inf"><span class="ro6-k">${e(k)}</span><span class="ro6-v">${e(v??'미설정')}</span></div>`;
const detail=(title,body)=>`<details class="ro6-details"><summary>${e(title)}</summary><div class="ro6-content">${body}</div></details>`;
function bar(label,value,max,kind){const percent=typeof value==='number'&&typeof max==='number'&&max>0?Math.max(0,Math.min(100,value/max*100)):0;return `<div class="ro6-bar ro6-${kind}"><div class="ro6-lab"><span>${label}</span><span>${n(value)} / ${n(max)}</span></div><div class="ro6-track"><div class="ro6-fill" style="width:${percent}%"></div></div></div>`;}
export function statusHTML(s,data,rules,catalog,{controls=true}={}){
 const p=s.player,sys=s.systems,w=world(s,data),c=s.clocks[w];
 const time=c?`${c.date} ${c.minute===null?'시각 미정':String(Math.floor(c.minute/60)).padStart(2,'0')+':'+String(c.minute%60).padStart(2,'0')}${c.uncertain?' · 마지막 확인':''}`:'시작 시점 미정';
 let body=`<div class="ro6-rl-crest"><div class="ro6-rl-sigil">✶</div><div class="ro6-rl-ttl">${w==='reality'?'Reality Record':'Somnium Record'}</div></div><div class="ro6-status-name">${e(p.handle??'이름 미정')} <span class="ro6-muted">· ${w==='game'?'접속 중':w==='reality'?'현실':'자유 시작'}</span></div>`;
 if(w==='game'){
  const L=p.level,start=L?threshold(L,rules):null,next=L?threshold(L+1,rules):null;
  body+=`<div class="ro6-rl-vitals"><div class="ro6-rl-lv"><small>Level</small>${L??'?'}</div><div class="ro6-rl-bars">${bar('EXP',p.totalExp===null?null:Math.min(Math.max(0,p.totalExp-start),next-start),next===null?null:next-start,'exp')}${bar('HP',p.hp.value,p.hp.max,'hp')}${bar('MP',p.mp.value,p.mp.max,'mp')}</div></div><div class="ro6-rl-div"></div><div class="ro6-rl-sec">Stats</div><div class="ro6-rl-stats">${[...STAT_KEYS.map(k=>[k,p.stats[k]]),['AP',p.points]].map(([k,v])=>`<div class="ro6-stat"><div class="ro6-n">${k}</div><div class="ro6-val">${n(v)}</div></div>`).join('')}</div><div class="ro6-rl-div"></div><div class="ro6-rl-sec">Assets</div><div class="ro6-rl-assets">${[['dia','◈','다이아',p.wallet.diamonds],['gold','⊙','골드',p.wallet.gold]].map(([kind,icon,label,value])=>`<div class="ro6-asset ro6-${kind}"><span class="ro6-ic">${icon}</span><div><div class="ro6-t">${label}</div><div class="ro6-v">${n(value)}</div></div></div>`).join('')}</div>`;
  if(sys.pendingGold)body+=`<p class="ro6-muted">잔액 확인 대기 보상: 골드 +${n(sys.pendingGold)} 별도 보관</p>`;
  if(p.redBrand)body+='<div class="ro6-alert">붉은 낙인 · 퀘스트 수주 불가 · 몬스터 최대 어그로</div>';
  if(s.logoutLock)body+=`<div class="ro6-alert">로그아웃 차단 · ${e(s.logoutLock)}</div>`;
  if(sys.avatarTrap)body+=`<div class="ro6-alert">아바타 구속 · ${e(sys.avatarTrap.name??sys.avatarTrap)}</div>`;
  if(s.pendingDeath)body+=`<div class="ro6-alert">에테르 붕괴 · 부활 선택 대기<br>일반 부활: 누적 총EXP 50% 손실<br>즉시 부활: 1,000다이아 또는 1,000만 골드</div>`;
 }
 if(w==='unset')body+='<p class="ro6-muted">장소와 캐릭터 정보는 아직 정해지지 않았습니다. 첫 문장으로 원하는 시작을 알려주세요.</p>';
 const quests=s.quests.filter(q=>!['declined','failed'].includes(q.status));
 const questLabel=q=>`${q.title} · ${q.status==='offered'?'제안':q.status==='active'?'진행 중':q.rewardClaimed?'완료·수령':'완료·보상 대기'}`;
 body+=`<div class="ro6-rl-div"></div><div class="ro6-rl-sec">Info</div><div class="ro6-rl-info">${info('Loc',s.place||data.locations[s.loc]?.label)}${info('Time',time)}`;
 if(w==='game')body+=info('Guild',sys.guild.name??'없음')+info('House',sys.housing.name??'없음')+info('Pet',sys.pet?.name??'없음');
 if(w==='reality')body+=info('현실 지갑',sys.real.krw===null?'미설정':n(sys.real.krw)+'원')+info('솜누스',sys.real.capsule??'미설정')+info('몸 상태',sys.real.condition??'기록 없음')+info('영양 팩',sys.real.nutritionDays===null?'미설정':`마지막 확인 ${sys.real.nutritionDays}일`);
 body+=info('Quest',quests.length?quests.map(questLabel).join(' / '):'없음')+'</div>';
 if(w==='game'){
  const gear=['weapon','armor','accessory'].map((slot,i)=>info(['무기','방어구','장신구'][i],catalog.items[sys.equipment[slot]]?.name??sys.customItems?.[sys.equipment[slot]]?.name??'없음')).join('');
  const bag=p.inventory.map(i=>`<div class="ro6-item">${e(i.name)} × ${n(i.qty)}</div>`).join('');
  if(bag||Object.values(sys.equipment).some(Boolean))body+=detail('장비·소지품',gear+(bag||'<span class="ro6-muted">소지품 없음</span>'));
  if(p.skills.length||sys.statuses.length)body+=detail('성흔·스킬·상태',p.skills.map(id=>`<div class="ro6-item">${e(catalog.skills[id]?.name??sys.customSkills?.[id]?.name??id)}${sys.cooldowns[id]>0?' · 대기 '+n(sys.cooldowns[id])+'턴':''}</div>`).join('')+sys.statuses.map(x=>`<div class="ro6-item">${e(x.name)} · ${n(x.turns)}턴</div>`).join(''));
  if(sys.guild.loan>0)body+=detail('부활 대출',n(sys.guild.loan)+' 골드');
 }
 if(quests.some(q=>q.note))body+=detail('퀘스트 상세',quests.map(q=>`<div class="ro6-item"><b>${e(questLabel(q))}</b><br>${e(q.note)}</div>`).join(''));
 if(s.companions.length)body+=detail('동행',s.companions.map(id=>e(data.chars[id]?.name??id)).join(' · '));
 let html=`<section class="ro4-hud ro6-rlst" aria-label="렐릭타 상태창">${body}</section>`;
 return html;
}
export function bindStatus(_root,_onAction,_onContinue){}
