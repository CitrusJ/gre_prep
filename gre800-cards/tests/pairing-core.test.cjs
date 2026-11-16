'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../dist/pairing-core.js');
const group=(id,words,meaning)=>({id,page:2,meaning,words:words.map(word=>({word}))});
const fixture=()=>({title:'Source pairs',sourceUrl:'../../materials/vocabulary/example.pdf',groups:[group('a',['bright','radiant'],'明亮的'),group('b',['calm','serene'],'平静的'),group('c',['rapid','swift'],'迅速的'),group('d',['large','immense'],'巨大的'),group('e',['tiny','minute'],'微小的')]});
const allEvidence=round=>[...round.pairs,...round.distractors||[]];
const legacy=round=>{const old=structuredClone(round),ids=new Set(old.pairs.flatMap(pair=>pair.ids));old.items=old.items.filter(item=>ids.has(item.id));delete old.distractors;return old;};
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
test('eight words contain three source-backed pairs and exactly two distractors with no mate',()=>{
 const data=fixture(),rounds=core.buildRounds(data,25,rng(17));assert.equal(rounds.length,25);
 for(const round of rounds){assert.equal(core.validateRound(round,data),true);assert.equal(new Set(round.items.map(item=>item.word)).size,8);assert.equal(round.distractors.length,2);for(const item of round.items)assert.equal(round.items.filter(other=>core.checkPair(round,item.id,other.id)).length,round.distractors.some(d=>d.id===item.id)?0:1);}
});
test('pair checking is order-independent, rejects self, unknown and crossed selections',()=>{
 const round=core.buildRounds(fixture(),1,rng(8))[0],[a,b]=round.pairs[0].ids,c=round.pairs[1].ids[0];assert.ok(core.checkPair(round,a,b));assert.ok(core.checkPair(round,b,a));assert.equal(core.checkPair(round,a,a),false);assert.equal(core.checkPair(round,a,c),false);assert.equal(core.checkPair(round,'missing',b),false);
});
test('source groups sharing words transitively never appear in one round',()=>{
 const data=fixture();data.groups.push(group('bridge',['radiant','luminous'],'灿烂的'),group('more',['luminous','glowing'],'发光的'));
 for(const round of core.buildRounds(data,100,rng(2)))assert.ok(allEvidence(round).filter(pair=>['a','bridge','more'].includes(pair.groupId)).length<=1);
});
test('groups with an overlapping Chinese sense are not mixed',()=>{
 const data=fixture();data.groups.push(group('overlap',['tranquil','placid'],'平静的，安宁的'));
 for(const round of core.buildRounds(data,80,rng(5)))assert.ok(!(allEvidence(round).some(pair=>pair.groupId==='b')&&allEvidence(round).some(pair=>pair.groupId==='overlap')));
});

test('printed article variants do not hide a shared word or create two plausible partners',()=>{
 const data=fixture();
 const variants=[['a','a bright','sparkling'],['d','an immense','vast'],['b','the serene','tranquil']];
 variants.forEach(([id,word,mate],i)=>data.groups.push(group(`article-${id}`,[word,mate],`其他考法${i}`)));
 const before=JSON.stringify(data);
 for(const round of core.buildRounds(data,100,rng(33))){
  for(const [id]of variants)assert.ok(!(allEvidence(round).some(pair=>pair.groupId===id)&&allEvidence(round).some(pair=>pair.groupId===`article-${id}`)));
  assert.equal(new Set(round.items.map(item=>item.word.replace(/^(?:a|an|the)\s+/,''))).size,8);
  assert.ok(core.validateRound(round,data));
 }
 assert.equal(JSON.stringify(data),before);
});
test('count, randomness and insufficient distinct groups are checked',()=>{
 for(const count of [0,-1,1.2,101,'3',NaN])assert.throws(()=>core.buildRounds(fixture(),count));
 assert.throws(()=>core.buildRounds({...fixture(),groups:fixture().groups.slice(0,4)},1));
 assert.throws(()=>core.buildRounds(fixture(),2,()=>1));assert.throws(()=>core.buildRounds(fixture(),2,()=>NaN));
 assert.throws(()=>core.buildRounds({groups:[group('a',['a','b'],'甲'),group('b',['b','c'],'乙'),group('c',['c','d'],'丙')]},1));
});
test('generation does not mutate source objects and supports deterministic fixture RNG',()=>{
 const data=fixture(),before=JSON.stringify(data);assert.deepEqual(core.buildRounds(data,10,rng(77)),core.buildRounds(data,10,rng(77)));assert.equal(JSON.stringify(data),before);
});
test('groups with more than two source equivalents sample a real pair',()=>{
 const data=fixture();data.groups[0].words.push({word:'luminous'});
 for(const round of core.buildRounds(data,20,rng(45)))assert.ok(core.validateRound(round,data));
});
test('progress validation rejects duplicate or missing cards and unknown group IDs',()=>{
 const data=fixture(),base=core.buildRounds(data,1,rng(3))[0];
 const changed=fn=>{const round=structuredClone(base);fn(round);return round;};
 assert.equal(core.validateRound(null),false);assert.equal(core.validateRound(changed(r=>r.items.pop())),false);
 assert.equal(core.validateRound(changed(r=>r.items[1].id=r.items[0].id)),false);assert.equal(core.validateRound(changed(r=>r.items[1].word=r.items[0].word.toUpperCase())),false);
 assert.equal(core.validateRound(changed(r=>r.pairs[1].ids[0]=r.pairs[0].ids[0])),false);
 assert.equal(core.validateRound(changed(r=>r.pairs[0].groupId='invented'),data),false);
});
test('source validation rejects forged meaning, page, cross-group pairs and invented words',()=>{
 const data=fixture(),base=core.buildRounds(data,1,rng(3))[0];
 for(const change of [r=>r.pairs[0].meaning='forged',r=>r.pairs[0].page=999,r=>r.items[0].word='invented',r=>[r.pairs[0].ids[0],r.pairs[1].ids[0]]=[r.pairs[1].ids[0],r.pairs[0].ids[0]]]){const round=structuredClone(base);change(round);assert.equal(core.validateRound(round,data),false);}
});
test('malformed source groups fail before generation',()=>{
 for(const data of [{},{groups:[{id:'x',words:[]}]},{groups:[group('x',['same','same'],'相同')]},{groups:[group('x',['a','b'],'甲'),group('x',['c','d'],'乙')]}])assert.throws(()=>core.buildRounds(data,1));
});
test('source groups marked for review stay in data but are excluded from practice and restored rounds',()=>{
 const data=fixture(),reference=core.buildRounds(data,30,rng(1)).find(round=>round.pairs.some(pair=>pair.groupId==='a'));
 const flagged=fixture();flagged.groups[0].needsReview=true;flagged.groups.push(group('f',['lasting','enduring'],'持久的'));
 for(const round of core.buildRounds(flagged,100,rng(1)))assert.ok(allEvidence(round).every(pair=>pair.groupId!=='a'));
 assert.equal(core.validateRound(reference,flagged),false);assert.equal(flagged.groups.length,6);
});
test('bundled source has 500 original pairs and generated rounds remain unambiguous',()=>{
 const data=require('../dist/equivalence-pairs.json');assert.equal(data.groups.length,500);assert.equal(data.groups.reduce((n,g)=>n+g.words.length,0),1000);
 const excluded=new Set(data.groups.filter(group=>group.needsReview).map(group=>group.id));
 assert.equal(excluded.size,3);
 const key=word=>core.normalize(word).replace(/^(?:a|an|the)\s+/,'');
 const sourceEdges=new Set();
 for(const group of data.groups)for(let i=0;i<group.words.length;i++)for(let j=i+1;j<group.words.length;j++)sourceEdges.add([key(group.words[i].word),key(group.words[j].word)].sort().join('\0'));
 for(const seed of [1,23,987])for(const round of core.buildRounds(data,100,rng(seed))){
  assert.ok(core.validateRound(round,data));assert.equal(round.items.length,8);assert.equal(round.distractors.length,2);assert.ok(allEvidence(round).every(pair=>!excluded.has(pair.groupId)));
  let actualEdges=0;
  for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){
   const a=round.items[i],b=round.items[j],linked=sourceEdges.has([key(a.word),key(b.word)].sort().join('\0'));
   assert.equal(linked,core.checkPair(round,a.id,b.id),'only the intended three edges may occur among all eight cards');
   if(linked)actualEdges++;
  }
  assert.equal(actualEdges,3);
 }

});


test('distractor evidence must uniquely cover the two otherwise unused cards',()=>{
 const data=fixture(),base=core.buildRounds(data,1,rng(48))[0];
 for(const change of [r=>delete r.distractors,r=>r.distractors.pop(),r=>r.distractors.push({...r.distractors[0]}),r=>r.distractors[0].id=r.pairs[0].ids[0],r=>r.distractors[1].id=r.distractors[0].id,r=>r.distractors[0].id='missing',r=>r.distractors[0].groupId=r.pairs[0].groupId,r=>r.distractors[0].meaning='',r=>r.distractors[0].page=0]){
  const round=structuredClone(base);change(round);assert.equal(core.validateRound(round),false);
 }
 for(const change of [r=>r.distractors[0].groupId='invented',r=>r.distractors[0].meaning='forged',r=>r.distractors[0].page=999,r=>r.items.find(item=>item.id===r.distractors[0].id).word='invented']){
  const round=structuredClone(base);change(round);assert.equal(core.validateRound(round,data),false);
 }
 const joined=structuredClone(base),group=data.groups.find(group=>group.id===joined.distractors[0].groupId);
 joined.items.find(item=>item.id===joined.distractors[1].id).word=group.words.find(word=>word.word!==joined.items.find(item=>item.id===joined.distractors[0].id).word).word;
 joined.distractors[1]={...joined.distractors[0],id:joined.distractors[1].id};
 assert.equal(core.validateRound(joined,data),false,'a fourth valid pair is not a valid pair of distractors');
});

test('legacy six-card rounds stay valid and gain distractors without changing original cards or answers',()=>{
 const data=fixture(),original=legacy(core.buildRounds(data,1,rng(91))[0]),before=JSON.stringify(original);
 assert.ok(core.validateRound(original,data));assert.ok(core.validateRound({...original,distractors:[]},data));
 assert.equal(core.validateRound({...original,distractors:null},data),false);
 const upgraded=core.addDistractors(original,data,rng(4));
 assert.equal(upgraded.items.length,8);assert.equal(upgraded.distractors.length,2);assert.ok(core.validateRound(upgraded,data));
 assert.deepEqual(upgraded.pairs,original.pairs);assert.equal(upgraded.id,original.id);
 for(const item of original.items)assert.deepEqual(upgraded.items.find(candidate=>candidate.id===item.id),item);
 assert.equal(JSON.stringify(original),before);
 assert.deepEqual(core.addDistractors(original,data,rng(4)),upgraded,'upgrade remains deterministic under fixture RNG');
 const again=core.addDistractors(upgraded,data,rng(9));assert.deepEqual(again,upgraded);
 again.items[0].word='changed';assert.notEqual(upgraded.items[0].word,'changed');
 assert.throws(()=>core.addDistractors(null,data));
 assert.throws(()=>core.addDistractors(original,{groups:data.groups.filter(group=>original.pairs.some(pair=>pair.groupId===group.id))},rng(2)));
});
