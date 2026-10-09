import {request} from './request';import type {ProactiveCareConfig} from './types';
export default {getProactiveCareConfig:(_aid:string)=>request<ProactiveCareConfig>('/native-memory/proactive'),updateProactiveCareConfig:(_aid:string,body:ProactiveCareConfig)=>request('/native-memory/proactive',{method:'PUT',body:JSON.stringify(body)})};
