// v0.8.10 상태창 「Somnium Record」 — Lucid 디자인. 읽기 전용 기록이며 조작 버튼은 두지 않는다.
import {world,STAT_KEYS} from './session.mjs';
import {threshold} from './engine.mjs';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?(v!==0&&Math.abs(v)<0.001?v.toExponential(2):v.toLocaleString('ko-KR',{maximumFractionDigits:3})):'미설정';
const pc=(v,max)=>typeof v==='number'&&typeof max==='number'&&max>0?Math.max(0,Math.min(100,v/max*100)):0;

// 작은 장식 아이콘 (currentColor)
const GEM='<svg class="rl-ic-gem" viewBox="0 0 16 26" aria-hidden="true"><polygon points="8,0 0,9 8,11" fill="currentColor" fill-opacity=".95"/><polygon points="8,0 16,9 8,11" fill="currentColor" fill-opacity=".55"/><polygon points="0,9 8,11 8,26" fill="currentColor" fill-opacity=".72"/><polygon points="16,9 8,11 8,26" fill="currentColor" fill-opacity=".32"/></svg>';
const ICON={
 dia:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" fill-opacity=".22"/><path d="M6 3h12l4 6-10 12L2 9zM2 9h20M9 3l3 6 3-6M12 21L9 9M12 21l3-12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
 gold:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 8.6l1 2.3 2.4.2-1.8 1.6.6 2.4-2.2-1.3-2.2 1.3.6-2.4-1.8-1.6 2.4-.2z" fill="currentColor"/></svg>',
 won:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
};
const INFO_ICON={Loc:'⌖',Time:'◷',Guild:'⚑',House:'⌂',Pet:'❀',Quest:'✦','현실 지갑':'₩','솜누스':'◫','몸 상태':'♡','영양 팩':'⊕'};
const info=(k,v,wide=false)=>`<div class="rl-inf${wide?' is-wide':''}"><span class="rl-inf-i">${INFO_ICON[k]??'·'}</span><span class="rl-inf-k">${e(k)}</span><span class="rl-inf-v">${e(v??'미설정')}</span></div>`;
const detail=(title,body,count)=>`<details class="rl-det"><summary><span class="rl-det-t">${e(title)}</span>${count?`<span class="rl-det-n">${e(count)}</span>`:''}<span class="rl-det-cv"></span></summary><div class="rl-det-b">${body}</div></details>`;
const sec=(en,ko)=>`<div class="rl-sec"><span class="rl-sec-en">${en}</span><span class="rl-sec-ko">${ko}</span></div>`;
function bar(label,value,max,kind){
 return `<div class="rl-bar rl-${kind}"><div class="rl-bar-lab"><span class="rl-bar-k">${label}</span><span class="rl-bar-v"><b>${n(value)}</b> / ${n(max)}</span></div><div class="rl-bar-tr"><div class="rl-bar-fl" style="width:${pc(value,max).toFixed(1)}%"></div></div></div>`;
}
const alert=(head,body)=>`<div class="rl-alert"><span class="rl-alert-g">${GEM}</span><div><b>${e(head)}</b>${body?`<span>${body}</span>`:''}</div></div>`;

export function statusHTML(s,data,rules,catalog,{controls=true}={}){
 const p=s.player,sys=s.systems,w=world(s,data),c=s.clocks[w],loc=data.locations[s.loc];
 const zone=w==='game'?(loc?.world??'game'):w;
 const time=c?`${c.date} ${c.minute===null?'시각 미정':String(Math.floor(c.minute/60)).padStart(2,'0')+':'+String(c.minute%60).padStart(2,'0')}${c.uncertain?' · 마지막 확인':''}`:'시작 시점 미정';
 const state=w==='game'?'접속 중':w==='reality'?'로그아웃 · 현실':'자유 시작';
 const place=s.place||loc?.label;
 let lv='',expNow=null,expMax=null;
 if(w==='game'){
  const L=p.level,start=L?threshold(L,rules):null,next=L?threshold(L+1,rules):null;
  expNow=p.totalExp===null||start===null?null:Math.min(Math.max(0,p.totalExp-start),next-start);expMax=next===null||start===null?null:next-start;
  lv=`<div class="ro6-rl-lv rl-lv" style="--p:${pc(expNow,expMax).toFixed(1)}"><span class="rl-lv-ring"></span><span class="rl-lv-in"><small>Lv</small><b>${L??'?'}</b></span></div>`;
 }
 let body=`<header class="rl-hd"><div class="rl-hd-id"><div class="rl-hd-eb">${GEM}<span>${w==='reality'?'Reality Record':'Somnium Record'}</span></div>`+
  `<div class="rl-hd-name">${e(p.handle??'이름 미정')}</div><div class="rl-hd-st"><i></i><span>${state}</span>${place?`<span class="rl-hd-sep">·</span><span class="rl-hd-loc">${e(place)}</span>`:''}</div></div>${lv}</header>`;
 if(w==='game'){
  body+=`<div class="rl-bars">${bar('HP',p.hp.value,p.hp.max,'hp')}${bar('MP',p.mp.value,p.mp.max,'mp')}${bar('EXP',expNow,expMax,'exp')}</div>`;
  body+=sec('Stats','능력치')+`<div class="rl-stats">${STAT_KEYS.map(k=>`<div class="rl-stat"><span class="rl-stat-k">${k}</span><span class="rl-stat-v">${n(p.stats[k])}</span></div>`).join('')}<div class="rl-stat is-ap${p.points>0?' has-pt':''}"><span class="rl-stat-k">AP</span><span class="rl-stat-v">${n(p.points)}</span></div></div>`;
  body+=`<div class="rl-assets">${[['dia','다이아',p.wallet.diamonds],['gold','골드',p.wallet.gold]].map(([k,label,v])=>`<div class="rl-asset rl-${k}"><span class="rl-asset-i">${ICON[k]}</span><span class="rl-asset-t"><small>${label}</small><b>${n(v)}</b></span></div>`).join('')}</div>`;
  if(sys.pendingGold)body+=`<p class="rl-muted">잔액 확인 대기 보상: 골드 +${n(sys.pendingGold)} 별도 보관</p>`;
  if(p.redBrand)body+=alert('붉은 낙인','퀘스트 수주 불가 · 몬스터 최대 어그로');
  if(s.logoutLock)body+=alert('로그아웃 차단',e(s.logoutLock));
  if(sys.avatarTrap)body+=alert('아바타 구속',e(sys.avatarTrap.name??sys.avatarTrap));
  if(s.pendingDeath)body+=alert('에테르 붕괴 · 부활 선택 대기','일반 부활: 누적 총EXP 50% 손실<br>즉시 부활: 1,000다이아 또는 1,000만 골드');
 }
 if(w==='unset')body+='<p class="rl-muted rl-unset">장소와 캐릭터 정보는 아직 정해지지 않았습니다. 첫 문장으로 원하는 시작을 알려주세요.</p>';
 const quests=s.quests.filter(q=>!['declined','failed'].includes(q.status));
 const questLabel=q=>`${q.title} · ${q.status==='offered'?'제안':q.status==='active'?'진행 중':q.rewardClaimed?'완료·수령':'완료·보상 대기'}`;
 body+=sec('Record','기록')+`<div class="rl-info">${info('Loc',place)}${info('Time',time)}`;
 if(w==='game')body+=info('Guild',sys.guild.name??'없음')+info('House',sys.housing.name??'없음')+info('Pet',sys.pet?.name??'없음');
 if(w==='reality')body+=info('현실 지갑',sys.real.krw===null?'미설정':n(sys.real.krw)+'원')+info('솜누스',sys.real.capsule??'미설정')+info('몸 상태',sys.real.condition??'기록 없음')+info('영양 팩',sys.real.nutritionDays===null?'미설정':`마지막 확인 ${sys.real.nutritionDays}일`);
 body+=info('Quest',quests.length?quests.map(questLabel).join(' / '):'없음',true)+'</div>';
 let dets='';
 if(w==='game'){
  const gear=['weapon','armor','accessory'].map((slot,i)=>`<div class="rl-gear"><span>${['무기','방어구','장신구'][i]}</span><b>${e(catalog.items[sys.equipment[slot]]?.name??sys.customItems?.[sys.equipment[slot]]?.name??'없음')}</b></div>`).join('');
  const bag=p.inventory.map(i=>`<div class="rl-item"><span>${e(i.name)}</span><b>× ${n(i.qty)}</b></div>`).join('');
  if(bag||Object.values(sys.equipment).some(Boolean))dets+=detail('장비·소지품',`<div class="rl-gears">${gear}</div>`+(bag||'<span class="rl-muted">소지품 없음</span>'),p.inventory.length||'');
  if(p.skills.length||sys.statuses.length)dets+=detail('성흔·스킬·상태',p.skills.map(id=>`<div class="rl-item is-skill"><span>${e(catalog.skills[id]?.name??sys.customSkills?.[id]?.name??id)}</span>${sys.cooldowns[id]>0?`<b>대기 ${n(sys.cooldowns[id])}턴</b>`:''}</div>`).join('')+sys.statuses.map(x=>`<div class="rl-item is-status"><span>${e(x.name)}</span><b>${n(x.turns)}턴</b></div>`).join(''),p.skills.length+sys.statuses.length);
  if(sys.guild.loan>0)dets+=detail('부활 대출',`<div class="rl-item"><span>상환 잔액</span><b>${n(sys.guild.loan)} 골드</b></div>`);
 }
 if(quests.some(q=>q.note))dets+=detail('퀘스트 상세',quests.map(q=>`<div class="rl-item is-quest"><span><b>${e(questLabel(q))}</b><br>${e(q.note)}</span></div>`).join(''),quests.length);
 if(s.companions.length)dets+=detail('동행',`<div class="rl-chips">${s.companions.map(id=>`<span>${e(data.chars[id]?.name??id)}</span>`).join('')}</div>`,s.companions.length);
 if(dets)body+=`<div class="rl-dets">${dets}</div>`;
 body+=`<footer class="rl-ft"><span>Oneiros Network</span><span>Sync r${e(s.rev??0)}</span></footer>`;
 return `<section class="ro4-hud ro6-rlst rl-hud" data-world="${w}" data-zone="${e(zone)}" aria-label="렐릭타 상태창">${body}</section>`;
}
export function bindStatus(_root,_onAction,_onContinue){}
