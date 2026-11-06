// 오네이로스의 제단 · 숨은 추첨 대기열 (v0.8.9)
// 모델 호출 없이 확장이 {{user}} 본인의 소환·룰렛 결과를 미리 정한다.
// 세션에는 숨은 시드, 사용 횟수, 행운 보정 단계, 예외 기록만 저장하므로
// 같은 입력의 재생성은 같은 결과를, 새 입력은 다음 결과를 받는다.
export const GRADE_NAMES=['신급','상등급','노말','꽝'];
// 행운 보정 6단계. 각 값은 [신급, 상등급, 노말] 확률이며 꽝은 나머지.
export const LUCK=[
    null,
    {label:'1 · 기본',       odds:[8e-7,0.04,0.30]},   // 꽝 약 66% (원작 체감)
    {label:'2 · 운이 좋은 편', odds:[5e-6,0.08,0.34]},   // 꽝 약 58%
    {label:'3 · 행운',       odds:[2e-5,0.15,0.40]},   // 꽝 약 45%
    {label:'4 · 강운',       odds:[1e-4,0.25,0.45]},   // 꽝 약 30%
    {label:'5 · 금손',       odds:[5e-4,0.40,0.45]},   // 꽝 약 15%
    {label:'6 · 천운',       odds:[2e-3,0.55,0.42]},   // 꽝 약 2.8% · 설정상 꽝이 거의 안 나오는 캐릭터용
];
export const BEAMS=['무지개빛','황금빛','보랏빛','푸른빛','흰빛','잿빛'];
export const QUEUE_SIZE=10, MAX_DRAWS=20, LOG_SIZE=8;

function hash32(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
    return ()=>{h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return (h^=h>>>16)>>>0;};}
function unit(seed,index,salt){const f=hash32(seed+':'+index+':'+salt);f();return f()/4294967296;}
const tier=x=>Number.isSafeInteger(x)&&x>=1&&x<=LUCK.length-1?x:1;

export function newSeed(){
    const a=new Uint32Array(4);globalThis.crypto.getRandomValues(a);
    return [...a].map(n=>n.toString(16).padStart(8,'0')).join('');
}
export function oddsOf(luck){
    const [d,u,n]=LUCK[tier(luck)].odds;
    return {신급:d,상등급:u,노말:n,꽝:1-d-u-n};
}
export function draw(seed,index,luck=1){
    const r=unit(seed,index,'grade'),[d,u,n]=LUCK[tier(luck)].odds;
    const grade=r<d?'신급':r<d+u?'상등급':r<d+u+n?'노말':'꽝';
    const beam=BEAMS[Math.floor(unit(seed,index,'beam')*BEAMS.length)];
    return {grade,beam};
}
export function altarOf(state){
    const a=state?.systems?.altar;
    return a&&typeof a.seed==='string'&&/^[0-9a-f]{32}$/.test(a.seed)&&Number.isSafeInteger(a.n)&&a.n>=0?a:null;
}
export function luckOf(state){return tier(altarOf(state)?.luck);}
export function ensureAltar(state){
    state.systems??={};
    const a=altarOf(state);
    state.systems.altar=a?{seed:a.seed,n:a.n,luck:tier(a.luck),log:Array.isArray(a.log)?a.log.slice(-LOG_SIZE):[]}:{seed:newSeed(),n:0,luck:1,log:[]};
    return state;
}
export function setLuck(state,luck){ensureAltar(state);state.systems.altar.luck=tier(luck);return state;}
export function upcoming(state,size=QUEUE_SIZE){
    const a=altarOf(state);if(!a)return [];
    return Array.from({length:size},(_,i)=>({no:i+1,...draw(a.seed,a.n+i,tier(a.luck))}));
}
const list=q=>q.map(x=>`#${x.no} ${x.grade} · ${x.beam}`).join(' / ');
export function queueText(state,settled=false){
    const q=upcoming(state);if(!q.length)return '';
    if(settled)return '[Hidden altar queue — ALREADY SETTLED for this input]\n'
        +"{{user}}'s pulls or roulette spins in this regenerated reply used these same results in order (and any recorded canonical override); retell them faithfully. They are already counted: omit draws in ROAI.\n"+list(q);
    return "[Hidden altar queue — fixed server results for {{user}}'s own pulls; never shown as a list]\n"
        +"Use ONLY when {{user}} personally makes an altar pull or Grace Roulette spin in THIS response: take results in order from #1, one per pull/spin. "
        +'The grade and beam are fixed; invent a fitting item name/detail for that grade. Never reroll, skip, reorder or upgrade a result for drama, luck flavour or the user\'s wish. '
        +"Report the number of {{user}}'s results used as \"draws\" in ROAI (0 when none, including when only NPCs pulled).\n"
        +"NPC pulls never use or count this queue: judge them from that NPC's canon (luck build, abilities, history) and the public odds.\n"
        +'Only an established canonical ability or event that explicitly affects the altar may change one of these results (e.g. an ability that forces the next pull to be junk, or a hidden-role intervention already earned in play). '
        +'Then add altarOverride:[{"no":N,"grade":"신급|상등급|노말|꽝","reason":"which ability/event"}] in ROAI.\n'+list(q);
}
export function countGachaCards(text){return (String(text??'').match(/<GACHA>/g)??[]).length;}
export function consume(state,used){
    const a=altarOf(state);if(!a)return state;
    const n=Math.max(0,Math.min(MAX_DRAWS,Number.isSafeInteger(used)?used:0));
    state.systems.altar={...a,n:a.n+n,luck:tier(a.luck),log:Array.isArray(a.log)?a.log:[]};return state;
}
// AI가 정사 능력·사건을 근거로 대기열 결과를 바꾼 기록. 근거 문장이 없으면 받지 않는다.
export function recordOverrides(state,overrides,used,rev){
    const a=altarOf(state);if(!a)throw new Error('no-altar');
    if(!Array.isArray(overrides)||overrides.length>MAX_DRAWS)throw new Error('invalid-override');
    const base=a.n-used,log=[...(Array.isArray(a.log)?a.log:[])];
    for(const o of overrides){
        if(!o||typeof o!=='object'||!Number.isSafeInteger(o.no)||o.no<1||o.no>used)throw new Error('override-outside-used-draws');
        if(!GRADE_NAMES.includes(o.grade))throw new Error('invalid-override-grade');
        if(typeof o.reason!=='string'||o.reason.trim().length<4)throw new Error('override-needs-reason');
        const from=draw(a.seed,base+o.no-1,tier(a.luck)).grade;
        log.push({rev,no:o.no,from,to:o.grade,reason:o.reason.trim().slice(0,160)});
    }
    state.systems.altar={...a,log:log.slice(-LOG_SIZE)};return state;
}
