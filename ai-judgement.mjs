import {normalizeSession,applyProposal,transition,world,snapshot,STAT_KEYS} from './session.mjs';
import {seed,threshold} from './engine.mjs';
import {renderScene} from './router.mjs';
import {queueText,consume,recordOverrides,MAX_DRAWS} from './altar.mjs';
const copy=x=>JSON.parse(JSON.stringify(x));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER;
const safeKey=k=>!['__proto__','constructor','prototype'].includes(k);
// v0.8.1: 모델이 "1,000"·"970"처럼 문자열 숫자를 보내도 정수로 받아 준다.
const numeric=v=>typeof v==='string'&&/^\s*\d{1,3}(?:,\d{3})+\s*$|^\s*\d+\s*$/.test(v)?Number(v.replace(/[\s,]/g,'')):v;
function coerce(o){if(Array.isArray(o))return o.map(coerce);if(object(o)){const out={};for(const[k,v]of Object.entries(o))if(safeKey(k))out[k]=['handle','name','note','title','id','text','detail','type','kind','slot','status','date','place','loc','event','transition','logoutLock'].includes(k)?v:coerce(v);return out;}return numeric(o);}
function merge(base,patch){const out=copy(base);for(const[k,v]of Object.entries(patch)){if(!safeKey(k))continue;out[k]=object(v)&&object(out[k])?merge(out[k],v):copy(v);}return out;}
export function prepareAIState(input,data,rules,catalog){
 const base=seed(data,rules,catalog,'free'),s=normalizeSession(merge(base,input??{}),data);
 s.systems.dialogue={status:'none',question:null,pending:null,last:[],mode:'ai'};
 s.preflight=false; // One narrative request; no separate interpreter/planner call.
 return s;
}
export function parseAIJudgement(text){
 const source=[...String(text??'').matchAll(/<!--RO(?:AI|4):([\s\S]*?)-->|<RELICTA_STATE>([\s\S]*?)<\/RELICTA_STATE>/g)].at(-1);
 if(!source)return {value:null,error:'no-ai-state'};
 let raw=(source[1]??source[2]).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 if(raw.length>64000)return {value:null,error:'ai-state-too-large'};
 try{const value=JSON.parse(raw);if(!object(value))throw new Error();return {value,error:null};}catch{return {value:null,error:'invalid-ai-state-json'};}
}
export function stripAIJudgement(text){return String(text??'').replace(/<!--ROAI:[\s\S]*?(?:-->|$)|<RELICTA_STATE>[\s\S]*?(?:<\/RELICTA_STATE>|$)/g,'');}
function validatePlayer(p){
 if(!object(p))throw new Error('invalid-player');
 const allowed=['handle','level','lastLevel','totalExp','points','tickets','stats','wallet','hp','mp','inventory','inventoryReplace','skills','redBrand'];
 if(Object.keys(p).some(k=>!allowed.includes(k)))throw new Error('unknown-player-field');
 for(const k of ['level','lastLevel'])if(k in p&&p[k]!==null&&(!int(p[k])||p[k]<1))throw new Error('invalid-level');
 for(const k of ['points','tickets'])if(k in p&&!int(p[k]))throw new Error('invalid-points');
 if('totalExp'in p&&p.totalExp!==null&&!finite(p.totalExp))throw new Error('invalid-exp');
 if('handle'in p&&p.handle!==null&&typeof p.handle!=='string')throw new Error('invalid-handle');
 if('inventoryReplace'in p&&typeof p.inventoryReplace!=='boolean')throw new Error('invalid-inventory-mode');
 if('redBrand'in p&&typeof p.redBrand!=='boolean')throw new Error('invalid-brand');
 if(p.stats&&(!object(p.stats)||Object.entries(p.stats).some(([k,v])=>!STAT_KEYS.includes(k)||!int(v))))throw new Error('invalid-stats');
 if(p.wallet&&(!object(p.wallet)||Object.entries(p.wallet).some(([k,v])=>!['diamonds','gold'].includes(k)||(v!==null&&!int(v)))))throw new Error('invalid-wallet');
 for(const k of ['hp','mp'])if(p[k]&&(!object(p[k])||Object.entries(p[k]).some(([a,v])=>!['value','max'].includes(a)||(v!==null&&!finite(v)))))throw new Error('invalid-vitals');
 if(p.inventory&&(!Array.isArray(p.inventory)||p.inventory.some(i=>!object(i)||typeof i.id!=='string'||i.id.length>48||!int(i.qty))))throw new Error('invalid-inventory');
 if(p.skills&&(!Array.isArray(p.skills)||p.skills.some(i=>typeof i!=='string'||i.length>72)))throw new Error('invalid-skills');
}
const systemKeys=['equipment','growth','guild','housing','pet','real','battle','cooldowns','statuses','customItems','customSkills','receipts','pendingGold','setup','deadNatives','avatarTrap','npcOverrides'];
function validateSystems(sys,data){
 if(!object(sys)||Object.keys(sys).some(k=>!systemKeys.includes(k)))throw new Error('invalid-systems');
 for(const k of ['equipment','growth','guild','housing','real','cooldowns','customItems','customSkills','setup','npcOverrides'])if(k in sys&&!object(sys[k]))throw new Error('invalid-system-object');
 if(sys.equipment&&Object.entries(sys.equipment).some(([k,v])=>!['weapon','armor','accessory'].includes(k)||(v!==null&&typeof v!=='string')))throw new Error('invalid-equipment');
 for(const k of ['statuses','receipts','deadNatives'])if(k in sys&&!Array.isArray(sys[k]))throw new Error('invalid-system-list');
 if(sys.cooldowns&&Object.values(sys.cooldowns).some(v=>!int(v)))throw new Error('invalid-cooldowns');
 if(sys.statuses?.some(v=>!object(v)||typeof v.name!=='string'||!int(v.turns)))throw new Error('invalid-status');
 if(sys.receipts?.some(v=>!object(v)))throw new Error('invalid-receipt');
 if(sys.guild){for(const k of ['loan','revivalFund'])if(k in sys.guild&&sys.guild[k]!==null&&!finite(sys.guild[k]))throw new Error('invalid-guild-money');}
 if(sys.real){for(const k of ['krw','nutritionDays'])if(k in sys.real&&sys.real[k]!==null&&!finite(sys.real[k]))throw new Error('invalid-reality-number');}
 for(const k of ['customItems','customSkills'])if(sys[k]&&Object.values(sys[k]).some(v=>!object(v)||typeof v.name!=='string'||v.name.length>80))throw new Error('invalid-custom-entry');
 if(sys.deadNatives?.some(id=>data.chars[id]?.kind!=='elys'))throw new Error('invalid-native-death');
 if(sys.setup?.pending!==undefined&&typeof sys.setup.pending!=='boolean')throw new Error('invalid-setup');
}
export function applyAIJudgement(input,proposal,data,rules,catalog,meta={}){
 const before=prepareAIState(input,data,rules,catalog);
 if(!object(proposal))return {ok:false,state:before,error:'invalid-ai-state',warnings:[]};
 // v0.8.1: 리비전 불일치만 전체 거부. 나머지는 항목별로 검사해 맞는 부분만 반영하고 경고를 남긴다.
 const raw=object(proposal.state)?{...proposal.state,rev:proposal.rev??proposal.state.rev}:proposal;
 const p=coerce(raw);
 if(p.rev!==undefined&&p.rev!==before.rev)return {ok:false,state:before,error:'stale-revision',warnings:[]};
 const warnings=[];const attempt=(label,fn)=>{try{fn();}catch(e){warnings.push(label+':'+String(e.message??e));}};
 let base=copy(before);
 if(p.transition!==undefined)attempt('transition',()=>{if(!['logout','login'].includes(p.transition))throw new Error('invalid-transition');const r=transition(base,p.transition==='logout'?'reality':'game',data);if(!r.ok)throw new Error(r.error);base=r.state;});
 const scene={rev:base.rev};for(const k of ['loc','event','cast','place','dt','mem','note','follow','leave'])if(p[k]!==undefined)scene[k]=p[k];
 if(scene.cast!==undefined){
  // ID 대신 이름을 쓰거나 존재하지 않는 ID가 섞여도 나머지 등장인물은 살린다.
  const byName=new Map(Object.values(data.chars).map(c=>[c.name,c.id]));
  const list=(Array.isArray(scene.cast)?scene.cast:[]).map(x=>typeof x==='string'?(Object.hasOwn(data.chars,x)?x:byName.get(x.trim())):null);
  if(!Array.isArray(scene.cast)||list.some(x=>!x))warnings.push('cast:unknown-entry');
  scene.cast=[...new Set(list.filter(Boolean))].slice(0,data.maxCast);
 }
 let next=base;
 const routed=applyProposal(base,scene,data);
 if(routed.ok)next=routed.state;
 else{warnings.push('scene:'+routed.error);
  // 장면 전체가 거부되면 등장인물·장소 등 개별 항목만 다시 시도한다.
  for(const k of Object.keys(scene).filter(k=>k!=='rev')){const r=applyProposal(next,{rev:next.rev,[k]:scene[k]},data);if(r.ok)next=r.state;}
 }
 if(p.player!==undefined)attempt('player',()=>{
  if(!object(p.player))throw new Error('invalid-player');
  const patch={};
  for(const[k,v]of Object.entries(p.player)){if(!safeKey(k))continue;try{validatePlayer({[k]:v});patch[k]=copy(v);}catch(e){warnings.push('player.'+k+':'+e.message);}}
  if(patch.inventory){const bag=new Map((p.player.inventoryReplace===true&&'inventoryReplace'in patch?[]:before.player.inventory).map(i=>[i.id,copy(i)]));for(const i of patch.inventory){if(i.qty===0){bag.delete(i.id);continue;}const old=bag.get(i.id),known=catalog.items[i.id]??p.systems?.customItems?.[i.id]??before.systems.customItems?.[i.id];bag.set(i.id,{...old,...i,name:i.name??old?.name??known?.name??i.id,note:i.note??old?.note??''});}patch.inventory=[...bag.values()];}delete patch.inventoryReplace;
  if(patch.skills)patch.skills=[...new Set([...before.player.skills,...patch.skills])];
  next.player=merge(next.player,patch);
 });
 if(p.systems!==undefined)attempt('systems',()=>{
  if(!object(p.systems))throw new Error('invalid-systems');
  for(const[k,v]of Object.entries(p.systems)){if(!systemKeys.includes(k)){warnings.push('systems.'+k+':unknown');continue;}try{validateSystems({[k]:v},data);next.systems=merge(next.systems,{[k]:v});}catch(e){warnings.push('systems.'+k+':'+e.message);}}
 });
 // Native deaths and a red brand cannot be erased by ordinary narrative updates.
 next.player.redBrand=before.player.redBrand||next.player.redBrand;
 next.systems.deadNatives=[...new Set([...(before.systems.deadNatives??[]),...(next.systems.deadNatives??[])])];
 if(p.quests!==undefined)attempt('quests',()=>{
  if(!Array.isArray(p.quests))throw new Error('invalid-quests');
  const quests=new Map(next.quests.map(q=>[q.id,copy(q)]));
  for(const q of p.quests.slice(0,12)){if(!object(q)||!/^q_[a-z0-9_]{1,40}$/.test(q.id)||typeof q.title!=='string'||!['offered','active','completed','failed','declined'].includes(q.status)){warnings.push('quest:'+String(q?.id??'?'));continue;}const old=quests.get(q.id);quests.set(q.id,{...old,...q,rewardClaimed:old?.rewardClaimed===true||q.rewardClaimed===true});}
  next.quests=[...quests.values()];
 });
 if(p.pendingDeath!==undefined)attempt('pendingDeath',()=>{if(p.pendingDeath===true)next.pendingDeath={id:'ai-death-'+before.rev,openedRev:before.rev};else if(p.pendingDeath===false||p.pendingDeath===null)next.pendingDeath=null;else if(object(p.pendingDeath)&&typeof p.pendingDeath.id==='string')next.pendingDeath=p.pendingDeath;else throw new Error('invalid-death-state');});
 if(p.logoutLock!==undefined)attempt('logoutLock',()=>{if(p.logoutLock!==null&&typeof p.logoutLock!=='string')throw new Error('invalid-logout-lock');next.logoutLock=p.logoutLock;});
 if(p.clocks!==undefined)attempt('clocks',()=>{if(!object(p.clocks))throw new Error('invalid-clocks');const ok={};for(const [w,c]of Object.entries(p.clocks)){if(!['game','reality'].includes(w)||!object(c)){warnings.push('clock.'+w);continue;}if(c.date!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||Number.isNaN(Date.parse(c.date+'T00:00:00Z')))){warnings.push('clock.'+w+'.date');continue;}if(c.minute!==undefined&&c.minute!==null&&(!int(c.minute)||c.minute>=1440)){warnings.push('clock.'+w+'.minute');continue;}ok[w]=c;}next.clocks=merge(next.clocks,ok);});
 next.systems.growth.highestLevel=Math.max(before.systems.growth.highestLevel??0,next.systems.growth.highestLevel??0,next.player.level??0);
 // 숨은 제단 대기열: 모델이 보고한 사용 수, 없으면 응답의 GACHA 카드 수만큼 넘긴다.
 const draws=p.draws!==undefined?(int(p.draws)&&p.draws<=MAX_DRAWS?p.draws:(warnings.push('draws:invalid'),meta.gachaCards??0)):(meta.gachaCards??0);
 consume(next,draws);
 if(p.altarOverride!==undefined)attempt('altarOverride',()=>recordOverrides(next,p.altarOverride,draws,before.rev+1));
 next=prepareAIState(next,data,rules,catalog);next.rev=before.rev+1;
 // World/gate filtering uses the same canonical router; AI cannot grant private unlock flags.
 next.cast=renderScene({...next,autoMarkers:false},data).state.cast;
 next.companions=next.companions.filter(id=>next.cast.includes(id));
 return {ok:true,state:next,error:warnings.length?'partial: '+warnings.slice(0,6).join(', '):null,warnings};
}
export function aiSnapshot(s,data,rules,catalog){
 const x=snapshot(s,data);x.judgement='main-model';x.setup=s.systems.setup;
 x.systems={equipment:s.systems.equipment,growth:s.systems.growth,guild:s.systems.guild,housing:s.systems.housing,pet:s.systems.pet,real:s.systems.real,cooldowns:s.systems.cooldowns,statuses:s.systems.statuses,customItems:s.systems.customItems,customSkills:s.systems.customSkills,deadNatives:s.systems.deadNatives,receipts:s.systems.receipts?.slice(-3)};
 x.ownedItemRules=s.player.inventory.map(i=>({id:i.id,name:i.name,rule:catalog.items[i.id]??s.systems.customItems?.[i.id]??i.note}));
 x.ownedSkillRules=s.player.skills.map(id=>({id,rule:catalog.skills[id]??s.systems.customSkills?.[id]??id}));
 if(s.player.level)x.expBar={start:threshold(s.player.level,rules),next:threshold(s.player.level+1,rules)};
 return x;
}
// v0.8.1: 이름 언급 감지. 별칭 단위로, 앞뒤가 한글 단어에 붙어 있으면 무시한다.
// 일반 명사와 겹치는 닉네임(strict)은 사람에게 쓰는 조사·호칭이 붙거나 따옴표로 감쌌을 때만 인정한다.
const LOOSE='(?:은|는|이|가|을|를|의|에게서|에게|한테서|한테|께서|께|와|과|이랑|랑|도|만|아|야|님|씨|에서|에|으로|로|이라|라|이야|이여|여|이나|나|처럼|보다|하고)?';
const STRICT='(?:님|씨|에게서|에게|한테서|한테|께서|께|더러|이랑|랑|이라는|라는|아|야|이여)';
const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function mentions(text,c){
 const t=String(text??'');if(!t)return false;
 const aliases=Array.isArray(c.aliases)&&c.aliases.length?c.aliases:[c.name];
 return aliases.some(a=>{
  const strict=Array.isArray(c.strict)?c.strict.includes(a):false;
  if(strict){
   if(new RegExp(`[“"'‘「『]\\s*${esc(a)}\\s*[”"'’」』]`).test(t))return true;
   return new RegExp(`(?<![가-힣])${esc(a)}\\s?${STRICT}(?![가-힣])`).test(t);
  }
  return new RegExp(`(?<![가-힣A-Za-z])${esc(a)}${LOOSE}(?![가-힣])`).test(t);
 });
}
export function renderAIRequest(s,data,rules,catalog,{locked=false,utterance='',altarState=null}={}){
 const scene=renderScene({...s,autoMarkers:false},data);
 const game=data.locations[s.loc].world!=='reality';
 const kitAllowed=c=>game||c.kind==='real'||c.kind==='hidden';
 const extra=[];
 for(const id of s.cast){const c=data.chars[id];if(c?.kit&&kitAllowed(c)&&!scene.kitIds.includes(id))extra.push('[Canonical ability reference: '+c.name+']\n'+c.kit);}
 // Keyword knowledge retrieval, never action interpretation or automatic spawning.
 const named=scene.directory.eligible.filter(id=>!s.cast.includes(id)&&data.chars[id]?.name&&mentions(utterance,data.chars[id])).slice(0,2);
 for(const id of named){const c=data.chars[id];let profile=c.profile;if(!game&&c.identity)profile=profile.replace(/^.*\n/,'Known real-world person linked to '+c.name+' (GM continuity).\n').replace(/^Look:.*$/m,'Look: '+c.realLook)+'\n'+c.identity;extra.push('[Referenced local candidate, NOT automatically present: '+c.name+']\n'+profile+(c.kit&&kitAllowed(c)?'\n'+c.kit:''));}
 const protocol=`[AI judgement v0.8]\nResolve the user's contextual intent, plausible actions, outcomes and numerical consequences in THIS narrative response. No command grammar, action-ID requirement, parser failure notices, separate interpretation call or technical clarification. Infer clear references; ask an in-world question only when the actual story choice is materially ambiguous. Questions/hypotheses/negations/quoted NPC actions are not player spending. Keep user agency.\n${locked?'REGENERATION: This input has a settled outcome. Retell it without another payment/roll/progress; preserve the supplied state and drops.':'The snapshot is the starting record. You judge the new outcome; make narrative, result cards and final state agree. Apply only consequences supported by the player action and scene. Named items outside the sample catalog may exist: record a consistent ID/name/quantity and short rule. Skills still require absorbed dream shards.'}\nPlace ONE hidden JSON comment right after the story and any GACHA/QST/DM cards, BEFORE any Dreamteo block: <!--ROAI:{"rev":${s.rev}}-->. Write it even if the reply is short; add only the changed fields to this object, using final totals; never copy invented example numbers. Omit unchanged fields; {} or {"rev":${s.rev}} means no numerical change. No visible JSON/full HUD HTML/RLST.\nAllowed top fields: rev, draws({{user}}'s altar queue results used this response), altarOverride(only with a canonical ability/event reason), loc, event, cast(at most6 actual IDs such as c001; other people stay ambient; add a newcomer when they enter), place, dt(0..120), clocks, transition(login/logout), mem([{id,stage,note}]), note, follow, leave, player, systems, quests, pendingDeath(true/false), logoutLock. player: handle,level,totalExp,points,tickets,stats{STR,CON,AGI,INT,LUK,DEX,SEN},wallet{gold,diamonds},hp{value,max},mp{value,max},inventory([{id,name,qty,note}]),inventoryReplace(optional boolean),skills([new IDs/names]),redBrand. systems: equipment{weapon,armor,accessory},growth{highestLevel},guild,housing,pet,real,cooldowns,statuses([{name,turns}]),customItems({ID:{name,kind,slot,note}}),customSkills({ID:{name,note}}),receipts([{type,text,detail}]),pendingGold,setup{mode,pending},deadNatives([native IDs]),avatarTrap. Inventory rows update final quantities BY ID; qty0 removes; omitted items remain. inventoryReplace:true intentionally replaces the whole bag. skills ADD permanent entries. Quest rows update BY ID; other quests remain. Statuses replace their list. Quest IDs q_...; quest status offered/active/completed/failed/declined and rewardClaimed boolean. Objects are partial patches, amounts are final totals as plain JSON numbers (970, not "970"). Null=unknown. Preserve unknown values; never silently assume veteran funds or fill omitted setup stats. Do not emit evidence,known,deep,bonds,worldTruth,abyssOrigin or hidden unlocks.\nFixed canon: gacha 30 diamonds/pull, no pity, independent beam/grade; {{user}}'s altar pulls and Grace Roulette spins MUST use the hidden altar queue in order (NPC pulls follow their own canon); no claim of cryptographic RNG. Creation 10 AP, +1 AP/new highest level; no repeated AP after regaining lost levels. INT adds MP, not magic damage. Normal revival halves cumulative TOTAL EXP; instant revival 1000 diamonds OR 10000000 gold, guild debt only with a real fictional fund. Nonlethal duel ends at HP1; natives die permanently, native killing gives permanent red brand; Lords cannot be ordinary HP kills. Do not grant game powers/money to reality. Only accepted/completed/claimed quest steps settle their respective effects.\nClient draft display defaults: EXP threshold=50*(L-1)*L; maxHP=100+12*CON+5*(L-1); maxMP=40+8*INT+3*(L-1), plus established equipment/effects. Keep established unique abilities above these draft templates. No additional game math or probabilities are newly canonized.\nLocation codes: ${Object.values(data.locations).map(l=>l.code+'='+l.label).join('; ')}\nActivity codes: ${Object.keys(data.events).join(', ')}.`;
 const altar=game?queueText(locked&&altarState?altarState:s,locked):'';
 return {state:{...s,cast:scene.state.cast},prompt:'[Current session; AI resolves the next outcome]\n'+JSON.stringify(aiSnapshot(s,data,rules,catalog))+'\n\n'+scene.prompt+'\n\n'+extra.join('\n\n')+(altar?'\n\n'+altar:'')+'\n\n'+protocol};
}
