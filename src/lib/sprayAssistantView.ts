import type { RecentSpraySession, SpraySessionState } from './spraySession';
import { SPRAY_STATIONS, rateCurrentWeather, type SpraySettings, type SprayWindow, type WeatherSnapshot } from './sprayWeather';

const TIME_ZONE='America/Denver';

export type SprayUi={
  section:HTMLElement;station:HTMLSelectElement;product:HTMLInputElement;notes:HTMLTextAreaElement;equipment:HTMLSelectElement;
  maxWind:HTMLInputElement;maxGust:HTMLInputElement;minRh:HTMLInputElement;minTemp:HTMLInputElement;maxTemp:HTMLInputElement;
  maxPop:HTMLInputElement;dryHours:HTMLInputElement;minWindow:HTMLInputElement;current:HTMLElement;rating:HTMLElement;
  refresh:HTMLButtonElement;forecast:HTMLElement;windows:HTMLElement;session:HTMLElement;start:HTMLButtonElement;stop:HTMLButtonElement;
  snapshot:HTMLButtonElement;recent:HTMLElement;segment:HTMLElement;sprayStatus:HTMLSelectElement;message:HTMLElement;
};

function esc(value:unknown):string{return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function num(value:number|null,digits=0):string{return value===null?'—':value.toFixed(digits);}
function cardinal(value:number|null):string{if(value===null)return'—';const d=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return d[Math.round((((value%360)+360)%360)/22.5)%16];}
export function formatSprayTime(value:string):string{return new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));}
function formatWindow(window:SprayWindow):string{const day=new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,weekday:'short',month:'short',day:'numeric'}).format(new Date(window.startTime));const time=new Intl.DateTimeFormat('en-US',{timeZone:TIME_ZONE,hour:'numeric',minute:'2-digit'});return`${day}, ${time.format(new Date(window.startTime))}–${time.format(new Date(window.endTime))}`;}

function html():string{return`
<h2>Spraying field assistant</h2>
<label>Weather station<select class="spray-station"><option value="auto">Auto — nearest Nisland/Newell station</option>${SPRAY_STATIONS.map(station=>`<option value="${station.id}">${esc(station.name)}</option>`).join('')}</select></label>
<div class="bfid-spray-current"></div><div class="bfid-spray-rating unknown">No current assessment</div>
<button class="spray-refresh wide" type="button">Refresh conditions and spraying windows</button><div class="bfid-spray-forecast-status">Forecast not loaded.</div><div class="bfid-spray-window-list"></div>
<details class="bfid-spray-limits"><summary>Spraying limits and product</summary><div>
<label>Product / mix name<input class="spray-product" placeholder="AquaNeat mix"></label>
<label>Spraying equipment<select class="spray-equipment"><option value="pickup-sprayer">Pickup sprayer</option><option value="atv-sprayer">ATV sprayer</option><option value="tractor-sprayer">Tractor sprayer</option><option value="backpack-sprayer">Backpack / hand sprayer</option></select></label>
<label>Application notes<textarea class="spray-notes" placeholder="Rate, target weeds, nozzle, pressure, additives, field notes"></textarea></label>
<div class="bfid-spray-grid"><label>Maximum wind mph<input class="spray-max-wind" type="number"></label><label>Maximum gust mph<input class="spray-max-gust" type="number"></label><label>Minimum humidity %<input class="spray-min-rh" type="number"></label><label>Minimum temperature °F<input class="spray-min-temp" type="number"></label><label>Maximum temperature °F<input class="spray-max-temp" type="number"></label><label>Maximum precip chance %<input class="spray-max-pop" type="number"></label><label>Required dry time hours<input class="spray-dry-hours" type="number"></label><label>Minimum window hours<input class="spray-min-window" type="number"></label></div>
</div></details>
<div class="bfid-spray-disclaimer">Candidate windows are a planning aid. The pesticide label, on-site wind at application height, direction, gusts, inversion conditions, buffers, rainfast interval, and sensitive downwind areas control the decision.</div>
<div class="bfid-spray-session"><span>No spraying session active.</span></div><div class="bfid-spray-actions"><button class="bfid-spray-start" type="button">Start spraying</button><button class="bfid-spray-stop" type="button" hidden>Stop spraying</button><button class="spray-snapshot" type="button" disabled>Record weather now</button><button class="spray-save" type="button">Save limits</button></div>
<strong>Recent spraying records</strong><div class="bfid-spray-record-list"></div>
<div class="segment-card"><strong>Independent spraying status</strong><span class="spray-segment">No project segment selected.</span></div><label>Spraying state<select class="spray-status" disabled><option value="unsprayed">Unsprayed</option><option value="partial">Partial</option><option value="sprayed">Sprayed</option><option value="needs-return">Needs return</option><option value="skipped">Skipped</option></select></label><div class="bfid-spray-message"></div>`;}

export function createSprayUi(sidebar:HTMLElement):SprayUi{
  const section=document.createElement('section');section.id='bfid-spray-assistant';section.innerHTML=html();
  const portable=[...sidebar.querySelectorAll<HTMLElement>('section')].find(item=>item.querySelector('h2')?.textContent?.trim()==='Portable data');portable?sidebar.insertBefore(section,portable):sidebar.append(section);
  const q=<T extends Element>(selector:string)=>section.querySelector<T>(selector)!;
  return{section,station:q('.spray-station'),product:q('.spray-product'),notes:q('.spray-notes'),equipment:q('.spray-equipment'),maxWind:q('.spray-max-wind'),maxGust:q('.spray-max-gust'),minRh:q('.spray-min-rh'),minTemp:q('.spray-min-temp'),maxTemp:q('.spray-max-temp'),maxPop:q('.spray-max-pop'),dryHours:q('.spray-dry-hours'),minWindow:q('.spray-min-window'),current:q('.bfid-spray-current'),rating:q('.bfid-spray-rating'),refresh:q('.spray-refresh'),forecast:q('.bfid-spray-forecast-status'),windows:q('.bfid-spray-window-list'),session:q('.bfid-spray-session'),start:q('.bfid-spray-start'),stop:q('.bfid-spray-stop'),snapshot:q('.spray-snapshot'),recent:q('.bfid-spray-record-list'),segment:q('.spray-segment'),sprayStatus:q('.spray-status'),message:q('.bfid-spray-message')};
}

export function fillSpraySettings(ui:SprayUi,settings:SpraySettings):void{
  ui.station.value=settings.stationMode;ui.product.value=settings.productName;ui.notes.value=settings.applicationNotes;ui.equipment.value=settings.sprayEquipment;
  ui.maxWind.value=String(settings.maxWindMph);ui.maxGust.value=String(settings.maxGustMph);ui.minRh.value=String(settings.minHumidityPercent);ui.minTemp.value=String(settings.minTemperatureF);ui.maxTemp.value=String(settings.maxTemperatureF);ui.maxPop.value=String(settings.maxPrecipProbabilityPercent);ui.dryHours.value=String(settings.requiredDryHours);ui.minWindow.value=String(settings.minimumWindowHours);
}
function clamp(value:number,min:number,max:number):number{return Math.min(max,Math.max(min,value));}
function input(input:HTMLInputElement,fallback:number):number{const value=Number(input.value);return Number.isFinite(value)?value:fallback;}
export function readSpraySettings(ui:SprayUi):SpraySettings{return{stationMode:ui.station.value,productName:ui.product.value.trim(),applicationNotes:ui.notes.value.trim(),sprayEquipment:ui.equipment.value,maxWindMph:clamp(input(ui.maxWind,10),0,60),maxGustMph:clamp(input(ui.maxGust,15),0,80),minHumidityPercent:clamp(input(ui.minRh,30),0,100),minTemperatureF:clamp(input(ui.minTemp,40),-40,130),maxTemperatureF:clamp(input(ui.maxTemp,90),-40,140),maxPrecipProbabilityPercent:clamp(input(ui.maxPop,20),0,100),requiredDryHours:clamp(Math.round(input(ui.dryHours,6)),0,24),minimumWindowHours:clamp(Math.round(input(ui.minWindow,2)),1,12)};}
export function sprayMessage(ui:SprayUi,text:string,error=false):void{ui.message.textContent=text;ui.message.className=`bfid-spray-message${error?' error':''}`;}

export function renderCurrentWeather(ui:SprayUi,snapshot:WeatherSnapshot|null,settings:SpraySettings):void{
  if(!snapshot){ui.current.innerHTML='<div class="bfid-spray-empty">Current station conditions unavailable.</div>';ui.rating.className='bfid-spray-rating unknown';ui.rating.textContent='No current assessment';return;}
  const station=SPRAY_STATIONS.find(item=>item.id===snapshot.stationId);
  ui.current.innerHTML=`<div class="bfid-spray-reading"><small>Station</small><b>${esc(snapshot.stationName)}</b></div><div class="bfid-spray-reading"><small>Temperature</small><b>${num(snapshot.temperatureF)} °F</b></div><div class="bfid-spray-reading"><small>Humidity</small><b>${num(snapshot.relativeHumidityPercent)}%</b></div><div class="bfid-spray-reading"><small>Wind</small><b>${cardinal(snapshot.windDirectionDegrees)} ${num(snapshot.windSpeedMph)} mph</b></div><div class="bfid-spray-reading"><small>Gust</small><b>${num(snapshot.windGustMph)} mph</b></div><div class="bfid-spray-reading"><small>Rain today</small><b>${num(snapshot.rainTodayInches,2)} in</b></div><div class="bfid-spray-observation-time">${esc(station?.detail??snapshot.stationId)} · observed ${esc(snapshot.observedAt?formatSprayTime(snapshot.observedAt):'time unavailable')}${snapshot.stale?' · stale/cached':''}</div>`;
  const result=rateCurrentWeather(snapshot,settings);const title=result.rating==='good'?'Candidate conditions':result.rating==='marginal'?'Marginal conditions':result.rating==='hold'?'Hold spraying':'Unknown';ui.rating.className=`bfid-spray-rating ${result.rating}`;ui.rating.innerHTML=`<strong>${title}</strong><span>${esc(result.reasons.join(' · '))}</span>`;
}
export function renderSprayWindows(ui:SprayUi,windows:SprayWindow[]):void{ui.windows.innerHTML=windows.length?windows.map(window=>`<article class="bfid-spray-window"><strong>${esc(formatWindow(window))}</strong><span>${window.hours} forecast hours</span><small>wind ≤ ${num(window.maxWindMph)} mph · ${num(window.minTemperatureF)}–${num(window.maxTemperatureF)} °F · humidity ≥ ${num(window.minHumidityPercent)}% · precip ≤ ${num(window.maxPrecipitationPercent)}%</small></article>`).join(''):'<div class="bfid-spray-empty">No forecast period meets every configured limit.</div>';}
export function renderSpraySession(ui:SprayUi,state:SpraySessionState,oldText:string,oldRecording:boolean):void{
  ui.start.hidden=state.active;ui.stop.hidden=!state.active;ui.snapshot.disabled=!state.active;ui.station.disabled=state.active;ui.product.disabled=state.active;ui.notes.disabled=state.active;ui.equipment.disabled=state.active;
  const status=document.querySelector<HTMLElement>('.status-pill');
  if(state.active&&state.session){const minutes=Math.max(0,Math.round((Date.now()-new Date(state.session.startedAt).getTime())/60000));ui.session.className='bfid-spray-session active';ui.session.innerHTML=`<strong>SPRAYING ACTIVE</strong><span>${minutes} min · ${state.pointCount} GPS points · ${state.weatherCount} weather records</span><small>${esc(state.session.productName||'Product not entered')}${state.session.segmentId?` · segment ${esc(state.session.segmentId)}`:''}</small>`;if(status){status.classList.add('recording');status.textContent=`SPRAYING · ${state.pointCount} points · ${state.weatherCount} weather`;}}
  else{ui.session.className='bfid-spray-session';ui.session.innerHTML='<span>No spraying session active.</span>';if(status?.textContent?.startsWith('SPRAYING')){status.textContent=oldText||'Location inactive';status.classList.toggle('recording',oldRecording);}}
}
export function renderRecentSpraying(ui:SprayUi,records:RecentSpraySession[]):void{ui.recent.innerHTML=records.length?records.map(record=>`<article class="bfid-spray-record"><strong>${esc(record.productName||'Spraying session')}</strong><span>${esc(formatSprayTime(record.startedAt))} · ${record.durationMinutes} min</span><small>${record.pointCount} GPS points · ${record.weatherSnapshots?.length??0} weather records${record.segmentId?` · segment ${esc(record.segmentId)}`:''}${record.endedAt?'':' · unfinished'}</small></article>`).join(''):'<div class="bfid-spray-empty">No spraying sessions recorded yet.</div>';}
