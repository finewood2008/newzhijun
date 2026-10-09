import {useEffect,useState} from 'react';import {request} from '../api/request';
export function useServerTimezone(){const [zone,setZone]=useState('UTC');useEffect(()=>{let live=true;request<{timezone:string}>('/native-memory/timezone').then(v=>{if(live)setZone(v.timezone||'UTC')}).catch(()=>{});return()=>{live=false}},[]);return zone;}
