// v0.8.16 · 긴 채팅 경량화
// 카드 정규식은 메시지마다 같은 <style>을 하나씩 품고 있습니다. 메시지가 100개면 같은 규칙이 100벌 쌓여
// 글자 하나가 바뀔 때마다 브라우저가 전부 다시 대조합니다. 렐릭타 채팅에서는 같은 스타일을 문서 머리에 한 벌만 두고
// 메시지 안의 사본은 걷어 냅니다. 지난 메시지의 움직임은 style.css(body.ro-relicta 규칙)가 멈춥니다.
const seen=new Set();
let active=false;

function hoist(el){
    const css=el.textContent||'';
    if(!css.includes('data-ro6-kind'))return;
    if(!seen.has(css)){
        seen.add(css);
        const copy=document.createElement('style');
        copy.setAttribute('data-ro-hoist','');
        copy.textContent=css;
        document.head.append(copy);
    }
    el.remove();
}

function sweep(root){
    if(!root?.querySelectorAll)return;
    for(const el of root.querySelectorAll('.mes_text style'))hoist(el);
}

export function setRelictaActive(on){
    active=!!on;
    document.body?.classList.toggle('ro-relicta',active);
    if(active)sweep(document.querySelector('#chat'));
}

export function onChatMutations(records){
    if(!active||!records)return;
    for(const r of records)for(const n of r.addedNodes){
        if(n.nodeType!==1)continue;
        if(n.tagName==='STYLE'){if(n.closest?.('#chat .mes_text'))hoist(n);}
        else if(n.querySelectorAll){
            if(n.matches?.('#chat .mes_text, #chat .mes_text *, #chat .mes, #chat .mes *'))for(const el of n.querySelectorAll('style'))hoist(el);
            else if(n.id==='chat')sweep(n);
        }
    }
}

export const perfStats=()=>({active,unique:seen.size,inChat:document.querySelectorAll('#chat .mes_text style').length});
