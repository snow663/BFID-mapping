import './sprayAssistant.css';
import { getSetting, putSetting } from './db';
import { createSprayUi, fillSpraySettings, readSpraySettings, renderCurrentWeather, renderRecentSpraying, renderSpraySession, renderSprayWindows, sprayMessage, type SprayUi } from './sprayAssistantView';
import { DEFAULT_SPRAY_SETTINGS, chooseSprayStation, fetchHourlyForecast, fetchStationWeather, findSprayWindows, type SprayPosition, type SpraySettings, type WeatherSnapshot } from './sprayWeather';
import { captureSprayWeather, getRecentSpraySessions, getSegmentSprayStatus, getSpraySessionState, setSegmentSprayStatus, startSpraySession, stopSpraySession, type SprayStatus } from './spraySession';

const FLAG='__bfidSprayAssistantInstalled';
const SETTINGS_KEY='sprayAssistantSettings';
let ui:SprayUi|null=null;
let settings:SpraySettings={...DEFAULT_SPRAY_SETTINGS};
let currentSnapshot:WeatherSnapshot|null=null;
let selectedSegmentId:string|null=null;
let selectedSegmentName='';
let statusTimer:number|null=null;
let oldStatusText='';
let oldStatusRecording=false;

async function loadSettings():Promise<void>{try{const raw=await getSetting(SETTINGS_KEY,'');settings={...DEFAULT_SPRAY_SETTINGS,...(raw?JSON.parse(raw):{})};}catch{settings={...DEFAULT_SPRAY_SETTINGS};}}
async function saveSettings():Promise<void>{if(!ui)return;settings=readSpraySettings(ui);await putSetting(SETTINGS_KEY,JSON.stringify(settings));}
function oneShotPosition():Promise<SprayPosition>{return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('Location services unavailable.'));navigator.geolocation.getCurrentPosition(result=>resolve({longitude:result.coords.longitude,latitude:result.coords.latitude,accuracy:result.coords.accuracy,altitude:result.coords.altitude,heading:result.coords.heading,speed:result.coords.speed,timestamp:result.timestamp,source:'gps'}),reject,{enableHighAccuracy:true,maximumAge:1000,timeout:15000});});}

async function refreshWeather():Promise<void>{
  if(!ui)return;ui.refresh.disabled=true;ui.forecast.textContent='Updating station conditions and hourly forecast…';
  try{
    await saveSettings();let position=getSpraySessionState().position;
    if(!position){try{position=await oneShotPosition();}catch{const station=chooseSprayStation(settings.stationMode,null);position={longitude:station.longitude,latitude:station.latitude,timestamp:Date.now(),source:'gps'};}}
    const station=chooseSprayStation(settings.stationMode,position);const [snapshot,periods]=await Promise.all([fetchStationWeather(station,'manual',position),fetchHourlyForecast(position)]);
    currentSnapshot=snapshot;renderCurrentWeather(ui,snapshot,settings);renderSprayWindows(ui,findSprayWindows(periods,settings));ui.forecast.textContent=`Forecast centered near ${position.latitude.toFixed(3)}, ${position.longitude.toFixed(3)} · ${periods.length} NWS hourly periods checked.`;
  }catch(error){ui.forecast.textContent=error instanceof Error?error.message:'Weather update failed.';renderSprayWindows(ui,[]);}finally{ui.refresh.disabled=false;}
}

function appRecordingActive():boolean{const status=document.querySelector<HTMLElement>('.status-pill.recording');return Boolean(status&&!status.textContent?.startsWith('SPRAYING'));}
function otherButtons():HTMLButtonElement[]{return[...document.querySelectorAll<HTMLButtonElement>('.sidebar button')].filter(button=>['Record travel','Record mowing','Start building road'].includes(button.textContent?.trim()??''));}
function lockOtherActivities(active:boolean):void{for(const button of otherButtons()){if(active){if(button.dataset.sprayOldDisabled===undefined)button.dataset.sprayOldDisabled=String(button.disabled);button.disabled=true;button.title='Finish spraying first.';}else if(button.dataset.sprayOldDisabled!==undefined){button.disabled=button.dataset.sprayOldDisabled==='true';delete button.dataset.sprayOldDisabled;button.removeAttribute('title');}}}
function sessionChanged():void{if(!ui)return;const state=getSpraySessionState();renderSpraySession(ui,state,oldStatusText,oldStatusRecording);lockOtherActivities(state.active);}
async function renderRecent():Promise<void>{if(ui)renderRecentSpraying(ui,await getRecentSpraySessions());}

async function start():Promise<void>{
  if(!ui)return;if(appRecordingActive()){sprayMessage(ui,'Finish the active travel, mowing, or mapping recording before starting spraying.',true);return;}
  await saveSettings();ui.start.disabled=true;sprayMessage(ui,'Waiting for a high-accuracy GPS fix…');const status=document.querySelector<HTMLElement>('.status-pill');oldStatusText=status?.textContent??'';oldStatusRecording=status?.classList.contains('recording')??false;
  try{await startSpraySession(settings,selectedSegmentId,sessionChanged);sessionChanged();sprayMessage(ui,'Spraying started. Start weather is recorded when the station is available.');if(statusTimer===null)statusTimer=window.setInterval(sessionChanged,1000);}catch(error){sprayMessage(ui,error instanceof Error?error.message:'Unable to start spraying.',true);}finally{ui.start.disabled=false;}
}
async function stop():Promise<void>{if(!ui)return;await stopSpraySession();if(statusTimer!==null)window.clearInterval(statusTimer);statusTimer=null;sessionChanged();await renderRecent();sprayMessage(ui,'Spraying session saved independently from mowing.');}
async function snapshot():Promise<void>{if(!ui)return;ui.snapshot.disabled=true;try{currentSnapshot=await captureSprayWeather('manual');renderCurrentWeather(ui,currentSnapshot,settings);sprayMessage(ui,'Weather snapshot recorded.');}catch(error){sprayMessage(ui,error instanceof Error?error.message:'Weather snapshot failed.',true);}finally{ui.snapshot.disabled=false;}}

function selectedSegment():{id:string|null;name:string}{const section=[...document.querySelectorAll<HTMLElement>('.sidebar section')].find(item=>item.querySelector('h2')?.textContent?.trim()==='Selected segment');return{id:section?.querySelector('code')?.textContent?.trim()||null,name:section?.querySelector('.segment-card strong')?.textContent?.trim()||''};}
async function syncSegment():Promise<void>{if(!ui)return;const next=selectedSegment();if(next.id===selectedSegmentId&&next.name===selectedSegmentName)return;selectedSegmentId=next.id;selectedSegmentName=next.name;if(!next.id){ui.segment.textContent='No project segment selected.';ui.sprayStatus.disabled=true;ui.sprayStatus.value='unsprayed';return;}ui.segment.textContent=next.name||next.id;ui.sprayStatus.disabled=false;ui.sprayStatus.value=await getSegmentSprayStatus(next.id);}
async function updateSegmentStatus():Promise<void>{if(!ui||!selectedSegmentId)return;await setSegmentSprayStatus(selectedSegmentId,ui.sprayStatus.value as SprayStatus);sprayMessage(ui,`${selectedSegmentName||selectedSegmentId}: spraying state updated.`);}

async function mountAssistant():Promise<void>{
  if(document.getElementById('bfid-spray-assistant'))return;const sidebar=document.querySelector<HTMLElement>('.sidebar');if(!sidebar){window.setTimeout(()=>void mountAssistant(),100);return;}
  ui=createSprayUi(sidebar);await loadSettings();fillSpraySettings(ui,settings);
  ui.refresh.onclick=()=>void refreshWeather();ui.start.onclick=()=>void start();ui.stop.onclick=()=>void stop();ui.snapshot.onclick=()=>void snapshot();ui.section.querySelector<HTMLButtonElement>('.spray-save')!.onclick=()=>void saveSettings().then(()=>{if(ui){renderCurrentWeather(ui,currentSnapshot,settings);sprayMessage(ui,'Spraying limits saved.');}});ui.station.onchange=()=>void refreshWeather();ui.sprayStatus.onchange=()=>void updateSegmentStatus();
  document.addEventListener('click',event=>{if(!getSpraySessionState().active||!ui)return;const text=(event.target instanceof Element?event.target.closest('button')?.textContent:'')?.trim();if(['Record travel','Record mowing','Start building road'].includes(text??'')){event.preventDefault();event.stopImmediatePropagation();sprayMessage(ui,'Finish spraying before starting another field activity.',true);}},true);
  new MutationObserver(()=>{void syncSegment();lockOtherActivities(getSpraySessionState().active);}).observe(sidebar,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled']});
  await syncSegment();await renderRecent();sessionChanged();void refreshWeather();
}

export function installSprayAssistant():void{const state=window as unknown as Record<string,unknown>;if(state[FLAG])return;state[FLAG]=true;document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>void mountAssistant(),{once:true}):void mountAssistant();}
