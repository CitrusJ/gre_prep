/* Source-backed eight-word / three-pair practice with two distractors. No storage or network access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GREPairingCore=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ');
  // Articles remain visible exactly as printed, but must not disguise a shared word.
  const exclusionKey=value=>normalize(value).replace(/^(?:a|an|the)\s+(?=\S)/,'');
  const phrase=value=>normalize(value).replace(/[，,；;、。\s]/g,'').replace(/的$/,'');
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const text=(value,max=300)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  const meaningKeys=value=>new Set(String(value||'').split(/[，,；;、/]/).map(phrase).filter(value=>value.length>=2));
  const caches=new WeakMap();
  function index(data){
    if(!object(data)||!Array.isArray(data.groups))throw Error('配对词表尚未加载。');
    if(caches.has(data))return caches.get(data);
    const groups=[],byId=new Map(),parent=new Map(),seenIds=new Set();
    function find(word){if(!parent.has(word))parent.set(word,word);const p=parent.get(word);if(p!==word)parent.set(word,find(p));return parent.get(word);}
    function union(a,b){const left=find(a),right=find(b);if(left!==right)parent.set(right,left);}
    for(const raw of data.groups){
      if(!object(raw)||!text(raw.id,200)||seenIds.has(raw.id)||!Array.isArray(raw.words)||raw.words.length<2||!text(raw.meaning,2000)||!Number.isInteger(raw.page)||raw.page<1)throw Error('配对词表中的来源组格式不完整。');
      seenIds.add(raw.id);
      const words=raw.words.map(word=>{if(!object(word)||!text(word.word,150))throw Error('配对词表中有不完整的单词。');return {word:word.word.trim(),key:normalize(word.word)};});
      if(new Set(words.map(word=>word.key)).size!==words.length)throw Error('同一来源组中有重复单词。');
      words.forEach(word=>union(exclusionKey(words[0].word),exclusionKey(word.word)));
      const group={id:raw.id,page:raw.page,meaning:raw.meaning,words,meaningKeys:meaningKeys(raw.meaning)};
      if(raw.needsReview!==true){groups.push(group);byId.set(group.id,group);}
    }
    // Shared source words link senses conservatively: such groups never share a round.
    for(const group of groups)group.component=find(exclusionKey(group.words[0].word));
    const result={groups,byId};caches.set(data,result);return result;
  }
  function shuffle(values,rng){const out=[...values];for(let i=out.length-1;i>0;i--){const r=rng();if(!Number.isFinite(r)||r<0||r>=1)throw Error('随机数生成器必须返回 0（含）到 1（不含）。');const j=Math.floor(r*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  function compatible(a,b){return a.component!==b.component&&![...a.meaningKeys].some(key=>b.meaningKeys.has(key));}
  function chooseGroups(source,count,required,rng,used=new Set()){
    for(let attempt=0;attempt<40;attempt++){
      const chosen=[...required],randomized=shuffle(source.groups,rng);
      const candidates=[...randomized.filter(group=>!used.has(group.id)),...randomized.filter(group=>used.has(group.id))];
      for(const group of candidates){
        if(chosen.every(other=>compatible(group,other)))chosen.push(group);
        if(chosen.length===count)return chosen;
      }
    }
    throw Error('暂时无法组合三组配对和两个不混淆的干扰词，请重新开始。');
  }
  function copyRound(round){
    const copy={...round,items:round.items.map(item=>({...item})),pairs:round.pairs.map(pair=>({...pair,ids:[...pair.ids]}))};
    if(Array.isArray(round.distractors))copy.distractors=round.distractors.map(item=>({...item}));
    return copy;
  }
  function buildRounds(data,count,rng=Math.random){
    if(!Number.isInteger(count)||count<1||count>100)throw Error('每次练习请输入 1–100 轮。');
    if(typeof rng!=='function')throw TypeError('rng must be a function');
    const source=index(data),used=new Set(),rounds=[];
    if(source.groups.length<5||new Set(source.groups.map(group=>group.component)).size<5)throw Error('词表中还没有足够的独立来源组来组成三组配对和两个干扰词。');
    for(let turn=0;turn<count;turn++){
      const chosen=chooseGroups(source,5,[],rng,used);
      const id=`pair-${turn+1}-${chosen.slice(0,3).map(group=>group.id).join('-')}`,items=[],pairs=[],distractors=[];
      chosen.forEach((group,groupIndex)=>{
        const selected=shuffle(group.words,rng).slice(0,groupIndex<3?2:1);
        const ids=selected.map((word,position)=>{const itemId=`${id}:${groupIndex<3?groupIndex*2+position:groupIndex+3}`;items.push({id:itemId,word:word.word});return itemId;});
        const evidence={meaning:group.meaning,page:group.page,groupId:group.id};
        if(groupIndex<3)pairs.push({ids,...evidence});else distractors.push({id:ids[0],...evidence});
        used.add(group.id);
      });
      const round={id,items:shuffle(items,rng),pairs,distractors,sourceTitle:typeof data.title==='string'?data.title:'',sourceUrl:typeof data.sourceUrl==='string'?data.sourceUrl:''};
      if(!validateRound(round,data))throw Error('配对题目校验失败，请重新开始。');
      rounds.push(round);
    }
    return rounds;
  }
  function validateRound(round,data){
    if(!object(round)||!text(round.id,1000)||!Array.isArray(round.items)||![6,8].includes(round.items.length)||!Array.isArray(round.pairs)||round.pairs.length!==3)return false;
    const size=round.items.length,distractors=round.distractors;
    // Six-word rounds remain valid as historical records. Every new eight-word
    // round must account for both unused cards with explicit source evidence.
    if(size===6?(distractors!==undefined&&(!Array.isArray(distractors)||distractors.length!==0)):(!Array.isArray(distractors)||distractors.length!==2))return false;
    if(round.items.some(item=>!object(item)||!text(item.id,1100)||!text(item.word,150)))return false;
    const items=new Map(round.items.map(item=>[item.id,item]));
    if(items.size!==size||new Set(round.items.map(item=>exclusionKey(item.word))).size!==size)return false;
    const used=new Set(),groupIds=new Set(),evidence=[];
    for(const pair of round.pairs){
      if(!object(pair)||!Array.isArray(pair.ids)||pair.ids.length!==2||pair.ids[0]===pair.ids[1]||pair.ids.some(id=>!items.has(id)||used.has(id))||!text(pair.meaning,2000)||!text(pair.groupId,200)||groupIds.has(pair.groupId)||!Number.isInteger(pair.page)||pair.page<1)return false;
      pair.ids.forEach(id=>used.add(id));groupIds.add(pair.groupId);evidence.push({entry:pair,ids:pair.ids});
    }
    if(used.size!==6)return false;
    for(const distractor of distractors||[]){
      if(!object(distractor)||!text(distractor.id,1100)||!items.has(distractor.id)||used.has(distractor.id)||!text(distractor.meaning,2000)||!text(distractor.groupId,200)||groupIds.has(distractor.groupId)||!Number.isInteger(distractor.page)||distractor.page<1)return false;
      used.add(distractor.id);groupIds.add(distractor.groupId);evidence.push({entry:distractor,ids:[distractor.id]});
    }
    if(used.size!==size)return false;
    if(data){
      let source;try{source=index(data);}catch{return false;}
      const groups=[];
      for(const {entry,ids} of evidence){const group=source.byId.get(entry.groupId);if(!group||entry.page!==group.page||entry.meaning!==group.meaning||!ids.every(id=>group.words.some(word=>word.key===normalize(items.get(id).word))))return false;groups.push(group);}
      if(groups.some((group,i)=>groups.slice(i+1).some(other=>!compatible(group,other))))return false;
    }
    return true;
  }
  function addDistractors(round,data,rng=Math.random){
    if(typeof rng!=='function')throw TypeError('rng must be a function');
    if(!validateRound(round,data))throw Error('原配对题目校验失败，无法补充干扰词。');
    const upgraded=copyRound(round);
    if(round.items.length===8)return upgraded;
    const source=index(data),required=round.pairs.map(pair=>source.byId.get(pair.groupId));
    const chosen=chooseGroups(source,5,required,rng),ids=new Set(round.items.map(item=>item.id));
    upgraded.distractors=[];
    chosen.slice(3).forEach((group,position)=>{
      const word=shuffle(group.words,rng)[0];
      let id=`${round.id}:distractor-${position+1}`,suffix=0;
      while(ids.has(id))id=`${round.id}:distractor-${position+1}-${++suffix}`;
      ids.add(id);upgraded.items.push({id,word:word.word});
      upgraded.distractors.push({id,groupId:group.id,page:group.page,meaning:group.meaning});
    });
    upgraded.items=shuffle(upgraded.items,rng);
    if(!validateRound(upgraded,data))throw Error('补充干扰词后的题目校验失败。');
    return upgraded;
  }
  function checkPair(round,a,b){if(!validateRound(round)||typeof a!=='string'||typeof b!=='string'||a===b)return false;return round.pairs.some(pair=>pair.ids.includes(a)&&pair.ids.includes(b));}
  return {buildRounds,addDistractors,validateRound,checkPair,normalize};
});
