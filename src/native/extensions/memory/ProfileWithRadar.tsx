import {useState,type ComponentProps} from 'react';
import ProfileOverview from '../../pages/Agent/Memory/ProfileOverview';
import {OntologyRadar} from '../../../OntologyRadar';
export default function ProfileWithRadar(props:ComponentProps<typeof ProfileOverview>){
 const [tab,setTab]=useState('ontology');
 return <><div className="profile-subtabs" role="tablist" aria-label="用户画像内容"><button role="tab" aria-selected={tab==='ontology'} onClick={()=>setTab('ontology')}>本体雷达</button><button role="tab" aria-selected={tab==='memory'} onClick={()=>setTab('memory')}>记忆资料</button></div>{tab==='ontology'?<OntologyRadar/>:<ProfileOverview {...props}/>}</>;
}
