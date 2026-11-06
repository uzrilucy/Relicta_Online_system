// Copy-only prompt/display hygiene. Never mutate the saved raw message.
import {stripAIJudgement} from './ai-judgement.mjs';
export function cleanNarrative(text,board=true){
 let s=stripAIJudgement(text).replace(/<!--RO4:[\s\S]*?(?:-->|$)|<RLST>[\s\S]*?(?:<\/RLST>|$)/g,'')
  .replace(/(?:-SYM:[ \t]*)?행동 해석을 마치지 못했습니다\. 실행할 행동을 짧게 다시 알려주세요\./g,'');
 if(board)s=s.replace(/<(?:꿈터|DREAMTEO)(?:[ \t][^>\r\n]*)?>[\s\S]*?(?:<\/(?:꿈터|DREAMTEO)>|$)/g,'');
 return s;
}
export function finalAIInstruction(){return '[Relicta v0.8 current protocol overrides legacy v0.7 engine/parser instructions] The main narrative model judges actions and updates the supplied record in this response. No pre-response action interpreter, pending-action/error notification, action IDs or separate model call. Write one valid hidden ROAI JSON patch right after the story and any cards (before any Dreamteo block), using the current snapshot revision, final totals as JSON numbers, newcomers in cast and draws when the hidden altar queue was used. On REGENERATION preserve the settled outcome; do not reroll or spend again. Follow the current injected schema, canon and active Dreamteo policy. Do not print full HUD HTML/RLST. Keep other end-of-reply tags requested by other instructions (e.g. an image tag like <pic prompt="...">): write them AFTER the ROAI comment, complete and closed, never inside it.';}
