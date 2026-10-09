import {api} from './api';
export const groups=[
 {id:'values',label:'价值与原则',caption:'我在乎什么',color:'#a6452e',kinds:['principle','value','boundary']},
 {id:'identity',label:'自我定位',caption:'我如何看待自己',color:'#77745f',kinds:['identity']},
 {id:'decision',label:'应对与决策',caption:'我怎样作出选择',color:'#486d70',kinds:['decision']},
 {id:'aspiration',label:'希望成为',caption:'我想走向哪里',color:'#a8824d',kinds:['aspiration']},
 {id:'response',label:'理解与回应',caption:'怎样与我相处',color:'#807083',kinds:['response']}
];
export const kinds:Record<string,string>={principle:'原则',value:'价值',boundary:'边界',identity:'自我定位',decision:'应对与决策',aspiration:'希望成为',response:'理解与回应'};
export type Evidence={atom_id?:string;event_id?:string;quote:string;timestamp:string;available?:boolean;source_type:string;filename?:string;atom_hash?:string};
export type Claim={id:string;version:string;kind:string;title:string;statement:string;conditions:string;exceptions:string;state:string;core_status:string;admitted_at:string;admitted_by:number|null;admitted_version:string;evidence_valid:boolean;merged_into?:string;importance:1|2|3;affinity:1|2|3|4|5;evidence:Evidence[];valid_from?:string;valid_until?:string;history:{version:string;at:string;reason:string;value:Claim}[]};
export type Ontology={revision:string;claims:Claim[];generated_at?:string;outdated:boolean;coverage:{read_atoms:number;eligible_sources:number;independent_events:number;has_more?:boolean};progress?:{status:string}};
export const isCore=(c:Claim)=>c.core_status==='admitted'&&c.state==='confirmed'&&!!c.admitted_at&&c.admitted_by!==null&&c.admitted_version===c.version&&c.evidence_valid&&!c.merged_into&&c.kind!=='situation';
export const isPending=(c:Claim)=>['pending','snoozed'].includes(c.core_status)&&!['withdrawn','dismissed'].includes(c.state)&&!c.merged_into&&c.kind!=='situation';
export function point(c:Claim){const index=Math.max(0,groups.findIndex(g=>g.kinds.includes(c.kind)));let hash=0;for(const ch of c.id)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;const angle=(-90+index*72+((hash%1000)/1000-.5)*48)*Math.PI/180;const distance=220-(c.affinity-1)*33;return {x:300+Math.cos(angle)*distance,y:300+Math.sin(angle)*distance,r:[0,9,14,18][c.importance],distance,color:groups[index].color};}
export type Command={action:string;expected_version:string;request_id:string;[key:string]:unknown};
export async function saveNode(id:string,command:Command){
 const result=await api<{status:string;changed_id:string;ontology:Ontology}>('/ontology/nodes/'+encodeURIComponent(id),'POST',command);
 if(result.status!=='ready')throw new Error('这项理解或它的来源已发生变化。草稿已保留，请重新读取并核对。');
 const fresh=await api<Ontology>('/ontology');
 const committed=result.ontology.claims.find(c=>c.id===result.changed_id);
 if(committed&&fresh.claims.find(c=>c.id===result.changed_id)?.version!==committed.version)throw new Error('保存后的版本尚未核对成功，草稿已保留。请刷新确认。');
 return fresh;
}

/** Resolve collisions angularly inside each category, never change semantic distance. */
export function layoutPoints(claims:Claim[]){
 const placed=new Map<string,ReturnType<typeof point>>();
 for(const c of [...claims].sort((a,b)=>a.id.localeCompare(b.id))){
  const base=point(c),index=Math.max(0,groups.findIndex(g=>g.kinds.includes(c.kind))),center=(-90+index*72)*Math.PI/180;
  const original=Math.atan2(base.y-300,base.x-300);let chosen=base,best=-Infinity;
  for(const step of [0,1,-1,2,-2,3,-3,4,-4,5,-5,6,-6]){
   const angle=original+step*5*Math.PI/180;
   const diff=Math.atan2(Math.sin(angle-center),Math.cos(angle-center));if(Math.abs(diff)>32*Math.PI/180)continue;
   const candidate={...base,x:300+Math.cos(angle)*base.distance,y:300+Math.sin(angle)*base.distance};
   const clearance=Math.min(...[...placed.values()].map(p=>Math.hypot(p.x-candidate.x,p.y-candidate.y)-p.r-base.r));
   if(clearance>best){chosen=candidate;best=clearance;}if(clearance>=18)break;
  }
  placed.set(c.id,chosen);
 }
 return placed;
}
