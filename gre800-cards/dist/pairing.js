/* Eight-word pairing practice: three pairs and two source-backed distractors. */
(()=>{
  'use strict';
  const KEY='gre-word-pairing-v1',FORMAT='gre-word-pairing-progress',MAX_BYTES=4*1024*1024;
  const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value)),object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
  const time=value=>Number.isFinite(value)&&value>=0&&value<=8640000000000000;
  const norm=value=>core.normalize(value),edge=(a,b)=>[norm(a),norm(b)].sort().join('\u0000');
  const shuffle=values=>{const out=[...values];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;};
  const uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
  const empty=()=>({version:1,screen:'setup',count:10,session:null,history:[],updatedAt:0});
  let host=null,onChange=null,data=null,core=null,stamp='',groups=new Map(),edges=new Set(),state=empty(),loaded=false,storageWarning='',notice='',maySave=true;
  const active=()=>host?.isConnected&&!!host.querySelector('[data-pairing-screen]');
  const response=()=>state.session?.responses[state.session.index];
  const round=()=>state.session?.rounds[state.session.index];
  const answered=result=>time(result?.submittedAt);
  function signature(value){let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);return (hash>>>0).toString(16)+'-'+value.length;}
  function prepare(){
    data=window.GRE_EQUIVALENCE_DATA;core=window.GREPairingCore;
    if(!data||!Array.isArray(data.groups)||!core?.buildRounds||!core?.validateRound||!core?.checkPair||!core?.addDistractors)return false;
    groups=new Map(data.groups.map(group=>[String(group.id),group]));edges=new Set();
    for(const group of data.groups.filter(group=>group.needsReview!==true))for(let a=0;a<group.words.length;a++)for(let b=a+1;b<group.words.length;b++)edges.add(edge(group.words[a].word,group.words[b].word));
    stamp=signature(JSON.stringify([data.title,data.sourceUrl,data.groups]));
    return data.groups.filter(group=>group.needsReview!==true).length>=5;
  }
  function cleanRound(raw){
    if(!core.validateRound(raw,data)||typeof raw.id!=='string'||raw.id.length>600)throw Error('配对题目格式不正确。');
    const items=raw.items.map(item=>({id:String(item.id),word:String(item.word)}));
    if(![6,8].includes(items.length)||new Set(items.map(item=>item.id)).size!==items.length||new Set(items.map(item=>norm(item.word))).size!==items.length||items.some(item=>!item.id||item.id.length>300||!item.word||item.word.length>200))throw Error('配对轮次必须包含八个不同的词，或一份完整的旧六词记录。');
    const byId=new Map(items.map(item=>[item.id,item])),used=new Set();
    const pairs=raw.pairs.map(pair=>{
      const group=groups.get(String(pair.groupId)),ids=pair.ids.map(String);
      if(!group||ids.length!==2||ids.some(id=>!byId.has(id)||used.has(id))||ids[0]===ids[1]||ids.some(id=>!group.words.some(word=>norm(word.word)===norm(byId.get(id).word))))throw Error('配对关系无法对应原词表。');
      ids.forEach(id=>used.add(id));
      return {ids,groupId:String(group.id),page:group.page,meaning:String(group.meaning||group.words.map(word=>word.meaning||'').filter(Boolean).join('；')||'')};
    });
    if(pairs.length!==3||used.size!==6)throw Error('配对关系不完整。');
    for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){
      const expected=pairs.some(pair=>pair.ids.includes(items[a].id)&&pair.ids.includes(items[b].id));
      if(edges.has(edge(items[a].word,items[b].word))!==expected)throw Error('该轮存在交叉配对关系，请重新生成练习。');
    }
    const distractors=(raw.distractors||[]).map(item=>{
      const group=groups.get(String(item.groupId));
      return {id:String(item.id),groupId:String(group.id),page:group.page,meaning:String(group.meaning)};
    });
    return items.length===8?{id:raw.id,items,pairs,distractors}:{id:raw.id,items,pairs};
  }
  function cleanDraft(raw,current){
    if(!object(raw)||!Array.isArray(raw.pairs)||raw.pairs.length>3)throw Error('配对作答记录不完整。');
    const ids=new Set(current.items.map(item=>item.id)),used=new Set();
    const pairs=raw.pairs.map(pair=>{
      if(!Array.isArray(pair)||pair.length!==2||pair.some(id=>typeof id!=='string'||!ids.has(id)||used.has(id))||pair[0]===pair[1])throw Error('配对作答包含重复或无效单词。');
      pair.forEach(id=>used.add(id));return [...pair];
    });
    if(raw.selected!==null&&(pairs.length===3||typeof raw.selected!=='string'||!ids.has(raw.selected)||used.has(raw.selected)))throw Error('当前选中的词不正确。');
    return {pairs,selected:raw.selected};
  }
  function cleanResponse(raw,current){
    const out=cleanDraft(raw,current);
    if(raw.submittedAt!==null&&!time(raw.submittedAt)||raw.submittedAt!==null&&(out.pairs.length!==3||out.selected!==null))throw Error('已提交的配对记录不完整。');
    if(!Array.isArray(raw.undo)||raw.undo.length>80)throw Error('撤销记录格式不正确。');
    return {...out,submittedAt:raw.submittedAt,undo:answered(raw)?[]:raw.undo.map(item=>cleanDraft(item,current))};
  }
  function cleanSession(raw){
    if(raw===null)return null;
    if(!object(raw)||typeof raw.id!=='string'||raw.id.length>100||!time(raw.startedAt)||!Array.isArray(raw.rounds)||!integer(raw.rounds.length,1,100)||!Array.isArray(raw.responses)||raw.responses.length!==raw.rounds.length||!integer(raw.index,0,raw.rounds.length-1))throw Error('配对轮次记录不完整。');
    const rounds=raw.rounds.map(cleanRound),responses=raw.responses.map((item,i)=>cleanResponse(item,rounds[i]));
    rounds.forEach((current,i)=>{
      if(current.items.length!==6||answered(responses[i]))return;
      let seed=parseInt(signature(current.id+'|'+stamp).split('-')[0],16);
      const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      rounds[i]=cleanRound(core.addDistractors(current,data,rng));
    });
    if(raw.finishedAt!==null&&(!time(raw.finishedAt)||!responses.every(answered)))throw Error('完成状态与实际作答不符。');
    return {id:raw.id,startedAt:raw.startedAt,finishedAt:raw.finishedAt,index:raw.index,rounds,responses};
  }
  function cleanState(raw){
    if(!object(raw)||raw.version!==1||raw.dataStamp!==stamp||!['setup','practice','summary'].includes(raw.screen)||!integer(raw.count,1,100)||!time(raw.updatedAt)||!Array.isArray(raw.history)||raw.history.length>200)throw Error('这份配对进度与当前词表不匹配。');
    const session=cleanSession(raw.session),seen=new Set();
    const history=raw.history.map(item=>{
      if(!object(item)||typeof item.id!=='string'||item.id.length>100||seen.has(item.id)||!time(item.startedAt)||!time(item.finishedAt)||!integer(item.total,1,100)||!integer(item.correctPairs,0,item.total*3)||!integer(item.correctRounds,0,item.total))throw Error('配对练习历史格式不正确。');
      seen.add(item.id);return {id:item.id,startedAt:item.startedAt,finishedAt:item.finishedAt,total:item.total,correctPairs:item.correctPairs,correctRounds:item.correctRounds};
    });
    if(raw.screen!=='setup'&&!session||raw.screen==='summary'&&session?.finishedAt===null)throw Error('未找到当前练习。');
    return {version:1,screen:raw.screen,count:raw.count,session,history,updatedAt:raw.updatedAt};
  }
  function snapshot(){return {format:FORMAT,version:1,exportedAt:Date.now(),state:{...clone(state),dataStamp:stamp}};}
  function save(){
    state.updatedAt=Date.now();
    try{if(!maySave)throw Error();localStorage.setItem(KEY,JSON.stringify({...state,dataStamp:stamp}));storageWarning='';onChange?.();return true;}
    catch{storageWarning='当前浏览器未能保存配对进度，请导出备份后再关闭页面。';return false;}
  }
  function restore(document){
    if(!object(document)||document.format!==FORMAT||document.version!==1)throw Error('请选择配对练习导出的进度 JSON。');
    const incoming=cleanState(document.state),latest=incoming.updatedAt>=state.updatedAt?incoming:state;
    const history=new Map();for(const item of [...state.history,...incoming.history]){const prior=history.get(item.id);if(!prior||item.finishedAt>=prior.finishedAt)history.set(item.id,item);}
    const next={...clone(latest),history:[...history.values()].sort((a,b)=>b.finishedAt-a.finishedAt).slice(0,200)};
    try{localStorage.setItem(KEY,JSON.stringify({...next,dataStamp:stamp}));}catch{throw Error('浏览器保存失败，当前配对记录未改动。');}
    state=next;maySave=true;storageWarning='';notice='配对进度已合并，同一轮练习不会重复累计。';onChange?.();if(active())render();return snapshot();
  }
  function load(){
    loaded=true;
    let raw;
    try{
      raw=localStorage.getItem(KEY);
      if(raw){
        const original=JSON.parse(raw);state=cleanState(original);
        const upgraded=original.session?.rounds.some((current,i)=>current.items.length===6&&state.session?.rounds[i].items.length===8);
        if(upgraded){
          try{localStorage.setItem(KEY+'-backup-before-eight-words',raw);localStorage.setItem(KEY,JSON.stringify({...state,dataStamp:stamp}));}
          catch{storageWarning='本轮已补充两个干扰项，但浏览器未能保存；请导出配对进度。';}
        }
      }
    }
    catch{
      state=empty();
      if(raw)try{localStorage.setItem(KEY+'-recovery-'+Date.now(),raw);storageWarning='旧配对记录暂时无法恢复，已保留恢复副本，可以开始新练习。';}catch{maySave=false;storageWarning='旧配对记录暂时无法恢复，原记录已保留；新练习请及时导出备份。';}
      else storageWarning='浏览器存储不可用，练习后请导出配对进度。';
    }
  }
  function score(current,result){return result.pairs.filter(pair=>core.checkPair(current,pair[0],pair[1])).length;}
  function totals(session){let correctPairs=0,correctRounds=0,completed=0;session.responses.forEach((result,i)=>{if(!answered(result))return;completed++;const count=score(session.rounds[i],result);correctPairs+=count;if(count===3)correctRounds++;});return {correctPairs,correctRounds,completed};}
  function start(rounds){
    if(!rounds.length)throw Error('当前词表尚不足以组成三组配对和两个干扰项。');
    const checked=rounds.map(current=>cleanRound(core.addDistractors(cleanRound(current),data)));
    state.session={id:uid(),startedAt:Date.now(),finishedAt:null,index:0,rounds:checked,responses:checked.map(()=>({pairs:[],selected:null,submittedAt:null,undo:[]}))};
    state.screen='practice';notice='';save();render();
  }
  function remember(result){result.undo.push({pairs:clone(result.pairs),selected:result.selected});if(result.undo.length>80)result.undo.shift();}
  function choose(id){
    const result=response(),current=round();if(!result||answered(result)||result.pairs.length>=3||!current.items.some(item=>item.id===id)||result.pairs.some(pair=>pair.includes(id)))return;
    remember(result);
    if(result.selected===id)result.selected=null;
    else if(result.selected){result.pairs.push([result.selected,id]);result.selected=null;}
    else result.selected=id;
    notice='';save();render(id);
  }
  function finish(){
    const session=state.session;if(!session?.responses.every(answered))return;
    session.finishedAt ||= Date.now();const stats=totals(session);
    const item={id:session.id,startedAt:session.startedAt,finishedAt:session.finishedAt,total:session.rounds.length,correctPairs:stats.correctPairs,correctRounds:stats.correctRounds};
    state.history=[item,...state.history.filter(old=>old.id!==session.id)].slice(0,200);state.screen='summary';save();render();
  }
  function sourceLink(page){
    const url=String(data.sourceUrl||'');
    if(!/^(?:\.\.\/){0,2}materials\/vocabulary\/[^?#]+\.pdf$/i.test(url)||url.includes('\\'))return '';
    return `<a class="text-link" href="${E(url)}#page=${Number.isInteger(page)&&page>0?page:1}" target="_blank" rel="noopener">原词表第 ${E(page||1)} 页 ↗</a>`;
  }
  const button=(action,text,style='secondary',attributes='')=>`<button type="button" class="button ${style}" data-pair-action="${action}" ${attributes}>${text}</button>`;
  const heading=()=>{
    const legacy=state.screen==='practice'&&round()?.items.length===6||state.screen==='summary'&&state.session?.rounds.every(current=>current.items.length===6);
    return `<header class="page-header pairing-heading"><div><p class="eyebrow">${legacy?'SAVED SIX-WORD ROUND':'EIGHT WORDS · THREE PAIRS · TWO DISTRACTORS'}</p><h1 class="page-title">${legacy?'回看原来的六词配对。':'八个词，配三组，留下两个干扰项。'}</h1><p class="page-description">${legacy?'这是已提交的旧六词记录，保留当时的词卡和答案；新练习使用八个词。':'按原词表中的同义／等价关系配成三组；剩下两个词不配对，提交后查看答案。'}</p></div><span class="pill">${legacy?'旧六词记录':'八词配对'}</span></header>`;
  };
  const backups=()=>`<div class="pairing-backups">${button('export','导出配对进度','secondary small')}${button('import','导入配对进度','secondary small')}<input type="file" data-pair-import accept=".json,application/json" hidden><p class="muted">配对记录自动保存在此浏览器，可独立导出备份。</p></div>`;
  const wordById=(current,id)=>current.items.find(item=>item.id===id)?.word||id;
  function evidence(current){
    const paired=`<section class="pairing-evidence" data-pair-answers><h2>原词表的三组配对</h2>${current.pairs.map(pair=>{
      const group=groups.get(String(pair.groupId));
      return `<article><h3>${pair.ids.map(id=>E(wordById(current,id))).join('<span aria-hidden="true"> ↔ </span>')}</h3>${pair.ids.map(id=>{const word=group.words.find(word=>norm(word.word)===norm(wordById(current,id)));return `<p><strong>${E(word.word)}</strong>${word.pos?` <em>${E(word.pos)}</em>`:''} ${E(word.meaning||group.meaning||'原表未提供中文释义')}</p>`;}).join('')}${(Array.isArray(group.sourceNotes)?group.sourceNotes:[]).map(note=>`<p class="pairing-quality-note">${E(note)}</p>`).join('')}<div>${sourceLink(pair.page)}</div></article>`;
    }).join('')}</section>`;
    const distractors=(current.distractors||[]);
    return paired+(distractors.length?`<section class="pairing-evidence pairing-distractors" data-pair-distractors><h2>本轮的两个干扰项</h2><p class="muted">这两个词没有本轮对应的配对词；它们各自的原表释义如下。</p>${distractors.map(item=>{
      const group=groups.get(String(item.groupId)),word=group.words.find(word=>norm(word.word)===norm(wordById(current,item.id)));
      return `<article data-pair-distractor-id="${E(item.id)}"><h3>${E(word.word)}</h3><p>${word.pos?`<em>${E(word.pos)}</em> `:''}${E(word.meaning||item.meaning)}</p><div>${sourceLink(item.page)}</div></article>`;
    }).join('')}</section>`:'');
  }
  function setup(){
    const session=state.session,stats=session?totals(session):null,pending=[...groups.values()].filter(group=>group.needsReview===true);
    return `<section class="overview-card pairing-setup"><h2 class="section-heading">先选这一轮的练习量</h2><p class="muted">每轮随机出现八个词，其中六个配成三组，另两个是干扰项。配齐三组即可提交，剩下两个不用选；误点可在提交前拆开、撤销。</p><form data-pair-setup><label class="field-label" for="pairing-count">练习轮数</label><div class="pairing-count-options" role="group" aria-label="常用轮数">${[5,10,20].map(n=>button('count',`${n} 轮`,state.count===n?'primary small':'secondary small',`data-pair-count="${n}" aria-pressed="${state.count===n}"`)).join('')}</div><div class="inline-form"><input id="pairing-count" class="text-input" type="number" min="1" max="100" step="1" value="${state.count}" required><button class="button primary" type="submit">${session&&!session.finishedAt?'开始新练习':'开始配对'} →</button></div></form>${session?`<div class="pairing-resume"><p class="muted">上次练习：已完成 ${stats.completed} / ${session.rounds.length} 轮${session.finishedAt?'，可以查看结果。':'。开始新练习会替换这组未完成的词卡。'}</p>${button('resume',session.finishedAt?'查看上次结果':'继续上次练习','secondary')}</div>`:''}<p class="pairing-source-note">词汇来自《${E(data.title||'六选二等价词表')}》，共 ${groups.size} 组 · ${groups.size-pending.length} 组可练${pending.length?` · ${pending.length} 组原表疑点待核对`:''}。本模式练习词汇关系；完整六选二题还需结合句子语境。</p>${pending.length?`<details class="pairing-source-review"><summary>查看 ${pending.length} 组原表疑点（不进入练习）</summary>${pending.map(group=>`<article><h3>${group.words.map(word=>E(word.word)).join(' ↔ ')}</h3>${(Array.isArray(group.sourceNotes)&&group.sourceNotes.length?group.sourceNotes:['本组待核对，暂不用于配对练习。']).map(note=>`<p>${E(note)}</p>`).join('')}${sourceLink(group.page)}</article>`).join('')}</details>`:''}</section>${state.history.length?`<section class="pairing-history"><h2 class="section-heading">最近练习</h2>${state.history.slice(0,5).map(item=>`<p><span>${E(new Date(item.finishedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</span><strong>${item.correctPairs} / ${item.total*3} 组正确</strong><span>${item.total} 轮</span></p>`).join('')}</section>`:''}${backups()}`;
  }
  function practice(){
    const session=state.session,current=round(),result=response(),submitted=answered(result),stats=totals(session),correct=submitted?score(current,result):0;
    const distractorIds=new Set((current.distractors||[]).map(item=>item.id)),hasDistractors=distractorIds.size===2;
    return `<div class="pairing-toolbar"><p class="muted">第 ${session.index+1} / ${session.rounds.length} 轮 · 已完成 ${stats.completed} 轮</p>${button('settings','练习设置','secondary small')}</div><section class="overview-card pairing-practice"><div class="pairing-round-heading"><h2 class="section-heading">${submitted?'核对这一轮的配对':'找出三组同义／等价词'}</h2><span class="pairing-count" role="status">已配 ${result.pairs.length} / 3 组</span></div><div class="pairing-word-grid ${hasDistractors?'':'is-legacy'}" aria-label="${current.items.length} 个待配对单词">${current.items.map((item,index)=>{
      const paired=result.pairs.findIndex(pair=>pair.includes(item.id)),selected=result.selected===item.id,correctPair=paired>=0&&submitted&&core.checkPair(current,...result.pairs[paired]),distractor=distractorIds.has(item.id);
      const gradeClass=!submitted?'':paired>=0?(correctPair?'is-correct':'is-wrong'):distractor?'is-distractor':'is-wrong';
      const mark=paired>=0?`第 ${paired+1} 组${submitted?correctPair?' · ✓':distractor?' · × 干扰项':' · ×':''}`:submitted?(distractor?'干扰项 · 正确排除':'应参与配对 · 未选'):selected?'已选中':result.pairs.length===3?'未选':'待配对';
      return `<button type="button" class="pairing-word ${selected?'is-selected':''} ${paired>=0?'is-paired pair-tone-'+paired:''} ${gradeClass}" data-pair-word="${E(item.id)}" ${submitted&&distractor?'data-pair-distractor="true"':''} ${submitted&&paired<0&&!distractor?'data-pair-missed="true"':''} aria-pressed="${selected}" ${submitted||paired>=0||result.pairs.length>=3?'disabled':''}><span class="pairing-word-key">${index+1}</span><strong lang="en">${E(item.word)}</strong><span class="pairing-word-mark">${mark}</span></button>`;
    }).join('')}</div><div class="pairing-draft" aria-label="你的三组配对">${[0,1,2].map(index=>{
      const pair=result.pairs[index];
      return `<div class="pairing-pair ${pair?'pair-tone-'+index:'is-empty'}"><span class="pairing-pair-number">${index+1}</span><div>${pair?pair.map(id=>`<strong lang="en">${E(wordById(current,id))}</strong>`).join('<span aria-hidden="true"> ↔ </span>'):'等待配对'}</div>${pair?(submitted?`<span class="pairing-result-mark">${core.checkPair(current,...pair)?'✓ 正确':'× 再核对'}</span>`:button('split','拆开','secondary small',`data-pair-index="${index}"`)):''}</div>`;
    }).join('')}</div>${submitted?`<div class="pairing-feedback ${correct===3?'is-correct':'is-wrong'}" data-pair-feedback role="status"><strong>${correct===3?(hasDistractors?'三组都配对了，两个干扰项也排除了。':'三组都配对了。'):`这一轮配对正确 ${correct} / 3 组。`}</strong><p>${correct===3?'再看一眼中文释义，巩固词义。':hasDistractors?'对照三组答案和干扰项释义，再记一遍这些词。':'对照原词表，再记一遍这些词的意思。'}</p></div>${evidence(current)}`:`<div class="pairing-controls">${button('undo','↶ 撤销一步','secondary small',result.undo.length?'':'disabled')}${button('reset','清空配对','secondary small',result.pairs.length||result.selected?'':'disabled')}${button('submit','核对三组配对','primary',result.pairs.length===3?'':'disabled')}</div><p class="pairing-keyboard-hint muted">${result.pairs.length===3?'三组已配齐，剩余两个词保持未选。需要修改可拆开或撤销。':`也可用 1–${current.items.length} 选词，Backspace 撤销；选好三组后提交，剩余两个词不用选。`}</p>`}<div class="pairing-navigation">${button('previous','← 上一轮','secondary',session.index>0?'':'disabled')}<span class="muted">${session.index+1} / ${session.rounds.length}</span>${button('next',session.index===session.rounds.length-1?'完成练习 ✓':'下一轮 →','primary',submitted?'':'disabled')}</div></section>${backups()}`;
  }
  function summary(){
    const session=state.session,stats=totals(session),wrong=session.rounds.length-stats.correctRounds;
    return `<section class="overview-card pairing-summary"><h2 class="section-heading">这一组，练习完了。</h2><div class="summary-grid"><div class="summary-stat"><span class="muted">正确配对</span><strong>${stats.correctPairs}<small> / ${session.rounds.length*3} 组</small></strong></div><div class="summary-stat"><span class="muted">全对轮次</span><strong>${stats.correctRounds}<small> / ${session.rounds.length} 轮</small></strong></div><div class="summary-stat"><span class="muted">需要巩固</span><strong>${wrong}<small> 轮</small></strong></div></div><div class="result-actions">${button('retry-wrong','重练错题','primary',wrong?'':'disabled')}${button('settings','重新随机练','secondary')}${button('review','查看本次配对','secondary')}</div></section><section class="pairing-summary-rounds"><h2 class="section-heading">每一轮的结果</h2>${session.rounds.map((current,index)=>`<details class="pairing-result-round"><summary>第 ${index+1} 轮${current.items.length===6?' · 旧六词记录':''} · ${score(current,session.responses[index])} / 3 组正确</summary><div class="pairing-your-pairs"><h3>你的配对</h3>${session.responses[index].pairs.map(pair=>`<p>${pair.map(id=>E(wordById(current,id))).join(' ↔ ')} <span>${core.checkPair(current,...pair)?'✓':'×'}</span></p>`).join('')}</div>${evidence(current)}</details>`).join('')}</section>${backups()}`;
  }
  function render(focusId){
    if(!host)return;
    host.innerHTML=`<div class="pairing-shell" data-pairing-screen="${state.screen}">${heading()}${storageWarning?`<p class="pairing-notice is-warning" role="status">${E(storageWarning)}</p>`:''}${notice?`<p class="pairing-notice" role="status">${E(notice)}</p>`:''}${state.screen==='practice'&&state.session?practice():state.screen==='summary'&&state.session?summary():setup()}</div>`;
    if(focusId){const button=[...host.querySelectorAll('[data-pair-word]')].find(button=>button.dataset.pairWord===focusId&&!button.disabled);button?.focus({preventScroll:true});}
  }
  function mount(options){
    host=options?.root||options;onChange=options?.onChange||null;if(!host?.querySelector)return false;
    let ready=false;try{ready=prepare();}catch{}
    if(!ready){host.innerHTML='<section class="empty-state"><h1 class="page-title">八词配对暂时没有加载成功</h1><p>请刷新页面，并确认配对词表与网页保存在同一应用文件夹中。</p></section>';return false;}
    if(!loaded)load();render();return true;
  }
  function download(){const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`gre-word-pairing-${new Date().toLocaleDateString('en-CA')}.json`;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function action(name,button){
    const result=response(),session=state.session;
    notice='';
    if(name==='count'){state.count=Number(button.dataset.pairCount);save();render();return;}
    if(name==='export'){download();return;}
    if(name==='import'){host.querySelector('[data-pair-import]').click();return;}
    if(name==='settings'){state.screen='setup';save();render();return;}
    if(name==='resume'&&session){state.screen=session.finishedAt?'summary':'practice';save();render();return;}
    if(name==='review'&&session){session.index=0;state.screen='practice';save();render();return;}
    if(name==='retry-wrong'&&session){const rounds=session.rounds.filter((current,index)=>score(current,session.responses[index])<3).map(current=>({...clone(current),items:shuffle(current.items)}));if(rounds.length)start(rounds);return;}
    if(!session||!result)return;
    if(name==='previous'&&session.index>0){session.index--;save();render();return;}
    if(name==='next'&&answered(result)){if(session.index===session.rounds.length-1){finish();return;}session.index++;save();render();return;}
    if(answered(result))return;
    if(name==='undo'&&result.undo.length){const prior=result.undo.pop();result.pairs=prior.pairs;result.selected=prior.selected;}
    if(name==='reset'&&(result.pairs.length||result.selected)){remember(result);result.pairs=[];result.selected=null;}
    if(name==='split'&&integer(Number(button.dataset.pairIndex),0,result.pairs.length-1)){remember(result);result.pairs.splice(Number(button.dataset.pairIndex),1);}
    if(name==='submit'&&result.pairs.length===3){result.submittedAt=Date.now();result.selected=null;result.undo=[];}
    save();render();
  }
  document.addEventListener('click',event=>{
    if(!active())return;const button=event.target.closest('button');if(!button||button.disabled||!host.contains(button))return;
    try{if(button.dataset.pairWord)choose(button.dataset.pairWord);else if(button.dataset.pairAction)action(button.dataset.pairAction,button);}catch(error){notice=error.message||'暂时无法开始配对，请刷新后重试。';render();}
  });
  document.addEventListener('submit',event=>{
    if(!active()||!event.target.matches('[data-pair-setup]'))return;event.preventDefault();
    const count=Number(host.querySelector('#pairing-count').value);if(!integer(count,1,100)){notice='请输入 1–100 之间的整数轮数。';render();return;}
    try{state.count=count;start(core.buildRounds(data,count));}catch(error){notice=error.message||'暂时没有足够的配对组，请稍后重试。';render();}
  });
  document.addEventListener('change',async event=>{
    if(!active()||!event.target.matches('[data-pair-import]'))return;const file=event.target.files[0];if(!file)return;
    try{if(file.size>MAX_BYTES)throw Error('配对进度文件不能超过 4 MB。');restore(JSON.parse(await file.text()));}catch(error){notice='导入失败：'+error.message;if(active())render();}
  });
  document.addEventListener('keydown',event=>{
    if(!active()||state.screen!=='practice'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.target.matches('input,textarea,select,[contenteditable="true"]'))return;
    if(/^[1-8]$/.test(event.key)){const item=round().items[Number(event.key)-1];if(item){event.preventDefault();choose(item.id);}}
    else if(event.key==='Backspace'&&!answered(response())){event.preventDefault();action('undo',null);}
    else if(event.key==='ArrowLeft'&&state.session.index>0){event.preventDefault();action('previous',null);}
    else if(event.key==='ArrowRight'&&answered(response())){event.preventDefault();action('next',null);}
  });
  window.GREPairing={mount,getState:()=>clone(state),snapshot,restore};
})();
