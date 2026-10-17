  (function () {
    "use strict";
    var STORAGE="pad-pedal-seamless-v3", DB_NAME="pad-pedal-samples-v3", DB_STORE="samples", KEYS=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"], STOCK_VOICES=["Warm Pad","Ambient Pad","Worship Swell","Dream Choir","Heavenly Pad","Soft Strings","Shimmer Pad","Gentle Pluck"], EQ_COLORS=["#61e7b2","#7caeff","#ffcf66","#ff8b8b","#d998ff","#64e5f0"];
    var PAD_COUNT=8;
    var selected=0, editingInput=false, editingBand=0, currentWaveBuffer=null, waveDrag=null, wavePeaks=new Map(), saveTimer=0, trimRestartTimer=0, project;
    function id(){return "p_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,9);} function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)));} function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(char){return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char];});}
    function keyOptions(select){select.innerHTML=KEYS.map(function(key){return '<option value="'+key+'">'+key.replace("#","♯")+"</option>";}).join("");}
    function defaultBands(){var s=[["highpass",55,0,.7,24],["lowshelf",140,0,.8,12],["peaking",430,0,1.1,12],["peaking",1300,0,1.1,12],["highshelf",4400,0,.8,12],["lowpass",16000,0,.7,12]];return s.map(function(b){return {enabled:true,type:b[0],freq:b[1],gain:b[2],q:b[3],slope:b[4]};});}

    // ---------------------------------------------------------------
    // Data model. Every pad (and the audio-input channel) owns a full
    // copy of every effect, so each pad is a complete saved sound.
    // ---------------------------------------------------------------
    var FX_NAMES=["eq","compressor","drive","filter","phaser","chorus","tremolo","width","delay","reverb","lfo","texture"];
    function defaultEffects(){return {
      eq:{enabled:true,bands:defaultBands()},
      compressor:{enabled:false,type:"VCA",threshold:-22,ratio:3,attack:20,release:220,knee:8,makeup:0,mix:100},
      drive:{enabled:false,type:"tape",amount:30,tone:9000,mix:100},
      filter:{enabled:false,type:"lowpass",freq:2400,q:3,rate:.2,sync:"off",depth:40,wave:"sine"},
      phaser:{enabled:false,stages:6,rate:.25,sync:"off",depth:60,feedback:35,mix:50},
      chorus:{enabled:false,depth:4,frequency:12,rate:.35,mix:30},
      tremolo:{enabled:false,mode:"tremolo",rate:4,sync:"1/8",depth:40,wave:"sine"},
      width:{enabled:false,width:150,haas:30},
      delay:{enabled:false,type:"regular",bpm:72,sync:true,division:".5",send:25,feedback:30,tone:6000},
      reverb:{enabled:true,type:"hall",predelay:28,wet:32,dry:100,decay:4.2,lowCut:100,highCut:12000,shimmer:0},
      lfo:{enabled:false,target:"volume",wave:"sine",rate:.25,depth:12,amount:50},
      texture:{enabled:false,type:"choir",volume:20,highPass:120,lowPass:11000}
    };}
    function defaultPad(index){var names=["Warm Pad","Ambient Clouds","Worship Swell","Dream Choir","Soft Strings","Shimmer Pad","Gentle Pluck","Cinematic Swell"], voices=["Warm Pad","Ambient Pad","Worship Swell","Dream Choir","Soft Strings","Shimmer Pad","Gentle Pluck","Cinematic Swell"];return {id:id(),name:names[index]||"Pad "+(index+1),key:"C",rootKey:"C",voice:voices[index]||"Warm Pad",chord:"auto",sampleId:null,level:72,crossfade:160,trimStart:0,trimEnd:1,loop:true,octaves:{sub:0,up:0},swell:{attack:0,breathe:0,rate:.08},effects:defaultEffects()};}
    function defaultInput(){var p=defaultPad(0);p.id="input";p.name="Audio input";p.isInput=true;p.enabled=false;p.voice="Input";p.level=80;p.effects.reverb.wet=28;return p;}
    function defaultPerformance(){return {volume:.85,tone:1,reverb:.5,fade:.5,morph:.5,exprTarget:"swell",layerMode:false};}
    function defaultRouting(){return {mode:"mono4",buses:{tracks:{ch:1},pad:{ch:2},click:{ch:3},instrument:{ch:4}},clickFallback:"off",mainDevice:null,clickDevice:null};}
    function normalizeRouting(r){var d=defaultRouting();if(!r||typeof r!=="object")return d;
      if(!r.mode){ // v4 routing (clickMode) -> v5
        var cm=r.clickMode||"auto";d.clickFallback=cm==="mix"||cm==="split"||cm==="device"||cm==="off"?cm:"off";d.mainDevice=r.mainDevice||null;d.clickDevice=r.clickDevice||null;return d;}
      var out={mode:r.mode==="stereo"?"stereo":"mono4",buses:{},clickFallback:["off","mix","split","device"].indexOf(r.clickFallback)>-1?r.clickFallback:"off",mainDevice:r.mainDevice||null,clickDevice:r.clickDevice||null};
      Object.keys(d.buses).forEach(function(k){var b=r.buses&&r.buses[k];var ch=b&&isFinite(Number(b.ch))?Math.round(Number(b.ch)):d.buses[k].ch;out.buses[k]={ch:clamp(ch,0,32)};});return out;}
    function defaultProject(){return {version:6,setlistId:id(),tracksMode:false,textures:[],routing:defaultRouting(),audio:{sampleRate:0,latency:"interactive"},instrument:{},midiOut:{},link:{enabled:false},mapping:{},projector:{},display:{},name:"My Central Control set",selected:0,theme:{bg:"#08111d",panel:"#101e31",text:"#ecf7ff",accent:"#5de6b0",blue:"#75adff",line:"#294966"},pads:Array.from({length:PAD_COUNT},function(_,i){return defaultPad(i);}),library:[],performance:defaultPerformance(),tempo:{bpm:72},songs:[],songIndex:-1,input:defaultInput(),midi:{channel:0,clock:true}};}
    function mergeInto(base,saved){
      if(!saved||typeof saved!=="object")return base;
      var fx=saved.effects||{},p=Object.assign(base,saved);
      p.effects=defaultEffects();
      FX_NAMES.forEach(function(name){p.effects[name]=Object.assign(p.effects[name],fx[name]||{});});
      p.effects.eq.bands=Array.isArray(fx.eq&&fx.eq.bands)&&fx.eq.bands.length===6?fx.eq.bands.map(function(b,n){return Object.assign(defaultBands()[n],b);}):defaultBands();
      p.octaves=Object.assign({sub:0,up:0},saved.octaves||{});p.swell=Object.assign({attack:0,breathe:0,rate:.08},saved.swell||{});
      p.level=clamp(p.level,0,100);p.crossfade=clamp(p.crossfade,40,600);p.trimStart=clamp(p.trimStart,0,.98);p.trimEnd=clamp(p.trimEnd,.02,1);if(p.trimEnd<=p.trimStart)p.trimEnd=Math.min(1,p.trimStart+.02);
      if(KEYS.indexOf(p.key)<0)p.key="C";if(KEYS.indexOf(p.rootKey)<0)p.rootKey="C";if(!p.id)p.id=id();
      if(p.effects.delay.bpm&&saved.effects&&saved.effects.delay&&saved.effects.delay.sync===undefined)p.effects.delay.sync=false; // older projects kept their own delay tempo
      return p;}
    function mergePad(saved,index){return mergeInto(defaultPad(index),saved);}
    function normalizeProject(value){var base=defaultProject();if(!value||!Array.isArray(value.pads))return base;
      base.name=typeof value.name==="string"?value.name:base.name;base.setlistId=typeof value.setlistId==="string"&&value.setlistId?value.setlistId:id();base.selected=clamp(value.selected||0,0,PAD_COUNT-1);base.theme=Object.assign(base.theme,value.theme||{});
      var perf=value.performance||{};Object.keys(base.performance).forEach(function(k){if(typeof base.performance[k]==="number"){var v=Number(perf[k]);if(isFinite(v))base.performance[k]=clamp(v,0,1);}else if(perf[k]!==undefined)base.performance[k]=perf[k];});
      base.pads=Array.from({length:PAD_COUNT},function(_,i){return mergePad(value.pads[i],i);});
      base.library=Array.isArray(value.library)?value.library.filter(function(item){return item&&item.id&&item.name;}):[];
      base.tempo={bpm:clamp((value.tempo&&value.tempo.bpm)||72,30,300)};
      base.songs=Array.isArray(value.songs)?value.songs.filter(function(s){return s&&typeof s.name==="string";}).map(function(s){return Object.assign({},s,{id:s.id||id(),name:s.name,key:KEYS.indexOf(s.key)>-1?s.key:"C",bpm:clamp(s.bpm||72,30,300),pad:clamp(s.pad==null?-1:s.pad,-1,PAD_COUNT-1),notes:typeof s.notes==="string"?s.notes:""});}):[];
      base.songIndex=clamp(value.songIndex==null?-1:value.songIndex,-1,base.songs.length-1);
      base.input=mergeInto(defaultInput(),value.input);base.input.id="input";base.input.isInput=true;base.input.voice="Input";
      base.midi=Object.assign(base.midi,value.midi||{});
      ["textures","routing","audio","instrument","ui","midiOut","link","mapping","projector","display","inputs","midiInputs","setups","songSetups"].forEach(function(k){if(value[k]&&typeof value[k]==="object")base[k]=value[k];});["setupCurrent","setupDefault"].forEach(function(k){if(typeof value[k]==="string")base[k]=value[k];});base.routing=normalizeRouting(base.routing);base.tracksMode=!!value.tracksMode;
      if(Array.isArray(value.globalPads))base.globalPads=Array.from({length:PAD_COUNT},function(_,i){return mergePad(value.globalPads[i],i);});base.usingSongPads=value.usingSongPads||null;
      return base;}
    function loadProject(){try{return normalizeProject(JSON.parse(localStorage.getItem(STORAGE)));}catch(_){return defaultProject();}} function persistSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(function(){project.selected=selected;localStorage.setItem(STORAGE,JSON.stringify(project));mirrorSoon();},100);} function persistNow(){clearTimeout(saveTimer);project.selected=selected;localStorage.setItem(STORAGE,JSON.stringify(project));mirrorSoon();}
    // the project is also kept on the driver (/data/pad-pedal/project.json) so backups have it and a fresh card gets it back
    var mirrorTimer=null,mirrorBusy=false,mirrorDirty=false;
    function mirrorSoon(){clearTimeout(mirrorTimer);mirrorTimer=setTimeout(mirrorNow,1500);}
    function mirrorNow(){var b=window.__pedalBridge;if(!b||!b.connected||!localStorage.getItem(STORAGE))return;if(mirrorBusy){mirrorDirty=true;return;}mirrorBusy=true;fetch("http://127.0.0.1:8766/project",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(project)}).catch(function(){}).then(function(){mirrorBusy=false;if(mirrorDirty){mirrorDirty=false;mirrorSoon();}});}
    // a browser with no project yet (new card, restored backup) takes the driver's copy
    function adoptDriverProject(){var b=window.__pedalBridge;if(!b||!b.connected)return;if(localStorage.getItem(STORAGE))return;fetch("http://127.0.0.1:8766/project",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){if(j&&Array.isArray(j.pads)&&!localStorage.getItem(STORAGE)){localStorage.setItem(STORAGE,JSON.stringify(j));location.reload();}}).catch(function(){});} function currentPad(){return editingInput?project.input:project.pads[selected];}
    function getPath(obj,path){return path.split(".").reduce(function(value,part){return value==null?undefined:value[part];},obj);} function setPath(obj,path,value){var parts=path.split("."),target=obj;parts.slice(0,-1).forEach(function(part){target=target[part];});target[parts[parts.length-1]]=value;} function controlValue(control){if(control.type==="checkbox")return control.checked;if(control.type==="range"||control.type==="number")return Number(control.value);return control.value;}
    function formatValue(path,value){
      if(typeof value!=="number")return value;var v=Number(value),parts=path.split("."),last=parts[parts.length-1],fx=parts[0]==="effects"?parts[1]:"";
      if(/threshold|makeup|knee/.test(last))return v.toFixed(1)+" dB";if(last==="ratio")return v.toFixed(1)+":1";if(/attack|release|predelay/.test(last)&&path!=="swell.attack")return Math.round(v)+" ms";
      if(path==="swell.attack")return v<.05?"Preset":v.toFixed(1)+" s";if(fx==="chorus"&&(last==="frequency"||last==="depth"))return v.toFixed(1)+" ms";
      if(/freq|Cut|Pass/.test(last)||last==="tone")return v>=1000?(v/1000).toFixed(v>=10000?0:1)+" kHz":Math.round(v)+" Hz";
      if(last==="decay")return v.toFixed(1)+" s";if(last==="rate")return v.toFixed(2)+" Hz";if(last==="q")return v.toFixed(1);if(last==="bpm")return Math.round(v)+" BPM";
      if(path==="crossfade")return Math.round(v)+" ms";return Math.round(v)+"%";}

    var sampleMemory=new Map(), decodedSamples=new Map(), dbPromise;
    function openDb(){if(dbPromise)return dbPromise;dbPromise=new Promise(function(resolve){if(!window.indexedDB){resolve(null);return;}var req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=function(){req.result.createObjectStore(DB_STORE);};req.onsuccess=function(){resolve(req.result);};req.onerror=function(){resolve(null);};});return dbPromise;}
    async function storeBlob(sampleId,blob){sampleMemory.set(sampleId,blob);var db=await openDb();if(!db)return;await new Promise(function(resolve){var tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).put(blob,sampleId);tx.oncomplete=resolve;tx.onerror=resolve;});}
    async function getBlob(sampleId){if(sampleMemory.has(sampleId))return sampleMemory.get(sampleId);var db=await openDb();if(!db)return null;return new Promise(function(resolve){var tx=db.transaction(DB_STORE,"readonly"),request=tx.objectStore(DB_STORE).get(sampleId);request.onsuccess=function(){if(request.result)sampleMemory.set(sampleId,request.result);resolve(request.result||null);};request.onerror=function(){resolve(null);};});}
    async function clearBlobs(){sampleMemory.clear();decodedSamples.clear();var db=await openDb();if(!db)return;await new Promise(function(resolve){var tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).clear();tx.oncomplete=resolve;tx.onerror=resolve;});}
    function dataUrl(blob){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=reject;reader.readAsDataURL(blob);});} function dataUrlBlob(url){var parts=url.split(","),match=parts[0].match(/data:(.*?);base64/),type=match?match[1]:"application/octet-stream",bytes=atob(parts[1]||""),array=new Uint8Array(bytes.length);for(var i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);return new Blob([array],{type:type});}
    // =================================================================
    // Built-in pad library (synthesized, so every pad works in all 12
    // keys with no samples). Layers: [wave, gain, detune in cents].
    // =================================================================
    var CHORDS={root:[0],fifth:[0,7],open:[0,7,12],sus2:[0,2,7],sus4:[0,5,7],major:[0,4,7],minor:[0,3,7],add9:[0,4,7,14]};
    var CHORD_NAMES={auto:"Preset default",root:"Single note",fifth:"Root + 5th",open:"Open 5th + octave",sus2:"Sus2",sus4:"Sus4",major:"Major",minor:"Minor",add9:"Add9"};
    var PAD_LIBRARY={
      "Warm Pad":{layers:[["sine",.55,-7],["triangle",.34,0],["sine",.28,8]],unison:1,spread:6,tone:4400,attack:.18,air:0,motion:.12,chord:"fifth"},
      "Ambient Pad":{layers:[["sine",.45,-13],["triangle",.3,0],["sawtooth",.13,11]],unison:2,spread:14,tone:2700,attack:.36,air:.05,motion:.25,chord:"open"},
      "Worship Swell":{layers:[["sine",.46,-8],["sine",.42,0],["triangle",.22,8]],unison:2,spread:10,tone:3600,attack:.9,air:.03,motion:.18,chord:"fifth"},
      "Dream Choir":{layers:[["sawtooth",.26,-6],["sawtooth",.24,6]],unison:2,spread:9,tone:3600,attack:.5,air:.08,motion:.2,chord:"fifth",formants:[[700,7],[1150,8],[2700,9]]},
      "Heavenly Pad":{layers:[["sine",.38,-15],["triangle",.3,0],["sawtooth",.08,15]],unison:2,spread:18,tone:5200,attack:.5,air:.1,motion:.2,chord:"open"},
      "Soft Strings":{layers:[["sawtooth",.15,-5],["sawtooth",.13,5],["triangle",.25,0]],unison:2,spread:12,tone:2200,attack:.35,air:.02,motion:.1,chord:"fifth"},
      "Shimmer Pad":{layers:[["sine",.32,-12],["sine",.27,0],["triangle",.18,1212]],unison:2,spread:12,tone:6200,attack:.3,air:.12,motion:.3,chord:"open"},
      "Gentle Pluck":{layers:[["triangle",.45,-3],["sine",.25,4],["sine",.14,1200]],unison:1,spread:4,tone:4800,attack:.02,air:0,motion:0,chord:"fifth"},
      "Analog Warmth":{layers:[["sawtooth",.17,-9],["sawtooth",.17,9],["square",.06,-1200]],unison:2,spread:16,tone:1800,attack:.4,air:.02,motion:.35,chord:"fifth"},
      "Deep Drone":{layers:[["sine",.5,0],["triangle",.25,-1200],["sawtooth",.05,5]],unison:1,spread:5,tone:1400,attack:1.5,air:.04,motion:.15,chord:"open"},
      "Air Pad":{layers:[["sine",.3,0],["sine",.16,1902]],unison:1,spread:4,tone:9000,attack:1.2,air:.35,motion:.4,chord:"fifth"},
      "Organ Wash":{layers:[["sine",.35,0],["sine",.2,1200],["sine",.12,1902],["sine",.1,2400]],unison:1,spread:3,tone:6000,attack:.25,air:.02,motion:.08,chord:"fifth"},
      "Glass Pad":{layers:[["triangle",.3,0],["sine",.2,2400],["sine",.08,3102]],unison:2,spread:7,tone:8000,attack:.35,air:.06,motion:.22,chord:"sus2"},
      "Cinematic Swell":{layers:[["sawtooth",.14,-10],["sawtooth",.14,10],["sine",.35,-1200]],unison:2,spread:20,tone:2600,attack:2.2,air:.08,motion:.3,chord:"open"},
      "Velvet Pad":{layers:[["triangle",.4,-4],["sine",.3,5],["triangle",.12,1200]],unison:2,spread:8,tone:3000,attack:.45,air:.02,motion:.14,chord:"fifth"},
      "Morning Light":{layers:[["sine",.4,-9],["triangle",.3,0],["sine",.2,1207],["sine",.08,2400]],unison:2,spread:11,tone:5600,attack:.7,air:.09,motion:.22,chord:"add9"},
      "Cathedral Air":{layers:[["sine",.4,0],["sine",.22,1200],["sine",.15,1902],["triangle",.1,2400]],unison:2,spread:7,tone:5000,attack:1.4,air:.14,motion:.12,chord:"open"},
      "Evening Strings":{layers:[["sawtooth",.13,-7],["sawtooth",.13,7],["sawtooth",.08,1205],["triangle",.2,0]],unison:3,spread:14,tone:2400,attack:.6,air:.03,motion:.16,chord:"major"},
      "Sub Bloom":{layers:[["sine",.6,-1200],["triangle",.25,0],["sine",.1,7]],unison:1,spread:4,tone:1600,attack:1.8,air:.02,motion:.1,chord:"root"},
      "Crystal Choir":{layers:[["sawtooth",.2,-5],["sawtooth",.2,5],["sine",.18,1200]],unison:2,spread:9,tone:4200,attack:.6,air:.1,motion:.2,chord:"fifth",formants:[[600,8],[1000,9],[2500,10]]},
      "Warm Brass Pad":{layers:[["sawtooth",.22,-6],["sawtooth",.22,6],["square",.05,0]],unison:2,spread:10,tone:2100,attack:.3,air:.01,motion:.1,chord:"fifth",formants:[[500,6],[1500,7]]},
      "Hollow Wood":{layers:[["square",.18,-3],["triangle",.3,0],["sine",.2,-1200]],unison:1,spread:5,tone:1900,attack:.25,air:0,motion:.08,chord:"fifth"},
      "Vapor":{layers:[["sine",.3,-20],["sine",.3,20],["triangle",.1,1200]],unison:3,spread:24,tone:3400,attack:1.1,air:.2,motion:.45,chord:"sus2"},
      "Golden Hour":{layers:[["triangle",.3,-8],["sawtooth",.1,8],["sine",.25,1200],["sine",.12,1902]],unison:2,spread:12,tone:4600,attack:.9,air:.07,motion:.24,chord:"add9"},
      "Ocean Pad":{layers:[["sine",.4,-11],["triangle",.28,11],["sawtooth",.07,0]],unison:3,spread:18,tone:2300,attack:1.6,air:.25,motion:.5,chord:"open"},
      "Starlight":{layers:[["sine",.25,0],["sine",.2,1200],["sine",.15,2400],["sine",.08,3600]],unison:2,spread:6,tone:9000,attack:.5,air:.15,motion:.3,chord:"sus2"},
      "Soft Square":{layers:[["square",.12,-4],["square",.12,4],["sine",.3,0]],unison:2,spread:8,tone:1700,attack:.4,air:0,motion:.12,chord:"fifth"},
      "Celestial Organ":{layers:[["sine",.3,0],["sine",.22,1200],["sine",.18,1902],["sine",.12,2400],["sine",.08,2786]],unison:1,spread:2,tone:7000,attack:.15,air:.03,motion:.05,chord:"fifth"},
      "Dusty Tape":{layers:[["triangle",.35,-14],["triangle",.3,9],["sine",.15,-1200]],unison:2,spread:16,tone:2000,attack:.5,air:.04,motion:.38,chord:"fifth"},
      "Lo-fi Keys Pad":{layers:[["triangle",.3,-6],["square",.06,6],["sine",.3,1200]],unison:1,spread:9,tone:2600,attack:.08,air:.01,motion:.2,chord:"major"},
      "Horizon":{layers:[["sawtooth",.1,-12],["sawtooth",.1,12],["sine",.4,0],["sine",.15,1200]],unison:3,spread:22,tone:3000,attack:2.6,air:.1,motion:.2,chord:"open"},
      "Silk":{layers:[["sine",.45,-3],["sine",.35,3],["triangle",.1,1200]],unison:2,spread:5,tone:3800,attack:.6,air:.05,motion:.1,chord:"fifth"},
      "Thick Saw Wall":{layers:[["sawtooth",.16,-16],["sawtooth",.16,16],["sawtooth",.12,-1200],["sawtooth",.1,1205]],unison:3,spread:20,tone:2800,attack:.5,air:.03,motion:.18,chord:"open"},
      "Angelic":{layers:[["sine",.3,-6],["sine",.3,6],["triangle",.18,1200],["sine",.1,2400]],unison:3,spread:10,tone:6400,attack:1,air:.18,motion:.26,chord:"major",formants:[[800,7],[1200,8],[3000,9]]},
      "Flute Air":{layers:[["sine",.5,0],["triangle",.15,1200],["sine",.1,1902]],unison:1,spread:3,tone:4000,attack:.35,air:.3,motion:.3,chord:"root"},
      "Glassy Bells":{layers:[["sine",.3,0],["sine",.2,2400],["sine",.12,3102],["triangle",.08,3600]],unison:2,spread:6,tone:9500,attack:.05,air:.08,motion:.25,chord:"sus2"},
      "Low Drift":{layers:[["triangle",.4,-1200],["sine",.3,-1195],["sawtooth",.06,0]],unison:2,spread:12,tone:1300,attack:2,air:.05,motion:.3,chord:"fifth"},
      "Pulse Pad":{layers:[["sawtooth",.15,-8],["sawtooth",.15,8],["sine",.3,0]],unison:2,spread:10,tone:3200,attack:.2,air:.02,motion:.9,chord:"fifth"},
      "Whisper":{layers:[["sine",.3,0],["sine",.12,1200]],unison:2,spread:8,tone:3600,attack:1.4,air:.45,motion:.35,chord:"root"},
      "Ember":{layers:[["sawtooth",.12,-9],["triangle",.3,9],["sine",.3,-1200],["square",.04,0]],unison:2,spread:13,tone:1900,attack:.7,air:.04,motion:.2,chord:"minor"},
      "Deep Space":{layers:[["sine",.45,-1200],["sine",.25,-13],["sine",.2,13],["triangle",.08,1200]],unison:3,spread:26,tone:2200,attack:3,air:.12,motion:.4,chord:"open"},
      "Bright Worship":{layers:[["sawtooth",.14,-5],["sawtooth",.14,5],["sine",.3,1200],["sine",.1,1902]],unison:2,spread:9,tone:5200,attack:.8,air:.08,motion:.18,chord:"add9"},
      "Minor Mood":{layers:[["triangle",.3,-7],["sawtooth",.1,7],["sine",.3,0],["sine",.1,1200]],unison:2,spread:11,tone:2800,attack:.9,air:.05,motion:.2,chord:"minor"},
      "Open Fifths Wall":{layers:[["sawtooth",.13,-10],["sawtooth",.13,10],["triangle",.25,0],["sine",.3,-1200],["sine",.1,1200]],unison:3,spread:18,tone:3000,attack:1.2,air:.06,motion:.2,chord:"open"},
      "Sunrise Shimmer":{layers:[["sine",.3,-10],["sine",.28,0],["triangle",.16,1210],["sine",.1,2402]],unison:3,spread:14,tone:7200,attack:.6,air:.14,motion:.32,chord:"open"},
      "Harmonium":{layers:[["sawtooth",.12,-4],["sawtooth",.12,4],["square",.08,0],["sine",.2,1200]],unison:2,spread:6,tone:3300,attack:.2,air:.03,motion:.07,chord:"fifth",formants:[[700,5],[1800,6]]},
      "Night Choir":{layers:[["sawtooth",.18,-7],["sawtooth",.18,7],["sine",.2,-1200]],unison:3,spread:12,tone:2600,attack:1.2,air:.09,motion:.22,chord:"minor",formants:[[650,8],[1100,9],[2600,9]]},
      "Prayer Pad":{layers:[["sine",.42,-5],["sine",.4,4],["triangle",.14,1200]],unison:2,spread:7,tone:3100,attack:1.6,air:.06,motion:.12,chord:"fifth"},
      "Big Build":{layers:[["sawtooth",.16,-12],["sawtooth",.16,12],["sawtooth",.1,-1200],["sine",.25,0],["square",.05,1200]],unison:3,spread:22,tone:4200,attack:3.5,air:.1,motion:.25,chord:"open"},
      "Sunrise Strings":{layers:[["sawtooth",.13,-6],["sawtooth",.13,6],["triangle",.22,1200]],unison:3,spread:14,tone:3400,attack:1.4,air:.04,motion:.16,chord:"open"},
      "Cello Bed":{layers:[["sawtooth",.18,-4],["sawtooth",.16,4],["sine",.3,-1200]],unison:2,spread:9,tone:1500,attack:.8,air:.01,motion:.08,chord:"fifth"},
      "Felt Keys Pad":{layers:[["triangle",.4,0],["sine",.26,1200],["sine",.1,1902]],unison:1,spread:3,tone:2600,attack:.06,air:.02,motion:.05,chord:"add9"},
      "Rhodes Bed":{layers:[["sine",.42,0],["triangle",.18,1200],["sine",.1,2786]],unison:1,spread:4,tone:3200,attack:.04,air:.01,motion:.12,chord:"major"},
      "Bowed Glass":{layers:[["sine",.3,0],["triangle",.22,1902],["sine",.12,2400]],unison:2,spread:6,tone:7400,attack:1.8,air:.14,motion:.3,chord:"sus2"},
      "Wide Saw Pad":{layers:[["sawtooth",.15,-14],["sawtooth",.15,14],["sawtooth",.08,0]],unison:3,spread:26,tone:3800,attack:.6,air:.05,motion:.28,chord:"open"},
      "Lush Supersaw":{layers:[["sawtooth",.12,-18],["sawtooth",.12,18],["sawtooth",.1,-7],["sawtooth",.1,7]],unison:3,spread:30,tone:5200,attack:.9,air:.08,motion:.3,chord:"open"},
      "Soft Brass Pad":{layers:[["sawtooth",.2,-3],["square",.06,3],["triangle",.2,-1200]],unison:2,spread:8,tone:2000,attack:.5,air:.01,motion:.08,chord:"fifth"},
      "Warm Low Strings":{layers:[["sawtooth",.18,-8],["sawtooth",.16,8],["sine",.32,-1200]],unison:2,spread:12,tone:1200,attack:1.1,air:.02,motion:.1,chord:"fifth"},
      "Breath Pad":{layers:[["sine",.3,0],["triangle",.18,700]],unison:2,spread:10,tone:5400,attack:1.4,air:.45,motion:.35,chord:"sus2"},
      "Heaven Choir":{layers:[["sawtooth",.2,-8],["sawtooth",.2,8],["triangle",.18,1200]],unison:3,spread:14,tone:3800,attack:1.3,air:.12,motion:.24,chord:"open",formants:[[800,7],[1200,8],[2800,9]]},
      "Aah Choir":{layers:[["sawtooth",.22,-5],["sawtooth",.22,5]],unison:2,spread:9,tone:3000,attack:.7,air:.06,motion:.15,chord:"major",formants:[[730,8],[1090,9],[2440,9]]},
      "Ooh Choir":{layers:[["sawtooth",.22,-5],["sawtooth",.22,5]],unison:2,spread:9,tone:2400,attack:.8,air:.05,motion:.14,chord:"fifth",formants:[[300,8],[870,9],[2240,9]]},
      "Minor Mist":{layers:[["sine",.4,-9],["triangle",.28,0],["sine",.14,1200]],unison:2,spread:12,tone:2800,attack:1.2,air:.08,motion:.24,chord:"minor"},
      "Sus Bloom":{layers:[["triangle",.34,-6],["sine",.32,6],["sine",.12,1902]],unison:2,spread:10,tone:4400,attack:.9,air:.07,motion:.2,chord:"sus4"},
      "Add9 Glow":{layers:[["sine",.36,-7],["triangle",.28,7],["sine",.1,2400]],unison:2,spread:9,tone:4600,attack:.7,air:.06,motion:.18,chord:"add9"},
      "Root Drone":{layers:[["sine",.55,0],["sine",.25,-1200],["triangle",.1,1200]],unison:1,spread:2,tone:1800,attack:2,air:.03,motion:.1,chord:"root"},
      "Fifths Drone":{layers:[["sine",.45,0],["triangle",.2,-1200]],unison:1,spread:3,tone:2400,attack:2.4,air:.05,motion:.12,chord:"fifth"},
      "Tape Pad":{layers:[["triangle",.32,-10],["sawtooth",.1,10],["sine",.24,0]],unison:2,spread:16,tone:2100,attack:.6,air:.06,motion:.45,chord:"fifth"},
      "Vinyl Keys":{layers:[["triangle",.36,0],["sine",.2,1200]],unison:1,spread:5,tone:2300,attack:.03,air:.1,motion:.2,chord:"major"},
      "Crystal Bells":{layers:[["sine",.3,0],["sine",.2,2400],["sine",.12,3486],["triangle",.08,1200]],unison:1,spread:4,tone:9000,attack:.01,air:.04,motion:.06,chord:"add9"},
      "Music Box":{layers:[["triangle",.36,1200],["sine",.2,2400]],unison:1,spread:2,tone:8000,attack:.005,air:.02,motion:0,chord:"major"},
      "Ocean Swell":{layers:[["sine",.36,-12],["triangle",.24,12],["sawtooth",.06,-1200]],unison:2,spread:22,tone:2200,attack:3,air:.25,motion:.5,chord:"open"},
      "Starfield":{layers:[["sine",.26,0],["sine",.18,1902],["sine",.12,3102],["triangle",.08,2400]],unison:2,spread:14,tone:9500,attack:1.6,air:.3,motion:.4,chord:"sus2"},
      "Dark Cathedral":{layers:[["sawtooth",.12,-10],["sine",.4,-1200],["sine",.2,0]],unison:2,spread:12,tone:1300,attack:2.2,air:.08,motion:.15,chord:"minor"},
      "Grand Organ":{layers:[["sine",.3,0],["sine",.22,1200],["sine",.16,1902],["sine",.12,2400],["sine",.08,-1200]],unison:1,spread:2,tone:7000,attack:.12,air:.01,motion:.04,chord:"major"},
      "Gospel Organ":{layers:[["sine",.34,0],["sine",.26,1200],["sine",.2,1902],["square",.04,2400]],unison:1,spread:3,tone:5200,attack:.05,air:.01,motion:.3,chord:"major"},
      "Synth Strings 80s":{layers:[["sawtooth",.15,-8],["sawtooth",.15,8],["square",.05,0]],unison:3,spread:18,tone:4200,attack:.5,air:.03,motion:.3,chord:"open"},
      "Warm Sub Bed":{layers:[["sine",.6,-1200],["triangle",.18,0]],unison:1,spread:2,tone:900,attack:1.4,air:0,motion:.06,chord:"root"},
      "Evening Pad":{layers:[["triangle",.34,-6],["sine",.34,6],["sawtooth",.06,-1200]],unison:2,spread:11,tone:2500,attack:1.1,air:.05,motion:.18,chord:"fifth"},
      "Hope Pad":{layers:[["sine",.38,-8],["triangle",.3,8],["sine",.12,1902]],unison:2,spread:12,tone:4800,attack:1.3,air:.08,motion:.22,chord:"add9"},
      "Selah":{layers:[["sine",.42,-4],["sine",.36,4],["triangle",.1,2400]],unison:2,spread:8,tone:3600,attack:2.6,air:.12,motion:.2,chord:"sus2"},
      // ---- v8.1: 40 more
      "Shimmer Rise":{layers:[["sine",.3,-7],["triangle",.24,7],["sine",.14,1200],["sine",.08,2400]],unison:2,spread:14,tone:7400,attack:2.4,air:.16,motion:.32,chord:"open"},
      "Shimmer Halo":{layers:[["sine",.3,0],["sine",.18,1902],["sine",.12,2400],["triangle",.06,3102]],unison:3,spread:16,tone:9800,attack:1.8,air:.22,motion:.38,chord:"sus2"},
      "Octave Shimmer":{layers:[["triangle",.32,0],["sine",.2,1200],["sine",.12,2400]],unison:2,spread:10,tone:8200,attack:1.2,air:.14,motion:.28,chord:"fifth"},
      "Glass Shimmer":{layers:[["sine",.26,-5],["sine",.2,1205],["triangle",.1,2398]],unison:2,spread:9,tone:9000,attack:.9,air:.1,motion:.3,chord:"add9"},
      "Cloud Shimmer":{layers:[["sine",.34,-12],["sine",.24,12],["sine",.1,1902]],unison:3,spread:20,tone:6800,attack:3.2,air:.28,motion:.42,chord:"open"},
      "Angel Choir":{layers:[["sawtooth",.18,-7],["sawtooth",.18,7],["sine",.16,1200]],unison:3,spread:12,tone:4200,attack:1.1,air:.1,motion:.2,chord:"major",formants:[[750,7],[1150,8],[2700,9]]},
      "Soft Ooh":{layers:[["triangle",.24,-4],["sawtooth",.14,4]],unison:2,spread:8,tone:2000,attack:1,air:.05,motion:.12,chord:"fifth",formants:[[320,8],[800,9],[2300,9]]},
      "Ee Choir":{layers:[["sawtooth",.2,-6],["sawtooth",.2,6]],unison:2,spread:10,tone:4400,attack:.8,air:.06,motion:.16,chord:"add9",formants:[[270,8],[2300,10],[3000,10]]},
      "Boys Choir":{layers:[["triangle",.26,0],["sawtooth",.12,1200]],unison:2,spread:7,tone:5200,attack:.9,air:.08,motion:.14,chord:"open",formants:[[500,8],[1500,9],[2800,10]]},
      "Mass Choir":{layers:[["sawtooth",.16,-11],["sawtooth",.16,11],["sawtooth",.1,-1200]],unison:3,spread:20,tone:3400,attack:1.4,air:.1,motion:.26,chord:"major",formants:[[700,7],[1100,8],[2600,9]]},
      "Whisper Choir":{layers:[["sine",.22,-3],["triangle",.18,3]],unison:2,spread:10,tone:3000,attack:2,air:.38,motion:.2,chord:"sus2",formants:[[650,6],[1080,7],[2650,8]]},
      "Warm Strings":{layers:[["sawtooth",.14,-6],["sawtooth",.14,6],["triangle",.2,0]],unison:3,spread:12,tone:2600,attack:.7,air:.02,motion:.12,chord:"major"},
      "Cinema Strings":{layers:[["sawtooth",.13,-9],["sawtooth",.13,9],["sawtooth",.08,-1200]],unison:3,spread:18,tone:3200,attack:1.6,air:.04,motion:.18,chord:"open"},
      "Chamber Strings":{layers:[["sawtooth",.12,-4],["sawtooth",.12,4],["triangle",.16,1200]],unison:2,spread:8,tone:3800,attack:.45,air:.02,motion:.1,chord:"fifth"},
      "Cello Bed":{layers:[["sawtooth",.18,-5],["triangle",.24,-1200]],unison:2,spread:8,tone:1500,attack:.9,air:.02,motion:.1,chord:"fifth"},
      "Violin Air":{layers:[["sawtooth",.1,-7],["sawtooth",.1,7],["sine",.16,1200]],unison:3,spread:14,tone:6200,attack:1.3,air:.09,motion:.24,chord:"add9"},
      "Pizz Pulse":{layers:[["triangle",.4,0],["sine",.2,1200]],unison:1,spread:3,tone:3200,attack:.008,air:0,motion:0,chord:"major"},
      "Analog Brass Pad":{layers:[["sawtooth",.18,-5],["sawtooth",.18,5],["square",.06,-1200]],unison:2,spread:10,tone:2800,attack:.25,air:.01,motion:.15,chord:"major"},
      "Juno Pad":{layers:[["sawtooth",.16,-7],["square",.1,7],["sine",.2,-1200]],unison:3,spread:16,tone:2300,attack:.5,air:.03,motion:.45,chord:"open"},
      "Prophet Sweep":{layers:[["sawtooth",.18,-10],["sawtooth",.18,10]],unison:2,spread:14,tone:1700,attack:1.2,air:.02,motion:.6,chord:"fifth"},
      "OB Warmth":{layers:[["sawtooth",.17,-8],["sawtooth",.17,8],["triangle",.12,-1200]],unison:3,spread:18,tone:2000,attack:.8,air:.03,motion:.35,chord:"major"},
      "Poly Glow":{layers:[["square",.12,-6],["square",.12,6],["sine",.22,0]],unison:2,spread:12,tone:3000,attack:.6,air:.04,motion:.3,chord:"add9"},
      "Wide Saw Wall":{layers:[["sawtooth",.13,-15],["sawtooth",.13,15],["sawtooth",.1,0]],unison:3,spread:26,tone:3600,attack:.9,air:.04,motion:.25,chord:"open"},
      "Mellow Analog":{layers:[["triangle",.3,-6],["square",.07,6],["sine",.24,-1200]],unison:2,spread:9,tone:1600,attack:.7,air:.02,motion:.2,chord:"fifth"},
      "Sync Lead Pad":{layers:[["sawtooth",.16,0],["square",.1,702]],unison:2,spread:8,tone:4200,attack:.3,air:.02,motion:.4,chord:"fifth"},
      "Infinite Swell":{layers:[["sine",.38,-10],["triangle",.26,10],["sine",.12,1902]],unison:3,spread:18,tone:3400,attack:4.5,air:.16,motion:.35,chord:"open"},
      "Slow Bloom":{layers:[["triangle",.32,-6],["sine",.32,6],["sine",.1,2400]],unison:2,spread:12,tone:4600,attack:3.6,air:.1,motion:.24,chord:"add9"},
      "Tidal Pad":{layers:[["sine",.34,-14],["sine",.24,14],["triangle",.08,-1200]],unison:3,spread:24,tone:2600,attack:2.8,air:.24,motion:.62,chord:"fifth"},
      "Aurora":{layers:[["sine",.28,0],["sine",.2,1902],["triangle",.12,2400],["sine",.08,3486]],unison:3,spread:20,tone:8600,attack:2.6,air:.26,motion:.48,chord:"sus2"},
      "Deep Space":{layers:[["sine",.42,-1200],["sine",.22,0],["triangle",.08,1902]],unison:2,spread:16,tone:1900,attack:3.4,air:.18,motion:.4,chord:"open"},
      "Morning Mist":{layers:[["sine",.36,-5],["triangle",.24,5],["sine",.12,1200]],unison:2,spread:12,tone:3800,attack:2.2,air:.22,motion:.26,chord:"sus4"},
      "Still Waters":{layers:[["sine",.44,0],["sine",.24,1200]],unison:1,spread:6,tone:2600,attack:2.8,air:.12,motion:.14,chord:"fifth"},
      "Wilderness":{layers:[["triangle",.3,-8],["sawtooth",.06,8],["sine",.24,-1200]],unison:2,spread:14,tone:2200,attack:2.4,air:.2,motion:.3,chord:"minor"},
      "Lament":{layers:[["sine",.36,-6],["triangle",.26,6],["sine",.1,1200]],unison:2,spread:10,tone:2400,attack:1.8,air:.08,motion:.18,chord:"minor"},
      "Night Watch":{layers:[["triangle",.28,-9],["sine",.3,0],["sawtooth",.05,-1200]],unison:2,spread:12,tone:1500,attack:2.2,air:.1,motion:.22,chord:"minor"},
      "Breath Pad":{layers:[["sine",.3,-4],["sine",.26,4]],unison:2,spread:8,tone:3200,attack:1.6,air:.42,motion:.26,chord:"fifth"},
      "Felt Pad":{layers:[["triangle",.36,-3],["sine",.28,3]],unison:1,spread:5,tone:1700,attack:.9,air:.06,motion:.12,chord:"major"},
      "Bell Pad":{layers:[["sine",.3,0],["sine",.16,2400],["sine",.1,3486],["triangle",.18,-1200]],unison:2,spread:8,tone:7600,attack:.4,air:.06,motion:.16,chord:"add9"},
      "Harp Glow":{layers:[["triangle",.36,0],["sine",.18,1200],["sine",.08,1902]],unison:1,spread:4,tone:5600,attack:.01,air:.04,motion:.05,chord:"add9"},
      "Organ Swell":{layers:[["sine",.3,0],["sine",.22,1200],["sine",.14,1902],["sine",.1,2400]],unison:1,spread:3,tone:5400,attack:1.4,air:.02,motion:.1,chord:"fifth"}
    };
    STOCK_VOICES=Object.keys(PAD_LIBRARY);
    function noteIndex(key){return Math.max(0,KEYS.indexOf(key));}
    function profileFor(voice){return PAD_LIBRARY[voice]||PAD_LIBRARY["Warm Pad"];}
    function chordFor(pad){var name=pad.chord&&pad.chord!=="auto"?pad.chord:profileFor(pad.voice).chord;return CHORDS[name]||CHORDS.fifth;}
    function activeSong(){return project.songs[project.songIndex]||null;}
    function playKeyFor(pad){var song=activeSong();return song?song.key:pad.key;}

    // ----- tempo -----------------------------------------------------
    var DIVISIONS={"1/1":4,"1/2":2,"1/4":1,"1/4.":1.5,"1/8":.5,"1/8.":.75,"1/8T":1/3,"1/16":.25};
    function tempoBpm(){return clamp((project.tempo&&project.tempo.bpm)||72,30,300);}
    function syncedRate(rate,sync){if(!sync||sync==="off")return rate;return tempoBpm()/60/(DIVISIONS[sync]||1);}

    // ----- performance macros (knobs) ----------------------------------
    var expressionValue=1;
    function volumeGain(v){return 1.1*Math.pow(clamp(v,0,1),1.6);} function toneHz(v){return 250*Math.pow(80,clamp(v,0,1));} function swellGain(v){return .12+.88*clamp(v,0,1);}
    function reverbMult(){return clamp(project.performance.reverb,0,1)*2;} function fadeMult(v){v=clamp(v,0,1);return v<.5?Math.pow(2,(v-.5)*4):Math.pow(2,(v-.5)*8);}
    function fadeSeconds(pad){return clamp(clamp(pad.crossfade,40,600)/1000*fadeMult(project.performance.fade),.03,12);}
    function smoothParam(param,value,time){param.cancelScheduledValues(time);param.setTargetAtTime(value,time,.03);}

    // ----- waveshaper curves (drive + compressor colour) ---------------
    var curveCache=new Map();
    function shaperCurve(kind,amount){
      var key=kind+":"+Math.round(amount);if(curveCache.has(key))return curveCache.get(key);
      var n=2048,c=new Float32Array(n),k=1+clamp(amount,0,100)/100*(kind==="fuzz"?40:kind==="tube"?8:kind==="fet"?5:6);
      for(var i=0;i<n;i++){var x=i/(n-1)*2-1,y=x;
        if(kind==="tape")y=Math.atan(k*x)/Math.atan(k);
        else if(kind==="tube")y=x>=0?(1-Math.exp(-k*x))/(1-Math.exp(-k)):-(1-Math.exp(k*.6*x))/(1-Math.exp(-k*.6));
        else if(kind==="fet")y=Math.tanh(k*x)/Math.tanh(k);
        else if(kind==="opto")y=Math.tanh(1.3*x)/Math.tanh(1.3);
        else if(kind==="fuzz"){var h=Math.tanh(k*x);y=(h<0?-1:1)*Math.pow(Math.abs(h),.6);}
        else if(kind==="lofi"){var steps=Math.pow(2,Math.max(2,Math.round(12-clamp(amount,0,100)/100*9))-1);y=Math.round(x*steps)/steps;}
        c[i]=y;}
      curveCache.set(key,c);return c;}

    // ----- compressor types --------------------------------------------
    var COMP_TYPES={
      VCA:{label:"Clean (VCA)",color:"clean",drive:0,desc:"Transparent and precise: does exactly what the controls say."},
      FET:{label:"Punchy (FET)",color:"fet",drive:35,desc:"Very fast attack with bite and grit. Pushes a pad forward in the mix."},
      Opto:{label:"Smooth (Opto)",color:"opto",drive:10,desc:"Slow and gentle. Evens out swells without pumping."},
      VariMu:{label:"Warm (Vari-Mu)",color:"tube",drive:25,desc:"Very soft knee and tube warmth. Thickens and glues."},
      Bus:{label:"Glue (Bus)",color:"clean",drive:0,desc:"Gentle ratio and medium timing. Holds layered sounds together."},
      Limiter:{label:"Limiter",color:"clean",drive:0,desc:"Brick-wall ceiling at the threshold. Nothing gets louder than it."}
    };
    function compSettings(c){
      var t=COMP_TYPES[c.type]?c.type:"VCA",a=clamp(c.attack,0,300),r=clamp(c.release,20,1200),k=clamp(c.knee,0,40),ratio=clamp(c.ratio,1,20);
      if(t==="FET"){a=Math.min(a,6);r=Math.min(r,250);k=Math.min(k,4);}
      if(t==="Opto"){a=Math.max(a,30);r=Math.max(r,450);k=Math.max(k,18);}
      if(t==="VariMu"){a=Math.max(a,15);r=Math.max(r,300);k=Math.max(k,28);ratio=Math.min(ratio,6);}
      if(t==="Bus"){a=clamp(a,10,30);r=clamp(r,100,600);k=6;ratio=clamp(ratio,1.5,4);}
      if(t==="Limiter"){a=1;r=clamp(r,30,200);k=0;ratio=20;}
      return {type:t,threshold:clamp(c.threshold,-60,0),ratio:ratio,attack:a,release:Math.min(r,1000),knee:k,makeup:clamp(c.makeup,0,24),mix:clamp(c.mix==null?100:c.mix,0,100),color:COMP_TYPES[t].color,drive:COMP_TYPES[t].drive};}
    // Static output level (dB) for an input level (dB): the curve the compressor draws.
    function compOutDb(s,x){var t=s.threshold,k=s.knee,r=s.ratio;if(2*(x-t)<-k)return x;if(k>0&&2*Math.abs(x-t)<=k)return x+(1/r-1)*Math.pow(x-t+k/2,2)/(2*k);return t+(x-t)/r;}

    // ----- pitch shifter (for shimmer): two crossfaded sweeping delay taps -----
    function buildPitchShifter(c,semitones){
      var ratio=Math.pow(2,semitones/12),W=.06,f=(ratio-1)/W,input=c.createGain(),output=c.createGain();
      var cosWave=c.createPeriodicWave(new Float32Array([0,1]),new Float32Array([0,0]),{disableNormalization:true});
      var taps=[0,1].map(function(){var d=c.createDelay(.2),dg=c.createGain(),saw=c.createOscillator(),sawAmt=c.createGain(),win=c.createOscillator(),winAmt=c.createGain();
        saw.type="sawtooth";saw.frequency.value=f;sawAmt.gain.value=-W/2;d.delayTime.value=W/2;saw.connect(sawAmt).connect(d.delayTime);
        win.setPeriodicWave(cosWave);win.frequency.value=f;winAmt.gain.value=.5;dg.gain.value=.5;win.connect(winAmt).connect(dg.gain);
        input.connect(d).connect(dg).connect(output);return [saw,win];});
      return {input:input,output:output,start:function(t){taps[0].forEach(function(o){o.start(t);});taps[1].forEach(function(o){o.start(t+.5/f);});},nodes:taps[0].concat(taps[1])};}

    // =================================================================
    // Audio engine: master bus, meters, voices, layers, morph, freeze
    // =================================================================
    function AudioEngine(){this.ctx=null;this.master=null;this.limiter=null;this.active=null;this.layers=[];this.releasing=[];this.lastStopAt=-99;this.impulses=new Map();this.noise=new Map();this.meterRunning=false;this.playRequest=0;this.morph=null;this.frozen=null;this.inputVoice=null;this.hooks=[];this.routing={mode:"off",channels:2};}
    AudioEngine.prototype.context=function(){
      if(this.ctx)return this.ctx;
      var ao=project.audio||{},opts={latencyHint:["interactive","balanced","playback"].indexOf(ao.latency)>-1?ao.latency:"interactive"};if(ao.sampleRate>0)opts.sampleRate=ao.sampleRate;var c;try{c=new (window.AudioContext||window.webkitAudioContext)(opts);}catch(_){c=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});}this.ctx=c;
      this.master=c.createGain();this.master.gain.value=volumeGain(project.performance.volume);
      this.swell=c.createGain();this.swell.gain.value=swellGain(expressionValue);
      this.tone=c.createBiquadFilter();this.tone.type="lowpass";this.tone.Q.value=.5;this.tone.frequency.value=toneHz(project.performance.tone);
      this.limiter=c.createDynamicsCompressor();this.limiter.threshold.value=-3;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.12;
      // Buses: pad (pads + textures + audio input), tracks, click (+ MD voice). The instrument bus is native (PipeWire) on the Central Control OS.
      this.mainMix=c.createGain();this.tracksBus=c.createGain();this.texturesBus=c.createGain();this.clickBus=c.createGain();this.outGain=c.createGain();
      this.tracksLimiter=c.createDynamicsCompressor();this.tracksLimiter.threshold.value=-1;this.tracksLimiter.knee.value=0;this.tracksLimiter.ratio.value=20;this.tracksLimiter.attack.value=.002;this.tracksLimiter.release.value=.1;this.tracksOut=c.createGain();
      this.master.connect(this.swell).connect(this.tone).connect(this.mainMix);this.texturesBus.connect(this.mainMix);this.mainMix.connect(this.limiter).connect(this.outGain);
      this.tracksBus.connect(this.tracksLimiter).connect(this.tracksOut);this.routeOutput();
      // Meters + analysers: pre-limiter (how hard we drive it) and post-limiter (what leaves the Pi)
      this.spectrum=c.createAnalyser();this.spectrum.fftSize=4096;this.spectrum.smoothingTimeConstant=.82;this.mainMix.connect(this.spectrum);
      this.preSplit=c.createChannelSplitter(2);this.preL=c.createAnalyser();this.preR=c.createAnalyser();this.mainMix.connect(this.preSplit);this.preSplit.connect(this.preL,0);this.preSplit.connect(this.preR,1);
      this.postSplit=c.createChannelSplitter(2);this.postL=c.createAnalyser();this.postR=c.createAnalyser();this.limiter.connect(this.postSplit);this.postSplit.connect(this.postL,0);this.postSplit.connect(this.postR,1);
      [this.preL,this.preR,this.postL,this.postR].forEach(function(a){a.fftSize=2048;});
      this.setupFreezeRecorder();
      var self=this;this.hooks.forEach(function(hook){try{hook(self);}catch(error){console.warn("engine hook failed",error);}});
      return c;};
    // Where the sound goes. Default "mono4": four mono outputs - 1 tracks, 2 pads, 3 click + MD voice, 4 instrument
    // (the Pad Pedal OS makes one multi-channel output out of the headphone jack, the I2S DAC and any USB interface).
    // "stereo": each bus on a stereo pair. On a plain 2-channel device the buses that don't fit are mixed into 1-2
    // (click: into the mix, to another device, left/right split, or off - project.routing.clickFallback).
    AudioEngine.prototype.routeOutput=function(){var c=this.ctx;if(!c)return;var r=project.routing=normalizeRouting(project.routing);
      var self=this;[this.outGain,this.tracksOut,this.clickBus].forEach(function(n){try{n.disconnect();}catch(_){}});
      (this.routeNodes||[]).forEach(function(n){try{n.disconnect();}catch(_){}});this.routeNodes=[];this.merger=null;
      var maxCh=Math.max(1,c.destination.maxChannelCount||2),stereo=r.mode==="stereo",need=0;
      var buses={tracks:this.tracksOut,pad:this.outGain,click:this.clickBus};if(this.loopOut){try{this.loopOut.disconnect();}catch(_){}buses.instrument=this.loopOut;}var directs=(this.directOuts||[]).filter(function(d){return d.node&&d.ch>0;});
      directs.forEach(function(d){try{d.node.disconnect();}catch(_){}need=Math.max(need,d.ch);});
      Object.keys(buses).forEach(function(k){var ch=r.buses[k]?r.buses[k].ch:0;if(ch>0)need=Math.max(need,ch+(stereo?1:0));});
      var multi=maxCh>2&&need>2;
      this.routing={mode:multi?r.mode:"stereo2",channels:maxCh,wanted:r.mode,need:need,buses:{}};
      if(multi){var n=Math.min(maxCh,Math.max(2,need));try{c.destination.channelCount=n;c.destination.channelCountMode="explicit";c.destination.channelInterpretation="discrete";}catch(_){}
        var m=this.merger=c.createChannelMerger(n);this.routeNodes.push(m);
        Object.keys(buses).forEach(function(k){var ch=r.buses[k]?r.buses[k].ch:0,node=buses[k];if(!(ch>0)||ch>n){self.routing.buses[k]="off";return;}
          if(stereo&&ch<n){var sp=c.createChannelSplitter(2);node.connect(sp);sp.connect(m,0,ch-1);sp.connect(m,1,ch);self.routeNodes.push(sp);self.routing.buses[k]=ch+"-"+(ch+1);}
          else{var mono=c.createGain();mono.channelCount=1;mono.channelCountMode="explicit";mono.channelInterpretation="speakers";node.connect(mono);mono.connect(m,0,ch-1);self.routeNodes.push(mono);self.routing.buses[k]=String(ch);}});
        self.routing.direct={};directs.forEach(function(d){if(d.ch<=n){d.node.connect(m,0,d.ch-1);self.routing.direct[d.id]=d.ch;}});
        m.connect(c.destination);}
      else{try{if(c.destination.channelCount!==2){c.destination.channelCount=2;c.destination.channelCountMode="explicit";c.destination.channelInterpretation="speakers";}}catch(_){}
        var fb=r.clickFallback||"off";this.routing.buses={tracks:"1-2",pad:"1-2",click:fb};
        if(fb==="split"){var m2=this.merger=c.createChannelMerger(2),mono2=c.createGain(),cm=c.createGain();mono2.channelCount=1;mono2.channelCountMode="explicit";cm.channelCount=1;cm.channelCountMode="explicit";this.outGain.connect(mono2);this.tracksOut.connect(mono2);mono2.connect(m2,0,0);this.clickBus.connect(cm);cm.connect(m2,0,1);m2.connect(c.destination);this.routeNodes.push(m2,mono2,cm);}
        else{this.outGain.connect(c.destination);this.tracksOut.connect(c.destination);if(this.loopOut)this.loopOut.connect(c.destination);
          if(fb==="mix")this.clickBus.connect(c.destination);else if(fb==="device")this.clickToDevice();}}
      if(this.clickTap)this.clickBus.connect(this.clickTap);
      if(r.mainDevice&&c.setSinkId){c.setSinkId(r.mainDevice===("default")?"":r.mainDevice).catch(function(error){setStatus("Main output device not available ("+error.message+")");});}
      document.dispatchEvent(new CustomEvent("pp-routing",{detail:this.routing}));};
    AudioEngine.prototype.clickToDevice=async function(){var c=this.ctx,r=project.routing||{};if(!this.clickDest)this.clickDest=c.createMediaStreamDestination();this.clickBus.connect(this.clickDest);
      if(!this.clickCtx){this.clickCtx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});this.clickCtx.createMediaStreamSource(this.clickDest.stream).connect(this.clickCtx.destination);}
      if(r.clickDevice&&this.clickCtx.setSinkId){try{await this.clickCtx.setSinkId(r.clickDevice==="default"?"":r.clickDevice);}catch(error){setStatus("Click output device not available ("+error.message+")");}}
      if(this.clickCtx.state!=="running")this.clickCtx.resume();};
    // A short test tone on one bus, so you can hear which cable is which.
    AudioEngine.prototype.testBus=function(bus){var c=this.context();var node={tracks:this.tracksBus,pad:this.mainMix,click:this.clickBus}[bus];if(!node)return;var o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value={tracks:440,pad:330,click:880}[bus]||440;
      g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(.25,c.currentTime+.02);g.gain.setValueAtTime(.25,c.currentTime+.5);g.gain.linearRampToValueAtTime(0,c.currentTime+.6);o.connect(g).connect(node);o.start();o.stop(c.currentTime+.65);if(c.state!=="running")c.resume();};
    AudioEngine.prototype.ensure=async function(){var ctx=this.context();if(ctx.state!=="running")await ctx.resume();return ctx;};
    AudioEngine.prototype.getBuffer=async function(sampleId){if(!sampleId)return null;if(decodedSamples.has(sampleId))return decodedSamples.get(sampleId);var blob=await getBlob(sampleId);if(!blob)return null;var ctx=this.context();try{var buffer=await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));decodedSamples.set(sampleId,buffer);return buffer;}catch(_){return null;}};
    // Algorithmic reverb impulses: early reflections + a tail whose highs die faster than its lows.
    AudioEngine.prototype.impulse=function(type,decay){
      var key=type+":"+Math.round(decay*10);if(this.impulses.has(key))return this.impulses.get(key);
      var sr=this.ctx.sampleRate,seconds=clamp(decay,.3,12),length=Math.min(Math.floor(sr*seconds),Math.floor(sr*8)),buffer=this.ctx.createBuffer(2,length,sr);
      var shape={plate:1.5,room:3.3,hall:2.15,cathedral:1.7,spring:2.6}[type]||2.15,damp={plate:.55,room:.35,hall:.25,cathedral:.18,spring:.7}[type]||.25;
      var early={room:[.007,.013,.019,.027,.041],hall:[.011,.023,.037,.053,.071],cathedral:[.019,.041,.063,.089,.12]}[type]||[];
      for(var ch=0;ch<2;ch++){var data=buffer.getChannelData(ch),lp=0;
        for(var i=0;i<length;i++){var pos=i/length,a=1-(1-damp)*Math.pow(pos,.5)*.92,white=Math.random()*2-1;lp+=a*(white-lp);var v=lp*Math.pow(1-pos,shape);
          if(type==="spring")v*=1+.5*Math.sin(i/sr*2*Math.PI*(9+ch));
          data[i]=v;}
        early.forEach(function(t,n){var idx=Math.floor((t+ch*.0017)*sr);if(idx<length)data[idx]+=(n%2?-1:1)*.7*Math.pow(.8,n);});}
      this.impulses.set(key,buffer);return buffer;};
    AudioEngine.prototype.noiseBuffer=function(type){var key=type;if(this.noise.has(key))return this.noise.get(key);var length=Math.floor(this.ctx.sampleRate*2.4),buffer=this.ctx.createBuffer(2,length,this.ctx.sampleRate);for(var c=0;c<2;c++){var data=buffer.getChannelData(c),brown=0;for(var i=0;i<length;i++){var white=Math.random()*2-1;brown=(brown+.025*white)/1.025;var value=white;if(type==="wind"||type==="choir")value=brown*4.2;if(type==="tape")value=white*.23+brown*.6;if(type==="vinyl")value=Math.random()<.006?white*.9:white*.12;if(type==="rain")value=white*(Math.random()>.91?1:.3);if(type==="drone")value=brown*2.7;data[i]=clamp(value,-1,1);}}this.noise.set(key,buffer);return buffer;};

    var MAX_PAD_LAYERS=4;
    // level of one playing pad layer (0..1.4), glided
    AudioEngine.prototype.setLayerLevel=function(index,level,seconds){var v=this.voiceFor(index);if(!v||!v.mix||!this.ctx)return;v.level=clamp(level,0,1.4);var now=this.ctx.currentTime;v.mix.gain.cancelScheduledValues(now);v.mix.gain.setTargetAtTime(v.level,now,Math.max(.01,(seconds||0.05)/3));if(window.PPScenes)window.PPScenes.layersChanged();};
    AudioEngine.prototype.layerState=function(){return this.voices().map(function(v){return {pad:project.pads.findIndex(function(p){return p.id===v.pad.id;}),level:v.level==null?1:v.level,name:v.pad.name};}).filter(function(l){return l.pad>=0;});};
    // a pad scene: exactly these pads (max 4) at these levels; the rest fade out; all over `seconds`
    AudioEngine.prototype.applyPadScene=async function(list,seconds){
      list=(list||[]).filter(function(l){return project.pads[l.pad];}).slice(0,MAX_PAD_LAYERS);await this.ensure();
      var engine=this,now=this.ctx.currentTime,fade=seconds==null?2:Math.max(.02,seconds),want=list.map(function(l){return project.pads[l.pad].id;});
      this.voices().forEach(function(v){if(want.indexOf(v.pad.id)>-1)return;engine.layers=engine.layers.filter(function(x){return x!==v;});if(engine.active===v)engine.active=engine.layers.shift()||null;engine.release(v,fade,now);});
      for(var i=0;i<list.length;i++){var l=list[i],v=this.voiceFor(l.pad);if(v){this.setLayerLevel(l.pad,l.level==null?1:l.level,fade);}else await this.playPad(l.pad,null,{layer:true,keep:true,fade:fade,level:l.level==null?1:l.level});}
      this.morph=null;renderPads();};
    AudioEngine.prototype.voices=function(){return (this.active?[this.active]:[]).concat(this.layers);};
    AudioEngine.prototype.playingIndexes=function(){var ids=this.voices().map(function(v){return v.pad.id;});return project.pads.map(function(p,i){return ids.indexOf(p.id)>-1?i:-1;}).filter(function(i){return i>-1;});};
    AudioEngine.prototype.voiceFor=function(index){var id=project.pads[index].id;return this.voices().filter(function(v){return v.pad.id===id;})[0]||null;};
    AudioEngine.prototype.release=function(voice,seconds,now){voice.fadeOut(now,seconds);voice.dispose(now+seconds+.08);this.track(voice,now+seconds+.08);};
    // opts.layer: add on top of what is playing (or fade this pad out if it is already playing)
    AudioEngine.prototype.playPad=async function(index,overrideKey,opts){
      opts=opts||{};var request=++this.playRequest,pad=project.pads[index],ctx=await this.ensure(),buffer=pad.sampleId?await this.getBuffer(pad.sampleId):null;
      if(request!==this.playRequest)return;
      if(pad.sampleId&&!buffer){setStatus("Could not load "+((sampleFor(pad.sampleId)||{}).name||"this sample")+". Re-import the file.");return;}
      var key=overrideKey||playKeyFor(pad),now=ctx.currentTime+.004,seconds=opts.fade>0?opts.fade:fadeSeconds(pad),engine=this;
      if(opts.layer&&!opts.keep){var existing=this.voiceFor(index);if(existing){this.layers=this.layers.filter(function(v){return v!==existing;});if(this.active===existing)this.active=this.layers.shift()||null;this.release(existing,seconds,now);setStatus("Layer off: "+pad.name);renderPads();return;}}
      var next=new Voice(this,pad,buffer,key);next.start(now);next.fadeIn(now,seconds);
      next.level=opts.level!=null?opts.level:1;if(next.mix&&next.level!==1)next.mix.gain.setValueAtTime(next.level,now);
      // up to MAX_PAD_LAYERS pads at once: the oldest one fades out to make room
      if(opts.layer&&this.active&&this.voices().length>=MAX_PAD_LAYERS){var oldest=this.active;this.active=this.layers.shift()||null;this.release(oldest,seconds,now);}
      if(opts.layer&&this.active){this.layers.push(next);}
      else{this.voices().forEach(function(v){engine.release(v,seconds,now);});this.layers=[];this.active=next;this.morph=null;}
      if(opts.layer&&!this.active)this.active=next;
      this.startMeter();setStatus((opts.layer?"Layered ":"Playing ")+pad.name+" in "+key.replace("#","♯"));renderPads();renderChain();};
    // Stop fades everything out over the pad's fade time; pressing Stop again while it is still fading cuts instantly.
    AudioEngine.prototype.stop=function(){this.playRequest++;if(!this.ctx)return;var now=this.ctx.currentTime,engine=this;var all=this.voices();if(!all.length){if(this.releasing.length)this.panic();return;}var seconds=Math.max(.09,fadeSeconds(all[0].pad));this.active=null;this.layers=[];this.morph=null;this.lastStopAt=now;all.forEach(function(v){engine.release(v,seconds,now);});setStatus(seconds>.4?"Fading out ("+seconds.toFixed(1)+" s) - Stop again to cut":"Stopped");renderPads();};
    AudioEngine.prototype.update=function(pad){this.voices().forEach(function(v){if(v.pad.id===pad.id)v.apply(pad);});if(this.inputVoice&&pad.isInput)this.inputVoice.apply(pad);renderChain();};
    AudioEngine.prototype.refreshAll=function(){var engine=this;this.voices().forEach(function(v){v.apply(v.pad);});if(this.inputVoice)this.inputVoice.apply(this.inputVoice.pad);};
    AudioEngine.prototype.restartForTrim=function(){if(this.active&&this.active.pad.id===currentPad().id)this.playPad(selected);};
    AudioEngine.prototype.startMeter=function(){if(this.meterRunning)return;this.meterRunning=true;var engine=this;function tick(){var voice=engine.active,reduction=voice&&voice.pad.effects.compressor.enabled?Math.max(0,-(voice.comp.reduction||0)):0;var bar=document.querySelector("#grMeter");if(bar){bar.style.width=Math.min(100,reduction/30*100)+"%";document.querySelector("#grText").textContent=reduction.toFixed(1)+" dB";}requestAnimationFrame(tick);}requestAnimationFrame(tick);};
    AudioEngine.prototype.samplePosition=function(){var v=this.active;if(!v||!v.buffer||!this.ctx)return null;var p=v.pad,start=p.trimStart*v.buffer.duration,end=p.trimEnd*v.buffer.duration,duration=Math.max(.001,end-start),progress=(this.ctx.currentTime-v.startedAt)*v.rate;if(p.loop)return start+((progress%duration)+duration)%duration;return Math.min(end,start+progress);};
    AudioEngine.prototype.applyPerformance=function(){if(!this.ctx)return;var p=project.performance,now=this.ctx.currentTime;smoothParam(this.master.gain,volumeGain(p.volume),now);smoothParam(this.tone.frequency,toneHz(p.tone),now);if(this.morph)this.setMorph(p.morph);this.refreshAll();};
    AudioEngine.prototype.setSwell=function(value){expressionValue=clamp(value,0,1);if(this.ctx)smoothParam(this.swell.gain,swellGain(expressionValue),this.ctx.currentTime);};
    AudioEngine.prototype.track=function(voice,until){var list=this.releasing;list.push(voice);setTimeout(function(){var i=list.indexOf(voice);if(i>-1)list.splice(i,1);},Math.max(0,(until-this.ctx.currentTime)*1000)+80);};
    AudioEngine.prototype.panic=function(){this.playRequest++;if(!this.ctx)return;var now=this.ctx.currentTime,all=this.releasing.concat(this.voices());this.active=null;this.layers=[];this.morph=null;all.forEach(function(voice){voice.kill(now);});this.releasing.length=0;this.unfreeze(.05);setStatus("Stopped");renderPads();};

    // ----- morph: two pads sounding together, blended by one control ----
    AudioEngine.prototype.startMorph=async function(a,b){if(a===b)return;await this.playPad(a);await this.playPad(b,null,{layer:true});this.morph={a:project.pads[a].id,b:project.pads[b].id};this.setMorph(project.performance.morph);setStatus("Morph: "+project.pads[a].name+" ↔ "+project.pads[b].name);renderPads();};
    AudioEngine.prototype.setMorph=function(pos){if(!this.morph||!this.ctx)return;var m=this.morph,now=this.ctx.currentTime;pos=clamp(pos,0,1);this.voices().forEach(function(v){if(v.pad.id===m.a)smoothParam(v.mix.gain,Math.cos(pos*Math.PI/2),now);if(v.pad.id===m.b)smoothParam(v.mix.gain,Math.sin(pos*Math.PI/2),now);});};

    // ----- freeze: capture the last few seconds of the whole mix and hold it forever -----
    AudioEngine.prototype.setupFreezeRecorder=function(){
      var engine=this,c=this.ctx;this.freezeBus=c.createGain();this.freezeBus.connect(this.master);
      if(!c.audioWorklet)return;
      var code="class R extends AudioWorkletProcessor{constructor(){super();this.size=Math.floor(sampleRate*4);this.L=new Float32Array(this.size);this.R=new Float32Array(this.size);this.pos=0;this.port.onmessage=e=>{if(e.data!=='grab')return;const n=this.size,p=this.pos,L=new Float32Array(n),R=new Float32Array(n);L.set(this.L.subarray(p));L.set(this.L.subarray(0,p),n-p);R.set(this.R.subarray(p));R.set(this.R.subarray(0,p),n-p);this.port.postMessage({L,R},[L.buffer,R.buffer]);};}process(inputs){const i=inputs[0];if(i&&i.length){const l=i[0],r=i[1]||i[0];for(let n=0;n<l.length;n++){this.L[this.pos]=l[n];this.R[this.pos]=r[n];this.pos=(this.pos+1)%this.size;}}return true;}}registerProcessor('pp-recorder',R);";
      // A data: URL works from a file:// page (a blob: URL does not); fall back to a ScriptProcessor ring buffer if worklets are refused.
      var url="data:application/javascript,"+encodeURIComponent(code);
      this.recorderReady=c.audioWorklet.addModule(url).then(function(){var node=new AudioWorkletNode(c,"pp-recorder",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:2,channelCountMode:"explicit"});var silent=c.createGain();silent.gain.value=0;engine.tone.connect(node);node.connect(silent).connect(c.destination);engine.recorder=node;}).catch(function(){engine.recorder=engine.scriptRecorder();});};
    AudioEngine.prototype.scriptRecorder=function(){
      var c=this.ctx;if(!c.createScriptProcessor)return null;var size=Math.floor(c.sampleRate*4),L=new Float32Array(size),R=new Float32Array(size),pos=0,sp=c.createScriptProcessor(4096,2,1),silent=c.createGain(),handlers={};silent.gain.value=0;
      sp.onaudioprocess=function(e){var l=e.inputBuffer.getChannelData(0),r=e.inputBuffer.numberOfChannels>1?e.inputBuffer.getChannelData(1):l;for(var n=0;n<l.length;n++){L[pos]=l[n];R[pos]=r[n];pos=(pos+1)%size;}};
      this.tone.connect(sp);sp.connect(silent).connect(c.destination);
      var port={onmessage:null,postMessage:function(){var oL=new Float32Array(size),oR=new Float32Array(size);oL.set(L.subarray(pos));oL.set(L.subarray(0,pos),size-pos);oR.set(R.subarray(pos));oR.set(R.subarray(0,pos),size-pos);var self=this;setTimeout(function(){if(self.onmessage)self.onmessage({data:{L:oL,R:oR}});},0);}};
      return {port:port,node:sp};};
    AudioEngine.prototype.freeze=async function(){
      await this.ensure();if(this.recorderReady)await this.recorderReady;if(!this.recorder){setStatus("Freeze isn't supported in this browser");return false;}
      var engine=this,c=this.ctx,data=await new Promise(function(resolve){engine.recorder.port.onmessage=function(e){resolve(e.data);};engine.recorder.port.postMessage("grab");});
      var sr=c.sampleRate,take=Math.floor(sr*3),X=Math.floor(sr*1),n=data.L.length,start=n-take,len=take-X,peak=0,buf=c.createBuffer(2,len,sr);
      // Seamless loop: the last second of the loop crossfades (equal power) into the audio just before its start.
      [data.L,data.R].forEach(function(src,ch){var out=buf.getChannelData(ch),i;
        for(i=0;i<len;i++)out[i]=src[start+X+i];
        for(var j=0;j<X;j++){var t=j/X;i=len-X+j;out[i]=src[start+X+i]*Math.cos(t*Math.PI/2)+src[start+j]*Math.sin(t*Math.PI/2);}
        for(i=0;i<len;i++)peak=Math.max(peak,Math.abs(out[i]));});
      if(peak<.002){setStatus("Nothing is sounding to freeze");return false;}
      this.unfreeze(1.2);
      var src=c.createBufferSource(),g=c.createGain(),now=c.currentTime;src.buffer=buf;src.loop=true;g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(1,now+.6);src.connect(g).connect(this.freezeBus);src.start(now);
      this.frozen={source:src,gain:g};setStatus("Frozen - the sound holds until you unfreeze");renderPads();return true;};
    AudioEngine.prototype.unfreeze=function(seconds){if(!this.frozen||!this.ctx)return;var f=this.frozen,now=this.ctx.currentTime;seconds=seconds==null?1.5:seconds;f.gain.gain.cancelScheduledValues(now);f.gain.gain.setValueAtTime(Math.max(.0001,f.gain.gain.value),now);f.gain.gain.exponentialRampToValueAtTime(.0001,now+seconds);try{f.source.stop(now+seconds+.05);}catch(_){}this.frozen=null;renderPads();};
    AudioEngine.prototype.toggleFreeze=function(){if(this.frozen){this.unfreeze();setStatus("Unfrozen");return Promise.resolve(false);}return this.freeze();};

    // ----- audio input channel (guitar / keys / mic through the same effects) -----
    AudioEngine.prototype.setInput=async function(on){
      var pad=project.input;pad.enabled=!!on;
      if(!on){if(this.inputVoice){var v=this.inputVoice,now=this.ctx.currentTime;v.fadeOut(now,.3);v.dispose(now+.4);this.inputVoice=null;}if(this.inputStream){this.inputStream.getTracks().forEach(function(t){t.stop();});this.inputStream=null;}setStatus("Audio input off");return true;}
      await this.ensure();
      try{this.inputStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,latency:0}});}
      catch(error){pad.enabled=false;setStatus("No audio input available: "+(error&&error.name||"blocked"));return false;}
      var node=this.ctx.createMediaStreamSource(this.inputStream),voice=new Voice(this,pad,null,pad.key,node),t=this.ctx.currentTime+.01;voice.start(t);voice.fadeIn(t,.15);this.inputVoice=voice;setStatus("Audio input on");return true;};

    // =================================================================
    // Voice: one pad (or the input) running through its own full chain
    //   source -> tone -> EQ -> compressor -> drive -> filter -> phaser
    //   -> chorus -> tremolo/pan -> width -> fade -> mix -> level -> master
    //   sends: delay (regular or true ping-pong), reverb (+ shimmer), texture
    // =================================================================
    function Voice(engine,pad,buffer,key,liveSource){this.engine=engine;this.ctx=engine.ctx;this.pad=pad;this.buffer=buffer;this.key=key;this.liveSource=liveSource||null;this.rate=buffer?Math.pow(2,(noteIndex(key)-noteIndex(pad.rootKey))/12):1;this.sources=[];this.oscillators=[];this.layerTimers=[];this.stopped=false;this.build();this.apply(pad);}
    Voice.prototype.param=function(param,value,time){if(!param)return;var t=time==null?this.ctx.currentTime:time;param.cancelScheduledValues(t);param.setTargetAtTime(value,t,.012);};
    Voice.prototype.osc=function(type,freq){var o=this.ctx.createOscillator();o.type=type;o.frequency.value=freq;this.oscillators.push(o);return o;};
    Voice.prototype.build=function(){
      var c=this.ctx,self=this;function G(v){var g=c.createGain();g.gain.value=v==null?1:v;return g;}function F(type,f){var b=c.createBiquadFilter();b.type=type;if(f)b.frequency.value=f;return b;}
      this.input=G(.0001);this.toneFilter=F("lowpass",5000);this.input.connect(this.toneFilter);
      // EQ: 6 bands x up to 4 stages (for 24-48 dB/oct high/low pass)
      var last=this.toneFilter;this.eqFilters=[];for(var band=0;band<6;band++){var stack=[];for(var n=0;n<4;n++){var filter=F("peaking",1000);filter.gain.value=0;last.connect(filter);last=filter;stack.push(filter);}this.eqFilters.push(stack);}
      this.eqOut=last;this.compMeter=c.createAnalyser();this.compMeter.fftSize=1024;last.connect(this.compMeter);
      // Compressor with character stage and parallel (dry/wet) mix
      this.comp=c.createDynamicsCompressor();this.compColor=c.createWaveShaper();this.compColor.oversample="2x";this.compWet=G(0);this.compDry=G(1);this.compSum=G();this.makeup=G();
      last.connect(this.comp).connect(this.compColor).connect(this.compWet).connect(this.compSum);last.connect(this.compDry).connect(this.compSum);this.compSum.connect(this.makeup);
      // Drive
      this.drDry=G(1);this.drPre=G();this.drShaper=c.createWaveShaper();this.drShaper.oversample="4x";this.drTone=F("lowpass",9000);this.drPost=G();this.drWet=G(0);this.drOut=G();
      this.makeup.connect(this.drDry).connect(this.drOut);this.makeup.connect(this.drPre).connect(this.drShaper).connect(this.drTone).connect(this.drPost).connect(this.drWet).connect(this.drOut);
      // Auto-filter
      this.flt=F("lowpass",2400);this.fltWet=G(0);this.fltDry=G(1);this.fltOut=G();this.fltLfo=this.osc("sine",.2);this.fltDepth=G(0);this.fltLfo.connect(this.fltDepth).connect(this.flt.detune);
      this.drOut.connect(this.flt).connect(this.fltWet).connect(this.fltOut);this.drOut.connect(this.fltDry).connect(this.fltOut);
      // Phaser: 8 all-pass stages, output tapped after 4, 6 or 8, with feedback
      this.phSum=G();this.phDry=G(1);this.phWet=G(0);this.phOut=G();this.phLfo=this.osc("sine",.25);this.phDepth=G(0);this.phFbDelay=c.createDelay(.01);this.phFbDelay.delayTime.value=.003;this.phFb=G(0);this.phStages=[];this.phTaps={};
      this.fltOut.connect(this.phDry).connect(this.phOut);this.fltOut.connect(this.phSum);var pl=this.phSum;
      [1,1.5,2.2,3.3,5,7.4,11,16].forEach(function(mult,i){var ap=F("allpass",320*mult);ap.Q.value=.6;pl.connect(ap);pl=ap;self.phStages.push(ap);self.phLfo.connect(self.phDepth);self.phDepth.connect(ap.detune);if(i===3||i===5||i===7){var tap=G(0);ap.connect(tap);tap.connect(self.phWet);tap.connect(self.phFb);self.phTaps[i+1]=tap;}});
      this.phFb.connect(this.phFbDelay).connect(this.phSum);this.phWet.connect(this.phOut);
      // Chorus
      this.chDry=G();this.chDelay=c.createDelay(.08);this.chWet=G(0);this.chOut=G();this.chLfo=this.osc("sine",.35);this.chDepth=G(0);
      this.phOut.connect(this.chDry).connect(this.chOut);this.phOut.connect(this.chDelay).connect(this.chWet).connect(this.chOut);this.chLfo.connect(this.chDepth).connect(this.chDelay.delayTime);
      // Tremolo / auto-pan (the square wave is rounded off so it never clicks)
      this.trem=G(1);this.tremLfo=this.osc("sine",4);this.tremSmooth=F("lowpass",40);this.tremDepth=G(0);this.pan=c.createStereoPanner();this.panDepth=G(0);
      this.tremLfo.connect(this.tremSmooth);this.tremSmooth.connect(this.tremDepth).connect(this.trem.gain);this.tremSmooth.connect(this.panDepth).connect(this.pan.pan);
      this.chOut.connect(this.trem).connect(this.pan);
      // Stereo width (mid/side, with a short Haas delay so even mono sounds get width)
      this.wIn=G();this.wIn.channelCount=2;this.wIn.channelCountMode="explicit";this.wIn.channelInterpretation="speakers";this.pan.connect(this.wIn);
      this.wSplit=c.createChannelSplitter(2);this.wMerge=c.createChannelMerger(2);this.wMid=G();this.wSide=G();this.wSideGain=G(1);this.wInv=G(-1);this.wHaas=c.createDelay(.05);this.wHaas.delayTime.value=.016;this.wHaasGain=G(0);
      this.wIn.connect(this.wSplit);var mL=G(.5),mR=G(.5),sL=G(.5),sR=G(-.5);this.wSplit.connect(mL,0);this.wSplit.connect(mR,1);this.wSplit.connect(sL,0);this.wSplit.connect(sR,1);mL.connect(this.wMid);mR.connect(this.wMid);sL.connect(this.wSide);sR.connect(this.wSide);
      this.wMid.connect(this.wHaas).connect(this.wHaasGain).connect(this.wSide);this.wSide.connect(this.wSideGain);
      this.wMid.connect(this.wMerge,0,0);this.wMid.connect(this.wMerge,0,1);this.wSideGain.connect(this.wMerge,0,0);this.wSideGain.connect(this.wInv).connect(this.wMerge,0,1);
      this.wWet=G(0);this.wDry=G(1);this.post=G();this.wMerge.connect(this.wWet).connect(this.post);this.wIn.connect(this.wDry).connect(this.post);
      // Output: dry -> fade (crossfades) -> mix (morph/breathe) -> level -> master
      this.dry=G();this.fade=G(.0001);this.mix=G(1);this.levelGain=G();this.post.connect(this.dry).connect(this.fade).connect(this.mix).connect(this.levelGain).connect(this.engine.master);
      // Delay send: regular, or true stereo ping-pong; a low-pass in the feedback darkens each repeat
      this.delaySend=G(0);this.delay=c.createDelay(4);this.delayTone=F("lowpass",6000);this.delayFeedback=G(0);this.delayRegWet=G(1);this.delayOut=G();
      this.post.connect(this.delaySend);this.delaySend.connect(this.delay);this.delay.connect(this.delayTone).connect(this.delayFeedback).connect(this.delay);this.delay.connect(this.delayRegWet).connect(this.delayOut);
      this.ppL=c.createDelay(4);this.ppR=c.createDelay(4);this.ppToneL=F("lowpass",6000);this.ppToneR=F("lowpass",6000);this.ppFbLR=G(0);this.ppFbRL=G(0);this.ppIn=G(0);this.ppMerge=c.createChannelMerger(2);this.ppWet=G(0);
      this.delaySend.connect(this.ppIn).connect(this.ppL);this.ppL.connect(this.ppToneL).connect(this.ppFbLR).connect(this.ppR);this.ppR.connect(this.ppToneR).connect(this.ppFbRL).connect(this.ppL);
      this.ppL.connect(this.ppMerge,0,0);this.ppR.connect(this.ppMerge,0,1);this.ppMerge.connect(this.ppWet).connect(this.delayOut);this.delayOut.connect(this.fade);
      // Reverb send with shimmer (octave-up pitch shift fed back into the reverb)
      this.reverbSend=G(0);this.preDelay=c.createDelay(.3);this.convolver=c.createConvolver();this.revHigh=F("highpass",100);this.revLow=F("lowpass",12000);this.revWet=G(0);
      this.post.connect(this.reverbSend).connect(this.preDelay).connect(this.convolver).connect(this.revHigh).connect(this.revLow).connect(this.revWet).connect(this.fade);
      this.shifter=buildPitchShifter(c,12);this.shimmerHP=F("highpass",400);this.shimmerGain=G(0);this.revLow.connect(this.shifter.input);this.shifter.output.connect(this.shimmerHP).connect(this.shimmerGain).connect(this.preDelay);this.shimmerGain.connect(this.revWet);
      // Texture layer
      this.textureSource=c.createBufferSource();this.textureHP=F("highpass",120);this.textureLP=F("lowpass",11000);this.textureGain=G(0);this.textureSource.connect(this.textureHP).connect(this.textureLP).connect(this.textureGain).connect(this.fade);
      // Modulation: user LFO, breathe (auto-swell movement), preset motion
      this.lfo=this.osc("sine",.25);this.lfoGain=G(0);this.lfo.connect(this.lfoGain);
      this.breath=this.osc("sine",.08);this.breathAmp=G(0);this.breathTone=G(0);this.breath.connect(this.breathAmp).connect(this.mix.gain);this.breath.connect(this.breathTone).connect(this.toneFilter.detune);
      this.motion=this.osc("sine",.11);this.motionAmt=G(0);this.motion.connect(this.motionAmt).connect(this.toneFilter.detune);
      // Source layers (main + sub-octave + octave-up)
      this.layerMain=G(1);this.layerSub=G(0);this.layerUp=G(0);[this.layerMain,this.layerSub,this.layerUp].forEach(function(g){g.connect(self.input);});
    };
    Voice.prototype.identity=function(filter){filter.type="peaking";this.param(filter.gain,0);this.param(filter.frequency,1000);this.param(filter.Q,.707);};
    Voice.prototype.apply=function(pad){
      this.pad=pad;var now=this.ctx.currentTime,fx=pad.effects,self=this,profile=profileFor(pad.voice),isSynth=!this.buffer&&!this.liveSource,P=function(param,v){self.param(param,v,now);};
      P(this.toneFilter.frequency,isSynth?profile.tone:20000);P(this.levelGain.gain,clamp(pad.level,0,100)/100);
      P(this.motionAmt.gain,isSynth?(profile.motion||0)*900:0);
      var sw=pad.swell||{};P(this.breath.frequency,clamp(sw.rate||.08,.02,1));P(this.breathAmp.gain,clamp(sw.breathe||0,0,100)/100*.22);P(this.breathTone.gain,clamp(sw.breathe||0,0,100)/100*500);
      var oct=pad.octaves||{};P(this.layerSub.gain,clamp(oct.sub||0,0,100)/100*(isSynth?.55:.7));P(this.layerUp.gain,clamp(oct.up||0,0,100)/100*(isSynth?.3:.5));
      // EQ
      var eq=fx.eq;for(var i=0;i<6;i++){var b=eq.bands[i],stack=this.eqFilters[i],count=Math.max(1,Math.round(Number(b.slope||12)/12));for(var n=0;n<stack.length;n++){var filter=stack[n];if(!eq.enabled||!b.enabled||(n>0&&b.type!=="highpass"&&b.type!=="lowpass")||n>=count){this.identity(filter);}else{filter.type=b.type;P(filter.frequency,clamp(b.freq,20,20000));P(filter.Q,clamp(b.q,.1,18));P(filter.gain,(b.type==="peaking"||b.type==="lowshelf"||b.type==="highshelf")?clamp(b.gain,-24,24):0);}}}
      // Compressor
      var cs=compSettings(fx.compressor),on=fx.compressor.enabled;
      P(this.comp.threshold,on?cs.threshold:0);P(this.comp.ratio,on?cs.ratio:1);P(this.comp.attack,cs.attack/1000);P(this.comp.release,cs.release/1000);P(this.comp.knee,cs.knee);
      this.compColor.curve=cs.color==="clean"?null:shaperCurve(cs.color,cs.drive);
      P(this.compWet.gain,on?cs.mix/100:0);P(this.compDry.gain,on?1-cs.mix/100:1);P(this.makeup.gain,Math.pow(10,(on?cs.makeup:0)/20));
      // Drive
      var dr=fx.drive,dOn=dr.enabled,amt=clamp(dr.amount,0,100);this.drShaper.curve=shaperCurve(dr.type,amt);
      P(this.drPre.gain,dr.type==="lofi"?1:1+amt/25);P(this.drPost.gain,dr.type==="lofi"?1:1/(1+amt/30));P(this.drTone.frequency,clamp(dr.tone,800,20000));
      P(this.drWet.gain,dOn?clamp(dr.mix,0,100)/100:0);P(this.drDry.gain,dOn?1-clamp(dr.mix,0,100)/100:1);
      // Auto-filter
      var fl=fx.filter,fOn=fl.enabled;this.flt.type=fl.type;P(this.flt.frequency,clamp(fl.freq,40,18000));P(this.flt.Q,clamp(fl.q,.3,20));
      this.fltLfo.type=fl.wave==="random"?"sine":fl.wave;P(this.fltLfo.frequency,clamp(syncedRate(fl.rate,fl.sync),.01,20));P(this.fltDepth.gain,fOn?clamp(fl.depth,0,100)/100*2400:0);
      P(this.fltWet.gain,fOn?1:0);P(this.fltDry.gain,fOn?0:1);
      // Phaser
      var ph=fx.phaser,pOn=ph.enabled,st=[4,6,8].indexOf(Number(ph.stages))>-1?Number(ph.stages):6;
      Object.keys(this.phTaps).forEach(function(k){P(self.phTaps[k].gain,Number(k)===st?1:0);});
      P(this.phLfo.frequency,clamp(syncedRate(ph.rate,ph.sync),.01,10));P(this.phDepth.gain,pOn?clamp(ph.depth,0,100)/100*1800:0);P(this.phFb.gain,pOn?clamp(ph.feedback,0,90)/100:0);
      var pm=clamp(ph.mix,0,100)/100;P(this.phWet.gain,pOn?pm:0);P(this.phDry.gain,pOn?1-pm*.5:1);
      // Chorus
      var chorus=fx.chorus;P(this.chDelay.delayTime,clamp(chorus.frequency,2,35)/1000);P(this.chDepth.gain,chorus.enabled?clamp(chorus.depth,0,16)/1000:0);P(this.chLfo.frequency,clamp(chorus.rate,.05,8));P(this.chWet.gain,chorus.enabled?clamp(chorus.mix,0,100)/100:0);P(this.chDry.gain,chorus.enabled?1-clamp(chorus.mix,0,100)/200:1);
      // Tremolo / auto-pan
      var tr=fx.tremolo,tOn=tr.enabled,depth=clamp(tr.depth,0,100)/100;this.tremLfo.type=tr.wave==="square"?"square":tr.wave==="triangle"?"triangle":"sine";P(this.tremLfo.frequency,clamp(syncedRate(tr.rate,tr.sync),.05,20));P(this.tremSmooth.frequency,tr.wave==="square"?25:200);
      var pan=tOn&&tr.mode==="autopan",trem=tOn&&tr.mode!=="autopan";P(this.trem.gain,trem?1-depth/2:1);P(this.tremDepth.gain,trem?depth/2:0);P(this.panDepth.gain,pan?depth:0);
      // Width
      var w=fx.width,wOn=w.enabled;P(this.wSideGain.gain,clamp(w.width,0,200)/100);P(this.wHaasGain.gain,wOn?clamp(w.haas,0,100)/100*.5:0);P(this.wWet.gain,wOn?1:0);P(this.wDry.gain,wOn?0:1);
      // Delay
      var delay=fx.delay,dt=60/(delay.sync?tempoBpm():clamp(delay.bpm,40,240))*Number(delay.division||.5),dlOn=delay.enabled,fb=dlOn?clamp(delay.feedback,0,88)/100:0,pp=delay.type==="pingpong";
      P(this.delay.delayTime,clamp(dt,.01,4));P(this.ppL.delayTime,clamp(dt,.01,4));P(this.ppR.delayTime,clamp(dt,.01,4));P(this.delayTone.frequency,clamp(delay.tone||6000,500,18000));P(this.ppToneL.frequency,clamp(delay.tone||6000,500,18000));P(this.ppToneR.frequency,clamp(delay.tone||6000,500,18000));
      P(this.delaySend.gain,dlOn?clamp(delay.send,0,100)/100:0);P(this.delayFeedback.gain,pp?0:fb);P(this.delayRegWet.gain,pp?0:1);P(this.ppIn.gain,pp?1:0);P(this.ppFbLR.gain,pp?Math.max(.35,fb):0);P(this.ppFbRL.gain,pp?fb:0);P(this.ppWet.gain,pp?1:0);
      // Reverb + shimmer
      var rev=fx.reverb;P(this.reverbSend.gain,rev.enabled?.75:0);P(this.preDelay.delayTime,clamp(rev.predelay,0,250)/1000);P(this.revWet.gain,rev.enabled?clamp(rev.wet,0,100)/100*reverbMult():0);P(this.dry.gain,clamp(rev.dry,0,100)/100);P(this.revHigh.frequency,clamp(rev.lowCut,20,1200));P(this.revLow.frequency,clamp(rev.highCut,1200,20000));
      P(this.shimmerGain.gain,rev.enabled?clamp(rev.shimmer||0,0,100)/100*.55:0);
      if(rev.enabled){var ir=this.engine.impulse(rev.type,rev.decay);if(this.convolver.buffer!==ir)this.convolver.buffer=ir;}
      // Texture
      var texture=fx.texture;if(!this.textureStarted){this.textureSource.buffer=this.engine.noiseBuffer(texture.type);this.textureSource.loop=true;}P(this.textureHP.frequency,clamp(texture.highPass,20,4000));P(this.textureLP.frequency,clamp(texture.lowPass,500,20000));P(this.textureGain.gain,texture.enabled?clamp(texture.volume,0,100)/100*.22:0);
      // User LFO
      this.lfoGain.disconnect();var lfo=fx.lfo;P(this.lfo.frequency,clamp(lfo.rate,.02,20));this.lfo.type=lfo.wave;
      if(lfo.enabled){var target=null,amount=clamp(lfo.depth,0,100)*clamp(lfo.amount,0,100)/100;
        if(lfo.target==="volume"){target=this.levelGain.gain;amount=amount/100;}if(lfo.target==="eqGain"){target=this.eqFilters[editingBand][0].gain;amount=amount/100*18;}if(lfo.target==="eqFrequency"){target=this.eqFilters[editingBand][0].frequency;amount=amount/100*Math.max(200,fx.eq.bands[editingBand].freq);}
        if(lfo.target==="compressor"){target=this.comp.threshold;amount=amount/100*24;}if(lfo.target==="delay"){target=this.delay.delayTime;amount=amount/100*.25;}if(lfo.target==="reverb"){target=this.revWet.gain;amount=amount/100;}if(lfo.target==="chorus"){target=this.chWet.gain;amount=amount/100;}if(lfo.target==="texture"){target=this.textureGain.gain;amount=amount/100*.22;}
        if(target){this.lfoGain.gain.setValueAtTime(amount,now);this.lfoGain.connect(target);}}
    };
    // Sample loop for one layer (main, sub-octave or octave-up), each with its own seamless crossfaded loop
    Voice.prototype.scheduleLoop=function(layer,startTime){
      if(this.stopped||!this.buffer||(this.endAt&&startTime>=this.endAt))return;
      var c=this.ctx,p=this.pad,rate=this.rate*layer.mult,start=p.trimStart*this.buffer.duration,end=Math.max(start+.012,p.trimEnd*this.buffer.duration),duration=(end-start)/rate,cross=Math.min(.04,Math.max(.006,duration*.08)),at=Math.max(startTime,c.currentTime+.003),source=c.createBufferSource(),gain=c.createGain(),voice=this;
      source.buffer=this.buffer;source.playbackRate.value=rate;source.connect(gain).connect(layer.node);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(1,at+Math.min(cross,.012));gain.gain.setValueAtTime(1,Math.max(at+cross,at+duration-cross));gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
      source.onended=function(){var index=voice.sources.indexOf(source);if(index>-1)voice.sources.splice(index,1);};source.start(at,start);source.stop(at+duration+.003);this.sources.push(source);
      var nextAt=at+duration-cross;layer.timer=setTimeout(function(){voice.scheduleLoop(layer,nextAt);},Math.max(0,(nextAt-c.currentTime-.025)*1000));};
    Voice.prototype.start=function(time){
      var c=this.ctx,self=this,pad=this.pad,profile=profileFor(pad.voice),swellAttack=clamp((pad.swell&&pad.swell.attack)||0,0,12);this.startedAt=time;
      var attack=this.liveSource?.02:this.buffer?Math.max(.012,swellAttack):Math.max(profile.attack,swellAttack);
      this.input.gain.cancelScheduledValues(time);this.input.gain.setValueAtTime(.0001,time);this.input.gain.exponentialRampToValueAtTime(1,time+attack);
      var layers=[{mult:1,node:this.layerMain},{mult:.5,node:this.layerSub},{mult:2,node:this.layerUp}];
      if(this.liveSource){this.liveSource.connect(this.layerMain);}
      else if(this.buffer){
        if(pad.loop){layers.forEach(function(l){self.layerTimers.push(l);self.scheduleLoop(l,time);});}
        else{var start=pad.trimStart*this.buffer.duration,end=Math.max(start+.012,pad.trimEnd*this.buffer.duration);layers.forEach(function(l){var s=c.createBufferSource();s.buffer=self.buffer;s.playbackRate.value=self.rate*l.mult;s.connect(l.node);s.start(time,start);s.stop(time+(end-start)/(self.rate*l.mult)+.003);self.sources.push(s);});}}
      else{
        // Built-in synth: chord x layers x unison, spread across the stereo field
        var base=261.6256*Math.pow(2,noteIndex(this.key)/12)/2,chord=chordFor(pad),layerDefs=profile.layers,unison=Math.max(1,Math.min(profile.unison||1,Math.floor(24/(chord.length*layerDefs.length)))),synthBus=c.createGain(),norm=1/Math.sqrt(chord.length);
        if(profile.formants){var fsum=c.createGain();fsum.gain.value=1.4;profile.formants.forEach(function(f){var bp=c.createBiquadFilter();bp.type="bandpass";bp.frequency.value=f[0];bp.Q.value=f[1];synthBus.connect(bp).connect(fsum);});var body=c.createBiquadFilter();body.type="lowpass";body.frequency.value=900;synthBus.connect(body).connect(fsum);fsum.connect(this.layerMain);}
        else synthBus.connect(this.layerMain);
        chord.forEach(function(semi,ci){var freq=base*Math.pow(2,semi/12);layerDefs.forEach(function(L){for(var u=0;u<unison;u++){var spread=unison>1?(u/(unison-1)-.5):0,o=self.osc(L[0],freq),g=c.createGain(),p=c.createStereoPanner();o.detune.value=L[2]+spread*(profile.spread||0)*2+(ci?3*ci:0);g.gain.value=L[1]*norm/Math.sqrt(unison);p.pan.value=spread*.9;o.connect(g).connect(p).connect(synthBus);}});});
        var sub=this.osc("sine",base/2),subG=c.createGain();subG.gain.value=.9;sub.connect(subG).connect(this.layerSub);
        chord.forEach(function(semi){var up=self.osc("triangle",base*2*Math.pow(2,semi/12)),g=c.createGain();g.gain.value=.5*norm;up.connect(g).connect(self.layerUp);});
        if(profile.air){var air=c.createBufferSource(),bp=c.createBiquadFilter(),ag=c.createGain();air.buffer=this.engine.noiseBuffer("rain");air.loop=true;bp.type="bandpass";bp.frequency.value=7000;bp.Q.value=.7;ag.gain.value=profile.air*.12;air.connect(bp).connect(ag).connect(this.eqFilters[0][0]);this.sources.push(air);air.start(time);}}
      this.oscillators.forEach(function(o){try{o.start(time);}catch(_){}});
      if(this.shifter)this.shifter.start(time);
      this.textureSource.start(time);this.textureStarted=true;};
    Voice.prototype.fadeIn=function(time,seconds){this.fade.gain.cancelScheduledValues(time);this.fade.gain.setValueAtTime(.0001,time);this.fade.gain.exponentialRampToValueAtTime(1,time+Math.max(.02,seconds));};
    Voice.prototype.fadeOut=function(time,seconds){if(this.stopped)return;this.fade.gain.cancelScheduledValues(time);this.fade.gain.setValueAtTime(Math.max(.0001,this.fade.gain.value),time);this.fade.gain.exponentialRampToValueAtTime(.0001,time+Math.max(.02,seconds));};
    Voice.prototype.allNodes=function(){return this.sources.concat(this.oscillators,this.shifter?this.shifter.nodes:[],[this.textureSource]);};
    Voice.prototype.stopTimers=function(){this.layerTimers.forEach(function(l){clearTimeout(l.timer);});};
    // Keeps looping samples going for the whole of a long fade.
    Voice.prototype.dispose=function(when){if(this.disposed)return;this.disposed=true;this.endAt=when;var voice=this,ctx=this.ctx,nodes=this.allNodes();nodes.forEach(function(node){try{node.stop(when);}catch(_){}});setTimeout(function(){voice.stopped=true;voice.stopTimers();voice.allNodes().forEach(function(node){try{node.disconnect();}catch(_){}});try{voice.fade.disconnect();voice.levelGain.disconnect();}catch(_){}},Math.max(0,when-ctx.currentTime)*1000+50);};
    Voice.prototype.kill=function(now){var g=this.fade.gain,voice=this;try{g.cancelScheduledValues(now);g.setValueAtTime(Math.max(.0001,g.value),now);g.exponentialRampToValueAtTime(.0001,now+.06);}catch(_){}this.stopped=true;this.disposed=true;this.stopTimers();this.allNodes().forEach(function(node){try{node.stop(now+.08);}catch(_){}});setTimeout(function(){try{voice.levelGain.disconnect();}catch(_){}},160);};
    var engine=new AudioEngine();

    function sampleFor(sampleId){return project.library.find(function(sample){return sample.id===sampleId;})||null;}
    function refreshVoiceOptions(){var select=document.querySelector("#voice"),pad=currentPad(),options=STOCK_VOICES.map(function(voice){return '<option value="'+voice+'">'+voice+"</option>";});if(project.library.length){options.push('<optgroup label="Imported voices">');project.library.forEach(function(sample){options.push('<option value="sample:'+sample.id+'">'+escapeHtml(sample.name)+"</option>");});options.push("</optgroup>");}select.innerHTML=options.join("");select.value=pad.sampleId?"sample:"+pad.sampleId:pad.voice;if(select.value==="")select.value=pad.voice||"Warm Pad";}
    function renderPads(){renderPerform();if(window.__pedalBridge)window.__pedalBridge.sendState();var playing=engine.active?engine.active.pad.id:null;document.querySelector("#padList").innerHTML=project.pads.map(function(pad,index){var cls="pad"+(index===selected?" active":"")+(pad.id===playing?" playing":""),source=pad.sampleId?(sampleFor(pad.sampleId)||{}).name||"Imported audio":pad.voice;return '<button class="'+cls+'" data-pad="'+index+'"><b>PAD '+(index+1)+'</b><span>'+escapeHtml(pad.name)+" · "+pad.key.replace("#","♯")+" · "+escapeHtml(source)+"</span></button>";}).join("");}
    function renderLibrary(){var root=document.querySelector("#library");if(!project.library.length){root.innerHTML="<small>No imported audio yet.</small>";return;}root.innerHTML=project.library.map(function(sample){return '<button data-library="'+sample.id+'" title="Load this sound into the selected pad">'+escapeHtml(sample.name)+" · root "+sample.rootKey.replace("#","♯")+"</button>";}).join("");}
    var CHAIN=[["eq","EQ"],["compressor","Compressor"],["drive","Drive"],["filter","Auto-filter"],["phaser","Phaser"],["chorus","Chorus"],["tremolo","Tremolo / pan"],["width","Width"],["delay","Delay"],["reverb","Reverb"],["texture","Texture"],["lfo","LFO"]];
    function renderChain(){var root=document.querySelector("#chainList");if(!root)return;var fx=currentPad().effects;root.innerHTML='<div class="live">'+(currentPad().isInput?"Audio input":"Pad sound")+"</div>"+CHAIN.map(function(c){var on=fx[c[0]].enabled;var extra=c[0]==="reverb"&&on&&fx.reverb.shimmer>0?" + shimmer":c[0]==="compressor"&&on?" · "+(COMP_TYPES[fx.compressor.type]||COMP_TYPES.VCA).label:"";return '<div class="'+(on?"live":"")+'" data-chain="'+c[0]+'">'+c[1]+extra+"</div>";}).join("")+"<div>Output</div>";}
    function loadFormBase(){var p=currentPad();document.querySelector("#padTitle").textContent="Pad "+(selected+1)+" — "+p.name;document.querySelector("#projectName").value=project.name;document.querySelectorAll("[data-path]").forEach(function(control){var value=getPath(p,control.dataset.path);if(control.type==="checkbox")control.checked=!!value;else if(value!=null)control.value=value;var output=control.closest("label")&&control.closest("label").querySelector("output");if(output)output.textContent=formatValue(control.dataset.path,value);});document.querySelector("#levelOut").textContent=p.level+"%";document.querySelector("#crossfadeOut").textContent=p.crossfade+" ms";document.querySelector("#trimStartOut").textContent=Math.round(p.trimStart*100)+"%";document.querySelector("#trimEndOut").textContent=Math.round(p.trimEnd*100)+"%";refreshVoiceOptions();renderEqEditor();renderPads();renderLibrary();renderChain();renderWaveform();}
    function loadForm(){
      document.body.classList.toggle("editing-input",editingInput);loadFormBase();
      var p=currentPad();if(editingInput)document.querySelector("#padTitle").textContent="Audio input — "+p.name;
      document.querySelector("#inputEnabled").checked=!!project.input.enabled;renderInputPad();
      var chord=document.querySelector("#padChord");if(chord&&!chord.options.length)chord.innerHTML=Object.keys(CHORD_NAMES).map(function(k){return '<option value="'+k+'">'+CHORD_NAMES[k]+"</option>";}).join("");if(chord)chord.value=p.chord||"auto";
      if(window.PPGraphics)window.PPGraphics.refresh();}
    function renderInputPad(){var b=document.querySelector("#inputPad");if(!b)return;b.classList.toggle("active",editingInput);b.classList.toggle("live",!!(engine.inputVoice));document.querySelector("#inputPadText").textContent="Guitar / keys / mic · "+(engine.inputVoice?"on":"off");}
    function renderEqEditor(){var p=currentPad(),select=document.querySelector("#eqBand");select.innerHTML=p.effects.eq.bands.map(function(_,index){return '<option value="'+index+'">Band '+(index+1)+"</option>";}).join("");select.value=editingBand;var b=p.effects.eq.bands[editingBand];document.querySelector("#eqType").value=b.type;document.querySelector("#eqFreq").value=b.freq;document.querySelector("#eqGain").value=b.gain;document.querySelector("#eqQ").value=b.q;document.querySelector("#eqSlope").value=b.slope;document.querySelector("#eqFreqOut").textContent=formatValue("freq",b.freq);document.querySelector("#eqGainOut").textContent=b.gain.toFixed(1)+" dB";document.querySelector("#eqQOut").textContent=b.q.toFixed(1);drawEq();}
    function graphGeometry(canvas){var rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));var ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx:ctx,width:rect.width,height:rect.height};} function xForFreq(freq,width){return 18+(Math.log(freq/20)/Math.log(20000/20))*(width-36);} function freqForX(x,width){return clamp(20*Math.pow(20000/20,(x-18)/Math.max(1,width-36)),20,20000);} function yForGain(gain,height){return 16+((24-gain)/48)*(height-32);} function gainForY(y,height){return clamp(24-((y-16)/Math.max(1,height-32))*48,-24,24);}
    function response(band,freq){if(!band.enabled)return 0;var ratio=Math.log(freq/band.freq)/Math.LN2;if(band.type==="peaking")return band.gain*Math.exp(-.5*Math.pow(ratio*Math.max(.35,band.q),2));if(band.type==="lowshelf")return band.gain/(1+Math.exp(ratio*3.2));if(band.type==="highshelf")return band.gain/(1+Math.exp(-ratio*3.2));var slope=Number(band.slope||12)/12;if(band.type==="highpass"&&freq<band.freq)return Math.max(-48,6.02*slope*Math.log2(freq/band.freq));if(band.type==="lowpass"&&freq>band.freq)return Math.max(-48,-6.02*slope*Math.log2(freq/band.freq));return 0;}
    var graphCtx=null,filterPool=[];
    function graphContext(){if(!graphCtx){try{graphCtx=new OfflineAudioContext(1,128,48000);}catch(_){graphCtx=null;}}return graphCtx;}
    // Summed magnitude response in dB of a chain of biquads, computed by the browser's own filter code.
    function biquadDb(specs,freqs){var g=graphContext(),n=freqs.length,mag=new Float32Array(n),ph=new Float32Array(n),total=new Float32Array(n);if(!g)return total;specs.forEach(function(sp,i){var f=filterPool[i]||(filterPool[i]=g.createBiquadFilter());f.type=sp.type;f.frequency.value=sp.freq;f.Q.value=sp.q==null?.707:sp.q;f.gain.value=sp.gain||0;f.detune.value=sp.detune||0;f.getFrequencyResponse(freqs,mag,ph);for(var k=0;k<n;k++)total[k]+=20*Math.log10(Math.max(1e-6,mag[k]));});return total;}
    function bandSpecs(b){if(!b.enabled)return [];var count=(b.type==="highpass"||b.type==="lowpass")?Math.max(1,Math.round(Number(b.slope||12)/12)):1,out=[];for(var n=0;n<count;n++)out.push({type:b.type,freq:clamp(b.freq,20,20000),q:clamp(b.q,.1,18),gain:(b.type==="peaking"||b.type==="lowshelf"||b.type==="highshelf")?clamp(b.gain,-24,24):0});return out;}
    function logFreqs(width,lo,hi){var n=Math.max(2,Math.floor(width/2)),f=new Float32Array(n);for(var i=0;i<n;i++)f[i]=lo*Math.pow(hi/lo,i/(n-1));return f;}
    function drawSpectrum(ctx,width,height,xFor,yFor){var a=engine.spectrum;if(!a||!engine.voices().length&&!engine.inputVoice&&!engine.frozen)return;var bins=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(bins);var sr=engine.ctx.sampleRate;ctx.beginPath();ctx.moveTo(xFor(20),height);for(var i=1;i<bins.length;i++){var f=i*sr/a.fftSize;if(f<20||f>20000)continue;ctx.lineTo(xFor(f),yFor(bins[i]));}ctx.lineTo(xFor(20000),height);ctx.closePath();ctx.fillStyle="rgba(117,173,255,.16)";ctx.fill();}
    function drawEq(){
      var canvas=document.querySelector("#eqGraph"),g=graphGeometry(canvas),ctx=g.ctx,width=g.width,height=g.height,p=currentPad(),bands=p.effects.eq.bands,accent=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#5de6b0";
      ctx.clearRect(0,0,width,height);ctx.lineWidth=1;ctx.strokeStyle="rgba(151,184,209,.18)";ctx.font="10px system-ui";
      [-24,-12,0,12,24].forEach(function(gain){var y=yForGain(gain,height);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();ctx.fillStyle="rgba(185,210,230,.62)";ctx.fillText((gain>0?"+":"")+gain,4,Math.max(11,y-3));});
      [20,50,100,200,500,1000,2000,5000,10000,20000].forEach(function(freq){var x=xForFreq(freq,width);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();ctx.fillStyle="rgba(185,210,230,.62)";ctx.fillText(freq>=1000?(freq/1000)+"k":freq,Math.min(width-20,x+2),height-6);});
      drawSpectrum(ctx,width,height,function(f){return xForFreq(f,width);},function(db){return height-clamp((db+100)/90,0,1)*height;});
      var freqs=logFreqs(width,20,20000),xs=Array.prototype.map.call(freqs,function(f){return xForFreq(f,width);});
      if(p.effects.eq.enabled){
        bands.forEach(function(b,i){if(!b.enabled)return;var r=biquadDb(bandSpecs(b),freqs);ctx.beginPath();for(var k=0;k<freqs.length;k++){var y=yForGain(clamp(r[k],-24,24),height);if(k===0)ctx.moveTo(xs[k],y);else ctx.lineTo(xs[k],y);}ctx.strokeStyle=EQ_COLORS[i]+"66";ctx.lineWidth=1.2;ctx.stroke();});
        var specs=[];bands.forEach(function(b){specs=specs.concat(bandSpecs(b));});var total=biquadDb(specs,freqs),zero=yForGain(0,height);
        ctx.beginPath();ctx.moveTo(xs[0],zero);for(var k2=0;k2<freqs.length;k2++)ctx.lineTo(xs[k2],yForGain(clamp(total[k2],-24,24),height));ctx.lineTo(xs[xs.length-1],zero);ctx.closePath();ctx.fillStyle=accent+"22";ctx.fill();
        ctx.beginPath();for(var k3=0;k3<freqs.length;k3++){var yy=yForGain(clamp(total[k3],-24,24),height);if(k3===0)ctx.moveTo(xs[k3],yy);else ctx.lineTo(xs[k3],yy);}ctx.strokeStyle=accent;ctx.lineWidth=2.4;ctx.stroke();}
      bands.forEach(function(band,index){var x=xForFreq(band.freq,width),visualGain=(band.type==="highpass"||band.type==="lowpass")?0:band.gain,y=yForGain(visualGain,height);ctx.beginPath();ctx.arc(x,y,index===editingBand?11:9,0,Math.PI*2);ctx.fillStyle=band.enabled?EQ_COLORS[index]:"#40566e";ctx.fill();ctx.lineWidth=index===editingBand?3:1;ctx.strokeStyle=index===editingBand?"#fff":"#13233a";ctx.stroke();ctx.fillStyle="#06111f";ctx.font="bold 10px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(index+1),x,y+.5);});
      ctx.textAlign="start";ctx.textBaseline="alphabetic";}
    async function renderWaveform(){var p=currentPad(),wanted=p.sampleId;currentWaveBuffer=wanted?await engine.getBuffer(wanted):null;if(currentPad().sampleId!==wanted)return;var canvas=document.querySelector("#waveform"),g=graphGeometry(canvas),ctx=g.ctx,width=Math.max(1,Math.round(g.width)),height=g.height;ctx.clearRect(0,0,g.width,height);if(!currentWaveBuffer){ctx.fillStyle="rgba(155,178,201,.8)";ctx.font="13px system-ui";ctx.textAlign="center";ctx.fillText("Import MP3 or WAV audio to view and trim its waveform",g.width/2,height/2);ctx.textAlign="start";document.querySelector("#sampleName").textContent="No imported audio on this pad";return;}var sample=sampleFor(wanted);document.querySelector("#sampleName").textContent=(sample?sample.name:"Imported audio")+" · root "+p.rootKey.replace("#","♯")+" · "+currentWaveBuffer.duration.toFixed(2)+" sec";var cacheKey=wanted+":"+width,peaks=wavePeaks.get(cacheKey);if(!peaks){var data=currentWaveBuffer.getChannelData(0),scale=data.length/width,mins=new Float32Array(width),maxs=new Float32Array(width);for(var n=0;n<width;n++){var begin=Math.floor(n*scale),end=Math.floor((n+1)*scale),min=1,max=-1;for(var i=begin;i<end;i++){var value=data[i]||0;if(value<min)min=value;if(value>max)max=value;}mins[n]=min;maxs[n]=max;}peaks={mins:mins,maxs:maxs};wavePeaks.set(cacheKey,peaks);}ctx.strokeStyle="rgba(100,229,240,.8)";ctx.lineWidth=1;ctx.beginPath();for(var x=0;x<width;x++){ctx.moveTo(x,(1+peaks.mins[x])*.5*height);ctx.lineTo(x,(1+peaks.maxs[x])*.5*height);}ctx.stroke();var startX=p.trimStart*width,endX=p.trimEnd*width;ctx.fillStyle="rgba(3,12,21,.55)";ctx.fillRect(0,0,startX,height);ctx.fillRect(endX,0,width-endX,height);[startX,endX].forEach(function(x){ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#5de6b0";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();ctx.fillStyle="#5de6b0";ctx.fillRect(x-4,0,8,16);});var position=engine.samplePosition();if(position!=null&&engine.active&&engine.active.pad.id===p.id){var px=position/currentWaveBuffer.duration*width;ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,height);ctx.stroke();}}
    function waveAnimation(last){requestAnimationFrame(function(now){if(now-last>50&&currentWaveBuffer&&engine.active&&engine.active.pad.id===currentPad().id)renderWaveform();waveAnimation(now);});} function setStatus(message){document.querySelector("#status").textContent=message;var pf=document.querySelector("#pfStatus");if(pf)pf.textContent=message;}
    function updateEq(field,value){var b=currentPad().effects.eq.bands[editingBand];b[field]=value;if(field==="freq")b.freq=clamp(value,20,20000);if(field==="gain")b.gain=clamp(value,-24,24);if(field==="q")b.q=clamp(value,.1,18);renderEqEditor();engine.update(currentPad());persistSoon();}
    function onGenericControl(control){var p=currentPad(),value=controlValue(control),path=control.dataset.path;setPath(p,path,value);if(path==="trimStart"&&p.trimStart>=p.trimEnd)p.trimEnd=Math.min(1,p.trimStart+.02);if(path==="trimEnd"&&p.trimEnd<=p.trimStart)p.trimStart=Math.max(0,p.trimEnd-.02);var output=control.closest("label")&&control.closest("label").querySelector("output");if(output)output.textContent=formatValue(path,getPath(p,path));document.querySelector("#levelOut").textContent=p.level+"%";document.querySelector("#crossfadeOut").textContent=p.crossfade+" ms";document.querySelector("#trimStartOut").textContent=Math.round(p.trimStart*100)+"%";document.querySelector("#trimEndOut").textContent=Math.round(p.trimEnd*100)+"%";document.querySelector("#padTitle").textContent="Pad "+(selected+1)+" — "+p.name;renderPads();renderChain();engine.update(p);persistSoon();if(["trimStart","trimEnd","loop"].indexOf(path)>-1){renderWaveform();clearTimeout(trimRestartTimer);trimRestartTimer=setTimeout(function(){engine.restartForTrim();},120);}if(["effects.texture.type","key","rootKey","chord"].indexOf(path)>-1&&engine.active&&engine.active.pad.id===p.id){clearTimeout(trimRestartTimer);trimRestartTimer=setTimeout(function(){engine.playPad(selected);},80);}}
    async function importFile(file,makeActive){if(!file||(!/^audio\//.test(file.type)&&!/\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff)$/i.test(file.name))){setStatus("Please choose an MP3 or WAV audio file.");return false;}setStatus("Importing "+file.name+"…");try{await engine.ensure();var buffer=await engine.ctx.decodeAudioData((await file.arrayBuffer()).slice(0)),sampleId=id(),name=file.name.replace(/\.[^.]+$/,"")||"Imported sound",item={id:sampleId,name:name,rootKey:currentPad().rootKey,type:file.type||"audio/*"};project.library.push(item);decodedSamples.set(sampleId,buffer);await storeBlob(sampleId,file);
      if(window.PPAnalysis&&window.PPAnalysis.keyOf){try{var detected=await window.PPAnalysis.keyOf(buffer);if(detected&&detected.key){item.rootKey=detected.key;item.detectedKey=detected.key+(detected.mode==="minor"?"m":"");item.keyConfidence=detected.keyConfidence;}}catch(_){}}if(makeActive!==false){var p=currentPad();p.sampleId=sampleId;p.voice="Imported Sample";p.name=name;p.rootKey=item.rootKey;p.trimStart=0;p.trimEnd=1;p.loop=true;document.querySelector("#padName").value=p.name;setStatus("Imported "+name+(item.detectedKey?" · sounds like "+item.detectedKey.replace("#","♯")+" (root key set, change it if it is wrong)":"")+". Save This Pad to keep it.");}persistNow();loadForm();return true;}catch(error){setStatus("Could not decode that audio file. Try a WAV or another MP3.");return false;}}
    async function setSelectedPad(index,autoplay){editingInput=false;selected=clamp(index,0,PAD_COUNT-1);project.selected=selected;editingBand=0;loadForm();persistSoon();if(autoplay!==false)await engine.playPad(selected);} function assignLibrary(sampleId){var sample=sampleFor(sampleId);if(!sample)return;var p=currentPad();p.sampleId=sampleId;p.voice="Imported Sample";p.rootKey=sample.rootKey||p.rootKey;p.trimStart=0;p.trimEnd=1;p.loop=true;loadForm();persistSoon();setStatus("Loaded "+sample.name+" into Pad "+(selected+1));}
    function applyTheme(){var theme=project.theme;Object.keys(theme).forEach(function(name){document.documentElement.style.setProperty("--"+name,theme[name]);});document.querySelectorAll("[data-theme]").forEach(function(input){input.value=theme[input.dataset.theme]||"#000000";});}

    document.addEventListener("input",function(event){var target=event.target;if(target.dataset.path)onGenericControl(target);});document.addEventListener("change",function(event){var target=event.target;if(target.dataset.path&&target.type!=="range")onGenericControl(target);});
    document.querySelector("#projectName").addEventListener("input",function(event){project.name=event.target.value||"Untitled Pad Project";persistSoon();}); document.querySelector("#voice").addEventListener("change",function(event){var value=event.target.value,p=currentPad();if(value.indexOf("sample:")===0){assignLibrary(value.slice(7));}else{p.voice=value;p.sampleId=null;persistSoon();renderPads();renderWaveform();engine.update(p);if(engine.active&&engine.active.pad.id===p.id)engine.playPad(selected);}});
    document.querySelector("#eqBand").addEventListener("change",function(event){editingBand=Number(event.target.value);renderEqEditor();engine.update(currentPad());});[["eqType","type",false],["eqFreq","freq",true],["eqGain","gain",true],["eqQ","q",true],["eqSlope","slope",true]].forEach(function(entry){document.querySelector("#"+entry[0]).addEventListener("input",function(event){updateEq(entry[1],entry[2]?Number(event.target.value):event.target.value);});document.querySelector("#"+entry[0]).addEventListener("change",function(event){updateEq(entry[1],entry[2]?Number(event.target.value):event.target.value);});});
    document.querySelector("#tabs").addEventListener("click",function(event){var button=event.target.closest("[data-panel]");if(!button)return;document.querySelectorAll(".tab").forEach(function(tab){tab.classList.toggle("active",tab===button);});document.querySelectorAll(".panel").forEach(function(panel){panel.classList.toggle("active",panel.id==="panel-"+button.dataset.panel);});});document.querySelector("#padList").addEventListener("click",function(event){var button=event.target.closest("[data-pad]");if(button)setSelectedPad(Number(button.dataset.pad),true);});
    document.querySelector("#startButton").addEventListener("click",function(){engine.playPad(selected);});document.querySelector("#stopButton").addEventListener("click",function(){engine.stop();});document.querySelector("#loopStop").addEventListener("click",function(){engine.stop();});document.querySelector("#savePad").addEventListener("click",function(){persistNow();renderPads();document.querySelector("#saveHint").textContent="Saved ✓ Pad "+(selected+1)+" now owns these settings.";setStatus("Saved "+currentPad().name);});
    document.querySelector("#importAudio").addEventListener("click",function(){document.querySelector("#audioFile").click();});document.querySelector("#audioFile").addEventListener("change",function(event){importFile(event.target.files[0],true);event.target.value="";});document.querySelector("#clearSample").addEventListener("click",function(){var p=currentPad();p.sampleId=null;p.voice="Warm Pad";persistSoon();loadForm();setStatus("Pad now uses its synth voice.");});document.querySelector("#library").addEventListener("click",function(event){var button=event.target.closest("[data-library]");if(button)assignLibrary(button.dataset.library);});
    document.querySelector("#folderImport").addEventListener("click",function(){document.querySelector("#folderFile").click();});document.querySelector("#folderFile").addEventListener("change",async function(event){var files=Array.from(event.target.files||[]).filter(function(file){return /^audio\//.test(file.type)||/\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff)$/i.test(file.name);});if(!files.length){setStatus("No MP3 or WAV files were found in that folder.");return;}var initialPad=selected;for(var i=0;i<files.length;i++){if(i<PAD_COUNT)selected=i;await importFile(files[i],i===initialPad);}selected=initialPad;loadForm();setStatus("Imported "+files.length+" audio file"+(files.length===1?"":"s")+" into Voices.");event.target.value="";});
    document.querySelector("#newProject").addEventListener("click",async function(){if(!confirm("Start a new stock project? This clears the current saved project and its imported audio from this browser."))return;engine.stop();project=defaultProject();selected=0;await clearBlobs();persistNow();applyTheme();loadForm();setStatus("New stock project ready.");});
    document.querySelector("#saveProject").addEventListener("click",async function(){try{persistNow();setStatus("Preparing portable project…");var copies=[];for(var i=0;i<project.library.length;i++){var sample=project.library[i],blob=await getBlob(sample.id);if(blob)copies.push({id:sample.id,name:sample.name,rootKey:sample.rootKey,type:sample.type,data:await dataUrl(blob)});}var payload={format:"Pad Pedal Project",version:3,project:project,samples:copies},url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download=(project.name||"pad-pedal-project").replace(/[^\w.-]+/g,"-")+".padpedal.json";document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);setStatus("Project saved with "+copies.length+" imported sound"+(copies.length===1?"":"s")+".");}catch(_){setStatus("Project could not be saved. Try saving without a very large audio file.");}});
    document.querySelector("#openProject").addEventListener("click",function(){document.querySelector("#projectFile").click();});document.querySelector("#projectFile").addEventListener("change",async function(event){var file=event.target.files[0];if(!file)return;try{var payload=JSON.parse(await file.text()),incoming=payload.project||payload;if(!incoming||!Array.isArray(incoming.pads))throw new Error("invalid");engine.stop();project=normalizeProject(incoming);selected=project.selected;decodedSamples.clear();sampleMemory.clear();if(Array.isArray(payload.samples)){for(var i=0;i<payload.samples.length;i++){var asset=payload.samples[i];if(asset&&asset.id&&asset.data)await storeBlob(asset.id,dataUrlBlob(asset.data));}}persistNow();applyTheme();loadForm();setStatus("Opened "+project.name+" with all saved settings.");}catch(_){setStatus("That is not a valid Pad Pedal project file.");}event.target.value="";});
    document.querySelector("#keyboardButton").addEventListener("click",function(){document.querySelector("#keyboardDialog").showModal();});document.querySelectorAll("[data-close]").forEach(function(button){button.addEventListener("click",function(){document.querySelector("#"+button.dataset.close).close();});});document.querySelectorAll("[data-theme]").forEach(function(input){input.addEventListener("input",function(){project.theme[input.dataset.theme]=input.value;applyTheme();persistSoon();drawEq();renderWaveform();});});
    var keyboardMap={a:"C",w:"C#",s:"D",e:"D#",d:"E",f:"F",t:"F#",g:"G",y:"G#",h:"A",u:"A#",j:"B"};document.querySelector("#keyboard").innerHTML=KEYS.map(function(key){var code=Object.keys(keyboardMap).find(function(letter){return keyboardMap[letter]===key;})||"";return '<button class="key'+(key.indexOf("#")>-1?" black":"")+'" data-note="'+key+'">'+key.replace("#","♯")+"<small>"+code.toUpperCase()+"</small></button>";}).join("");document.querySelector("#keyboard").addEventListener("click",function(event){var key=event.target.closest("[data-note]");if(key)engine.playPad(selected,key.dataset.note);});document.addEventListener("keydown",function(event){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();document.querySelector("#keyboardDialog").showModal();return;}if(event.key==="Escape"){var dialog=document.querySelector("dialog[open]");if(dialog)dialog.close();return;}if(event.target.matches("input,select,textarea")||event.repeat)return;if(/^[1-8]$/.test(event.key)){event.preventDefault();triggerPad(Number(event.key)-1);return;}if(event.key.toLowerCase()==="p"&&!event.ctrlKey&&!event.metaKey){event.preventDefault();setPerformMode(!isPerforming());return;}if(isPerforming()&&(event.key==="ArrowUp"||event.key==="ArrowDown")){event.preventDefault();changeKey(event.key==="ArrowUp"?1:-1);return;}if(event.key===" "){event.preventDefault();engine.stop();return;}var note=keyboardMap[event.key.toLowerCase()];if(note){event.preventDefault();engine.playPad(selected,note);}});
    function wavePointer(event){if(!currentWaveBuffer)return;var canvas=document.querySelector("#waveform"),rect=canvas.getBoundingClientRect(),ratio=clamp((event.clientX-rect.left)/rect.width,0,1),p=currentPad();if(event.type==="pointerdown"){waveDrag=Math.abs(ratio-p.trimStart)<Math.abs(ratio-p.trimEnd)?"start":"end";canvas.setPointerCapture(event.pointerId);}if(!waveDrag)return;if(waveDrag==="start")p.trimStart=clamp(ratio,0,p.trimEnd-.01);else p.trimEnd=clamp(ratio,p.trimStart+.01,1);document.querySelector("#trimStart").value=p.trimStart;document.querySelector("#trimEnd").value=p.trimEnd;document.querySelector("#trimStartOut").textContent=Math.round(p.trimStart*100)+"%";document.querySelector("#trimEndOut").textContent=Math.round(p.trimEnd*100)+"%";renderWaveform();persistSoon();clearTimeout(trimRestartTimer);trimRestartTimer=setTimeout(function(){engine.restartForTrim();},130);if(event.type==="pointerup"||event.type==="pointercancel")waveDrag=null;}
    document.querySelector("#waveform").addEventListener("pointerdown",wavePointer);document.querySelector("#waveform").addEventListener("pointermove",wavePointer);document.querySelector("#waveform").addEventListener("pointerup",wavePointer);document.querySelector("#waveform").addEventListener("pointercancel",wavePointer);
    var eqDrag=null;function eqPointer(event){var canvas=document.querySelector("#eqGraph"),rect=canvas.getBoundingClientRect(),p=currentPad(),x=event.clientX-rect.left,y=event.clientY-rect.top;if(event.type==="pointerdown"){var nearest=0,distance=Infinity;p.effects.eq.bands.forEach(function(band,index){var bx=xForFreq(band.freq,rect.width),by=yForGain((band.type==="highpass"||band.type==="lowpass")?0:band.gain,rect.height),d=Math.hypot(x-bx,y-by);if(d<distance){distance=d;nearest=index;}});if(distance>28)return;editingBand=nearest;eqDrag=nearest;canvas.setPointerCapture(event.pointerId);renderEqEditor();}if(eqDrag==null)return;var band=p.effects.eq.bands[eqDrag];band.freq=freqForX(x,rect.width);if(band.type!=="highpass"&&band.type!=="lowpass")band.gain=gainForY(y,rect.height);renderEqEditor();engine.update(p);persistSoon();if(event.type==="pointerup"||event.type==="pointercancel")eqDrag=null;}
    document.querySelector("#eqGraph").addEventListener("pointerdown",eqPointer);document.querySelector("#eqGraph").addEventListener("pointermove",eqPointer);document.querySelector("#eqGraph").addEventListener("pointerup",eqPointer);document.querySelector("#eqGraph").addEventListener("pointercancel",eqPointer);window.addEventListener("resize",function(){drawEq();renderWaveform();});
    project=loadProject();selected=project.selected;keyOptions(document.querySelector("#padKey"));keyOptions(document.querySelector("#rootKey"));applyTheme();loadForm();waveAnimation(0);

    // =================================================================
    // Perform view: big touch pads, key +/-, Volume/Tone/Reverb/Fade
    // knobs, swell meter. Every control here is also reachable from the
    // hardware control surface (pedal-driver.py) and stays in sync with it.
    // =================================================================
    var KNOBS=[{id:"volume",label:"Volume"},{id:"tone",label:"Tone"},{id:"reverb",label:"Reverb"},{id:"fade",label:"Fade"}];
    var ARC="M21.72 78.28 A40 40 0 1 1 78.28 78.28", ARC_LEN=2*Math.PI*40*.75;
    function isPerforming(){return document.body.classList.contains("performing");}
    function setPerformMode(on){document.body.classList.toggle("performing",!!on);document.querySelector("#perform").classList.toggle("hidden",!on);try{localStorage.setItem("pad-pedal-mode",on?"perform":"edit");}catch(_){}if(!on){drawEq();renderWaveform();}renderPerform();}
    function playingIndex(){if(!engine.active)return -1;var id=engine.active.pad.id;return project.pads.findIndex(function(pad){return pad.id===id;});}
    function knobText(id,v){if(id==="volume")return Math.round(v*100)+"%";if(id==="tone"){var hz=toneHz(v);return v>=.995?"Open":hz>=1000?(hz/1000).toFixed(1)+" kHz":Math.round(hz)+" Hz";}if(id==="reverb")return v<.005?"Dry":"×"+(v*2).toFixed(2);if(id==="fade")return fadeSeconds(currentPad()).toFixed(1)+" s";return String(v);}
    function buildKnobs(){document.querySelector("#pfKnobs").innerHTML=KNOBS.map(function(k){return '<div class="knob" data-knob="'+k.id+'" tabindex="0" role="slider" aria-label="'+k.label+'" aria-valuemin="0" aria-valuemax="100"><svg viewBox="0 0 100 100" aria-hidden="true"><path class="k-track" d="'+ARC+'"/><path class="k-value" d="'+ARC+'" stroke-dasharray="0 999"/><circle class="k-cap" cx="50" cy="50" r="27"/><line class="k-pointer" x1="50" y1="50" x2="50" y2="30"/></svg><b>'+k.label+'</b><span class="k-val"></span></div>';}).join("");}
    function updateKnob(id){var el=document.querySelector('[data-knob="'+id+'"]');if(!el)return;var v=project.performance[id];el.querySelector(".k-value").setAttribute("stroke-dasharray",(ARC_LEN*v).toFixed(2)+" 999");el.querySelector(".k-pointer").setAttribute("transform","rotate("+(-135+270*v).toFixed(1)+" 50 50)");el.querySelector(".k-val").textContent=knobText(id,v);el.setAttribute("aria-valuenow",String(Math.round(v*100)));el.setAttribute("aria-valuetext",knobText(id,v));}
    function updateKnobs(){if(!KNOBS)return;KNOBS.forEach(function(k){updateKnob(k.id);});}
    function setPerformance(id,value){if(!(id in project.performance))return;project.performance[id]=clamp(value,0,1);engine.applyPerformance();updateKnob(id);persistSoon();}
    function setExpression(value){if(engine.morph){project.performance.morph=clamp(value,0,1);engine.setMorph(value);if(window.PPFeatures)window.PPFeatures.renderPerformExtras();return;}engine.setSwell(value);var bar=document.querySelector("#pfExpr");if(bar)bar.style.width=Math.round(clamp(value,0,1)*100)+"%";}
    function renderPerform(){if(window.PPScenes)window.PPScenes.layersChanged();var root=document.querySelector("#pfPads");if(!root||!project)return;var playingList=engine.playingIndexes();root.innerHTML=project.pads.map(function(pad,i){var src=pad.sampleId?((sampleFor(pad.sampleId)||{}).name||"Imported audio"):pad.voice;return '<button class="pf-pad'+(playingList.indexOf(i)>-1?" playing":"")+(i===selected?" selected":"")+'" style="--padc:'+(window.PPColors?window.PPColors.pad(i):"")+'" data-pf-pad="'+i+'"><span class="n">'+(i+1)+"</span><b>"+escapeHtml(pad.name)+"</b><small>"+playKeyFor(pad).replace("#","♯")+" · "+escapeHtml(src)+"</small></button>";}).join("");var stopBtn=document.querySelector("#pfStop");if(stopBtn)stopBtn.querySelector("small").textContent=engine.active?"fade out":"again = cut";document.querySelector("#pfKey").textContent=playKeyFor(currentPad()).replace("#","♯");if(window.PPFeatures)window.PPFeatures.renderPerformExtras();document.querySelector("#pfProject").textContent=project.name;updateKnobs();}
    // Tap a pad = play it (crossfading from whatever is playing). Tap the playing pad again = fade it out.
    function triggerPad(index,opts){index=clamp(index,0,PAD_COUNT-1);opts=opts||{};if(window.PPFeatures&&window.PPFeatures.interceptPad(index))return;var layer=opts.layer||project.performance.layerMode,playing=engine.voiceFor(index);
      if(layer){selected=index;editingInput=false;engine.playPad(index,null,{layer:true});return;}
      if(playing&&engine.voices().length===1){engine.stop();return;}setSelectedPad(index,true);}
    function changeKey(delta){var song=activeSong();if(song){song.key=KEYS[((noteIndex(song.key)+delta)%12+12)%12];persistSoon();if(engine.active)engine.playPad(playingIndex()>-1?playingIndex():selected);else setStatus("Song key: "+song.key.replace("#","♯"));renderPads();return;}var p=currentPad(),n=((noteIndex(p.key)+delta)%12+12)%12;p.key=KEYS[n];document.querySelector("#padKey").value=p.key;persistSoon();if(engine.active&&engine.active.pad.id===p.id)engine.playPad(selected);else setStatus(p.name+" key: "+p.key.replace("#","♯"));renderPads();}
    function toggleSelected(){if(engine.active&&engine.active.pad.id===currentPad().id)engine.stop();else engine.playPad(selected);}

    (function wirePerform(){
      var pads=document.querySelector("#pfPads"),knobs=document.querySelector("#pfKnobs"),drag=null;
      function hit(event){var b=event.target.closest("[data-pf-pad],[data-pf-stop]");if(!b)return;if(b.dataset.pfStop)engine.stop();else triggerPad(Number(b.dataset.pfPad));}
      pads.addEventListener("pointerdown",function(event){if(event.button>0)return;event.preventDefault();hit(event);});
      pads.addEventListener("click",function(event){if(event.detail===0)hit(event);}); // keyboard Enter/Space on a focused pad
      knobs.addEventListener("pointerdown",function(event){var el=event.target.closest("[data-knob]");if(!el)return;event.preventDefault();el.focus();drag={id:el.dataset.knob,y:event.clientY,v:project.performance[el.dataset.knob]};el.setPointerCapture(event.pointerId);});
      knobs.addEventListener("pointermove",function(event){if(drag)setPerformance(drag.id,drag.v+(drag.y-event.clientY)/180);});
      ["pointerup","pointercancel"].forEach(function(type){knobs.addEventListener(type,function(){drag=null;});});
      knobs.addEventListener("wheel",function(event){var el=event.target.closest("[data-knob]");if(!el)return;event.preventDefault();setPerformance(el.dataset.knob,project.performance[el.dataset.knob]-event.deltaY*.0015);},{passive:false});
      knobs.addEventListener("keydown",function(event){var el=event.target.closest("[data-knob]");if(!el)return;var step=event.shiftKey?.1:.02,up=event.key==="ArrowUp"||event.key==="ArrowRight",down=event.key==="ArrowDown"||event.key==="ArrowLeft";if(up||down){event.preventDefault();event.stopPropagation();setPerformance(el.dataset.knob,project.performance[el.dataset.knob]+(up?step:-step));}});
      knobs.addEventListener("dblclick",function(event){var el=event.target.closest("[data-knob]");if(el)setPerformance(el.dataset.knob,defaultPerformance()[el.dataset.knob]);});
      var stopSide=document.querySelector("#pfStop");if(stopSide)stopSide.addEventListener("click",function(){engine.stop();});
      document.querySelector("#pfKeyDown").addEventListener("click",function(){changeKey(-1);});
      document.querySelector("#pfKeyUp").addEventListener("click",function(){changeKey(1);});
      document.querySelector("#pfEdit").addEventListener("click",function(){setPerformMode(false);});
      document.querySelector("#performButton").addEventListener("click",function(){setPerformMode(true);});
      // Touch screens: a pointerdown alone may not unlock audio; the following pointerup always does.
      document.addEventListener("pointerup",function(){if(engine.ctx&&engine.ctx.state!=="running")engine.ctx.resume();});
    })();

    // =================================================================
    // Hardware control surface bridge (talks to pedal-driver.py)
    // =================================================================
    // Two-way: the driver sends footswitch/knob/encoder/expression events,
    // and this page sends back which pad is playing so the pad LEDs match.
    // With no driver running (any PC), connecting just fails quietly and
    // retries; touch, mouse and keyboard keep working exactly the same.
    var PedalBridge = {
      url: "ws://127.0.0.1:8765",
      socket: null,
      connected: false,
      info: null,
      reconnectDelay: 2000,
      handleMessage: function (message) {
        if (!message || typeof message !== "object") return;
        switch (message.type) {
          case "hello":
            this.connected = true; this.info = message; this.showStatus(); adoptDriverProject(); mirrorSoon();
            if (!this.roleSent && this.socket && this.socket.readyState === 1) { this.roleSent = true; try { this.socket.send(JSON.stringify({ type: "role", role: "app" })); } catch (_) {} }
            else { this.sendState(); setStatus("Connected to the Central Control"); }
            if (window.PPFeatures) window.PPFeatures.handleHardware(message);
            break;
          case "pad": if (Number.isInteger(message.index)) { if (window.PPFeatures) window.PPFeatures.footswitchPad(message.index); else triggerPad(message.index); } break;
          case "stop": engine.stop(); break;
          case "panic": engine.panic(); break;
          case "knob": if (typeof message.value === "number") setPerformance(message.id, message.value); break;
          case "expression": if (typeof message.value === "number") setExpression(message.value); break;
          case "encoder": changeKey(message.delta < 0 ? -1 : 1); break;
          case "encoderPress": toggleSelected(); break;
          case "encoderHold": setPerformMode(!isPerforming()); break;
          default: if (window.PPFeatures) window.PPFeatures.handleHardware(message);
        }
      },
      sendState: function () {
        if (!this.socket || this.socket.readyState !== 1) return;
        try { this.socket.send(JSON.stringify({ type: "state", playing: playingIndex(), playingAll: engine.playingIndexes(), selected: selected })); } catch (_) {}
        if (window.PPActions && window.PPActions.sendLeds) window.PPActions.sendLeds();
      },
      send: function (message) {
        if (!this.socket || this.socket.readyState !== 1) return false;
        try { this.socket.send(JSON.stringify(message)); return true; } catch (_) { return false; }
      },
      showStatus: function () {
        var el = document.querySelector("#pfHw"); if (!el) return;
        el.classList.toggle("on", this.connected);
        el.textContent = this.connected ? "Central Control" + (this.info && this.info.appVersion ? " " + this.info.appVersion : "") : "Not connected"; el.title = this.connected ? "Connected to the Central Control hardware" + (this.info && this.info.hostname ? " (" + this.info.hostname + ")" : "") : "The pedal board / Central Control service is not running - retrying";
      },
      connect: function () {
        var bridge = this, socket;
        if (typeof WebSocket === "undefined") return;
        try { socket = new WebSocket(this.url); } catch (_) { return; }
        this.socket = socket;
        this.roleSent = false;
        socket.onmessage = function (event) { try { bridge.handleMessage(JSON.parse(event.data)); } catch (error) { console.warn("bridge message failed", error); } };
        socket.onclose = function () {
          if (bridge.connected) setStatus("Lost the Central Control service - retrying");
          bridge.connected = false; bridge.socket = null; bridge.showStatus();
          setTimeout(function () { bridge.connect(); }, bridge.reconnectDelay);
        };
      }
    };
    window.__pedalBridge = PedalBridge;

    // ---- audio input channel ----
    document.querySelector("#inputPad").addEventListener("click",function(){editingInput=true;loadForm();});
    document.querySelector("#inputEnabled").addEventListener("change",async function(e){var ok=await engine.setInput(e.target.checked);if(!ok&&e.target.checked)e.target.checked=false;persistSoon();renderInputPad();renderChain();});

    // ---- internal API for the feature modules (graphics.js, features.js) ----
    window.PP={engine:engine,project:function(){return project;},currentPad:currentPad,selected:function(){return selected;},isEditingInput:function(){return editingInput;},editingBand:function(){return editingBand;},
      setSelectedPad:setSelectedPad,triggerPad:triggerPad,changeKey:changeKey,setStatus:setStatus,persistSoon:persistSoon,persistNow:persistNow,mirrorNow:mirrorNow,adoptDriverProject:adoptDriverProject,renderPads:renderPads,loadForm:loadForm,renderChain:renderChain,
      setPerformance:setPerformance,setExpression:setExpression,isPerforming:isPerforming,setPerformMode:setPerformMode,playingIndex:playingIndex,activeSong:activeSong,playKeyFor:playKeyFor,
      clamp:clamp,escapeHtml:escapeHtml,KEYS:KEYS,noteIndex:noteIndex,COMP_TYPES:COMP_TYPES,compSettings:compSettings,compOutDb:compOutDb,shaperCurve:shaperCurve,biquadDb:biquadDb,logFreqs:logFreqs,drawSpectrum:drawSpectrum,
      tempoBpm:tempoBpm,syncedRate:syncedRate,DIVISIONS:DIVISIONS,fadeSeconds:fadeSeconds,toneHz:toneHz,graphGeometry:graphGeometry,redrawEq:drawEq,importFile:importFile,sampleFor:sampleFor,storeBlob:storeBlob,getBlob:getBlob,id:id,
      PAD_COUNT:PAD_COUNT,PAD_LIBRARY:PAD_LIBRARY,defaultPad:defaultPad,mergePad:mergePad,renderPerform:renderPerform,toggleSelected:toggleSelected,applyTheme:applyTheme,smoothParam:smoothParam,setStatus:setStatus,chordFor:chordFor};

    buildKnobs();
    var startPerforming = location.hash === "#perform";
    try { startPerforming = startPerforming || localStorage.getItem("pad-pedal-mode") === "perform"; } catch (_) {}
    setPerformMode(startPerforming);
    PedalBridge.connect();

    // Read-only hooks for the automated tests (test-headless.mjs).
    window.__test = {
      engine: engine,
      setSelectedPad: setSelectedPad,
      currentPad: currentPad,
      selectedIndex: function () { return selected; },
      projectPads: function () { return project.pads; },
      performance: function () { return project.performance; },
      playingIndex: playingIndex,
      isPerforming: isPerforming
    };
  })();

/* PP.ask: the app's own text box (window.prompt doesn't exist in the PC app, can't take a password
 * properly and squashes a pasted chord chart onto one line). Returns a Promise: the text, or null. */
(function () {
  "use strict";
  function ask(message, opts) {
    opts = typeof opts === "string" ? { value: opts } : (opts || {});
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "pp-ask";
      var field = opts.multiline ? '<textarea rows="14" spellcheck="false"></textarea>' : '<input type="' + (opts.password ? "password" : "text") + '" autocomplete="off">';
      d.innerHTML = '<form method="dialog"><label><span></span>' + field + '</label>' + (opts.password ? '<label class="toggle"><input type="checkbox" class="pp-ask-show"> Show</label>' : "") +
        '<div class="row"><button value="cancel" type="button" class="pp-ask-cancel">Cancel</button><button value="ok" class="primary">' + (opts.ok || "OK") + "</button></div></form>";
      d.querySelector("span").textContent = message;
      var input = d.querySelector("textarea, input:not(.pp-ask-show)"); input.value = opts.value == null ? "" : String(opts.value);
      if (opts.placeholder) input.placeholder = opts.placeholder;
      var done = false; function finish(v) { if (done) return; done = true; try { d.close(); } catch (_) {} d.remove(); resolve(v); }
      d.querySelector(".pp-ask-cancel").addEventListener("click", function () { finish(null); });
      var show = d.querySelector(".pp-ask-show"); if (show) show.addEventListener("change", function () { input.type = show.checked ? "text" : "password"; });
      d.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); finish(input.value); });
      d.addEventListener("cancel", function (e) { e.preventDefault(); finish(null); });
      d.addEventListener("close", function () { finish(null); });   // closed some other way (the app's Esc key handler)
      if (opts.multiline) input.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(input.value); } });
      document.body.appendChild(d); d.showModal(); input.focus(); if (!opts.multiline) input.select();
    });
  }
  if (window.PP) window.PP.ask = ask; window.PPAsk = ask;
})();
