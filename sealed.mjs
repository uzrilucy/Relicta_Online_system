// 인물 데이터 봉인 해제 (v0.8.1). 저장소에서 스포일러가 바로 읽히지 않게 하는 장치이며 보안 잠금은 아니다.
const KEY=[...'RELICTA'].map(c=>c.charCodeAt(0));
export function unsealData(obj){
    if(!obj||obj.format!=='relicta-sealed-1'||typeof obj.data!=='string')return obj;
    const bin=atob(obj.data),u=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i)^KEY[i%KEY.length];
    return JSON.parse(new TextDecoder('utf-8').decode(u));
}
