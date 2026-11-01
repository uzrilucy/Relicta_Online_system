import {initialSession,normalizeSession,authorAction,world,STAT_KEYS} from './session.mjs';
import {allowed} from './router.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
export const secureRng={int(max){
    if(!integer(max,1)||max>0x100000000)throw new Error('Invalid random bound');
    const limit=Math.floor(0x100000000/max)*max,b=new Uint32Array(1);let n;
    do{globalThis.crypto.getRandomValues(b);n=b[0];}while(n>=limit);
    return n%max;
}};
const chance=(rng,p)=>rng.int(1000000)<Math.floor(clamp(p,0,1)*1000000);
export function threshold(level,rules){return rules.expFactor*(level-1)*level;}
export function levelFor(exp,rules){let l=Math.max(1,Math.floor((1+Math.sqrt(1+4*exp/rules.expFactor))/2));while(threshold(l+1,rules)<=exp)l++;while(threshold(l,rules)>exp)l--;return l;}
function defaults(s){
    s.systems={setup:{mode:'newbie',pending:false},growth:{highestLevel:s.player.level??1},equipment:{weapon:null,armor:null,accessory:null},
        guild:{name:null,rank:null,role:null,territory:null,loan:null},housing:{name:null,type:null,safeSky:false},pet:null,
        reputation:[],statuses:[],cooldowns:{},battle:null,receipts:[],deadNatives:[],npcOverrides:{},pendingGold:0,real:{krw:null,capsule:null,nutritionDays:null},
        ...s.systems};
    for(const [key,base]of Object.entries({setup:{mode:'newbie',pending:false},growth:{highestLevel:s.player.level??1},equipment:{weapon:null,armor:null,accessory:null},guild:{name:null,rank:null,role:null,territory:null,loan:null},housing:{name:null,type:null,safeSky:false},real:{krw:null,capsule:null,nutritionDays:null}}))s.systems[key]={...base,...s.systems[key]};
    return s;
}
export function validateRules(rules,catalog){
    if(!(rules.expFactor>0))throw new Error('경험치 설정을 확인해주세요.');
    for(const table of [rules.gachaWeights,rules.questWeights]){
        if(!Array.isArray(table)||table.reduce((n,x)=>n+x[1],0)!==rules.gradeTotal||table.some(([id,w])=>!integer(w,1)||!Object.values(catalog.items).some(i=>i.grade===id)))throw new Error('등급 확률표 합계와 아이템 풀을 확인해주세요.');
    }
    if(Object.values(catalog.items).some(i=>!integer(i.weight??1,1)))throw new Error('아이템 가중치를 확인해주세요.');
    return true;
}
export function prepareState(input,data){return normalizeSession(defaults(normalizeSession(input,data)),data);}
export function seed(data,rules,catalog,mode='newbie'){
    let s=defaults(initialSession(data));s.systems.setup={mode,pending:mode!=='newbie'};s.cast=[];s.companions=[];s.relations={};
    if(mode!=='newbie'){s.loc=mode==='veteran'?'LOGIN':'UNSET';s.place='';s.player.level=null;s.player.totalExp=null;s.player.points=0;s.player.wallet={gold:null,diamonds:null};s.clocks.game.minute=null;s.clocks.game.uncertain=true;}
    else {s.player.wallet={gold:0,diamonds:0};recalculate(s,rules,catalog,true);}
    return normalizeSession(s,data);
}
function itemOf(s,catalog,id){return catalog.items[id]??s.systems.customItems?.[id];}
function skillOf(s,catalog,id){return catalog.skills[id]??Object.values(catalog.skills).find(k=>k.name===id)??s.systems.customSkills?.[id];}
export function derived(input,rules,catalog){
    const s=defaults(copy(input)),p=s.player,L=p.level??1,st=p.stats;
    const gear=Object.values(s.systems.equipment).map(id=>itemOf(s,catalog,id)).filter(Boolean);
    const weapon=itemOf(s,catalog,s.systems.equipment.weapon);
    const sen=st.SEN+gear.reduce((n,i)=>n+(i.sen??0),0);
    return {hp:rules.hpBase+st.CON*rules.hpPerCon+(L-1)*rules.hpPerLevel,
        mp:rules.mpBase+st.INT*rules.mpPerInt+(L-1)*rules.mpPerLevel,
        attack:rules.attackBase+st.STR*rules.attackPerStr+(weapon?.attack??0),defense:gear.reduce((n,i)=>n+(i.defense??0),0),
        reduction:Math.min(rules.agiReductionCap,st.AGI/(st.AGI+rules.agiReductionScale)),
        evasion:Math.min(rules.evasionCap,st.AGI/(st.AGI+rules.evasionScale)),
        crit:rules.criticalBase+Math.min(rules.criticalBonusCap,st.LUK/(st.LUK+1000)*rules.criticalBonusCap),sen,ranged:weapon?.ranged===true};
}
export function recalculate(s,rules,catalog,fill=false){
    if(s.player.totalExp!==null){const old=s.player.level??1,L=levelFor(s.player.totalExp,rules);s.player.level=L;
        const high=s.systems.growth.highestLevel??old;if(L>high)s.player.points+=L-high;s.systems.growth.highestLevel=Math.max(high,L);}
    if(s.player.level===null)return;
    const d=derived(s,rules,catalog);
    for(const [key,max]of [['hp',d.hp],['mp',d.mp]])s.player[key]={max,value:fill?max:Math.min(s.player[key].value??max,max)};
}
function add(s,id,qty,catalog){let i=s.player.inventory.find(x=>x.id===id);if(i){if(!integer(i.qty+qty))throw new Error('소지품 수량 계산 범위를 초과했습니다.');i.qty+=qty;}else s.player.inventory.push({id,name:itemOf(s,catalog,id)?.name??id,qty,note:itemOf(s,catalog,id)?.note??''});}
function take(s,id,n=1){const i=s.player.inventory.find(x=>x.id===id);if(!i||i.qty<n)throw new Error('소지품이 부족합니다.');i.qty-=n;s.player.inventory=s.player.inventory.filter(i=>i.qty>0);if(!i.qty)for(const slot of Object.keys(s.systems.equipment))if(s.systems.equipment[slot]===id)s.systems.equipment[slot]=null;}
function weighted(entries,rng){const total=entries.reduce((n,x)=>n+x[1],0);let n=rng.int(total);for(const [id,w]of entries){if(n<w)return id;n-=w;}throw new Error('Invalid weights');}
function rollLoot(s,rules,catalog,rng,quest=false){
    const grade=weighted(quest?rules.questWeights:rules.gachaWeights,rng);
    const pool=Object.values(catalog.items).filter(i=>i.grade===grade);
    const id=weighted(pool.map(i=>[i.id,i.weight??1]),rng);add(s,id,1,catalog);
    return {grade,id,name:catalog.items[id].name,beam:['회색','금색','청색','무지개'][rng.int(4)],broadcast:grade==='divine'};
}
function receipt(s,type,text,detail){const r={id:'r'+s.rev+'-'+s.systems.receipts.length,type,text,detail:detail??null};s.systems.receipts=[...s.systems.receipts,r].slice(-30);return r;}
function event(s,rules,catalog,rng){if(!chance(rng,rules.encounterChance))return null;const e=catalog.events[rng.int(catalog.events.length)];return receipt(s,'encounter',e.name,e);}
function finish(s,result='won',rules,catalog){
    const b=s.systems.battle;b.status=result;
    if(result==='won'){
        if(b.nonlethal){b.enemy.hp=1;receipt(s,'combat','결투 종료: 상대가 패배를 인정했습니다.');return;}
        if(b.enemy.kind==='native'){
            s.player.redBrand=true;if(b.enemy.characterId&&!s.systems.deadNatives.includes(b.enemy.characterId))s.systems.deadNatives.push(b.enemy.characterId);
            s.cast=s.cast.filter(id=>id!==b.enemy.characterId);s.companions=s.companions.filter(id=>id!==b.enemy.characterId);
            receipt(s,'curse','엘리시안이 사망했습니다. 붉은 낙인이 영구히 새겨졌습니다.');
        }else if(b.enemy.kind==='player'){
            if(b.enemy.characterId)s.systems.npcOverrides[b.enemy.characterId]={level:levelFor(threshold(b.enemy.level,rules)/2,rules),note:'전투 패배에 따른 일반 부활 추정치. 초기 EXP는 레벨 최소치로 산정.'};
            receipt(s,'combat','상대 솜니움의 에테르 클론이 부서졌습니다.');
        }else{
            s.player.totalExp+=b.enemy.exp??0;if(s.player.wallet.gold!==null)s.player.wallet.gold+=b.enemy.gold??0;else s.systems.pendingGold+=b.enemy.gold??0;
            recalculate(s,rules,catalog);receipt(s,'reward',`EXP +${b.enemy.exp??0}, 골드 +${b.enemy.gold??0}${s.player.wallet.gold===null?' (기존 잔액 미정·별도 보관)':''}`);
        }
    }
}
function receive(s,power,enemy,rules,catalog,rng){
    const d=derived(s,rules,catalog);
    if(chance(rng,d.evasion)){receipt(s,'combat','상대의 공격을 회피했습니다.');return;}
    let amount=Math.max(1,Math.round((power-d.defense)*(1-d.reduction)));
    const shield=s.systems.statuses.find(x=>x.id==='shield');if(shield)amount=Math.max(0,amount-shield.power);
    if(s.systems.battle.guard)amount=Math.ceil(amount/2);
    s.player.hp.value=Math.max(0,s.player.hp.value-amount);receipt(s,'combat',`받은 피해 ${amount}`);
    if(s.player.hp.value===0){
        const b=s.systems.battle;
        if(b.nonlethal){s.player.hp.value=1;b.status='lost';receipt(s,'combat','결투 패배: 치명상 전에 승부가 끝났습니다.');}
        else{s.pendingDeath={id:'death-'+s.rev,openedRev:s.rev};b.status='lost';receipt(s,'death','에테르 클론이 붕괴했습니다. 부활 방식을 선택해주세요.');}
    }
}
function tick(s){for(const id of Object.keys(s.systems.cooldowns))s.systems.cooldowns[id]=Math.max(0,s.systems.cooldowns[id]-1);s.systems.statuses=s.systems.statuses.map(e=>({...e,turns:e.turns-1})).filter(e=>e.turns>0);}
function newEnemy(s,a,data,catalog,rules){
    if(catalog.monsters[a.target])return copy(catalog.monsters[a.target]);
    const c=data.chars[a.target];if(!c)throw new Error('대상 정보가 없습니다.');
    if(c.kind==='abyss'||c.kind==='hidden')throw new Error('군주·히든 인물은 일반 HP 전투로 처치할 수 없습니다.');
    if(!s.cast.includes(c.id))throw new Error('현재 현장에 있는 인물만 대상으로 지정할 수 있습니다.');
    if(!allowed(c.id,s,data))throw new Error('이 세계·장소에 있을 수 없는 인물입니다.');
    if(s.systems.deadNatives.includes(c.id))throw new Error('이미 사망한 엘리시안입니다.');
    if(c.kind==='real')throw new Error('현실 인물에게 게임 전투를 적용할 수 없습니다.');
    const native=c.kind==='elys';
    const L=native?(/왕|황태자/.test(c.role)?120:/기사|수비|사냥/.test(c.role)?80:40):Number(s.systems.npcOverrides[c.id]?.level??c.kit.match(/Lv\.(\d+)/)?.[1]??Math.max(1,s.player.level));
    return {id:c.id,characterId:c.id,name:c.name,kind:native?'native':'player',level:native?null:L,hp:100+L*16,attack:8+L*3,defense:Math.floor(L/3),agi:Math.floor(L/2),exp:0,gold:0,note:'인물 전투 수치는 v0.4 대체 모델. 엘리시안의 실제 레벨을 부여한 값이 아니다.'};
}
export function applyGameAction(input,a,data,rules,catalog,rng=secureRng){
    const original=normalizeSession(input,data);let s=defaults(copy(original));
    const fail=e=>({ok:false,state:original,error:e.message??String(e)});
    try{
        const game=world(s,data)==='game';
        const ordinary=['logout','login','handle','quest','follow','leave','clock'];
        if(ordinary.includes(a.type)){
            if(['logout','login'].includes(a.type)&&s.systems.battle?.status==='active')throw new Error('전투를 끝내거나 이탈한 뒤 접속을 전환해주세요.');
            if(a.type==='logout'&&s.systems.avatarTrap)throw new Error('아바타 구속을 먼저 해제해주세요.');
            if(a.type==='quest'&&s.player.redBrand)throw new Error('붉은 낙인으로 퀘스트를 받을 수 없습니다.');
            const r=authorAction(s,a,data);if(!r.ok)return r;s=defaults(r.state);receipt(s,'action',a.type==='logout'?'현실로 돌아왔습니다.':a.type==='login'?'게임에 접속했습니다.':'기록을 갱신했습니다.');return {ok:true,state:s};
        }
        if(a.type==='topup'){
            if(!integer(a.amount,1)||!Number.isSafeInteger(a.amount*1000)||!integer(s.systems.real.krw)||s.systems.real.krw<a.amount*1000||s.player.wallet.diamonds===null)throw new Error('가상 현실 지갑과 충전할 다이아 수를 확인해주세요.');
            s.systems.real.krw-=a.amount*1000;s.player.wallet.diamonds+=a.amount;receipt(s,'topup',`${a.amount}다이아 가상 충전 · 현실 지갑 ${a.amount*1000}원 차감`);
        }else if(a.type==='setup'){
            if(!s.systems.setup.pending)throw new Error('시작 정보가 이미 확정됐습니다. 수정은 전체 세션 편집을 사용해주세요.');
            if(!integer(a.level,1)||!Number.isSafeInteger(threshold(a.level,rules))||!a.stats||Object.keys(a.stats).some(k=>!STAT_KEYS.includes(k))||STAT_KEYS.some(k=>!integer(a.stats[k])))throw new Error('레벨과 일곱 스탯을 입력해주세요.');
            const total=10+a.level-1;if(Object.values(a.stats).reduce((n,v)=>n+v,0)>total)throw new Error('스탯 합계가 기본 배분 가능량을 초과합니다. 추가 티켓은 전체 세션에서 설정해주세요.');
            s.player.level=a.level;s.player.totalExp=threshold(a.level,rules);s.player.stats=copy(a.stats);s.player.points=total-Object.values(a.stats).reduce((n,v)=>n+v,0);
            s.systems.growth.highestLevel=a.level;s.systems.setup.pending=false;recalculate(s,rules,catalog,true);
            if(a.wallet){for(const k of ['gold','diamonds'])if(a.wallet[k]!==undefined){if(!integer(a.wallet[k]))throw new Error('재화는 0 이상의 정수입니다.');s.player.wallet[k]=a.wallet[k];}}
            if(a.loc){if(!data.locations[a.loc]||['ZERO','SKY','UNSET'].includes(a.loc))throw new Error('시작 위치를 확인해주세요. 특수 영지는 별도 진행 설정이 필요합니다.');s.loc=a.loc;s.place='';}
            receipt(s,'setup','시작 정보를 확정했습니다.');
        }else{
            if(!game)throw new Error('게임 안에서 사용할 수 있는 동작입니다.');
            if(s.systems.setup.pending||s.player.level===null||s.player.totalExp===null)throw new Error('시작 레벨·스탯을 먼저 확정해주세요.');
            if(s.player.hp.max===null||s.player.mp.max===null)recalculate(s,rules,catalog);
            if(s.pendingDeath&&!['revive'].includes(a.type))throw new Error('부활 방식을 먼저 선택해주세요.');
            if(['stat','allocate'].includes(a.type)){
                const r=authorAction(s,a,data);if(!r.ok)return r;s=defaults(r.state);recalculate(s,rules,catalog);receipt(s,'growth','스탯 배분을 반영했습니다.');return {ok:true,state:s};
            }else if(a.type==='gacha'){
                const n=a.count??1;if(!integer(n,1)||n>rules.maxBatchPulls)throw new Error(`한 번에 1~${rules.maxBatchPulls}회 뽑을 수 있습니다.`);
                const cost=rules.gachaCost*n;if(s.player.wallet.diamonds===null||s.player.wallet.diamonds<cost)throw new Error('다이아가 부족하거나 미설정입니다.');
                s.player.wallet.diamonds-=cost;const drops=Array.from({length:n},()=>rollLoot(s,rules,catalog,rng));receipt(s,'gacha',`${n}회 소환 · ${cost}다이아`,drops);
            }else if(a.type==='claim'){
                const q=s.quests.find(q=>q.id===a.id);if(!q||q.status!=='completed'||q.rewardClaimed)throw new Error('수령할 완료 퀘스트 보상이 없습니다.');
                const loot=rollLoot(s,rules,catalog,rng,true);q.rewardClaimed=true;receipt(s,'quest','은총의 룰렛 보상을 받았습니다.',loot);
            }else if(a.type==='equip'){
                const i=itemOf(s,catalog,a.id);if(!i?.slot||!s.player.inventory.some(x=>x.id===a.id&&x.qty>0))throw new Error('장착 가능한 소지품이 아닙니다.');
                s.systems.equipment[i.slot]=a.id;recalculate(s,rules,catalog);receipt(s,'gear',`${i.name} 장착`);
            }else if(a.type==='use'||a.type==='absorb'){
                const i=itemOf(s,catalog,a.id);if(!i)throw new Error('아이템 정보가 없습니다.');take(s,a.id);
                if(i.kind==='shard'){
                    const sk=catalog.skills[i.skillId];if(!sk||s.player.skills.includes(sk.id))throw new Error('이미 보유한 스킬이거나 흡수할 수 없는 꿈조각입니다.');
                    s.player.skills.push(sk.id);receipt(s,'skill',`${sk.name} 성흔이 영구히 새겨졌습니다.`);
                }else if(i.kind==='consumable'){
                    for(const k of ['hp','mp'])if(i[k])s.player[k].value=Math.min(s.player[k].max,s.player[k].value+i[k]);receipt(s,'use',`${i.name} 사용`);
                }else if(i.kind==='stat'){s.player.points+=i.points;s.player.tickets+=i.points;receipt(s,'growth',`추가 스탯 ${i.points}포인트`);
                }else if(i.kind==='deed'){s.systems.housing={name:'이름 없는 하늘 영토',type:'sky',safeSky:true};receipt(s,'housing','하늘 영토 소유권을 얻었습니다.');
                }else if(i.kind==='pet'){s.systems.pet={name:'이름 없는 용의 알',kind:'신화급 용',note:'부화를 기다리고 있다.'};receipt(s,'pet','용의 알을 돌보기 시작했습니다.');
                }else throw new Error('이 아이템은 직접 사용 효과가 없습니다.');
            }else if(a.type==='startCombat'){
                if(s.systems.battle?.status==='active')throw new Error('이미 진행 중인 전투가 있습니다.');
                if(s.loc==='SKY'&&(catalog.monsters[a.target]||!a.nonlethal))throw new Error('하늘 영토는 PK·몬스터 침입이 차단되는 안전지대입니다.');
                if(s.loc==='RN_ARC'&&data.chars[a.target]&&!a.nonlethal)throw new Error('아르카디아는 PK 금지 영지입니다. 결투 또는 별도의 사건 판정이 필요합니다.');
                const e=newEnemy(s,a,data,catalog,rules);s.event='combat';s.systems.battle={id:'battle-'+s.rev,round:0,status:'active',nonlethal:a.nonlethal===true,enemy:{...e,maxHp:e.hp},guard:false};receipt(s,'combat',`${e.name} ${a.nonlethal?'결투':'전투'} 시작`);
            }else if(['attack','defend','retreat','skill'].includes(a.type)){
                const b=s.systems.battle;if(!b||b.status!=='active')throw new Error('진행 중인 전투가 없습니다.');
                const e=b.enemy,d=derived(s,rules,catalog);b.guard=false;
                let power=d.attack,physical=true,newCooldown=null;
                if(a.type==='skill'){
                    const sk=skillOf(s,catalog,a.id);if(!sk||!s.player.skills.some(x=>x===sk.id||x===sk.name))throw new Error('보유한 스킬이 아닙니다.');
                    if((s.systems.cooldowns[sk.id]??0)>0)throw new Error('재사용 대기 중입니다.');
                    const cost=Math.max(1,Math.ceil(sk.mp/(1+d.sen*rules.senCostFactor)));if(s.player.mp.value<cost)throw new Error('MP가 부족합니다.');s.player.mp.value-=cost;
                    newCooldown=[sk.id,sk.cooldown];power=sk.power+(sk.physical?d.attack:0);physical=sk.physical===true;
                    if(sk.type==='heal'){s.player.hp.value=Math.min(s.player.hp.max,s.player.hp.value+sk.power);power=0;receipt(s,'combat',`${sk.name}: HP 회복`);}
                    if(sk.type==='shield'){s.systems.statuses.push({id:'shield',name:sk.name,power:sk.power,turns:sk.turns+1});power=0;receipt(s,'combat',`${sk.name}: 방어 효과`);}
                }
                if(a.type==='defend'){b.guard=true;receipt(s,'combat','방어 자세를 취했습니다.');}
                else if(a.type==='retreat'){
                    if(chance(rng,clamp(0.5+(s.player.stats.AGI-e.agi)*0.01,0.1,0.95))){b.status='escaped';receipt(s,'combat','전투에서 이탈했습니다.');}
                    else receipt(s,'combat','이탈에 실패했습니다.');
                }else if(power>0){
                    const hit=clamp(0.85+(d.ranged?s.player.stats.DEX*0.005:0)-e.agi*0.003,0.1,0.99);
                    if(chance(rng,hit)){const crit=chance(rng,d.crit),damage=Math.max(1,Math.round((power-(physical?e.defense:0))*(crit?1.5:1)));e.hp=Math.max(0,e.hp-damage);receipt(s,'combat',`${crit?'치명타 · ':''}${e.name}에게 ${damage} 피해`);}else receipt(s,'combat','공격이 빗나갔습니다.');
                }
                if(e.hp===0)finish(s,'won',rules,catalog);
                if(b.status==='active')receive(s,e.attack,e,rules,catalog,rng);
                b.round++;tick(s);if(newCooldown)s.systems.cooldowns[newCooldown[0]]=newCooldown[1];
            }else if(a.type==='gainExp'){
                if(!integer(a.amount)||!Number.isSafeInteger(s.player.totalExp+a.amount))throw new Error('올바른 경험치가 아닙니다.');s.player.totalExp+=a.amount;recalculate(s,rules,catalog);receipt(s,'growth',`EXP +${a.amount} (제작자 시험 입력)`);
            }else if(a.type==='death'){
                const r=authorAction(s,a,data);if(!r.ok)return r;s=defaults(r.state);receipt(s,'death','사망 판정 열림 (제작자 시험)');return {ok:true,state:s};
            }else if(a.type==='revive'){
                if(s.loc==='AB_6'&&a.mode!=='normal')throw new Error('이 층에서는 즉시 부활을 사용할 수 없습니다.');
                if(s.systems.avatarTrap)throw new Error('아바타가 붙잡혀 있습니다. 구조·해제 조건이 먼저입니다.');
                if(a.mode==='guild'){
                    const g=s.systems.guild;if(!s.pendingDeath||!g.name||!integer(g.revivalFund)||g.revivalFund<rules.reviveGold||!integer(g.loan))throw new Error('길드 부활 자금·대출 기록이 설정되지 않았거나 부족합니다.');
                    g.revivalFund-=rules.reviveGold;g.loan+=rules.reviveGold;if(!integer(g.loan))throw new Error('길드 대출 계산 범위를 초과했습니다.');s.pendingDeath=null;recalculate(s,rules,catalog,true);s.systems.battle=null;s.systems.statuses=[];receipt(s,'revive','길드 부활 대출 · EXP 보존');
                    s.rev++;return {ok:true,state:normalizeSession(s,data)};
                }
                const r=authorAction(s,a,data);if(!r.ok)return r;s=defaults(r.state);recalculate(s,rules,catalog,true);s.systems.battle=null;s.systems.statuses=[];
                if(a.mode==='normal'){const altar=s.systems.respawnLoc??(s.loc.startsWith('AB_')?'RN_COB':s.loc==='LOGIN'?'RN_START':s.loc);if(data.locations[altar]&&data.locations[altar].world!=='reality')s.loc=altar;s.event='daily';}
                receipt(s,'revive',a.mode==='normal'?'일반 부활 · 누적 EXP 50% 손실':'즉시 부활 · EXP 보존');return {ok:true,state:s};
            }else if(a.type==='travel'){
                if(s.systems.battle?.status==='active')throw new Error('전투에서 이탈한 뒤 이동해주세요.');
                if(!data.locations[a.loc]||data.locations[a.loc].world==='reality'||a.loc==='UNSET')throw new Error('게임 이동 위치를 확인해주세요.');
                if(a.loc==='ZERO')throw new Error('제0구역 진입 조건은 아직 충족되지 않았습니다.');
                if(a.loc==='SKY'&&!s.systems.housing.safeSky)throw new Error('소유한 하늘 영토가 없습니다.');
                s.loc=a.loc;s.place='';s.companions=s.companions.filter(id=>allowed(id,s,data));s.cast=[...s.companions];s.event='explore';receipt(s,'travel',data.locations[a.loc].label);event(s,rules,catalog,rng);
            }else if(a.type==='explore'||a.type==='rest'){
                if(s.systems.battle?.status==='active')throw new Error('전투 중에는 탐험·휴식을 할 수 없습니다.');
                if(a.type==='rest'){s.player.hp.value=Math.min(s.player.hp.max,s.player.hp.value+Math.ceil(s.player.hp.max*0.1));s.player.mp.value=Math.min(s.player.mp.max,s.player.mp.value+Math.ceil(s.player.mp.max*0.1));}
                receipt(s,a.type,a.type==='rest'?'휴식을 취했습니다.':'주변을 탐색했습니다.');event(s,rules,catalog,rng);
            }else if(a.type==='auction'){
                if(!integer(a.price,1)||!integer(a.qty??1,1))throw new Error('판매가와 수량을 확인해주세요.');
                if(s.player.wallet.gold===null)throw new Error('골드 잔액이 미설정입니다.');const total=a.price*(a.qty??1);if(!integer(total,1)||!integer(s.player.wallet.gold+total))throw new Error('거래 금액이 계산 범위를 초과합니다.');take(s,a.id,a.qty??1);const tax=Math.ceil(total*rules.auctionTax);s.player.wallet.gold+=total-tax;recalculate(s,rules,catalog);receipt(s,'trade',`경매 거래 확정 · 총 ${total}, 세금 ${tax}, 수령 ${total-tax}`);
            }else throw new Error('지원하지 않는 게임 동작입니다.');
        }
        for(const n of [s.player.wallet.gold,s.player.wallet.diamonds,s.systems.guild.loan,s.systems.real.krw,s.systems.pendingGold,s.player.points,s.player.tickets])if(n!==null&&!integer(n))throw new Error('재화·포인트 계산 범위를 초과했습니다.');
        if(s.player.totalExp!==null&&(!Number.isFinite(s.player.totalExp)||s.player.totalExp<0||s.player.totalExp>Number.MAX_SAFE_INTEGER))throw new Error('경험치 계산 범위를 초과했습니다.');
        s.rev++;return {ok:true,state:normalizeSession(s,data)};
    }catch(e){return fail(e);}
}

export function gameSnapshot(s,data,rules,catalog){
    const base={setup:s.systems.setup,recent:s.systems.receipts.slice(-3)};
    if(world(s,data)!=='game')return {...base,real:s.systems.real};
    const b=s.systems.battle;
    return {...base,pendingGold:s.systems.pendingGold,derived:s.player.level?derived(s,rules,catalog):null,equipment:s.systems.equipment,guild:s.systems.guild,housing:s.systems.housing,pet:s.systems.pet,statuses:s.systems.statuses,cooldowns:s.systems.cooldowns,
        battle:b?{enemy:b.enemy.name,hp:b.enemy.hp,maxHp:b.enemy.maxHp,status:b.status,round:b.round,nonlethal:b.nonlethal}:null};
}

export function gameTextAction(message){
    const s=String(message??'').trim().replace(/^[*\s]+|[*\s.!。~]+$/g,'');let m;
    if((m=s.match(/^(?:가챠|뽑기|소환)\s*(\d+)?\s*(?:회|번)?$/)))return {type:'gacha',count:Number(m[1]??1)};
    if(/^(?:공격|공격한다)$/.test(s))return {type:'attack'};
    if(/^(?:방어|방어한다)$/.test(s))return {type:'defend'};
    if(/^(?:도주|이탈|후퇴)$/.test(s))return {type:'retreat'};
    if(/^(?:휴식|쉰다)$/.test(s))return {type:'rest'};
    if(/^(?:탐험|탐색)$/.test(s))return {type:'explore'};
    if((m=s.match(/^이동\s+([A-Z0-9_]+)$/)))return {type:'travel',loc:m[1]};
    if((m=s.match(/^(전투|결투)\s+([a-z0-9_]+)$/)))return {type:'startCombat',target:m[2],nonlethal:m[1]==='결투'};
    if((m=s.match(/^스킬\s+([a-z0-9_]+)$/)))return {type:'skill',id:m[1]};
    if((m=s.match(/^(사용|흡수|장착)\s+([a-z0-9_]+)$/)))return {type:m[1]==='장착'?'equip':'use',id:m[2]};
    if((m=s.match(/^보상\s+(q_[a-z0-9_]+)$/)))return {type:'claim',id:m[1]};
    return null;
}
