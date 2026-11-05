import { getContext } from '../../../extensions.js';
import { directory, allowed } from './router.mjs';
import {seed,applyGameAction,gameTextAction,validateRules} from './engine.mjs';
import {statusHTML,bindStatus} from './status-ui.mjs';
import {prepareAIState,parseAIJudgement,applyAIJudgement,renderAIRequest,mentions} from './ai-judgement.mjs';
import {unsealData} from './sealed.mjs';
import {ensureAltar,altarOf,countGachaCards,consume,LUCK,luckOf,setLuck,oddsOf} from './altar.mjs';
import {cleanNarrative,finalAIInstruction} from './st-presentation.mjs';
import {dreamteoFromEntries,stripDreamteo,cleanHistory,withDreamteoPolicy,textDreamteoPolicy} from './presentation.mjs';
import { initialSession, normalizeSession, world, fingerprint, parseProposal, applyProposal, authorAction, snapshot, renderSession, explicitUserAction, validateAuthorState } from './session.mjs';

const KEY='relicta_session_v04',PROMPT='relicta_session_v04';
const LEGACY_KEY='relicta_session_v03',LEGACY_PROMPT='relicta_session_v03';
let data,rules,catalog,pending,panel,loadingError;
const flights=new Map(),presentation=new Map(),ephemeral=new Map();let suspended=false;
const copy=x=>JSON.parse(JSON.stringify(x));
const contextId=ctx=>`${ctx.characterId??''}:${ctx.groupId??''}:${ctx.getCurrentChatId?.()??''}`;
async function loadData(){
    if(!pending)pending=Promise.all(['cast-data.sealed.json','rules.json','catalog.json'].map(file=>fetch(new URL('./'+file,import.meta.url)).then(r=>{if(!r.ok)throw new Error('Data HTTP '+r.status);return r.json();}))).then(([d,r,c])=>{data=unsealData(d);rules=r;catalog=c;validateRules(r,c);return d;}).catch(e=>{loadingError=e;throw e;});
    return pending;
}
function cardConfig(ctx=getContext()){
    const c=ctx.characters?.[ctx.characterId];
    let ext=c?.data?.extensions??c?.extensions;
    if(!ext&&c?.json_data){try{ext=JSON.parse(c.json_data).data?.extensions;}catch{}}
    return ext?.relicta?.project==='relicta-online'?ext.relicta:null;
}
function store(ctx=getContext()){
    if(ctx.chatMetadata[KEY])return ctx.chatMetadata[KEY];
    const config=cardConfig(ctx),legacy=ctx.chatMetadata[LEGACY_KEY];
    const old=legacy?.state??legacy;const enabled=!!config||old?.enabled===true;
    // v0.8.1: 렐릭타가 아닌 채팅에는 아무것도 저장하지 않는다(사용자가 직접 켤 때만 기록).
    if(!enabled){const id=contextId(ctx);if(!ephemeral.has(id)){const s=seed(data,rules,catalog,'free');s.enabled=false;ephemeral.set(id,{schema:4,state:s,origin:copy(s)});}return ephemeral.get(id);}
    const opening=ctx.chat.find(m=>!m.is_user&&!m.is_system)?.mes;
    const selected=config?.greeting_modes?.find(g=>g.text===opening)?.mode??config?.mode??'free';
    const initial=config?.initial_state&&selected===config.mode?prepareAIState(config.initial_state,data,rules,catalog):seed(data,rules,catalog,selected);
    const seeded=old?.enabled?prepareAIState({...initial,...old,systems:{...initial.systems,...old.systems,setup:{mode:'veteran',pending:true}}},data,rules,catalog):initial;seeded.enabled=enabled;
    ensureAltar(seeded);
    ctx.chatMetadata[KEY]={schema:4,state:seeded,origin:copy(seeded)};
    if(old)old.enabled=false;
    ctx.saveMetadataDebounced();
    return ctx.chatMetadata[KEY];
}
// v0.8.1: 첫 인사를 스와이프해 다른 시작(기존 플레이어·자유)을 고르면, 첫 입력 전까지 세션을 그 시작으로 다시 만든다.
function reseedFromGreeting(){
    const ctx=getContext();if(ctx.chat.some(m=>m.is_user))return false;
    const meta=ctx.chatMetadata[KEY],config=cardConfig(ctx);if(!meta||!config)return false;
    const opening=ctx.chat.find(m=>!m.is_user&&!m.is_system)?.mes??'';
    const mode=config.greeting_modes?.find(g=>g.text===opening)?.mode??config.mode??'free';
    if(meta.state?.systems?.setup?.mode===mode)return false;
    const initial=config.initial_state&&mode===config.mode?prepareAIState(config.initial_state,data,rules,catalog):seed(data,rules,catalog,mode);
    initial.enabled=true;ensureAltar(initial);
    ctx.chatMetadata[KEY]={schema:4,state:initial,origin:copy(initial)};ctx.saveMetadataDebounced();return true;
}
function current(){
    const m=store();
    if(m.state.enabled&&!altarOf(m.state)){ensureAltar(m.state);m.origin.systems??={};if(!altarOf(m.origin))m.origin.systems.altar={seed:m.state.systems.altar.seed,n:0};getContext().saveMetadataDebounced();}
    return prepareAIState(m.state,data,rules,catalog);
}
function save(state){
    const ctx=getContext(),m=store(ctx);m.state=prepareAIState(state,data,rules,catalog);
    if(!ctx.chatMetadata[KEY]&&m.state.enabled){ensureAltar(m.state);m.origin=copy(m.state);ctx.chatMetadata[KEY]=m;ephemeral.delete(contextId(ctx));}
    if(ctx.chatMetadata[KEY])ctx.saveMetadataDebounced();
}
function clearPrompt(){getContext().setExtensionPrompt(PROMPT,'',1,0,false,0);getContext().setExtensionPrompt(LEGACY_PROMPT,'',1,0,false,0);}
function setPrompt(state,options={}){
    const rendered=state.enabled?renderAIRequest(state,data,rules,catalog,options):{state,prompt:''};
    getContext().setExtensionPrompt(LEGACY_PROMPT,'',1,0,false,0);
    getContext().setExtensionPrompt(PROMPT,rendered.prompt,1,0,false,0);
    return rendered;
}
async function persistChat(){try{await getContext().saveChat?.();}catch(e){console.warn('[Relicta] Chat snapshot save failed',e);}}
function assistantIndex(){const chat=getContext().chat;for(let i=chat.length-1;i>=0;i--)if(!chat[i].is_user&&!chat[i].is_system)return i;return -1;}

function applyDisplayPolicy(message,index){
    const ctx=getContext(),flight=flights.get(contextId(ctx));
    const isFresh=!!flight&&index>=flight.start&&typeof flight.dreamteo==='boolean';
    const on=isFresh?flight.dreamteo:message.extra?.relicta05_ui?.dreamteo===true;
    message.extra??={};const prior=message.extra.relicta05_ui;
    const text=cleanNarrative(message.mes,false);
    const clean=on?text:stripDreamteo(text);
    message.extra.relicta05_ui={dreamteo:on,ownsDisplay:clean!==message.mes};
    if(clean!==message.mes){message.extra.display_text=clean;ctx.updateMessageBlock?.(index,message);}
    else if(prior?.ownsDisplay){delete message.extra.display_text;ctx.updateMessageBlock?.(index,message);}
}
function userIndex(end=getContext().chat.length){
    const chat=getContext().chat;for(let i=end-1;i>=0;i--)if(chat[i].is_user)return i;return -1;
}
function recordedState(message){
    const extra=message?.extra??{},record=message?.is_user?extra.relicta04_user:extra.relicta04;
    const state=record?(record.hash===fingerprint(message.mes)?record.after:record.before):null;
    const control=extra.relicta04_control?.after;
    return control&&control.rev>=(state?.rev??-1)?control:state;
}
function prefixState(end){
    const chat=getContext().chat;
    for(let i=end-1;i>=0;i--){const s=recordedState(chat[i]);if(s)return copy(s);}
    return copy(store().origin);
}
function checkpointUser(){
    const ctx=getContext(),index=userIndex();if(index<0)return null;
    const message=ctx.chat[index],hash=fingerprint(message.mes);message.extra??={};
    let record=message.extra.relicta04_user;
    if(record?.hash!==hash){
        const before=record?.before?copy(record.before):prefixState(index);
        record={hash,turnId:globalThis.crypto.randomUUID(),before,after:copy(before),judgementVersion:8};
        message.extra.relicta04_user=record;delete message.extra.relicta08_outcome;
    }else{
        record.turnId??=globalThis.crypto.randomUUID();
        // Old v0.8 already charged/rolled before narration. Pin that completed result.
        if(record.judgementVersion!==8&&!message.extra.relicta08_outcome&&record.actions?.length){
            let after=record.after;
            for(let j=index+1;j<ctx.chat.length&&!ctx.chat[j].is_user;j++){
                const old=recordedState(ctx.chat[j]);if(old)after=old;
            }
            message.extra.relicta08_outcome={hash,turnId:record.turnId,after:copy(after),source:'legacy'};
        }
        record.judgementVersion=8;
    }
    let outcome=message.extra.relicta08_outcome;
    if(outcome?.hash!==hash||outcome?.turnId!==record.turnId)outcome=null;
    // Explicit author changes have precedence over a pinned older outcome.
    for(let j=index;j<ctx.chat.length;j++){
        const control=ctx.chat[j].extra?.relicta04_control?.after;
        if(control&&control.rev>(outcome?.after?.rev??record.after.rev)){
            outcome={hash,turnId:record.turnId,after:copy(control),source:'author'};
            message.extra.relicta08_outcome=outcome;
        }
    }
    return {index,message,hash,record,outcome};
}
function syncMessage(index=assistantIndex()){
    const ctx=getContext(),message=ctx.chat[index];
    if(!message||message.is_user||message.is_system||!current().enabled)return {ok:false,error:'not-assistant'};
    applyDisplayPolicy(message,index);
    const hash=fingerprint(message.mes),existing=message.extra?.relicta04;
    const flight=flights.get(contextId(ctx));
    const u=userIndex(index),user=ctx.chat[u],record=user?.extra?.relicta04_user;
    const valid=record&&record.hash===fingerprint(user.mes);
    const outcome=valid&&user.extra?.relicta08_outcome?.hash===record.hash?user.extra.relicta08_outcome:null;
    const active=flight&&index>=flight.start&&(!flight.turnId||valid&&flight.turnId===record.turnId&&flight.inputHash===record.hash);
    if(existing?.hash===hash){
        if(outcome)save(outcome.after);
        return {ok:true,state:current(),duplicate:true};
    }
    // Historical/imported text is never replayed as a new purchase on load/render.
    if(!active&&!outcome)return {ok:false,state:current(),error:'historical-record-only'};
    const before=prepareAIState(active?flight.before:record.after,data,rules,catalog);
    const locked=outcome?.after??(active?flight.lockedAfter:null);
    const parsed=parseAIJudgement(message.mes);
    const cards=countGachaCards(message.mes);
    // 기록이 없거나 깨져도 이미 나온 소환 카드만큼은 제단 대기열을 넘겨 같은 결과가 반복되지 않게 한다.
    const result=locked?{ok:true,state:prepareAIState(locked,data,rules,catalog),error:null}:
        parsed.value?applyAIJudgement(before,parsed.value,data,rules,catalog,{gachaCards:cards}):{ok:false,state:consume(copy(before),cards),error:parsed.error};
    message.extra??={};message.extra.relicta04={schema:4,hash,before:copy(before),after:copy(result.state),error:result.error??null,warnings:result.warnings??[],judgementVersion:8,turnId:record?.turnId,inputHash:record?.hash};
    if(result.ok&&valid&&!outcome){user.extra.relicta08_outcome={hash:record.hash,turnId:record.turnId,after:copy(result.state),source:'ai'};}
    save(result.state);return result;
}
function restoreLatest(){
    if(!current().enabled)return;
    save(prefixState(getContext().chat.length));setPrompt(current());refresh();
}
function pinAuthorState(state){
    const message=getContext().chat[userIndex()],record=message?.extra?.relicta04_user;
    if(record&&record.hash===fingerprint(message.mes)){
        record.turnId??=globalThis.crypto.randomUUID();
        message.extra.relicta08_outcome={hash:record.hash,turnId:record.turnId,after:copy(state),source:'author'};
    }
}

function runAction(action){
    const ctx=getContext(),state=current();
    if(!state.enabled)return {ok:false,state,error:'이 채팅에서 렐릭타 세션을 먼저 켜주세요.'};
    const result=applyGameAction(state,action,data,rules,catalog);
    if(result.ok){save(result.state);const anchor=ctx.chat.at(-1);if(anchor){anchor.extra??={};anchor.extra.relicta04_control={after:copy(result.state)};}pinAuthorState(result.state);setPrompt(result.state);refresh();}
    return result;
}
function authorSet(value){
    const error=validateAuthorState(value,data);if(error)throw new Error(error);
    const before=current(),next=normalizeSession({...value,rev:before.rev+1},data);
    next.cast=next.cast.filter(id=>allowed(id,next,data));save(next);const anchor=getContext().chat.at(-1);if(anchor){anchor.extra??={};anchor.extra.relicta04_control={after:copy(next)};}pinAuthorState(next);setPrompt(next);refresh();
    return next;
}

globalThis.relictaSessionInterceptor=async function(_chat,_contextSize,_abort,type){
    const id=contextId(getContext());
    try{
        await loadData();if(id!==contextId(getContext()))return;
        let state=current();if(!state.enabled){clearPrompt();return;}
        // v0.8.1: 요약·대리 입력 같은 다른 생성에는 렐릭타 지시문을 빼고, 생성이 끝나면 되돌린다.
        if(['quiet','impersonate'].includes(type)){getContext().setExtensionPrompt(PROMPT,'',1,0,false,0);suspended=true;return;}
        presentation.delete(id);
        const turn=checkpointUser();
        if(turn){state=prepareAIState(turn.outcome?.after??turn.record.after,data,rules,catalog);save(state);}
        // ST constructs copied coreChat messages before calling interceptors.
        if(Array.isArray(_chat)){const clean=cleanHistory(_chat);_chat.splice(0,_chat.length,...clean);}
        presentation.set(id,{enabled:false,awaiting:true});
        const rendered=setPrompt(state,{locked:!!turn?.outcome,utterance:turn?.message.mes??'',altarState:turn?.outcome?turn.record.after:null});save(rendered.state);
        flights.set(id,{before:copy(turn?.record.after??state),lockedAfter:turn?.outcome?copy(turn.outcome.after):null,
            turnId:turn?.record.turnId,inputHash:turn?.hash,dreamteo:false,start:turn?turn.index+1:getContext().chat.length});
        refresh();await persistChat();
    }catch(e){if(id===contextId(getContext()))clearPrompt();console.error('[Relicta] Session preparation failed',e);}
};

function element(tag,text,attrs={}){const n=document.createElement(tag);if(text!==null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
const get=k=>panel.querySelector(`[data-ro="${k}"]`);
function check(key,label,parent=panel){const l=element('label',null),n=element('input',null,{type:'checkbox','data-ro':key});l.append(n,document.createTextNode(label));parent.append(l);return n;}
function input(key,label,select=false){const l=element('label',label),n=element(select?'select':'input',null,{'data-ro':key});if(!select)n.type='text';l.append(n);panel.append(l);return n;}
function options(select,items,selected){select.replaceChildren();for(const [value,label]of items){const o=element('option',label,{value});o.selected=Array.isArray(selected)?selected.includes(value):String(selected)===String(value);select.append(o);}}
function notify(result){if(result.ok)globalThis.toastr?.success('세션 기록에 반영했습니다.');else globalThis.toastr?.warning(result.error);}
function paintStatus(){
    if(!data||!document.querySelectorAll)return;
    const opened=new Set([...document.querySelectorAll('.ro4-status-host details[open]')].map(d=>d.querySelector('summary')?.textContent));
    for(const old of document.querySelectorAll('.ro4-status-host'))old.remove();
    const s=current();if(!s.enabled)return;
    const i=assistantIndex(),host=document.querySelector('#chat .mes[mesid="'+i+'"] .mes_text')??document.querySelector('#chat');if(!host)return;
    const view=document.createElement('div');view.className='ro4-status-host';view.innerHTML=statusHTML(s,data,rules,catalog);
    for(const d of view.querySelectorAll('details'))if(opened.has(d.querySelector('summary')?.textContent))d.open=true;
    // v0.8.1: 상태 기록이 빠지거나 일부만 반영됐을 때 상태창 안에만 조용히 표시한다(대화문에는 넣지 않음).
    const msg=getContext().chat[i],last=msg?.extra?.relicta04;
    if(last?.error&&last.hash===fingerprint(msg.mes)){
        const partial=String(last.error).startsWith('partial');
        const badge=document.createElement('div');badge.className='ro4-sync'+(partial?' is-partial':'');badge.title=String(last.error);
        badge.textContent=partial?'◐ 이번 응답의 상태 기록 일부가 반영되지 않았습니다 · 수치가 본문과 다르면 재생성하세요':'○ 이번 응답의 상태 기록이 반영되지 않았습니다 · 재생성하면 다시 기록합니다';
        view.prepend(badge);
    }
    bindStatus(view,async a=>{notify(runAction(a));await persistChat();},async()=>{await getContext().generate?.('normal');});host.append(view);
}
function refresh(){
    paintStatus();if(!panel||!data)return;
    const s=current(),d=directory(s,data),r=renderAIRequest(s,data,rules,catalog);
    for(const k of ['enabled','worldTruth','abyssOrigin'])get(k).checked=s[k];
    get('loc').value=s.loc;get('event').value=s.event;get('place').value=s.place;
    const candidates=[...new Set([...d.eligible,...s.cast,...s.known.filter(id=>allowed(id,s,data))])];
    options(get('cast'),candidates.map(id=>[id,`${id} ${data.chars[id].name} · ${data.chars[id].role}`]),s.cast);
    const label=id=>`${data.chars[id].name} · ${data.chars[id].role}`;
    options(get('known'),Object.keys(data.chars).filter(id=>['plat','mid','solo'].includes(data.chars[id].kind)).map(id=>[id,label(id)]),s.known);
    options(get('deep'),Object.keys(data.chars).map(id=>[id,label(id)]),s.deep);
    for(const k of ['known','deep'])filterOptions(k);
    get('luck').value=String(luckOf(s));get('luck-odds').textContent=oddsLine(luckOf(s));get('altar-log').textContent=altarLog(s);
    for(const k of data.evidence)get('evidence-'+k).checked=s.evidence.includes(k);
    for(const k of ['question','junk','systemGap'])get('extra-'+k).checked=s.extras[k];
    for(let n=139;n<=145;n++)get('bond-c'+n).value=s.bonds['c'+n];
    const last=getContext().chat[assistantIndex()]?.extra?.relicta04;
    get('summary').textContent=`세션 r${s.rev} · ${d.location.label} · 상세 ${r.state.cast.length}명 · 주입 ${r.prompt.length.toLocaleString()}자`+(last?.error?` · 마지막 제안: ${last.error}`:'');
    get('status').textContent=JSON.stringify(snapshot(s,data),null,2);
}
function fromUI(){
    const s=current();for(const k of ['enabled','worldTruth','abyssOrigin'])s[k]=get(k).checked;
    const target=get('loc').value;
    if((data.locations[target].world==='reality')!==(world(s,data)==='reality'))throw new Error('현실/게임 전환에는 로그아웃·접속 버튼을 사용해주세요.');
    s.loc=target;s.event=get('event').value;s.place=get('place').value;
    s.cast=[...get('cast').selectedOptions].map(o=>o.value);s.known=[...get('known').selectedOptions].map(o=>o.value);s.deep=[...get('deep').selectedOptions].map(o=>o.value);
    setLuck(s,Number(get('luck').value));
    s.evidence=data.evidence.filter(k=>get('evidence-'+k).checked);
    for(const k of ['question','junk','systemGap'])s.extras[k]=get('extra-'+k).checked;
    for(let n=139;n<=145;n++)s.bonds['c'+n]=Number(get('bond-c'+n).value);
    return s;
}
const pct=x=>x>=0.01?(x*100).toFixed(0)+'%':(x*100).toPrecision(1).replace(/\.?0+$/,'')+'%';
function oddsLine(l){const o=oddsOf(l);return `신급 ${pct(o['신급'])} · 상등급 ${pct(o['상등급'])} · 노말 ${pct(o['노말'])} · 꽝 ${pct(o['꽝'])} · NPC가 뽑을 때는 적용하지 않음`;}
function altarLog(s){const log=altarOf(s)?.log??[];return log.length?log.map(x=>`r${x.rev} #${x.no} ${x.from} → ${x.to} · ${x.reason}`).join('\n'):'(대기열 예외 기록 없음)';}
function filterOptions(key){const q=(panel?.querySelector(`[data-ro-filter="${key}"]`)?.value??'').trim();for(const o of get(key).options)o.hidden=!!q&&!o.textContent.includes(q)&&!o.selected;}
function nameList(key,label){
    const l=element('label',label),f=element('input',null,{type:'search',placeholder:'이름으로 찾기','data-ro-filter':key,'aria-label':label+' 검색'}),n=element('select',null,{'data-ro':key,multiple:'',size:'7'});
    f.addEventListener('input',()=>filterOptions(key));l.append(f,n);panel.append(l);return n;
}
function findChar(name){const q=String(name??'').trim();if(!q)return null;if(Object.hasOwn(data.chars,q))return q;
    return Object.values(data.chars).find(c=>c.name===q||(c.aliases??[]).includes(q))?.id??Object.values(data.chars).find(c=>c.name.includes(q))?.id??null;}
function toggleList(field,name,on){
    const id=findChar(name);if(!id)return `인물을 찾지 못했습니다: ${name}`;
    if(field==='known'&&!['plat','mid','solo'].includes(data.chars[id].kind))return `${data.chars[id].name}은(는) 현실 신원을 연결하는 플레이어가 아닙니다.`;
    const s=current(),set=new Set(s[field]);on?set.add(id):set.delete(id);authorSet({...s,[field]:[...set]});
    return `${data.chars[id].name}: ${field==='known'?'현실 신원 연결':'심층 전체 참고'} ${on?'켬':'끔'}`;
}
function button(label,fn,parent=panel){const b=element('button',label,{type:'button',class:'menu_button'});b.addEventListener('click',fn);parent.append(b);return b;}
function mount(){
    const host=document.querySelector('#extensions_settings')??document.querySelector('#extensions_settings2');if(!host)return;
    panel=element('details',null,{class:'ro-panel'});panel.append(element('summary','Relicta · 플레이 세션 v0.8.4'));
    panel.append(element('p','현재 채팅의 위치·명부·플레이어·인연 기록을 하나의 세션으로 관리합니다.',{class:'ro-note'}));
    check('enabled','이 채팅에서 사용');
    options(input('loc','현재 위치',true),Object.values(data.locations).map(l=>[l.code,l.label]),'RN_START');
    options(input('event','활동',true),Object.entries(data.events),'daily');input('place','세부 장소 (자유 서술)');
    const cast=input('cast','실제 등장인물 · 최대 6명',true);cast.multiple=true;
    panel.append(element('p','행동과 결과는 본문 AI가 판정하며, 이 확장은 최종 기록과 상태창을 관리합니다.',{class:'ro-note'}));
    const luck=input('luck','행운 보정 · 플레이어 본인의 소환·룰렛',true);
    options(luck,LUCK.slice(1).map((l,i)=>[String(i+1),l.label]),'1');
    panel.append(element('p','',{'data-ro':'luck-odds',class:'ro-note'}));
    luck.addEventListener('change',()=>{get('luck-odds').textContent=oddsLine(Number(luck.value));});
    nameList('known','현실 신원을 연결한 플레이어 (Ctrl/⌘ 클릭으로 여러 명)');nameList('deep','심층 전체 참고를 허용할 인물 (기본은 중심 모순 한 줄만 자동 전달)');
    const gates=element('details');gates.append(element('summary','제작자 진행 판정'));panel.append(gates);
    for(const [k,label]of Object.entries({servers:'NPC 서버 증거',audience:'관측실 증거',marca:'MARCA 증거',dreams:'의료 증언 증거'}))check('evidence-'+k,label,gates);
    for(let n=139;n<=145;n++){const l=element('label',data.chars['c'+n].name),select=element('select',null,{'data-ro':'bond-c'+n});options(select,[[0,'미진행'],[1,'균열'],[2,'귀환'],[3,'이름']],0);l.append(select);gates.append(l);}
    for(const [k,label]of Object.entries({question:'첫 질문 메모 확인',junk:'꽝 수집 조건 충족',systemGap:'현재 장면이 시스템의 틈'}))check('extra-'+k,label,gates);
    check('worldTruth','세계 진실 GM 참고',gates);check('abyssOrigin','나락 기원 GM 참고',gates);
    button('장면·진행 설정 적용',()=>{try{authorSet(fromUI());globalThis.toastr?.success('현재 세션에 반영했습니다.');}catch(e){globalThis.toastr?.warning(e.message);refresh();}});
    get('enabled').addEventListener('change',()=>authorSet({...current(),enabled:get('enabled').checked}));
    const actions=element('div',null,{class:'ro-row'});panel.append(actions);
    button('로그아웃',()=>notify(runAction({type:'logout'})),actions);button('게임 접속',()=>notify(runAction({type:'login'})),actions);
    const death=element('details');death.append(element('summary','사망·부활 시험 조작'));panel.append(death);
    death.append(element('p','실제 10초 입력 제한은 없습니다. 전투 HP가 0이 되면 이 부활 선택이 자동으로 열립니다.',{class:'ro-note'}));
    button('사망 판정 열기',()=>notify(runAction({type:'death'})),death);
    button('일반 부활 · 총EXP 절반',()=>notify(runAction({type:'revive',mode:'normal'})),death);
    button('즉시 부활 · 1,000다이아',()=>notify(runAction({type:'revive',mode:'diamonds'})),death);
    button('즉시 부활 · 1,000만 골드',()=>notify(runAction({type:'revive',mode:'gold'})),death);
    panel.append(element('p','',{'data-ro':'summary',class:'ro-note'}));
    const altarBox=element('details');altarBox.append(element('summary','제단 대기열 예외 기록'));altarBox.append(element('pre','',{'data-ro':'altar-log'}));panel.append(altarBox);
    const status=element('details');status.append(element('summary','기록 확인 · 임시 표시'));status.append(element('pre','',{'data-ro':'status'}));panel.append(status);
    const edit=element('details');edit.append(element('summary','전체 세션 JSON · 초기 수치 설정·내보내기'));panel.append(edit);
    edit.append(element('p','미정 값은 null로 유지합니다. 여기서 적용한 수치·진행 기록은 제작자 설정으로 취급합니다.',{class:'ro-note'}));
    const area=element('textarea','',{'data-ro':'json',rows:'12','aria-label':'전체 세션 JSON'});edit.append(area);
    button('현재 세션 읽기',()=>{area.value=JSON.stringify(current(),null,2);},edit);
    button('JSON을 세션에 적용',()=>{try{const value=JSON.parse(area.value);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();authorSet(value);}catch{globalThis.toastr?.error('세션 JSON을 확인해주세요.');}},edit);
    const preview=element('details');preview.append(element('summary','실제 주입 본문'));const pre=element('pre','');preview.append(pre);preview.addEventListener('toggle',()=>{if(preview.open)pre.textContent=renderAIRequest(current(),data,rules,catalog).prompt||'(비활성)';});panel.append(preview);
    host.append(panel);refresh();
}

function command(_args,value){
    const parts=String(value??'').trim().split(/\s+/),verb=parts.shift()??'상태';let action;
    if(['행운','luck'].includes(verb)){const n=Number(parts[0]);if(!Number.isInteger(n)||n<1||n>=LUCK.length)return '사용: /relicta 행운 1~6 (현재 '+luckOf(current())+'단계)';const s=current();setLuck(s,n);authorSet(s);return `행운 보정 ${LUCK[n].label} · ${oddsLine(n)}`;}
    if(['연결','link'].includes(verb))return toggleList('known',parts.join(' '),true);
    if(['연결해제','unlink'].includes(verb))return toggleList('known',parts.join(' '),false);
    if(['심층','deep'].includes(verb))return toggleList('deep',parts.join(' '),true);
    if(['심층해제','undeep'].includes(verb))return toggleList('deep',parts.join(' '),false);
    const gameAction=gameTextAction(String(value??''));if(gameAction){const r=runAction(gameAction);notify(r);return r.ok?JSON.stringify(snapshot(r.state,data)):r.error;}
    if(['상태','status'].includes(verb))return JSON.stringify(snapshot(current(),data));
    if(['로그아웃','logout'].includes(verb))action={type:'logout'};
    else if(['접속','login'].includes(verb))action={type:'login'};
    else if(['사망','death'].includes(verb))action={type:'death'};
    else if(['부활','revive'].includes(verb))action={type:'revive',mode:({일반:'normal',다이아:'diamonds',골드:'gold'})[parts[0]]??parts[0]};
    else if(['스탯','stat'].includes(verb))action={type:'stat',stat:parts[0],points:Number(parts[1])};
    else if(['닉네임','name'].includes(verb))action={type:'handle',name:parts.join(' ')};
    else if(['수락','accept'].includes(verb))action={type:'quest',id:parts[0],status:'active'};
    else if(['거절','decline'].includes(verb))action={type:'quest',id:parts[0],status:'declined'};
    else if(['동행','follow'].includes(verb))action={type:'follow',id:parts[0]};
    else if(['헤어짐','leave'].includes(verb))action={type:'leave',id:parts[0]};
    if(!action)return '사용: /relicta 상태 | 행운 1~6 | 연결 이름 | 연결해제 이름 | 심층 이름 | 심층해제 이름 | 로그아웃 | 접속 | 스탯 STR 2 | 수락 q_id | 사망 | 부활 일반/다이아/골드';
    const result=runAction(action);notify(result);return result.ok?JSON.stringify(snapshot(result.state,data)):result.error;
}

async function initialize(){
    try{
        await loadData();store();mount();const ctx=getContext();
        const on=(name,fn)=>{if(ctx.eventTypes[name])ctx.eventSource.on(ctx.eventTypes[name],fn);};
        on('CHAT_CHANGED',()=>{presentation.clear();flights.clear();clearPrompt();store();setPrompt(current());refresh();});
        on('WORLD_INFO_ACTIVATED',entries=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting){p.enabled=dreamteoFromEntries(entries);const f=flights.get(contextId(getContext()));if(f)f.dreamteo=p.enabled;}});
        on('CHAT_COMPLETION_PROMPT_READY',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&Array.isArray(event.chat)){event.chat=withDreamteoPolicy(event.chat,p.enabled);event.chat.push({role:'system',content:finalAIInstruction()});}});
        on('GENERATE_AFTER_COMBINE_PROMPTS',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&typeof event.prompt==='string')event.prompt=textDreamteoPolicy(event.prompt,p.enabled)+'\n'+finalAIInstruction();});
        const resume=()=>{if(!suspended)return;suspended=false;if(current().enabled)setPrompt(current());};
        on('GENERATE_AFTER_DATA',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;resume();});
        on('GENERATION_STOPPED',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;resume();});
        on('GENERATION_ENDED',resume);
        const received=async index=>{if(!current().enabled)return;syncMessage(Number.isInteger(index)?index:assistantIndex());setPrompt(current());refresh();await persistChat();};
        on('MESSAGE_RECEIVED',received);on('CHARACTER_MESSAGE_RENDERED',received);
        on('MESSAGE_SWIPED',async()=>{if(reseedFromGreeting()){setPrompt(current());refresh();await persistChat();return;}if(!current().enabled)return;checkpointUser();syncMessage(assistantIndex());setPrompt(current());refresh();await persistChat();});
        on('MESSAGE_DELETED',async()=>{restoreLatest();await persistChat();});
        on('MESSAGE_EDITED',()=>{restoreLatest();});
        // Registration through the current ST context; no shell or external service is used.
        if(ctx.SlashCommandParser?.addCommandObject&&ctx.SlashCommand?.fromProps)ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name:'relicta',callback:command,splitUnnamedArgument:false,
            unnamedArgumentList:ctx.SlashCommandArgument?.fromProps?[ctx.SlashCommandArgument.fromProps({description:'동작과 인수',typeList:[ctx.ARGUMENT_TYPE?.STRING??'string'],isRequired:false})]:[],
            helpString:'렐릭타 세션: 상태, 행운 보정(행운 1~6), 현실 신원 연결(연결/연결해제 이름), 심층 참고(심층/심층해제 이름), 로그아웃, 접속, 스탯, 퀘스트 수락, 사망·부활'}));
        else if(ctx.registerSlashCommand)ctx.registerSlashCommand('relicta',command,[], '렐릭타 시험 세션 조작',true,true);
        globalThis.RelictaSession={getState:()=>copy(current()),action:runAction,importState:authorSet,exportState:()=>JSON.stringify(current(),null,2)};
        setPrompt(current());refresh();
    }catch(e){console.error('[Relicta] Session init failed',loadingError??e);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
