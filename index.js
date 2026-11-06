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
// v0.8.6: crypto.randomUUID는 https·localhost에서만 있다. 휴대폰·LAN 주소로 접속해도 멈추지 않게 대체한다.
const uuid=()=>{if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const diag={lastError:null,lastPrompt:0,lastSync:null,interceptor:0,lastSkip:null,recovered:0,received:0,lastReceived:null,bound:0,init:null};
// v0.8.9: 응답 기록은 본문 전체가 아니라 숨은 판정 주석을 기준으로도 알아본다. 다른 확장·기능이 판정 뒤에 본문 글자를 고쳐도 기록이 풀리지 않는다.
const judgeSig=text=>{const m=[...String(text??'').matchAll(/<!--RO(?:AI|4):[\s\S]*?-->|<RELICTA_STATE>[\s\S]*?<\/RELICTA_STATE>/g)].at(-1);return m?m[0].replace(/\s+/g,' '):null;};
function sameText(record,message){if(!record||!message)return false;if(record.hash===fingerprint(message.mes))return true;if(message.is_user)return false;const s=judgeSig(message.mes);return !!s&&record.sig===s;}
// v0.8.8: 같은 확장이 두 폴더에 설치되면 모듈이 두 번 돈다. 먼저 뜬 쪽만 일하고 나머지는 경고만 남긴다.
const DUPLICATE=!!globalThis.__relictaSessionLoaded;if(DUPLICATE){globalThis.__relictaDuplicate=(globalThis.__relictaDuplicate??0)+1;console.warn('[Relicta] 같은 확장이 한 번 더 설치되어 있어 이 사본은 쉽니다:',import.meta.url);}else globalThis.__relictaSessionLoaded=import.meta.url;
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
    const shallow=!!ctx.characters?.[ctx.characterId]?.shallow;
    if(!enabled&&shallow){const s=seed(data,rules,catalog,'free');s.enabled=false;return {schema:4,state:s,origin:copy(s)};}
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
    // v0.8.11: 닫힌 판정 주석은 화면에 보이지 않으므로(정규식 14도 가린다) 표시 사본(display_text)을 만들지 않는다.
    // 사본은 본문을 그 순간으로 고정해서, 응답 뒤에 이미지 태그 등을 덧붙이는 다른 확장의 내용을 가려 버렸다. 꼭 가려야 할 것이 있을 때만 쓰고, 다시 그리는 것도 내용이 바뀔 때만 한다.
    const bare=String(message.mes??'').replace(/<!--RO(?:AI|4):[\s\S]*?-->/g,'');
    const needs=clean!==bare;
    message.extra.relicta05_ui={dreamteo:on,ownsDisplay:needs,base:needs?fingerprint(message.mes):null};
    if(needs){if(message.extra.display_text!==clean){message.extra.display_text=clean;ctx.updateMessageBlock?.(index,message);}}
    else if(prior?.ownsDisplay){delete message.extra.display_text;ctx.updateMessageBlock?.(index,message);}
}
function userIndex(end=getContext().chat.length){
    const chat=getContext().chat;for(let i=end-1;i>=0;i--)if(chat[i].is_user)return i;return -1;
}
function recordedState(message){
    const extra=message?.extra??{},record=message?.is_user?extra.relicta04_user:extra.relicta04;
    const state=record?(sameText(record,message)?record.after:record.before):null;
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
        record={hash,turnId:uuid(),before,after:copy(before),judgementVersion:8};
        message.extra.relicta04_user=record;delete message.extra.relicta08_outcome;
    }else{
        record.turnId??=uuid();
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
    const u=userIndex(index),user=ctx.chat[u],record=user?.extra?.relicta04_user;
    // v0.8.8: 판정 대기 정보는 메모리뿐 아니라 채팅 기록(입력 메시지 · 채팅 메타)에도 둔다. 생성 도중 채팅이 다시 불러와져도 짝을 잃지 않는다.
    let flight=flights.get(contextId(ctx)),recovered=false;
    if(!flight){const p=u>=0?user?.extra?.relicta09_pending:store(ctx).pending;if(p&&typeof p.start==='number'){flight=p;recovered=true;}}
    const valid=record&&record.hash===fingerprint(user.mes);
    const outcome=valid&&user.extra?.relicta08_outcome?.hash===record.hash?user.extra.relicta08_outcome:null;
    const active=flight&&index>=flight.start&&(!flight.turnId||valid&&flight.turnId===record.turnId&&flight.inputHash===record.hash);
    if(existing&&sameText(existing,message)){
        if(existing.hash!==hash){existing.hash=hash;const si0=Array.isArray(message.swipe_info)?message.swipe_info[message.swipe_id??0]:null;if(si0?.extra?.relicta04)si0.extra.relicta04.hash=hash;}
        if(outcome)save(outcome.after);
        return {ok:true,state:current(),duplicate:true};
    }
    // Historical/imported text is never replayed as a new purchase on load/render.
    if(!active&&!outcome){
        if(index===assistantIndex()&&existing?.hash!==hash)diag.lastSkip=!flight?'판정 대기 정보 없음(생성 전 준비가 이 응답과 이어지지 않음)':index<flight.start?'판정 요청보다 앞선 메시지':'입력 메시지가 판정 요청 뒤에 바뀜';
        return {ok:false,state:current(),error:'historical-record-only'};
    }
    const before=prepareAIState(active?flight.before:record.after,data,rules,catalog);
    const locked=outcome?.after??(active?flight.lockedAfter:null);
    const parsed=parseAIJudgement(message.mes);
    const cards=countGachaCards(message.mes);
    // 기록이 없거나 깨져도 이미 나온 소환 카드만큼은 제단 대기열을 넘겨 같은 결과가 반복되지 않게 한다.
    const result=locked?{ok:true,state:prepareAIState(locked,data,rules,catalog),error:null}:
        parsed.value?applyAIJudgement(before,parsed.value,data,rules,catalog,{gachaCards:cards}):{ok:false,state:consume(copy(before),cards),error:parsed.error};
    message.extra??={};message.extra.relicta04={schema:4,hash,sig:judgeSig(message.mes),before:copy(before),after:copy(result.state),error:result.error??null,warnings:result.warnings??[],judgementVersion:8,turnId:record?.turnId,inputHash:record?.hash};
    // v0.8.6: 실리태번은 스와이프별 extra를 swipe_info에 따로 보관한다. 다른 스와이프를 보고 돌아와도 기록이 남게 함께 적는다.
    const si=Array.isArray(message.swipe_info)?message.swipe_info[message.swipe_id??0]:null;if(si&&typeof si==='object'){si.extra??={};si.extra.relicta04=message.extra.relicta04;}
    diag.lastSync=result.error?String(result.error):'ok';diag.lastSkip=null;if(recovered)diag.recovered++;
    if(user?.extra?.relicta09_pending)delete user.extra.relicta09_pending;{const m=ctx.chatMetadata[KEY];if(m?.pending&&u<0)delete m.pending;}
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
        record.turnId??=uuid();
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

const relictaInterceptor=async function(_chat,_contextSize,_abort,type){
    const id=contextId(getContext());
    try{
        await loadData();bindEvents();if(id!==contextId(getContext()))return;
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
        diag.lastPrompt=rendered.prompt.length;diag.interceptor++;diag.lastError=null;
        flights.set(id,{before:copy(turn?.record.after??state),lockedAfter:turn?.outcome?copy(turn.outcome.after):null,
            turnId:turn?.record.turnId,inputHash:turn?.hash,dreamteo:false,start:turn?turn.index+1:getContext().chat.length});
        {const f=copy(flights.get(id));if(turn){turn.message.extra.relicta09_pending=f;}else{const m=store();m.pending=f;}diag.lastSkip=null;}
        safeRefresh();await persistChat();
    }catch(e){if(id===contextId(getContext()))clearPrompt();diag.lastError='생성 준비 실패: '+(e?.message??e);console.error('[Relicta] Session preparation failed',e);safeRefresh();}
};
if(!DUPLICATE)globalThis.relictaSessionInterceptor=relictaInterceptor;

function element(tag,text,attrs={}){const n=document.createElement(tag);if(text!==null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
const get=k=>panel.querySelector(`[data-ro="${k}"]`);
let body;
function check(key,label,parent=body){const l=element('label',null),n=element('input',null,{type:'checkbox','data-ro':key});l.append(n,document.createTextNode(label));parent.append(l);return n;}
function input(key,label,select=false){const l=element('label',label),n=element(select?'select':'input',null,{'data-ro':key});if(!select)n.type='text';l.append(n);body.append(l);return n;}
function options(select,items,selected){select.replaceChildren();for(const [value,label]of items){const o=element('option',label,{value});o.selected=Array.isArray(selected)?selected.includes(value):String(selected)===String(value);select.append(o);}}
function notify(result){if(result.ok)globalThis.toastr?.success('세션 기록에 반영했습니다.');else globalThis.toastr?.warning(result.error);}
function paintStatus(){
    if(!data||!document.querySelectorAll)return;
    const opened=new Set([...document.querySelectorAll('.ro4-status-host details[open]')].map(d=>d.querySelector('summary')?.textContent));
    for(const old of document.querySelectorAll('.ro4-status-host'))old.remove();
    const s=current();if(!s.enabled)return;
    painting=true;
    // v0.8.11: 상태창은 본문(.mes_text) 안이 아니라 메시지 블록 맨 끝에 붙인다. 본문을 다시 쓰거나 이미지를 끼워 넣는 다른 확장과 서로 건드리지 않는다.
    const i=assistantIndex(),mes=document.querySelector('#chat .mes[mesid="'+i+'"]'),host=mes?.querySelector('.mes_block')??mes?.querySelector('.mes_text')??document.querySelector('#chat');if(!host){painting=false;return;}
    const view=document.createElement('div');view.className='ro4-status-host';view.innerHTML=statusHTML(s,data,rules,catalog);
    for(const d of view.querySelectorAll('details'))if(opened.has(d.querySelector('summary')?.textContent))d.open=true;
    // v0.8.1: 상태 기록이 빠지거나 일부만 반영됐을 때 상태창 안에만 조용히 표시한다(대화문에는 넣지 않음).
    const msg=getContext().chat[i],last=msg?.extra?.relicta04;
    if(last?.error&&sameText(last,msg)){
        const partial=String(last.error).startsWith('partial');
        const badge=document.createElement('div');badge.className='ro4-sync'+(partial?' is-partial':'');badge.title=String(last.error);
        badge.textContent=partial?'◐ 이번 응답의 상태 기록 일부가 반영되지 않았습니다 · 수치가 본문과 다르면 재생성하세요':'○ 이번 응답의 상태 기록이 반영되지 않았습니다 · 재생성하면 다시 기록합니다';
        view.prepend(badge);
    }
    bindStatus(view,async a=>{notify(runAction(a));await persistChat();},async()=>{await getContext().generate?.('normal');});host.append(view);
    painting=false;
}
// v0.8.6: 메시지 칸이 다시 그려져 상태창이 사라지면 곧바로 다시 붙인다.
let painting=false,repaintTimer=null,observer=null;
function watchChat(){
    const chat=document.querySelector?.('#chat');if(!chat||observer||typeof MutationObserver!=='function')return;
    observer=new MutationObserver(()=>{if(painting||repaintTimer)return;repaintTimer=setTimeout(()=>{repaintTimer=null;try{if(!data||!current().enabled)return;const ch=getContext().chat,ai=assistantIndex(),m=ch[ai],ui=m?.extra?.relicta05_ui;if(ui?.ownsDisplay&&ui.base!==fingerprint(m.mes))applyDisplayPolicy(m,ai);if(!document.querySelector('.ro4-status-host'))paintStatus();}catch(e){console.warn('[Relicta] repaint',e);}},180);});
    observer.observe(chat,{childList:true,subtree:true});
}
function safeRefresh(){try{refresh();}catch(e){painting=false;diag.lastError='화면 갱신 오류: '+e.message;console.error('[Relicta] refresh failed',e);}}
function refresh(){
    paintStatus();if(!panel||!data)return;
    const s=current(),d=directory(s,data),r=s.enabled?renderAIRequest(s,data,rules,catalog):{state:s,prompt:''};
    get('enabled').checked=s.enabled;get('luck').value=String(luckOf(s));paintOdds(luckOf(s));paintConn(s);
    get('dirty').hidden=!dirty;
    if(!dirty){
    for(const k of ['worldTruth','abyssOrigin'])get(k).checked=s[k];
    get('loc').value=s.loc;get('event').value=s.event;get('place').value=s.place;
    const candidates=[...new Set([...d.eligible,...s.cast,...s.known.filter(id=>allowed(id,s,data))])];
    options(get('cast'),candidates.map(id=>[id,`${id} ${data.chars[id].name} · ${data.chars[id].role}`]),s.cast);
    const label=id=>`${data.chars[id].name} · ${data.chars[id].role}`;
    options(get('known'),Object.keys(data.chars).filter(id=>['plat','mid','solo'].includes(data.chars[id].kind)).map(id=>[id,label(id)]),s.known);
    options(get('deep'),Object.keys(data.chars).map(id=>[id,label(id)]),s.deep);
    for(const k of ['known','deep'])filterOptions(k);
    for(const k of data.evidence)get('evidence-'+k).checked=s.evidence.includes(k);
    for(const k of ['question','junk','systemGap'])get('extra-'+k).checked=s.extras[k];
    for(let n=139;n<=145;n++)get('bond-c'+n).value=s.bonds['c'+n];
    }
    get('altar-log').textContent=altarLog(s);
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
let dirty=false;
function diagReport(){
    const ctx=getContext(),ch=ctx.chat,i=assistantIndex(),m=ch[i],u=userIndex(i<0?ch.length:i),r=m?.extra?.relicta04,s=current();
    return {ext:'0.8.13',chat:ch.length,ai:i,user:u,mesLen:m?.mes?.length??null,block:!!judgeSig(m?.mes),
        rec:r?{len:Number(String(r.hash).split(':')[1]),hasSig:!!r.sig,match:r.hash===fingerprint(m.mes)?'hash':sameText(r,m)?'sig':'none',error:r.error??null}:null,
        userRec:!!ch[u]?.extra?.relicta04_user,pending:!!ch[u]?.extra?.relicta09_pending,rev:s.rev,enabled:s.enabled,card:!!cardConfig(ctx),
        events:{bound:diag.bound,init:diag.init,interceptor:diag.interceptor,received:diag.received,lastReceived:diag.lastReceived},lastSync:diag.lastSync,lastSkip:diag.lastSkip,recovered:diag.recovered,
        duplicate:globalThis.__relictaDuplicate??0,error:diag.lastError,tail:String(m?.mes??'').replace(/<!--[\s\S]*?-->/g,'').slice(-60)};
}
function paintConn(s){
    const el=get('conn');if(!el)return;const ctx=getContext(),config=cardConfig(ctx),msg=ctx.chat[assistantIndex()],last=msg?.extra?.relicta04;
    const fresh=last&&sameText(last,msg);const dg=get('diag');if(dg)try{dg.value=JSON.stringify(diagReport(),null,1);}catch(e){dg.value=String(e);}
    const sync=!s.enabled?null:!fresh?'아직 판정한 응답 없음':last.error?(String(last.error).startsWith('partial')?'일부만 반영':'기록 없음 · 재생성 필요'):'반영됨';
    const tone=!s.enabled?'off':diag.lastError?'bad':((fresh&&last.error)||(!fresh&&diag.lastSkip)||globalThis.__relictaDuplicate)?'warn':'on';
    el.dataset.tone=tone;el.replaceChildren();
    const head=element('b',!s.enabled?'○ 꺼짐':tone==='bad'?'● 오류':tone==='warn'?'◐ 확인 필요':'● 연결됨');
    const lines=[config?'렐릭타 카드 인식':'렐릭타 카드로 인식되지 않음 · 아래 「이 채팅에서 사용」을 켜면 수동으로 연결됩니다',
        s.enabled?`세션 r${s.rev} · 마지막 응답 ${sync}`:null,
        s.enabled&&diag.interceptor?`이번 접속 판정 요청 ${diag.interceptor}회 · 지시문 ${diag.lastPrompt.toLocaleString()}자`:null,
        sync==='아직 판정한 응답 없음'&&diag.lastSkip?'기록 건너뜀 · '+diag.lastSkip:null,
        diag.recovered?`채팅 기록에서 판정 대기 정보 복구 ${diag.recovered}회`:null,
        !diag.bound?'⚠ 실리 이벤트에 연결되지 않았습니다 · 페이지를 새로고침해 주세요':null,
        globalThis.__relictaDuplicate?'⚠ Relicta 확장이 두 번 설치되어 있습니다 · 확장 관리에서 하나를 지워주세요':null,
        diag.lastError,
        globalThis.isSecureContext===false?'보안 연결이 아닌 주소(LAN IP 등)로 접속 중 · v0.8.6부터 정상 동작':null].filter(Boolean);
    el.append(head);for(const l of lines)el.append(element('span',l));
}
const pct=x=>x>=0.01?(x*100).toFixed(0)+'%':(x*100).toPrecision(1).replace(/\.?0+$/,'')+'%';
function oddsLine(l){const o=oddsOf(l);return `신급 ${pct(o['신급'])} · 상등급 ${pct(o['상등급'])} · 노말 ${pct(o['노말'])} · 꽝 ${pct(o['꽝'])} · NPC가 뽑을 때는 적용하지 않음`;}
function paintOdds(l){
    const o=oddsOf(l),bar=get('luck-bar'),key=get('luck-key');get('luck-odds').textContent=oddsLine(l);
    if(bar){const [a,b,c,d]=bar.children;a.style.flexGrow=Math.max(o['신급'],0.004);b.style.flexGrow=o['상등급'];c.style.flexGrow=o['노말'];d.style.flexGrow=o['꽝'];}
    if(key){key.replaceChildren();for(const [k,name] of [['div','신급'],['sup','상등급'],['nor','노말'],['junk','꽝']]){const sp=element('span',null,{class:'k-'+k});const t=element('b',name+' '+pct(o[name]));t.style.color='var(--SmartThemeBodyColor, #ddd)';sp.append(t);key.append(sp);}}
}
function altarLog(s){const log=altarOf(s)?.log??[];return log.length?log.map(x=>`r${x.rev} #${x.no} ${x.from} → ${x.to} · ${x.reason}`).join('\n'):'(대기열 예외 기록 없음)';}
function filterOptions(key){const q=(panel?.querySelector(`[data-ro-filter="${key}"]`)?.value??'').trim();for(const o of get(key).options)o.hidden=!!q&&!o.textContent.includes(q)&&!o.selected;}
function nameList(key,label){
    const l=element('label',label),f=element('input',null,{type:'search',placeholder:'이름으로 찾기','data-ro-filter':key,'aria-label':label+' 검색'}),n=element('select',null,{'data-ro':key,multiple:'',size:'7'});
    f.addEventListener('input',()=>filterOptions(key));l.append(f,n);body.append(l);return n;
}
function findChar(name){const q=String(name??'').trim();if(!q)return null;if(Object.hasOwn(data.chars,q))return q;
    return Object.values(data.chars).find(c=>c.name===q||(c.aliases??[]).includes(q))?.id??Object.values(data.chars).find(c=>c.name.includes(q))?.id??null;}
function toggleList(field,name,on){
    const id=findChar(name);if(!id)return `인물을 찾지 못했습니다: ${name}`;
    if(field==='known'&&!['plat','mid','solo'].includes(data.chars[id].kind))return `${data.chars[id].name}은(는) 현실 신원을 연결하는 플레이어가 아닙니다.`;
    const s=current(),set=new Set(s[field]);on?set.add(id):set.delete(id);authorSet({...s,[field]:[...set]});
    return `${data.chars[id].name}: ${field==='known'?'현실 신원 연결':'심층 전체 참고'} ${on?'켬':'끔'}`;
}
function button(label,fn,parent=body){const b=element('button',label,{type:'button',class:'menu_button'});b.addEventListener('click',fn);parent.append(b);return b;}
function mount(){
    const host=document.querySelector('#extensions_settings')??document.querySelector('#extensions_settings2');if(!host)return;
    panel=element('details',null,{class:'ro-panel'});
    const sum=element('summary',null),gem=element('span',null,{class:'ro-sum-gem','aria-hidden':'true'}),title=element('span',null,{class:'ro-sum-t'});
    gem.innerHTML='<svg viewBox="0 0 16 26"><polygon points="8,0 0,9 8,11" fill="currentColor" fill-opacity=".95"/><polygon points="8,0 16,9 8,11" fill="currentColor" fill-opacity=".55"/><polygon points="0,9 8,11 8,26" fill="currentColor" fill-opacity=".72"/><polygon points="16,9 8,11 8,26" fill="currentColor" fill-opacity=".32"/></svg>';
    title.append(element('b','Relicta Online'),element('small','플레이 세션 · 상태창 · 판정 기록'));
    sum.append(gem,title,element('span','v0.8.13',{class:'ro-sum-v'}),element('span',null,{class:'ro-sum-cv','aria-hidden':'true'}));panel.append(sum);
    body=element('div',null,{class:'ro-body'});panel.append(body);
    const sec=(en,ko)=>{const h=element('div',null,{class:'ro-sec'});h.append(element('b',en),element('span',ko));body.append(h);};
    sec('Session','세션');
    body.append(element('div',null,{class:'ro-conn','data-ro':'conn','aria-live':'polite'}));
    {const d=element('details',null,{class:'ro-diag'});d.append(element('summary','진단 정보 · 문의할 때 길게 눌러 복사'),element('textarea',null,{'data-ro':'diag',readonly:'',rows:'7',spellcheck:'false'}));body.append(d);}
    body.append(element('p','현재 채팅의 위치·명부·플레이어·인연 기록을 하나의 세션으로 관리합니다.',{class:'ro-note'}));
    // v0.8.6: 켜고 끄기는 누르는 즉시 저장한다(예전에는 「적용」을 눌러야 해서 다음 응답 때 다시 꺼진 것처럼 보였다).
    check('enabled','이 채팅에서 사용').addEventListener('change',e=>{try{const st=current();st.enabled=e.target.checked;if(st.enabled)ensureAltar(st);authorSet(st);if(st.enabled)setPrompt(current());else clearPrompt();globalThis.toastr?.success(st.enabled?'이 채팅에서 렐릭타 세션을 켰습니다.':'이 채팅에서 렐릭타 세션을 껐습니다.');}catch(err){globalThis.toastr?.warning(err.message);safeRefresh();}});
    sec('Scene','장면');
    options(input('loc','현재 위치',true),Object.values(data.locations).map(l=>[l.code,l.label]),'RN_START');
    options(input('event','활동',true),Object.entries(data.events),'daily');input('place','세부 장소 (자유 서술)');
    const cast=input('cast','실제 등장인물 · 최대 6명',true);cast.multiple=true;
    body.append(element('p','행동과 결과는 본문 AI가 판정하며, 이 확장은 최종 기록과 상태창을 관리합니다.',{class:'ro-note'}));
    sec('Altar','행운 보정');
    const luck=input('luck','플레이어 본인의 소환·룰렛에만 적용',true);
    options(luck,LUCK.slice(1).map((l,i)=>[String(i+1),l.label]),'1');
    const odds=element('div',null,{class:'ro-odds','data-ro':'luck-bar','aria-hidden':'true'});for(const k of ['div','sup','nor','junk'])odds.append(element('i',null,{class:'o-'+k}));body.append(odds);
    body.append(element('div',null,{class:'ro-odds-key','data-ro':'luck-key'}));
    body.append(element('p','',{'data-ro':'luck-odds',class:'ro-note'}));
    luck.addEventListener('change',()=>{const n=Number(luck.value);paintOdds(n);try{const st=current();setLuck(st,n);authorSet(st);}catch(err){globalThis.toastr?.warning(err.message);safeRefresh();}});
    sec('Cast','인물 참고');
    nameList('known','현실 신원을 연결한 플레이어 (Ctrl/⌘ 클릭으로 여러 명)');nameList('deep','심층 전체 참고를 허용할 인물 (기본은 중심 모순 한 줄만 자동 전달)');
    sec('Author','제작자');
    const gates=element('details');gates.append(element('summary','제작자 진행 판정'));body.append(gates);
    for(const [k,label]of Object.entries({servers:'NPC 서버 증거',audience:'관측실 증거',marca:'MARCA 증거',dreams:'의료 증언 증거'}))check('evidence-'+k,label,gates);
    for(let n=139;n<=145;n++){const l=element('label',data.chars['c'+n].name),select=element('select',null,{'data-ro':'bond-c'+n});options(select,[[0,'미진행'],[1,'균열'],[2,'귀환'],[3,'이름']],0);l.append(select);gates.append(l);}
    for(const [k,label]of Object.entries({question:'첫 질문 메모 확인',junk:'꽝 수집 조건 충족',systemGap:'현재 장면이 시스템의 틈'}))check('extra-'+k,label,gates);
    check('worldTruth','세계 진실 GM 참고',gates);check('abyssOrigin','나락 기원 GM 참고',gates);
    const dirtyNote=element('p','적용하지 않은 변경이 있습니다 · 「장면·진행 설정 적용」을 눌러야 세션에 반영됩니다',{class:'ro-note ro-dirty','data-ro':'dirty'});dirtyNote.hidden=true;body.append(dirtyNote);
    button('장면·진행 설정 적용',()=>{try{authorSet(fromUI());dirty=false;globalThis.toastr?.success('현재 세션에 반영했습니다.');safeRefresh();}catch(e){globalThis.toastr?.warning(e.message);}}).classList.add('ro-primary');
    button('변경 취소',()=>{dirty=false;safeRefresh();});
    body.addEventListener('change',e=>{const k=e.target?.dataset?.ro;if(!k||['enabled','luck','json'].includes(k))return;dirty=true;get('dirty').hidden=false;});
    body.addEventListener('input',e=>{if(e.target?.dataset?.ro==='place'){dirty=true;get('dirty').hidden=false;}});
    get('enabled').addEventListener('change',()=>authorSet({...current(),enabled:get('enabled').checked}));
    const actions=element('div',null,{class:'ro-row'});body.append(actions);
    button('로그아웃',()=>notify(runAction({type:'logout'})),actions);button('게임 접속',()=>notify(runAction({type:'login'})),actions);
    const death=element('details');death.append(element('summary','사망·부활 시험 조작'));body.append(death);
    death.append(element('p','실제 10초 입력 제한은 없습니다. 전투 HP가 0이 되면 이 부활 선택이 자동으로 열립니다.',{class:'ro-note'}));
    button('사망 판정 열기',()=>notify(runAction({type:'death'})),death);
    button('일반 부활 · 총EXP 절반',()=>notify(runAction({type:'revive',mode:'normal'})),death);
    button('즉시 부활 · 1,000다이아',()=>notify(runAction({type:'revive',mode:'diamonds'})),death);
    button('즉시 부활 · 1,000만 골드',()=>notify(runAction({type:'revive',mode:'gold'})),death);
    sec('Records','기록');
    const altarBox=element('details');altarBox.append(element('summary','제단 대기열 예외 기록'));altarBox.append(element('pre','',{'data-ro':'altar-log'}));body.append(altarBox);
    const status=element('details');status.append(element('summary','기록 확인 · 임시 표시'));status.append(element('pre','',{'data-ro':'status'}));body.append(status);
    const edit=element('details');edit.append(element('summary','전체 세션 JSON · 초기 수치 설정·내보내기'));body.append(edit);
    edit.append(element('p','미정 값은 null로 유지합니다. 여기서 적용한 수치·진행 기록은 제작자 설정으로 취급합니다.',{class:'ro-note'}));
    const area=element('textarea','',{'data-ro':'json',rows:'12','aria-label':'전체 세션 JSON'});edit.append(area);
    button('현재 세션 읽기',()=>{area.value=JSON.stringify(current(),null,2);},edit);
    button('JSON을 세션에 적용',()=>{try{const value=JSON.parse(area.value);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();authorSet(value);}catch{globalThis.toastr?.error('세션 JSON을 확인해주세요.');}},edit);
    const preview=element('details');preview.append(element('summary','실제 주입 본문'));const pre=element('pre','');preview.append(pre);preview.addEventListener('toggle',()=>{if(preview.open)pre.textContent=renderAIRequest(current(),data,rules,catalog).prompt||'(비활성)';});body.append(preview);
    body.append(element('p','',{'data-ro':'summary',class:'ro-note ro-summary-line'}));
    host.append(panel);safeRefresh();
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
    if(['진단','diag'].includes(verb)){const text=JSON.stringify(diagReport());globalThis.toastr?.info?.(text,'Relicta 진단',{timeOut:0,extendedTimeOut:0,closeButton:true});return text;}
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
    if(!action)return '사용: /relicta 상태 | 진단 | 행운 1~6 | 연결 이름 | 연결해제 이름 | 심층 이름 | 심층해제 이름 | 로그아웃 | 접속 | 스탯 STR 2 | 수락 q_id | 사망 | 부활 일반/다이아/골드';
    const result=runAction(action);notify(result);return result.ok?JSON.stringify(snapshot(result.state,data)):result.error;
}

async function initialize(){
    try{
        await loadData();
        // v0.8.10: 이벤트를 먼저 연결한다. 예전에는 패널을 그리다 오류가 나면(실리를 막 켜서 캐릭터를 아직 안 고른 상태) 이벤트 연결이 통째로 건너뛰어져,
        // 판정 요청만 나가고 응답 기록·상태창·채팅 전환이 전부 멈췄다.
        bindEvents();
        try{store();}catch(e){diag.lastError='세션 준비 오류: '+e.message;console.error('[Relicta] store',e);}
        try{mount();}catch(e){diag.lastError='패널 표시 오류: '+e.message;console.error('[Relicta] mount',e);}
        diag.init='ok';
    }catch(e){diag.init='실패: '+(e?.message??e);diag.lastError='확장 시작 실패: '+(e?.message??e);console.error('[Relicta] Session init failed',loadingError??e);}
}
let bound=false;
function bindEvents(){
    if(bound)return;const ctx=getContext();if(!ctx?.eventSource||!ctx?.eventTypes)return;bound=true;
    const on=(name,fn)=>{if(ctx.eventTypes[name])ctx.eventSource.on(ctx.eventTypes[name],async(...a)=>{try{return await fn(...a);}catch(e){diag.lastError='이벤트 처리 오류('+name+'): '+(e?.message??e);console.error('[Relicta] '+name,e);}});diag.bound++;};
    {
        on('CHAT_CHANGED',()=>{presentation.clear();flights.clear();clearPrompt();dirty=false;store();setPrompt(current());safeRefresh();watchChat();});
        on('WORLD_INFO_ACTIVATED',entries=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting){p.enabled=dreamteoFromEntries(entries);const f=flights.get(contextId(getContext()));if(f)f.dreamteo=p.enabled;const ui=getContext().chat[userIndex()]?.extra?.relicta09_pending;if(ui)ui.dreamteo=p.enabled;}});
        on('CHAT_COMPLETION_PROMPT_READY',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&Array.isArray(event.chat)){
            // v0.8.6: 실리태번(openai.js)은 event.chat을 다시 읽지 않고 원래 배열을 그대로 보낸다. 새 배열로 바꾸면 지시문이 사라지므로 제자리에서 고친다.
            const next=withDreamteoPolicy(event.chat,p.enabled);next.push({role:'system',content:finalAIInstruction()});event.chat.splice(0,event.chat.length,...next);}});
        on('GENERATE_AFTER_COMBINE_PROMPTS',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&typeof event.prompt==='string')event.prompt=textDreamteoPolicy(event.prompt,p.enabled)+'\n'+finalAIInstruction();});
        const resume=()=>{if(!suspended)return;suspended=false;if(current().enabled)setPrompt(current());};
        on('GENERATE_AFTER_DATA',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;resume();});
        on('GENERATION_STOPPED',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;resume();});
        on('GENERATION_ENDED',resume);
        const received=async index=>{diag.received++;diag.lastReceived=index;if(!current().enabled)return;try{syncMessage(Number.isInteger(index)?index:assistantIndex());}catch(e){diag.lastError='응답 기록 오류: '+e.message;console.error('[Relicta] sync failed',e);}setPrompt(current());safeRefresh();await persistChat();};
        on('MESSAGE_RECEIVED',received);on('CHARACTER_MESSAGE_RENDERED',received);
        on('MESSAGE_UPDATED',index=>{if(!current().enabled)return;const ch=getContext().chat,i=Number.isInteger(Number(index))?Number(index):assistantIndex(),m=ch[i],ui=m?.extra?.relicta05_ui;if(m&&!m.is_user&&ui?.ownsDisplay&&ui.base!==fingerprint(m.mes))applyDisplayPolicy(m,i);setTimeout(()=>{try{paintStatus();}catch{}},0);});on('MORE_MESSAGES_LOADED',()=>{try{paintStatus();}catch{}});
        on('MESSAGE_SWIPED',async()=>{if(reseedFromGreeting()){setPrompt(current());refresh();await persistChat();return;}if(!current().enabled)return;checkpointUser();syncMessage(assistantIndex());setPrompt(current());refresh();await persistChat();});
        on('MESSAGE_DELETED',async()=>{restoreLatest();await persistChat();});
        on('MESSAGE_EDITED',()=>{restoreLatest();});
        // Registration through the current ST context; no shell or external service is used.
        try{if(ctx.SlashCommandParser?.addCommandObject&&ctx.SlashCommand?.fromProps)ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name:'relicta',callback:command,splitUnnamedArgument:false,
            unnamedArgumentList:ctx.SlashCommandArgument?.fromProps?[ctx.SlashCommandArgument.fromProps({description:'동작과 인수',typeList:[ctx.ARGUMENT_TYPE?.STRING??'string'],isRequired:false})]:[],
            helpString:'렐릭타 세션: 상태, 행운 보정(행운 1~6), 현실 신원 연결(연결/연결해제 이름), 심층 참고(심층/심층해제 이름), 로그아웃, 접속, 스탯, 퀘스트 수락, 사망·부활'}));
        else if(ctx.registerSlashCommand)ctx.registerSlashCommand('relicta',command,[], '렐릭타 시험 세션 조작',true,true);}catch(e){console.warn('[Relicta] slash command',e);}
        globalThis.RelictaSession={getState:()=>copy(current()),action:runAction,importState:authorSet,exportState:()=>JSON.stringify(current(),null,2)};
        try{setPrompt(current());}catch{}safeRefresh();watchChat();
    }
}
if(!DUPLICATE){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();}
