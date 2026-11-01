import { normalizeState, directory, allowed, applySceneProposal, renderScene } from './router.mjs';

export const STAT_KEYS=['STR','CON','AGI','INT','LUK','DEX','SEN'];
export const RELATION_STAGES=['seen','met','familiar','trusted','close'];
const MAX=Number.MAX_SAFE_INTEGER;
const text=(s,n)=>typeof s==='string'?s.slice(0,n):'';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=(v,fallback=0)=>Number.isSafeInteger(v)&&v>=0?v:fallback;
const amount=(v,fallback=null)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=MAX?v:fallback;
const nullableInt=v=>v===null?null:count(v,null);
const clone=x=>JSON.parse(JSON.stringify(x));
const dayValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;

export function initialSession(data,overrides={}) {
    return normalizeSession({
        version:4,enabled:true,loc:'LOGIN',event:'daily',cast:[],
        known:[],deep:[],evidence:[],bonds:{},extras:{},preflight:false,autoMarkers:true,
        worldTruth:false,abyssOrigin:false,rev:0,place:'접속 위치 선택',
        clocks:{game:{date:'2076-04-03',minute:720,uncertain:false},reality:{date:'2076-04-03',minute:null,uncertain:true}},
        player:{handle:null,level:1,lastLevel:null,totalExp:0,points:10,tickets:0,
            stats:Object.fromEntries(STAT_KEYS.map(k=>[k,0])),
            wallet:{gold:null,diamonds:null},hp:{value:null,max:null},mp:{value:null,max:null},
            inventory:[],skills:[],redBrand:false},
        relations:{},
        quests:[],notes:[],companions:[],pendingDeath:null,logoutLock:null,
        returnGame:null,returnReality:{loc:'RL_FREE',place:'접속 장소 미정',cast:[]},systems:{},
        ...overrides,
    },data);
}

function clock(input,fallback) {
    return {date:dayValid(input?.date)?input.date:fallback.date,
        minute:input?.minute===null?null:(Number.isInteger(input?.minute)&&input.minute>=0&&input.minute<1440?input.minute:fallback.minute),
        uncertain:input?.uncertain===true};
}
function vital(x) {const max=amount(x?.max);return {max,value:max===null?amount(x?.value):Math.min(amount(x?.value)??max,max)};}

export function normalizeSession(input,data) {
    const x=record(input)?input:{},r=normalizeState(x,data),p=record(x.player)?x.player:{};
    const relations={};
    for(const [id,v] of Object.entries(record(x.relations)?x.relations:{}))if(Object.hasOwn(data.chars,id))relations[id]={stage:RELATION_STAGES.includes(v?.stage)?v.stage:'seen',note:text(v?.note,140)};
    const quests=(Array.isArray(x.quests)?x.quests:[]).filter(q=>record(q)&&/^q_[a-z0-9_]{1,40}$/.test(q.id)&&['offered','active','completed','failed','declined'].includes(q.status)).slice(0,12).map(q=>({id:q.id,title:text(q.title,72),status:q.status,note:text(q.note,140),rewardClaimed:q.rewardClaimed===true}));
    const inventory=(Array.isArray(p.inventory)?p.inventory:[]).filter(i=>record(i)&&typeof i.id==='string'&&i.name&&count(i.qty)>0).map(i=>({id:text(i.id,48),name:text(i.name,64),qty:count(i.qty),note:text(i.note,96)}));
    const anchor=(a,real)=>record(a)&&Object.hasOwn(data.locations,a.loc)&&(data.locations[a.loc].world==='reality')===real?{loc:a.loc,place:text(a.place,64),cast:(Array.isArray(a.cast)?a.cast:[]).filter(id=>Object.hasOwn(data.chars,id)).slice(0,data.maxCast)}:null;
    return {...r,version:4,rev:count(x.rev),place:text(x.place,64),
        clocks:{game:clock(x.clocks?.game,{date:'2076-04-03',minute:720}),reality:clock(x.clocks?.reality,{date:'2076-04-03',minute:null})},
        player:{handle:typeof p.handle==='string'?text(p.handle,32):null,level:nullableInt(p.level??null),lastLevel:nullableInt(p.lastLevel??null),
            totalExp:amount(p.totalExp),points:count(p.points),tickets:count(p.tickets),
            stats:Object.fromEntries(STAT_KEYS.map(k=>[k,count(p.stats?.[k])])),
            wallet:{gold:nullableInt(p.wallet?.gold??null),diamonds:nullableInt(p.wallet?.diamonds??null)},
            hp:vital(p.hp),mp:vital(p.mp),inventory,skills:(Array.isArray(p.skills)?p.skills:[]).filter(s=>typeof s==='string').map(s=>s.slice(0,72)),redBrand:p.redBrand===true},
        relations,quests,notes:(Array.isArray(x.notes)?x.notes:[]).filter(s=>typeof s==='string').map(s=>s.slice(0,140)).slice(-8),
        companions:(Array.isArray(x.companions)?x.companions:[]).filter(id=>Object.hasOwn(data.chars,id)).slice(0,data.maxCast),
        pendingDeath:record(x.pendingDeath)?{id:text(x.pendingDeath.id,80),openedRev:count(x.pendingDeath.openedRev)}:null,
        logoutLock:typeof x.logoutLock==='string'?text(x.logoutLock,120):null,
        returnGame:anchor(x.returnGame,false),returnReality:anchor(x.returnReality,true),
        systems:record(x.systems)?JSON.parse(JSON.stringify(x.systems)): {},
    };
}

export function world(state,data) { return data.locations[state.loc].world==='unset'?'unset':data.locations[state.loc].world==='reality'?'reality':'game'; }
export function fingerprint(message) {
    let h=2166136261;
    for(let n=0;n<String(message??'').length;n++){h^=String(message).charCodeAt(n);h=Math.imul(h,16777619);}
    return (h>>>0).toString(16)+':'+String(message??'').length;
}

export function parseProposal(message) {
    const matches=[...String(message??'').matchAll(/<!--RO4:([\s\S]*?)-->/g)];
    if(!matches.length)return {value:null,error:'no-marker'};
    const source=matches.at(-1)[1];if(source.length>6000)return {value:null,error:'oversize-marker'};
    try {
        const x=JSON.parse(source);
        if(!record(x))throw new Error();
        const permitted=['rev','loc','event','cast','place','dt','mem','quests','note','follow','leave'];
        if(Object.keys(x).some(k=>!permitted.includes(k)))return {value:null,error:'forbidden-field'};
        if(!Number.isSafeInteger(x.rev)||x.rev<0)return {value:null,error:'invalid-revision'};
        return {value:x,error:null};
    }catch{return {value:null,error:'invalid-json'};}
}

function advanceTime(s,minutes,data) {
    if(!Number.isInteger(minutes)||minutes<0||minutes>120)return;
    const c=s.clocks[world(s,data)];if(!c)return;
    if(c.minute===null||c.uncertain)return;
    const total=c.minute+minutes,days=Math.floor(total/1440);
    c.minute=total%1440;
    if(days){const date=new Date(c.date+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);c.date=date.toISOString().slice(0,10);}
}

export function transition(input,target,data) {
    const s=normalizeSession(input,data),from=world(s,data);
    if(target===from)return {ok:true,state:s};
    if(s.pendingDeath)return {ok:false,state:s,error:'부활 선택을 먼저 완료해주세요.'};
    if(target==='reality'&&s.logoutLock)return {ok:false,state:s,error:s.logoutLock};
    const destination=target==='reality'?(s.returnReality??{loc:'RL_DIVE',place:'심해 다이브 룸',cast:[]}):(s.returnGame??{loc:'LOGIN',place:'접속 위치 선택',cast:[]});
    if(target==='reality')s.returnGame={loc:s.loc,place:s.place,cast:s.cast};
    else s.returnReality={loc:s.loc,place:s.place,cast:s.cast};
    s.loc=destination.loc;s.place=destination.place;s.event='daily';
    s.cast=destination.cast.filter(id=>allowed(id,s,data));
    s.companions=s.companions.filter(id=>allowed(id,s,data));
    s.clocks[target].uncertain=true; // No fictional real/game clock ratio is assumed.
    s.rev++;
    return {ok:true,state:s};
}

export function applyProposal(input,proposal,data) {
    const previous=normalizeSession(input,data),s=clone(previous);
    if(!record(proposal)||proposal.rev!==previous.rev)return {ok:false,state:previous,error:'stale-revision'};
    if(Object.keys(proposal).some(k=>!['rev','loc','event','cast','place','dt','mem','quests','note','follow','leave'].includes(k)))return {ok:false,state:previous,error:'forbidden-field'};
    if(proposal.loc&&!Object.hasOwn(data.locations,proposal.loc))return {ok:false,state:previous,error:'invalid-location'};
    if(proposal.event&&!Object.hasOwn(data.events,proposal.event))return {ok:false,state:previous,error:'invalid-event'};
    const targetLoc=proposal.loc??s.loc;
    if(world(s,data)!=='unset'&&(data.locations[targetLoc].world==='reality')!==(world(s,data)==='reality'))return {ok:false,state:previous,error:'world-transition-requires-action'};
    if(targetLoc!==s.loc&&s.systems.battle?.status==='active')return {ok:false,state:previous,error:'combat-active'};
    if(targetLoc==='ZERO'&&s.loc!=='ZERO')return {ok:false,state:previous,error:'special-location-requires-author'};
    if(targetLoc==='SKY'&&!s.systems.housing?.safeSky)return {ok:false,state:previous,error:'sky-ownership-required'};
    if(s.pendingDeath&&targetLoc!==s.loc)return {ok:false,state:previous,error:'death-pending'};
    if(proposal.cast!==undefined&&(!Array.isArray(proposal.cast)||proposal.cast.length>data.maxCast||proposal.cast.some(id=>!Object.hasOwn(data.chars,id))))return {ok:false,state:previous,error:'invalid-cast'};
    const oldCast=[...s.cast];
    const routed=applySceneProposal(s,{loc:targetLoc,event:proposal.event??s.event,cast:proposal.cast??s.cast},data);
    for(const k of ['loc','event','cast','extras'])s[k]=routed[k];
    s.companions=s.companions.filter(id=>allowed(id,s,data));
    const leaving=new Set(Array.isArray(proposal.leave)?proposal.leave:[]);
    s.companions=s.companions.filter(id=>!leaving.has(id));
    const actual=new Set([...oldCast,...s.cast]);
    for(const id of Array.isArray(proposal.follow)?proposal.follow:[])if(actual.has(id)&&allowed(id,s,data)&&!s.companions.includes(id))s.companions.push(id);
    s.companions=s.companions.slice(0,data.maxCast);
    s.cast=[...new Set([...s.companions,...s.cast])].slice(0,data.maxCast);
    if(typeof proposal.place==='string')s.place=text(proposal.place,64);
    else if(s.loc!==previous.loc)s.place='';
    advanceTime(s,proposal.dt,data);
    const participants=new Set([...oldCast,...s.cast]);
    for(const m of (Array.isArray(proposal.mem)?proposal.mem:[]).slice(0,data.maxCast)) {
        if(!record(m)||!participants.has(m.id))continue;
        const prev=s.relations[m.id]??{stage:'seen',note:''};
        const oldIndex=RELATION_STAGES.indexOf(prev.stage),newIndex=RELATION_STAGES.indexOf(m.stage);
        const stage=newIndex>=oldIndex&&newIndex<=oldIndex+1?RELATION_STAGES[newIndex]:prev.stage;
        s.relations[m.id]={stage,note:typeof m.note==='string'?text(m.note,140):prev.note};
    }
    for(const q of (Array.isArray(proposal.quests)?proposal.quests:[]).slice(0,3)) {
        if(!record(q)||!/^q_[a-z0-9_]{1,40}$/.test(q.id))continue;
        const found=s.quests.find(x=>x.id===q.id);
        if(!found) {
            // New quests may be offered, never silently accepted or rewarded.
            if(q.status==='offered'&&!s.player.redBrand&&s.quests.length<12)s.quests.push({id:q.id,title:text(q.title,72),status:'offered',note:text(q.note,140)});
        }else if(found.status==='active'&&['completed','failed'].includes(q.status)) {
            found.status=q.status;found.note=text(q.note,140);
        }else if(q.status===found.status&&typeof q.note==='string')found.note=text(q.note,140);
    }
    if(typeof proposal.note==='string'&&proposal.note.trim())s.notes=[...s.notes,text(proposal.note,140)].slice(-8);
    s.rev++;
    return {ok:true,state:normalizeSession(s,data),error:null};
}

export function authorAction(input,action,data) {
    const s=normalizeSession(input,data),old=clone(s),fail=error=>({ok:false,state:old,error});
    if(action?.type==='logout')return transition(s,'reality',data);
    if(action?.type==='login')return transition(s,'game',data);
    if(action?.type==='stat') {
        if(world(s,data)==='reality')return fail('게임 안에서 스탯을 배분해주세요.');
        const key=String(action.stat??'').toUpperCase(),n=action.points;
        if(!STAT_KEYS.includes(key)||!Number.isSafeInteger(n)||n<=0||n>s.player.points||!Number.isSafeInteger(s.player.stats[key]+n))return fail('배분할 스탯과 남은 포인트를 확인해주세요.');
        s.player.stats[key]+=n;s.player.points-=n;
    }else if(action?.type==='allocate') {
        if(world(s,data)==='reality'||!record(action.stats))return fail('게임 안에서 스탯 배분을 확인해주세요.');
        const pairs=Object.entries(action.stats),sum=pairs.reduce((a,[k,n])=>a+(Number.isSafeInteger(n)?n:0),0);
        if(!pairs.length||pairs.some(([k,n])=>!STAT_KEYS.includes(k)||!Number.isSafeInteger(n)||n<=0||!Number.isSafeInteger(s.player.stats[k]+n))||!Number.isSafeInteger(sum)||sum>s.player.points)return fail('스탯 배분이 남은 포인트를 초과하거나 올바르지 않습니다.');
        for(const [k,n]of pairs)s.player.stats[k]+=n;s.player.points-=sum;
    }else if(action?.type==='handle') {
        if(typeof action.name!=='string'||!action.name.trim()||action.name.trim().length>32)return fail('닉네임은 1~32자로 입력해주세요.');
        s.player.handle=action.name.trim();
    }else if(action?.type==='quest') {
        const q=s.quests.find(q=>q.id===action.id);
        if(!q||q.status!=='offered'||!['active','declined'].includes(action.status))return fail('선택할 수 있는 퀘스트 제안이 아닙니다.');
        q.status=action.status;
    }else if(action?.type==='follow') {
        if(!s.cast.includes(action.id)||!allowed(action.id,s,data))return fail('현재 함께 있는 인물만 동행으로 기록할 수 있습니다.');
        if(!s.companions.includes(action.id))s.companions.push(action.id);
    }else if(action?.type==='leave') {
        s.companions=s.companions.filter(id=>id!==action.id);s.cast=s.cast.filter(id=>id!==action.id);
    }else if(action?.type==='death') {
        if(world(s,data)==='reality'||s.pendingDeath)return fail('게임 내에서 새 사망 판정을 열 수 있는 상태가 아닙니다.');
        s.pendingDeath={id:'death-'+s.rev,openedRev:s.rev};
    }else if(action?.type==='revive') {
        if(!s.pendingDeath)return fail('진행 중인 사망 판정이 없습니다.');
        if(action.mode==='normal') {
            if(s.player.totalExp===null)return fail('누적 총경험치가 미설정입니다.');
            const before=s.player.totalExp;s.player.totalExp=before/2;
            if(before!==s.player.totalExp){s.player.lastLevel=s.player.level;s.player.level=null;}
            s.place='가장 가까운 마을 제단';s.cast=[];s.companions=[];
        }else if(['diamonds','gold'].includes(action.mode)) {
            const price=action.mode==='diamonds'?1000:10000000,balance=s.player.wallet[action.mode];
            if(balance===null||balance<price)return fail('즉시 부활에 필요한 재화가 없거나 잔액이 미설정입니다.');
            s.player.wallet[action.mode]-=price;
        }else return fail('부활 방식은 normal / diamonds / gold 중 하나입니다.');
        s.pendingDeath=null;s.player.hp.value=null;
    }else if(action?.type==='clock') {
        const w=action.world??world(s,data);
        if(!['game','reality'].includes(w)||!dayValid(action.date)||!Number.isInteger(action.minute)||action.minute<0||action.minute>=1440)return fail('날짜와 시간을 확인해주세요.');
        s.clocks[w]={date:action.date,minute:action.minute,uncertain:false};
    }else return fail('지원하지 않는 동작입니다.');
    s.rev++;
    return {ok:true,state:normalizeSession(s,data),error:null};
}

export function snapshot(input,data) {
    const s=normalizeSession(input,data),w=world(s,data),p=s.player;
    const out={rev:s.rev,world:w,loc:s.loc,place:s.place,event:s.event,cast:s.cast,
        clock:s.clocks[w],companions:s.companions,player:{handle:p.handle},
        quests:s.quests.filter(q=>!['declined','failed'].includes(q.status)),
        relations:Object.fromEntries(s.cast.filter(id=>s.relations[id]).map(id=>[id,s.relations[id]])),
        notes:s.notes.slice(-3)};
    if(w==='game')Object.assign(out.player,{level:p.level,totalExp:p.totalExp,points:p.points,stats:p.stats,hp:p.hp,mp:p.mp,wallet:p.wallet,inventory:p.inventory,skills:p.skills,redBrand:p.redBrand});
    if(s.pendingDeath)out.pendingDeath=s.pendingDeath;
    if(s.logoutLock)out.logoutLock=s.logoutLock;
    return out;
}

export function renderSession(input,data) {
    const s=normalizeSession(input,data);
    if(!s.enabled)return {state:s,prompt:'',profiles:[]};
    const render=renderScene({...s,autoMarkers:false},data);
    s.cast=render.state.cast;
    const controls='Scene codes: '+Object.values(data.locations).map(l=>l.code+'='+l.label).join('; ')+'\nActivity codes: '+Object.keys(data.events).join(', ');
    const protocol=s.autoMarkers?`End with one compact HTML comment, only changed fields plus rev: <!--RO4:{"rev":${s.rev},"loc":"${s.loc}","event":"${s.event}","cast":${JSON.stringify(s.cast)}}-->. Optional dt=0..120 scene minutes; mem=[{id,stage,note}] for actual participants; quests=[{id,title,status,note}] for offers or updates; follow/leave=[ids] only after joining/parting actually occurs; note=one lasting fact. Never output wallet, skills, identity, evidence, lord stages or arbitrary state fields in this proposal. New quests are offered until the player accepts through the recorded action. Cross-world transitions use the controller, never a loc proposal. Omit unchanged optional fields.`:'';
    const ledger='[Authoritative session snapshot; null means unset, never zero. No complete transaction or new skill without a confirmed record.]\n'+JSON.stringify(snapshot(s,data));
    return {...render,state:s,prompt:[ledger,render.prompt,controls,protocol].filter(Boolean).join('\n\n')};
}

export function explicitUserAction(message,state){
    const s=String(message??'').trim().replace(/^[*\s]+|[*\s.!。~]+$/g,'');
    if(/^(?:이제\s*|그럼\s*)?(?:로그아웃(?:한다|할게요?|하겠습니다|할래요?|합니다)?|logout)$/i.test(s))return {type:'logout'};
    if(/^(?:이제\s*|다시\s*)?(?:게임에?\s*)?(?:접속(?:한다|할게요?|하겠습니다|할래요?|합니다)?|로그인(?:한다|할게요?)?|login)$/i.test(s))return {type:'login'};
    const name=s.match(/^닉네임(?:은|을)?\s+(.+)$/);if(name)return {type:'handle',name:name[1].replace(/^["'“]|["'”]$/g,'')};
    const pattern=/\b(STR|CON|AGI|INT|LUK|DEX|SEN)\s*(?:에\s*)?(\d+)\s*(?:포인트)?/gi;
    const allocations=[...s.matchAll(pattern)];
    if(allocations.length&&/^[\s,·+/]*$/.test(s.replace(pattern,''))){
        const stats={};for(const m of allocations)stats[m[1].toUpperCase()]=(stats[m[1].toUpperCase()]??0)+Number(m[2]);
        return {type:'allocate',stats};
    }
    if(/^(?:퀘스트(?:를)?\s*)?수락(?:한다|할게요?|합니다)?$/.test(s)){
        const offers=state.quests.filter(q=>q.status==='offered');
        if(offers.length===1)return {type:'quest',id:offers[0].id,status:'active'};
    }
    return null;
}

export function validateAuthorState(value,data){
    if(!record(value)||!record(value.player)||!Object.hasOwn(data.locations,value.loc)||!Object.hasOwn(data.events,value.event))return '전체 세션 구조와 위치·활동 코드를 확인해주세요.';
    const p=value.player;
    for(const key of ['gold','diamonds'])if(p.wallet?.[key]!==null&&!Number.isSafeInteger(p.wallet?.[key])||typeof p.wallet?.[key]==='number'&&p.wallet[key]<0)return '잔액은 null 또는 0 이상의 정수여야 합니다.';
    if(p.totalExp!==null&&amount(p.totalExp)===null)return '총경험치를 확인해주세요.';
    if(!Number.isSafeInteger(p.points)||p.points<0||STAT_KEYS.some(k=>!Number.isSafeInteger(p.stats?.[k])||p.stats[k]<0))return '스탯과 배분 포인트를 확인해주세요.';
    if(p.level!==null&&(!Number.isSafeInteger(p.level)||p.level<1))return '레벨은 null 또는 1 이상의 정수여야 합니다.';
    if(!Array.isArray(value.cast)||value.cast.length>data.maxCast||value.cast.some(id=>!Object.hasOwn(data.chars,id)))return '등장인물 ID와 최대 인원을 확인해주세요.';
    for(const w of ['game','reality']){const c=value.clocks?.[w];if(!c||!dayValid(c.date)||c.minute!==null&&(!Number.isInteger(c.minute)||c.minute<0||c.minute>=1440))return '장면 날짜와 시간을 확인해주세요.';}
    return null;
}
