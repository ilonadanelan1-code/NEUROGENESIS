import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const BASELINE_SHA = "92eddaab0d914721e7732aae6f8345643216818c";
const datasetPath = process.argv[2];
assert.ok(datasetPath, "pass the pinned RuSRL JSONL path");
const rows = readFileSync(datasetPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
assert.equal(rows.length, 1500, "pinned RuSRL revision must contain 1500 rows");

function loadCore(source) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 5000 });
  assert.equal(typeof sandbox.window.NGSemanticCore?.analyse, "function");
  return sandbox.window.NGSemanticCore;
}
const baselineSource = execFileSync("git", ["show", BASELINE_SHA + ":semantic-core.js"], {
  encoding: "utf8", maxBuffer: 8 * 1024 * 1024
});
const currentSource = readFileSync(new URL("../semantic-core.js", import.meta.url), "utf8");
const baseline = loadCore(baselineSource), current = loadCore(currentSource);

const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase()
  .replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, "");
const goldRoleMap = new Map([
  // Keep only reasonably aligned semantic labels. Generic grammatical/semantic
  // "субъект" is not always an AGENT; "каузат" is an affected outcome (EFFECT),
  // not automatically a PATIENT.
  ["агенс","agent"], ["объект","patient"], ["каузатор","cause"],
  ["каузат","effect"], ["локатив","location"], ["темпоратив","time"],
  ["инструмент","instrument"], ["инструментив","instrument"]
]);
const predictedRoleMap = new Map([
  ["agent","agent"], ["cause","cause"], ["patient","patient"], ["theme","patient"],
  ["effect","effect"], ["location","location"], ["time","time"], ["instrument","instrument"]
]);
function spanPositions(tokens, phrase) {
  const wanted = String(phrase ?? "").split(/\s+/u).map(normalize).filter(Boolean);
  if (!wanted.length) return [];
  const normalized = tokens.map(normalize), found = [];
  for (let start=0; start<=normalized.length-wanted.length; start++) {
    let match=true;
    for (let offset=0; offset<wanted.length; offset++) {
      if (!normalized[start+offset] || normalized[start+offset]!==wanted[offset]) { match=false; break; }
    }
    if (match) for (let offset=0; offset<wanted.length; offset++) found.push(start+offset);
  }
  return found;
}

let malformedRows=0, multiPredicateSkipped=0, noMappedRoleSkipped=0;
const unmappedRoleCounts=Object.create(null);
const frames=[];
for (const row of rows) {
  const {tokens,synt_head:syntHead,sem_head:semHead,sem_role:semRole}=row;
  if (!Array.isArray(tokens)||!Array.isArray(syntHead)||!Array.isArray(semHead)||!Array.isArray(semRole)||
      tokens.length!==syntHead.length||tokens.length!==semHead.length||tokens.length!==semRole.length) {
    malformedRows++; continue;
  }
  const heads=[...new Set(semHead.filter((head,index)=>
    Number.isInteger(head)&&head>=0&&semRole[index]!=="_"))];
  if (heads.length!==1) { multiPredicateSkipped++; continue; }
  const predicateIndex=heads[0];
  if (predicateIndex>=tokens.length) { malformedRows++; continue; }
  const goldArguments=[];
  for(let index=0;index<tokens.length;index++) {
    if(semHead[index]!==predicateIndex) continue;
    const label=semRole[index];
    const role=goldRoleMap.get(label);
    if(role) goldArguments.push({index,role,token:tokens[index]});
    else if(label&&label!=="_") unmappedRoleCounts[label]=(unmappedRoleCounts[label]||0)+1;
  }
  if(!goldArguments.length) { noMappedRoleSkipped++; continue; }
  frames.push({sentId:row.sent_id,tokens,text:tokens.join(" "),
    predicate:tokens[predicateIndex],predicateKey:normalize(tokens[predicateIndex]),
    predicateIndex,goldArguments});
}
assert.ok(frames.length>0,"RuSRL must yield at least one single-predicate frame");
const predicateFrequency=new Map();
for(const frame of frames) predicateFrequency.set(frame.predicateKey,
  (predicateFrequency.get(frame.predicateKey)||0)+1);

function evaluate(core,selectedFrames) {
  let predicateCovered=0,predicateExact=0,frameCovered=0,exactFrames=0;
  let tp=0,fp=0,fn=0,goldArgumentCount=0,analysisErrors=0;
  const roleStats={},errorSamples=[];
  const ensureRole=role=>roleStats[role] ||= {gold:0,truePositive:0,falsePositive:0,falseNegative:0};
  for(const frame of selectedFrames) {
    let proposition=null;
    try { proposition=core.analyse(frame.text,{contextRelation:"new_topic"},null)?.proposition||null; }
    catch { analysisErrors++; }
    const predictedPredicate=normalize(proposition?.predicate);
    const predicateIsExact=!!predictedPredicate&&predictedPredicate===frame.predicateKey;
    if(predictedPredicate) predicateCovered++;
    if(predicateIsExact) predicateExact++;
    const predictedArguments=Array.isArray(proposition?.arguments)?proposition.arguments:[];
    const supportedArguments=predictedArguments.filter(argument=>predictedRoleMap.has(argument.role));
    if(predictedPredicate&&supportedArguments.length) frameCovered++;
    const matchedGold=new Set();
    let frameFalsePositives=0;
    for(const argument of supportedArguments) {
      const role=predictedRoleMap.get(argument.role);
      if(!role) continue;
      const positions=new Set(spanPositions(frame.tokens,argument.text));
      const match=predicateIsExact?frame.goldArguments.find(gold=>
        !matchedGold.has(gold.index+"|"+gold.role)&&gold.role===role&&positions.has(gold.index)):null;
      if(match) {
        matchedGold.add(match.index+"|"+match.role); tp++;
        ensureRole(role).truePositive++;
      } else { fp++; frameFalsePositives++; ensureRole(role).falsePositive++; }
    }
    for(const gold of frame.goldArguments) {
      goldArgumentCount++; ensureRole(gold.role).gold++;
      if(!matchedGold.has(gold.index+"|"+gold.role)) { fn++; ensureRole(gold.role).falseNegative++; }
    }
    if(predicateIsExact&&matchedGold.size===frame.goldArguments.length&&frameFalsePositives===0) exactFrames++;
    if(errorSamples.length<8&&(!predicateIsExact||matchedGold.size!==frame.goldArguments.length||frameFalsePositives)) {
      errorSamples.push({sentId:frame.sentId,text:frame.text.slice(0,220),goldPredicate:frame.predicate,
        predictedPredicate:proposition?.predicate||null,
        goldRoles:frame.goldArguments.map(g=>({role:g.role,token:g.token,index:g.index})),
        predictedRoles:supportedArguments.map(a=>({role:a.role,text:a.text}))});
    }
  }
  const precision=tp+fp?tp/(tp+fp):0,recall=goldArgumentCount?tp/goldArgumentCount:0;
  const f1=precision+recall?2*precision*recall/(precision+recall):0;
  const roleRows=Object.entries(roleStats).map(([role,stats])=>{
    const rolePrecision=stats.truePositive+stats.falsePositive
      ?stats.truePositive/(stats.truePositive+stats.falsePositive):0;
    const roleRecall=stats.gold?stats.truePositive/stats.gold:0;
    const roleF1=rolePrecision+roleRecall?2*rolePrecision*roleRecall/(rolePrecision+roleRecall):0;
    return [role,{...stats,precision:rolePrecision,recall:roleRecall,f1:roleF1}];
  });
  const supportedGoldRoles=roleRows.filter(([,stats])=>stats.gold>0);
  const macroF1=supportedGoldRoles.length
    ?supportedGoldRoles.reduce((sum,[,stats])=>sum+stats.f1,0)/supportedGoldRoles.length:0;
  const total=selectedFrames.length;
  return {
    frames:total,
    predicateCoverage:{covered:predicateCovered,total,rate:total?predicateCovered/total:null},
    predicateExact:{correct:predicateExact,total,accuracy:total?predicateExact/total:null},
    frameCoverage:{covered:frameCovered,total,rate:total?frameCovered/total:null},
    exactFrame:{correct:exactFrames,total,accuracy:total?exactFrames/total:null},
    argumentHeads:{truePositive:tp,falsePositive:fp,falseNegative:fn,gold:goldArgumentCount,
      precision,recall,microF1:f1,macroF1},
    roles:Object.fromEntries(roleRows),analysisErrors,errorSamples
  };
}
const baselineMetrics=evaluate(baseline,frames),experimentMetrics=evaluate(current,frames);
const singletonFrames=frames.filter(frame=>predicateFrequency.get(frame.predicateKey)===1);
const repeatedFrames=frames.filter(frame=>predicateFrequency.get(frame.predicateKey)>1);
const singletonMetrics=evaluate(current,singletonFrames),repeatedMetrics=evaluate(current,repeatedFrames);
assert.equal(malformedRows,0,"pinned RuSRL rows must have aligned token/head/role arrays");
assert.ok(experimentMetrics.argumentHeads.gold>0);
assert.equal(experimentMetrics.analysisErrors,0,"semantic-core must not throw on the external evaluation set");

console.log("NEUROGENESIS RuSRL external semantic-role evaluation: "+JSON.stringify({
  protocol:{dataset:"IsaNLP/RuSRL",revision:"56080b4b6f77c39b0a57147b1025feaabd1d843e",
    license:"CC BY-NC 4.0",publishedRows:rows.length,singlePredicateFrames:frames.length,
    multiPredicateSkipped,noMappedRoleSkipped,malformedRows,unmappedRoleCounts,
    goldRoleSubset:[...new Set(goldRoleMap.keys())],
    predicateForms:predicateFrequency.size,singletonPredicateFrames:singletonFrames.length,
    repeatedPredicateFrames:repeatedFrames.length,evaluationOnly:true,officialTestSplit:false,
    goldSyntaxAnnotationsAvailable:true,goldSyntaxUsedAsInput:false,
    predictedSyntaxAvailable:false,syntaxComparison:"not_performed"},
  baseline:baselineMetrics,experiment:experimentMetrics,
  predicateFrequencySlices:{singleton:singletonMetrics,repeated:repeatedMetrics}
}));
