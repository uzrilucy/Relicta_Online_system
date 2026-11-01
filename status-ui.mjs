import {world,STAT_KEYS} from './session.mjs';
import {derived,threshold} from './engine.mjs';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?(v!==0&&Math.abs(v)<0.001?v.toExponential(2):v.toLocaleString('ko-KR',{maximumFractionDigits:3})):'미설정';
const badge=(text,kind='')=>`<span class="ro4-badge ${e(kind)}">${e(text)}</span>`;
const row=(k,v)=>`<div class="ro4-row"><span>${e(k)}</span><b>${e(v??'미설정')}</b></div>`;
const action=(label,op,args={},disabled=false)=>`<button type="button" data-ro4-action="${e(op)}" data-ro4-args="${e(JSON.stringify(args))}" ${disabled?'disabled':''}>${e(label)}</button>`;
const box=(title,body,open=false)=>`<details class="ro4-section" ${open?'open':''}><summary>${e(title)}</summary><div class="ro4-content">${body}</div></details>`;
function bar(label,value,max,kind){const percent=typeof value==='number'&&typeof max==='number'&&max>0?Math.max(0,Math.min(100,value/max*100)):0;return `<div class="ro4-bar ${kind}"><div><span>${label}</span><b>${n(value)} / ${n(max)}</b></div><div class="ro4-track"><i style="width:${percent}%"></i></div></div>`;}
export function statusHTML(s,data,rules,catalog,{controls=true}={}){
    const sys=s.systems,w=world(s,data),p=s.player,clock=s.clocks[w];
    const time=clock?`${clock.date} ${clock.minute===null?'시각 미정':`${String(Math.floor(clock.minute/60)).padStart(2,'0')}:${String(clock.minute%60).padStart(2,'0')}`}${clock.uncertain?' · 마지막 확인':''}`:'시작 시점 미정';
    const header=`<header class="ro4-head"><div><span class="ro4-eyebrow">RELICTA ONLINE</span><h3>${e(p.handle??'이름을 기다리는 기록')}</h3><p>${e(s.place||data.locations[s.loc]?.label||'위치 미정')}</p></div>${badge(w==='game'?'접속 중':w==='reality'?'현실':'자유 시작',w)}</header>`;
    let body=`<div class="ro4-meta"><span>${e(time)}</span><span>${e(data.events[s.event]??'상황 미정')}</span></div>`;
    const names=ids=>ids.length?ids.map(id=>data.chars[id]?.name??id).join(' · '):'없음';
    if(w==='unset')body+=`<p class="ro4-muted">장소와 캐릭터 정보는 아직 정해지지 않았습니다. 첫 문장으로 원하는 시작을 알려주세요.</p>`;
    if(w==='game'){
        const L=p.level,base=L?threshold(L,rules):null,next=L?threshold(L+1,rules):null;
        body+=`<div class="ro4-vitals"><div class="ro4-level"><small>LEVEL</small><strong>${L??'?'}</strong>${sys.setup.pending?badge('설정 대기'):''}</div><div class="ro4-bars">${bar('HP',p.hp.value,p.hp.max,'hp')}${bar('MP',p.mp.value,p.mp.max,'mp')}${bar('EXP',p.totalExp===null?null:p.totalExp-base,next===null?null:next-base,'exp')}</div></div>`;
        body+=`<div class="ro4-money">${row('다이아',n(p.wallet.diamonds))}${row('골드',n(p.wallet.gold))}</div>`;
        if(sys.pendingGold)body+=row('잔액 확인 대기 보상',`골드 +${n(sys.pendingGold)} 별도 보관`);
        if(p.redBrand)body+=`<div class="ro4-alert">붉은 낙인 · 영구 저주<br><small>퀘스트 수주 불가 · 몬스터의 최대 어그로</small></div>`;
        if(s.logoutLock)body+=`<div class="ro4-alert">로그아웃 차단: ${e(s.logoutLock)}</div>`;
        if(sys.avatarTrap)body+=`<div class="ro4-alert">아바타 구속: ${e(sys.avatarTrap.name??sys.avatarTrap)} · 구조 조건을 확인해주세요.</div>`;
        if(s.pendingDeath)body+=`<div class="ro4-alert"><b>에테르 붕괴 · 부활 선택</b><p>일반 부활 시 누적 EXP ${n(p.totalExp===null?null:p.totalExp/2)} 손실. 즉시 부활은 EXP를 보존합니다.</p>${controls?`<div class="ro4-actions">${action('일반 부활','revive',{mode:'normal'},!!sys.avatarTrap)}${action('1,000다이아','revive',{mode:'diamonds'},p.wallet.diamonds===null||p.wallet.diamonds<1000||s.loc==='AB_6'||!!sys.avatarTrap)}${action('1,000만 골드','revive',{mode:'gold'},p.wallet.gold===null||p.wallet.gold<10000000||s.loc==='AB_6'||!!sys.avatarTrap)}${action('길드 부활 대출','revive',{mode:'guild'},!sys.guild.name||!Number.isSafeInteger(sys.guild.revivalFund)||sys.guild.revivalFund<10000000||!Number.isSafeInteger(sys.guild.loan)||s.loc==='AB_6'||!!sys.avatarTrap)}</div>`:''}<small>10초는 세계 안의 경고 연출입니다. 실제 입력 제한은 없습니다.</small></div>`;
        const d=L?derived(s,rules,catalog):null;
        const stats=STAT_KEYS.map(k=>`<div><small>${k}</small><b>${n(p.stats[k])}</b></div>`).join('')+`<div><small>배분 가능</small><b>${n(p.points)}</b></div>`;
        body+=`<div class="ro4-grid">`+box('능력치·성장',`<div class="ro4-stats">${stats}</div>${row('누적 총EXP',n(p.totalExp))}${row('다음 레벨 총EXP',n(next))}${row('추가 스탯 획득',n(p.tickets))}${d?row('공격 / 방어',`${n(d.attack)} / ${n(d.defense)}`)+row('회피 / 물리 감소',`${Math.round(d.evasion*100)}% / ${Math.round(d.reduction*100)}%`):''}<p class="ro4-muted">레벨 하락 후에도 이미 얻은 배분점은 유지하며, 같은 레벨 재달성으로 중복 지급하지 않습니다.</p>`);
        const gear=['weapon','armor','accessory'].map((slot,i)=>row(['무기','방어구','장신구'][i],catalog.items[sys.equipment[slot]]?.name??sys.customItems?.[sys.equipment[slot]]?.name??'없음')).join('');
        const bag=p.inventory.map(i=>{const item=catalog.items[i.id]??sys.customItems?.[i.id];return `<div class="ro4-item"><div><b>${e(i.name)}</b><small>× ${n(i.qty)}${i.note?' · '+e(i.note):''}</small></div>${controls&&item?.slot?action('장착','equip',{id:i.id}):controls&&['shard','consumable','stat','deed','pet'].includes(item?.kind)?action(item.kind==='shard'?'흡수':'사용','use',{id:i.id}):''}</div>`;}).join('')||'<p class="ro4-muted">소지품 없음</p>';
        body+=box('장비·소지품',gear+bag);
        const skills=p.skills.map(id=>{const k=catalog.skills[id]??Object.values(catalog.skills).find(k=>k.name===id)??sys.customSkills?.[id];const cost=k&&d?Math.max(1,Math.ceil(k.mp/(1+d.sen*rules.senCostFactor))):null;return `<div class="ro4-item"><div><b>${e(k?.name??id)}</b><small>MP ${n(cost)} · 대기 ${n(sys.cooldowns[id]??0)}턴${!k?' · 효과 설정 대기':''}</small></div>${controls&&k?action('사용','skill',{id:k.id},sys.battle?.status!=='active'||(sys.cooldowns[id]??0)>0):''}</div>`;}).join('')||'<p class="ro4-muted">흡수한 꿈조각 없음</p>';
        body+=box('성흔·스킬·상태',skills+sys.statuses.map(x=>row(x.name,`${x.turns}턴`)).join(''));
        body+=box('소속·거처·펫',row('길드',sys.guild.name??'없음')+row('등급 / 직위',`${sys.guild.rank??'미정'} / ${sys.guild.role??'미정'}`)+row('영지',sys.guild.territory??'없음')+row('부활 대출 잔액',n(sys.guild.loan))+row('거처',sys.housing.name??'없음')+row('안전',sys.housing.safeSky?'하늘 영토 · PK/몬스터 차단':sys.housing.name?'현지 법과 위험 적용':'해당 없음')+row('펫',sys.pet?.name??'없음')+(sys.pet?.note?`<p>${e(sys.pet.note)}</p>`:''));
        body+='</div>';
        const b=sys.battle;
        if(b)body+=box(`전투 · ${b.status==='active'?'진행 중':b.status==='won'?'승리':b.status==='escaped'?'이탈':'패배'}`,row('상대',b.enemy.name)+row('라운드',n(b.round))+bar('상대 HP',b.enemy.hp,b.enemy.maxHp,'enemy')+(b.enemy.note?`<p class="ro4-muted">${e(b.enemy.note)}</p>`:'')+(controls&&b.status==='active'?`<div class="ro4-actions">${action('공격','attack')}${action('방어','defend')}${action('이탈','retreat')}</div>`:''),true);
        if(controls&&!s.pendingDeath)body+=`<div class="ro4-actions ro4-toolbar">${action('소환 1회 · 30◈','gacha',{count:1},sys.setup.pending)}${action('탐험','explore')}${action('휴식','rest')}${action('로그아웃','logout',{},!!s.logoutLock)}</div>`;
    }
    if(w==='reality')body+=`<div class="ro4-money">${row('현실 지갑',sys.real.krw===null?'미설정':n(sys.real.krw)+'원')}${row('솜누스',sys.real.capsule??'접속 장소 미정')}</div>`+box('현실 기록',row('몸 상태',sys.real.condition??'기록 없음')+row('영양 팩',sys.real.nutritionDays===null?'미설정':`마지막 확인 ${sys.real.nutritionDays}일`)+row('연결 상태','로그아웃')+`<p class="ro4-muted">게임의 스탯·재화·스킬은 별도 보관됩니다.</p>`)+(controls?`<div class="ro4-actions">${action('렐릭타 접속','login')}</div>`:'');
    const quest=s.quests.map(q=>`<div class="ro4-item"><div><b>${e(q.title)}</b><small>${e(({offered:'제안',active:'진행 중',completed:q.rewardClaimed?'완료·보상 수령':'완료·보상 대기',failed:'실패',declined:'거절'})[q.status])} · ${e(q.note)}</small></div>${controls&&q.status==='offered'?action('수락','quest',{id:q.id,status:'active'},p.redBrand):controls&&q.status==='completed'&&!q.rewardClaimed?action('은총의 룰렛','claim',{id:q.id},w!=='game'):''}</div>`).join('')||'<p class="ro4-muted">기록된 퀘스트 없음</p>';
    body+=`<div class="ro4-grid">${box('퀘스트',quest)}${box('동행·인물 기록',row('현장',names(s.cast))+row('동행',names(s.companions))+s.cast.map(id=>{const r=s.relations[id];return r?row(data.chars[id]?.name,r.note):''}).join(''))}</div>`;
    if(s.notes.length||sys.reputation.length)body+=box('기억·평판',s.notes.map(x=>`<p class="ro4-muted">${e(x)}</p>`).join('')+sys.reputation.map(x=>row(x.name??'평판',x.note??x)).join(''));
    if(controls&&w==='game'&&!s.pendingDeath&&!sys.setup.pending&&sys.battle?.status!=='active')body+=box('전투 대상 선택',`<form data-ro4-form="combat"><label>대상<select name="target">${[...Object.values(catalog.monsters).map(x=>[x.id,x.name]),...s.cast.filter(id=>!['abyss','hidden','real'].includes(data.chars[id].kind)).map(id=>[id,data.chars[id].name])].map(([id,name])=>`<option value="${e(id)}">${e(name)}</option>`).join('')}</select></label><label>방식<select name="mode"><option value="battle">실전 · 사망 위험 있음</option><option value="duel">비살상 결투</option></select></label><button type="submit">선택한 전투 시작</button></form><p class="ro4-muted">직접 지정하는 판정용 대상입니다. 선택만으로 현장에 나타나지 않습니다.</p>`);
    const latest=sys.receipts.slice(-4).reverse().map(r=>`<li><b>${e(r.text)}</b>${r.detail?`<small>${e(Array.isArray(r.detail)?r.detail.map(x=>`${({divine:'신급',high:'상등급',normal:'노말',trash:'꽝'})[x.grade]??''} · ${x.name} · ${x.beam??''}${x.broadcast?' · 서버 전체 방송':''}`).join('\n'):r.detail.name??r.detail.note??'')}</small>`:''}</li>`).join('');
    if(latest)body+=box('최근 알림',`<ul class="ro4-log">${latest}</ul>`,true);
    if(controls)body+=`<details class="ro4-section"><summary>이동·캐릭터 설정</summary><div class="ro4-content"><form data-ro4-form="travel"><label>이동 위치<select name="loc">${Object.values(data.locations).filter(l=>!['unset','reality'].includes(l.world)&&!['LOGIN','ZERO'].includes(l.code)).map(l=>`<option value="${e(l.code)}">${e(l.label)}</option>`).join('')}</select></label><button type="submit">이동</button></form><p class="ro4-muted">신규 계정은 Lv1·10포인트·재화 0의 시작안입니다. 기존 플레이어·자유 시작은 수치 정보를 입력하기 전까지 판정을 보류합니다.</p>${sys.setup.pending?`<form data-ro4-form="setup"><label>레벨<input type="number" name="level" min="1" required placeholder="미정"></label><label>시작 위치<select name="loc">${Object.values(data.locations).filter(l=>!['UNSET','ZERO','SKY'].includes(l.code)).map(l=>`<option value="${e(l.code)}">${e(l.label)}</option>`).join('')}</select></label><div class="ro4-stats">${STAT_KEYS.map(k=>`<label>${k}<input type="number" name="${k}" min="0" required placeholder="미정"></label>`).join('')}</div><label>골드<input name="gold" type="number" min="0" placeholder="미정"></label><label>다이아<input name="diamonds" type="number" min="0" placeholder="미정"></label><button type="submit">시작 정보 확정</button></form>`:''}</div></details><div class="ro4-actions">${action('이 기록으로 이야기 이어가기','continue')}</div>`;
    return `<section class="ro4-hud" aria-label="렐릭타 상태창">${header}<div class="ro4-body">${body}</div></section>`;
}
export function bindStatus(root,onAction,onContinue){
    root.addEventListener('click',async event=>{
        const b=event.target.closest('[data-ro4-action]');if(!b||b.disabled)return;
        b.disabled=true;try{if(b.dataset.ro4Action==='continue')await onContinue?.();else await onAction({type:b.dataset.ro4Action,...JSON.parse(b.dataset.ro4Args||'{}')});}finally{if(b.isConnected)b.disabled=false;}
    });
    root.addEventListener('submit',async event=>{
        const form=event.target.closest('[data-ro4-form]');if(!form)return;event.preventDefault();
        const f=new FormData(form);
        if(form.dataset.ro4Form==='travel')await onAction({type:'travel',loc:f.get('loc')});
        else if(form.dataset.ro4Form==='combat')await onAction({type:'startCombat',target:f.get('target'),nonlethal:f.get('mode')==='duel'});
        else {const wallet={};for(const k of ['gold','diamonds'])if(f.get(k)!=='')wallet[k]=Number(f.get(k));await onAction({type:'setup',loc:f.get('loc'),level:Number(f.get('level')),stats:Object.fromEntries(STAT_KEYS.map(k=>[k,Number(f.get(k))])),wallet});}
    });
}
