import {cleanNarrative} from './st-presentation.mjs';
// Presentation policies never change gameplay state or trust chat text as an option.
export const DREAM_MARKER='[[RELICTA_DREAMTEO_ALWAYS_ON_V1]]';
export const UI_POLICY='[RELICTA UI POLICY v0.6]';
export function dreamteoFromEntries(entries){return Array.isArray(entries)&&entries.some(e=>e&&e.disable!==true&&e.enabled!==false&&typeof e.content==='string'&&/^\[USER-OPTION:DREAMTEO\]/.test(e.comment??'')&&e.content.startsWith(DREAM_MARKER));}
export function stripDreamteo(text,incomplete=true,inline=true){
    let s=String(text??'').replace(inline?/<(?:꿈터|DREAMTEO)(?:[ \t][^>\r\n]*)?>[\s\S]*?<\/(?:꿈터|DREAMTEO)>[ \t]*(?:\r?\n)?/g:/^[ \t]*<(?:꿈터|DREAMTEO)(?:[ \t][^>\r\n]*)?>[\s\S]*?<\/(?:꿈터|DREAMTEO)>[ \t]*(?:\r?\n)?/gm,'');
    if(incomplete)s=s.replace(/^[ \t]*<(?:꿈터|DREAMTEO)(?:[ \t][^>\r\n]*)?>[\s\S]*$/gm,'');
    return s;
}
export function cleanHistory(messages){return messages.map(m=>{
    if(m.role==='assistant'){
        if(typeof m.content==='string')return {...m,content:cleanNarrative(m.content)};
        if(Array.isArray(m.content))return {...m,content:m.content.map(b=>b.type==='text'?{...b,text:cleanNarrative(b.text)}:b)};
    }
    if(m.is_user===false&&!m.is_system&&typeof m.mes==='string')return {...m,mes:cleanNarrative(m.mes)};
    return m;
});}
export function dreamteoPolicy(on){return UI_POLICY+' Dreamteo '+(on?'ON. Append exactly one <꿈터> block as the LAST part of the reply, after the hidden ROAI patch, using the active WI format: 4-6 public posts (quiet 4; busy 5-6), each body 2-5 lines and 3-5 comments including some nested/author replies. Gripe target about 5% of posts, normally none and max one per feed; vary other categories. No private scenes, DM, hidden canon, real identity or exact internal odds. No automatic user posting/reading or actual-cast change.':'OFF. Omit all Dreamteo/forum blocks, feeds and substitute board summaries. An earlier board or a character mentioning the forum never enables it.');}
export function withDreamteoPolicy(messages,on){
    const clean=cleanHistory(messages).filter(m=>!(m.role==='system'&&typeof m.content==='string'&&m.content.startsWith(UI_POLICY)));
    return [...clean,{role:'system',content:dreamteoPolicy(on)}];
}
export function textDreamteoPolicy(prompt,on){
    const clean=stripDreamteo(prompt,false,false).replace(/\n?\[RELICTA UI POLICY v0\.6\][^\r\n]*/g,'');
    return clean+'\n'+dreamteoPolicy(on);
}
