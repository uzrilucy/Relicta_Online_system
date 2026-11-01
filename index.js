import { getContext } from '../../../extensions.js';
import { directory, allowed, parsePlan, applySceneProposal, plannerPrompt } from './router.mjs';
import {seed,prepareState,applyGameAction,gameTextAction,gameSnapshot,validateRules} from './engine.mjs';
import {statusHTML,bindStatus} from './status-ui.mjs';
import {dreamteoFromEntries,stripDreamteo,cleanHistory,withDreamteoPolicy,textDreamteoPolicy} from './presentation.mjs';
import { initialSession, normalizeSession, world, fingerprint, parseProposal, applyProposal, authorAction, snapshot, renderSession, explicitUserAction, validateAuthorState } from './session.mjs';

const KEY='relicta_session_v04',PROMPT='relicta_session_v04';
const LEGACY_KEY='relicta_session_v03',LEGACY_PROMPT='relicta_session_v03';
let data,rules,catalog,pending,panel,loadingError;
const flights=new Map(),presentation=new Map();
const copy=x=>JSON.parse(JSON.stringify(x));
const contextId=ctx=>`${ctx.characterId??''}:${ctx.groupId??''}:${ctx.getCurrentChatId?.()??''}`;
async function loadData(){
    if(!pending)pending=Promise.all(['cast-data.json','rules.json','catalog.json'].map(file=>fetch(new URL('./'+file,import.meta.url)).then(r=>{if(!r.ok)throw new Error('Data HTTP '+r.status);return r.json();}))).then(([d,r,c])=>{data=d;rules=r;catalog=c;validateRules(r,c);return d;}).catch(e=>{loadingError=e;throw e;});
    return pending;
}
function cardConfig(ctx=getContext()){
    const c=ctx.characters?.[ctx.characterId];
    let ext=c?.data?.extensions??c?.extensions;
    if(!ext&&c?.json_data){try{ext=JSON.parse(c.json_data).data?.extensions;}catch{}}
    return ext?.relicta?.project==='relicta-online'?ext.relicta:null;
}
function store(ctx=getContext()){
    if(!ctx.chatMetadata[KEY]){
        const config=cardConfig(ctx),legacy=ctx.chatMetadata[LEGACY_KEY];
        const old=legacy?.state??legacy;const enabled=!!config||old?.enabled===true;
        const opening=ctx.chat.find(m=>!m.is_user&&!m.is_system)?.mes;
        const selected=config?.greeting_modes?.find(g=>g.text===opening)?.mode??config?.mode??'free';
        const initial=config?.initial_state&&selected===config.mode?prepareState(config.initial_state,data):seed(data,rules,catalog,selected);
        const seeded=old?.enabled?prepareState({...initial,...old,systems:{...initial.systems,...old.systems,setup:{mode:'veteran',pending:true}}},data):initial;seeded.enabled=enabled;
        ctx.chatMetadata[KEY]={schema:4,state:seeded,origin:copy(seeded)};
        if(old)old.enabled=false;
        ctx.saveMetadataDebounced();
    }
    return ctx.chatMetadata[KEY];
}
function current(){return prepareState(store().state,data);}
function save(state){store().state=normalizeSession(state,data);getContext().saveMetadataDebounced();}
function clearPrompt(){getContext().setExtensionPrompt(PROMPT,'',1,0,false,0);getContext().setExtensionPrompt(LEGACY_PROMPT,'',1,0,false,0);}
function setPrompt(state){
    const rendered=renderSession(state,data);if(rendered.prompt)rendered.prompt+='\n[Confirmed game results]\n'+JSON.stringify(gameSnapshot(rendered.state,data,rules,catalog));
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
    const clean=on?message.mes:stripDreamteo(message.mes);
    message.extra.relicta05_ui={dreamteo:on,ownsDisplay:clean!==message.mes};
    if(clean!==message.mes){message.extra.display_text=clean;ctx.updateMessageBlock?.(index,message);}
    else if(prior?.ownsDisplay){delete message.extra.display_text;ctx.updateMessageBlock?.(index,message);}
}
function syncMessage(index=assistantIndex()){
    const ctx=getContext(),message=ctx.chat[index];
    if(!message||message.is_user||message.is_system||!current().enabled)return {ok:false,error:'not-assistant'};
    applyDisplayPolicy(message,index);
    const hash=fingerprint(message.mes),existing=message.extra?.relicta04;
    if(existing?.hash===hash){return {ok:true,state:current(),duplicate:true};}
    const flight=flights.get(contextId(ctx));
    let before;
    if(flight&&index>=flight.start)before=normalizeSession(flight.before,data);
    else if(existing?.before)before=normalizeSession(existing.before,data);
    else before=current();
    const parsed=parseProposal(message.mes);
    const result=before.autoMarkers&&parsed.value?applyProposal(before,parsed.value,data):{ok:false,state:before,error:before.autoMarkers?parsed.error:'auto-markers-disabled'};
    // A no-marker response is still an undoable narrative turn; never infer money or secrets.
    message.extra??={};message.extra.relicta04={schema:4,hash,before:copy(before),after:copy(result.state),error:result.error??null};
    save(result.state);
    return result;
}

function restoreLatest(){
    const ctx=getContext();
    if(!current().enabled)return;
    const message=[...ctx.chat].reverse().find(m=>m.extra?.relicta04||m.extra?.relicta04_user||m.extra?.relicta04_control);
    if(message?.extra?.relicta04_control&&message.extra.relicta04_control.after.rev>=Math.max(message.extra.relicta04?.after?.rev??0,message.extra.relicta04_user?.after?.rev??0)){save(message.extra.relicta04_control.after);setPrompt(current());refresh();return;}
    if(message?.is_user&&message.extra?.relicta04_user){save(message.extra.relicta04_user.after);setPrompt(current());refresh();return;}
    const last=ctx.chat.indexOf(message);
    if(message?.extra?.relicta04){
        const saved=message.extra.relicta04;
        if(saved.hash===fingerprint(message.mes))save(saved.after);
        else {save(saved.before);syncMessage(last);}
    }else save(store().origin);
    setPrompt(current());refresh();
}

function syncUserAction(){
    const ctx=getContext();let message;
    for(let i=ctx.chat.length-1;i>=0;i--)if(ctx.chat[i].is_user){message=ctx.chat[i];break;}
    if(!message)return;
    const hash=fingerprint(message.mes),record=message.extra?.relicta04_user;
    if(record?.hash===hash)return;
    const before=record?.before?normalizeSession(record.before,data):current();
    const action=gameTextAction(message.mes)??explicitUserAction(message.mes,before);if(!action)return;
    const result=applyGameAction(before,action,data,rules,catalog);
    message.extra??={};message.extra.relicta04_user={hash,before:copy(before),after:copy(result.state),error:result.error??null};
    save(result.state);if(!result.ok)globalThis.toastr?.warning(result.error);
}

function runAction(action){
    const ctx=getContext(),state=current();
    if(!state.enabled)return {ok:false,state,error:'이 채팅에서 렐릭타 세션을 먼저 켜주세요.'};
    const result=applyGameAction(state,action,data,rules,catalog);
    if(result.ok){save(result.state);const anchor=ctx.chat.at(-1);if(anchor){anchor.extra??={};anchor.extra.relicta04_control={after:copy(result.state)};}setPrompt(result.state);refresh();}
    return result;
}
function authorSet(value){
    const error=validateAuthorState(value,data);if(error)throw new Error(error);
    const before=current(),next=normalizeSession({...value,rev:before.rev+1},data);
    next.cast=next.cast.filter(id=>allowed(id,next,data));save(next);const anchor=getContext().chat.at(-1);if(anchor){anchor.extra??={};anchor.extra.relicta04_control={after:copy(next)};}setPrompt(next);refresh();
    return next;
}

globalThis.relictaSessionInterceptor=async function(_chat,_contextSize,_abort,type){
    try{
        await loadData();let state=current();
        if(!state.enabled){clearPrompt();return;}
        presentation.delete(contextId(getContext()));
        if(['quiet','impersonate'].includes(type))return;
        const id=contextId(getContext()),index=assistantIndex(),last=getContext().chat[index],rec=last?.extra?.relicta04;
        // A regenerated/swiped answer starts from its original pre-answer state.
        if(['regenerate','swipe','continue'].includes(type)&&rec&&state.rev===rec.after.rev){state=normalizeSession(rec.before,data);save(state);}
        syncUserAction();state=current();
        const beforePlan=copy(state);
        if(state.preflight){
            try{
                const ctx=getContext();
                const answer=await ctx.generateRaw({systemPrompt:'Select a fictional scene and actual cast; JSON only. Do not change worlds or grant progress.',prompt:plannerPrompt(state,data,cleanHistory(ctx.chat)),responseLength:220,trimNames:false});
                if(id!==contextId(getContext()))return;
                const plan=parsePlan(answer);
                if(!plan)throw new Error('Invalid plan');
                if(plan.loc&&(data.locations[plan.loc]?.world==='reality')!==(world(state,data)==='reality'))throw new Error('World transition needs controller action');
                const proposed=applySceneProposal(state,plan,data);
                const changed=proposed.loc!==state.loc||proposed.event!==state.event;
                state=normalizeSession({...state,loc:proposed.loc,event:proposed.event,cast:proposed.cast,extras:proposed.extras,place:proposed.loc===state.loc?state.place:''},data);
                if(changed){
                    const selected=parsePlan(await ctx.generateRaw({systemPrompt:'Select actual cast. Keep supplied loc/event fixed. JSON only.',prompt:plannerPrompt(state,data,cleanHistory(ctx.chat)),responseLength:220,trimNames:false}));
                    if(id!==contextId(getContext()))return;
                    if(selected?.loc!==state.loc||selected?.event!==state.event)throw new Error('Invalid target cast');
                    const routed=applySceneProposal(state,selected,data);state=normalizeSession({...state,cast:routed.cast},data);
                }
            }catch(e){state=beforePlan;console.warn('[Relicta] Preflight fallback',e);globalThis.toastr?.warning('사전 선택 실패: 현재 세션 기록을 유지합니다.');}
        }
        if(id!==contextId(getContext()))return;
        // Work on copied prompt messages; retain the original saved board history.
        if(Array.isArray(_chat)){const clean=cleanHistory(_chat);_chat.splice(0,_chat.length,...clean);}
        presentation.set(id,{enabled:false,awaiting:true}); // Re-evaluate the linked WI on every generation.
        const rendered=setPrompt(state);save(rendered.state);
        flights.set(id,{before:copy(rendered.state),dreamteo:false,start:['regenerate','swipe','continue'].includes(type)?Math.max(0,index):getContext().chat.length});
        refresh();
    }catch(e){clearPrompt();console.error('[Relicta] Session generation failed',e);globalThis.toastr?.error('렐릭타 세션 주입에 실패했습니다. 확장 설정을 확인해주세요.');}
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
    bindStatus(view,async a=>{notify(runAction(a));await persistChat();},async()=>{await getContext().generate?.('normal');});host.append(view);
}
function refresh(){
    paintStatus();if(!panel||!data)return;
    const s=current(),d=directory(s,data),r=renderSession(s,data);
    for(const k of ['enabled','autoMarkers','preflight','worldTruth','abyssOrigin'])get(k).checked=s[k];
    get('loc').value=s.loc;get('event').value=s.event;get('place').value=s.place;
    const candidates=[...new Set([...d.eligible,...s.cast,...s.known.filter(id=>allowed(id,s,data))])];
    options(get('cast'),candidates.map(id=>[id,`${id} ${data.chars[id].name} · ${data.chars[id].role}`]),s.cast);
    get('known').value=s.known.join(',');get('deep').value=s.deep.join(',');
    for(const k of data.evidence)get('evidence-'+k).checked=s.evidence.includes(k);
    for(const k of ['question','junk','systemGap'])get('extra-'+k).checked=s.extras[k];
    for(let n=139;n<=145;n++)get('bond-c'+n).value=s.bonds['c'+n];
    const last=getContext().chat[assistantIndex()]?.extra?.relicta04;
    get('summary').textContent=`세션 r${s.rev} · ${d.location.label} · 상세 ${r.profiles.length}명 · 주입 ${r.prompt.length.toLocaleString()}자`+(last?.error?` · 마지막 제안: ${last.error}`:'');
    get('status').textContent=JSON.stringify(snapshot(s,data),null,2);
}
function fromUI(){
    const s=current();for(const k of ['enabled','autoMarkers','preflight','worldTruth','abyssOrigin'])s[k]=get(k).checked;
    const target=get('loc').value;
    if((data.locations[target].world==='reality')!==(world(s,data)==='reality'))throw new Error('현실/게임 전환에는 로그아웃·접속 버튼을 사용해주세요.');
    s.loc=target;s.event=get('event').value;s.place=get('place').value;
    s.cast=[...get('cast').selectedOptions].map(o=>o.value);s.known=get('known').value.split(/[\s,]+/).filter(Boolean);s.deep=get('deep').value.split(/[\s,]+/).filter(Boolean);
    s.evidence=data.evidence.filter(k=>get('evidence-'+k).checked);
    for(const k of ['question','junk','systemGap'])s.extras[k]=get('extra-'+k).checked;
    for(let n=139;n<=145;n++)s.bonds['c'+n]=Number(get('bond-c'+n).value);
    return s;
}
function button(label,fn,parent=panel){const b=element('button',label,{type:'button',class:'menu_button'});b.addEventListener('click',fn);parent.append(b);return b;}
function mount(){
    const host=document.querySelector('#extensions_settings')??document.querySelector('#extensions_settings2');if(!host)return;
    panel=element('details',null,{class:'ro-panel'});panel.append(element('summary','Relicta · 플레이 세션 v0.5'));
    panel.append(element('p','현재 채팅의 위치·명부·플레이어·인연 기록을 하나의 세션으로 관리합니다.',{class:'ro-note'}));
    check('enabled','이 채팅에서 사용');
    options(input('loc','현재 위치',true),Object.values(data.locations).map(l=>[l.code,l.label]),'RN_START');
    options(input('event','활동',true),Object.entries(data.events),'daily');input('place','세부 장소 (자유 서술)');
    const cast=input('cast','실제 등장인물 · 최대 6명',true);cast.multiple=true;
    check('autoMarkers','AI의 장면·짧은 인연 기록 제안 반영');check('preflight','생성 전 인물 선택 · 추가 AI 호출 1~2회');
    input('known','현실 신원을 연결한 인물 ID');input('deep','심층 GM 참고를 허용할 인물 ID');
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
    const status=element('details');status.append(element('summary','기록 확인 · 임시 표시'));status.append(element('pre','',{'data-ro':'status'}));panel.append(status);
    const edit=element('details');edit.append(element('summary','전체 세션 JSON · 초기 수치 설정·내보내기'));panel.append(edit);
    edit.append(element('p','미정 값은 null로 유지합니다. 여기서 적용한 수치·진행 기록은 제작자 설정으로 취급합니다.',{class:'ro-note'}));
    const area=element('textarea','',{'data-ro':'json',rows:'12','aria-label':'전체 세션 JSON'});edit.append(area);
    button('현재 세션 읽기',()=>{area.value=JSON.stringify(current(),null,2);},edit);
    button('JSON을 세션에 적용',()=>{try{const value=JSON.parse(area.value);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();authorSet(value);}catch{globalThis.toastr?.error('세션 JSON을 확인해주세요.');}},edit);
    const preview=element('details');preview.append(element('summary','실제 주입 본문'));const pre=element('pre','');preview.append(pre);preview.addEventListener('toggle',()=>{if(preview.open)pre.textContent=renderSession(current(),data).prompt||'(비활성)';});panel.append(preview);
    host.append(panel);refresh();
}

function command(_args,value){
    const parts=String(value??'').trim().split(/\s+/),verb=parts.shift()??'상태';let action;
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
    if(!action)return '사용: /relicta 상태 | 로그아웃 | 접속 | 스탯 STR 2 | 수락 q_id | 사망 | 부활 일반/다이아/골드';
    const result=runAction(action);notify(result);return result.ok?JSON.stringify(snapshot(result.state,data)):result.error;
}

async function initialize(){
    try{
        await loadData();store();mount();const ctx=getContext();
        const on=(name,fn)=>{if(ctx.eventTypes[name])ctx.eventSource.on(ctx.eventTypes[name],fn);};
        on('CHAT_CHANGED',()=>{presentation.delete(contextId(getContext()));flights.delete(contextId(getContext()));clearPrompt();store();setPrompt(current());refresh();});
        on('WORLD_INFO_ACTIVATED',entries=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting){p.enabled=dreamteoFromEntries(entries);const f=flights.get(contextId(getContext()));if(f)f.dreamteo=p.enabled;}});
        on('CHAT_COMPLETION_PROMPT_READY',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&Array.isArray(event.chat))event.chat=withDreamteoPolicy(event.chat,p.enabled);});
        on('GENERATE_AFTER_COMBINE_PROMPTS',event=>{const p=presentation.get(contextId(getContext()));if(p?.awaiting&&current().enabled&&typeof event.prompt==='string')event.prompt=textDreamteoPolicy(event.prompt,p.enabled);});
        on('GENERATE_AFTER_DATA',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;});
        on('GENERATION_STOPPED',()=>{const p=presentation.get(contextId(getContext()));if(p)p.awaiting=false;});
        const received=async index=>{if(!current().enabled)return;syncMessage(Number.isInteger(index)?index:assistantIndex());setPrompt(current());refresh();await persistChat();};
        on('MESSAGE_RECEIVED',received);on('CHARACTER_MESSAGE_RENDERED',received);
        on('MESSAGE_SWIPED',async()=>{const i=assistantIndex(),m=getContext().chat[i],rec=m?.extra?.relicta04;if(rec){const controls=m.extra?.relicta04_control;const base=controls?.after?.rev>=rec.after.rev?controls.after:rec.before;save(base);flights.set(contextId(getContext()),{before:copy(base),start:i});syncMessage(i);}setPrompt(current());refresh();await persistChat();});
        on('MESSAGE_DELETED',()=>restoreLatest());
        // Registration through the current ST context; no shell or external service is used.
        if(ctx.SlashCommandParser?.addCommandObject&&ctx.SlashCommand?.fromProps)ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name:'relicta',callback:command,splitUnnamedArgument:false,
            unnamedArgumentList:ctx.SlashCommandArgument?.fromProps?[ctx.SlashCommandArgument.fromProps({description:'동작과 인수',typeList:[ctx.ARGUMENT_TYPE?.STRING??'string'],isRequired:false})]:[],
            helpString:'렐릭타 시험 세션: 상태, 로그아웃, 접속, 스탯, 퀘스트 수락, 사망·부활'}));
        else if(ctx.registerSlashCommand)ctx.registerSlashCommand('relicta',command,[], '렐릭타 시험 세션 조작',true,true);
        globalThis.RelictaSession={getState:()=>copy(current()),action:runAction,importState:authorSet,exportState:()=>JSON.stringify(current(),null,2)};
        const i=assistantIndex();if(i>=0&&current().enabled&&!getContext().chat[i].extra?.relicta04)syncMessage(i);
        setPrompt(current());refresh();
    }catch(e){console.error('[Relicta] Session init failed',loadingError??e);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
