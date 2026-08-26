/* CLEARWAYS NEXUS — COMMAND INTERFACE SCRIPT */
const bhubaneswarIntersections = ["Jaydev Vihar","Vani Vihar","Master Canteen","Acharya Vihar","Rasulgarh","Kalinga Hospital","Patia Square","Dhauli Square","Sishupalgarh","Khandagiri","Chandrasekharpur","Infocity Square","KIIT Square","Nandankanan","Damana","Palasuni","Bomikhal","Laxmi Sagar","Saheed Nagar","Cuttack Road","Gajapati Nagar","Nayapalli","Bhubaneswar Airport","Capital Hospital","Madhusudan Nagar","Forest Park","Baramunda","Sikharchandi","Mancheswar","Patrapada"];
const intersections = [];
for (let i = 0; i < 100; i++) {
    const name = bhubaneswarIntersections[i % bhubaneswarIntersections.length];
    intersections.push({ id:`${name} - ${i+1}`, name, gridIndex:i, status:'low', vehicleCount:0, averageSpeed:0, congestionPct:0,
        lanes:[{direction:'North',vehicleCount:0,averageSpeed:0,light:'green',manualActive:false},{direction:'East',vehicleCount:0,averageSpeed:0,light:'red',manualActive:false},{direction:'South',vehicleCount:0,averageSpeed:0,light:'green',manualActive:false},{direction:'West',vehicleCount:0,averageSpeed:0,light:'red',manualActive:false}]});
}
let currentView='overview', currentIntersection=null, radarChart=null, timelineChart=null, donutChart=null, laneBarChart=null;
let signalTimer=null, signalCountdown=30, threeNodeColors=null, threeNodeGeo=null;

function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function toggleClass(id,cls,force){const el=document.getElementById(id);if(el)el.classList.toggle(cls,force);}
function statusColor(s){return s==='critical'?'var(--red)':s==='medium'?'var(--amber)':'var(--green)';}

function initThreeJS() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas || typeof THREE === 'undefined') return;
    const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.1, 200);
    camera.position.set(0,0,22);
    const COLS=10, ROWS=10, SP=2.35, TOTAL=COLS*ROWS;
    const nPos = new Float32Array(TOTAL*3), nCol = new Float32Array(TOTAL*3);
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) { const idx=(r*COLS+c)*3; nPos[idx]=(c-COLS/2+0.5)*SP; nPos[idx+1]=(r-ROWS/2+0.5)*SP; nPos[idx+2]=0; nCol[idx]=0; nCol[idx+1]=0.45; nCol[idx+2]=0.65; }
    const nGeo = new THREE.BufferGeometry();
    nGeo.setAttribute('position', new THREE.BufferAttribute(nPos,3));
    nGeo.setAttribute('color', new THREE.BufferAttribute(nCol,3));
    scene.add(new THREE.Points(nGeo, new THREE.PointsMaterial({vertexColors:true,size:0.28,sizeAttenuation:true})));
    threeNodeColors=nCol; threeNodeGeo=nGeo;
    const lv=[];
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) { const x=(c-COLS/2+0.5)*SP, y=(r-ROWS/2+0.5)*SP; if(c<COLS-1)lv.push(x,y,0,x+SP,y,0); if(r<ROWS-1)lv.push(x,y,0,x,y+SP,0); }
    const lGeo=new THREE.BufferGeometry(); lGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(lv),3));
    scene.add(new THREE.LineSegments(lGeo,new THREE.LineBasicMaterial({color:0x003355,opacity:0.2,transparent:true})));
    const PC=200, pPos=new Float32Array(PC*3);
    for(let i=0;i<PC;i++){pPos[i*3]=(Math.random()-0.5)*55;pPos[i*3+1]=(Math.random()-0.5)*42;pPos[i*3+2]=(Math.random()-0.5)*22-4;}
    const pGeo=new THREE.BufferGeometry(); pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
    const particles=new THREE.Points(pGeo,new THREE.PointsMaterial({color:0x004466,size:0.07,opacity:0.48,transparent:true}));
    scene.add(particles);
    let t=0;
    (function animate(){requestAnimationFrame(animate);t+=0.003;camera.position.z=22+Math.sin(t*0.4)*1.1;camera.position.x=Math.sin(t*0.22)*0.9;camera.position.y=Math.cos(t*0.28)*0.55;camera.lookAt(0,0,0);particles.rotation.z+=0.0004;renderer.render(scene,camera);})();
    window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);});
}

function updateThreeColors() {
    if(!threeNodeColors||!threeNodeGeo) return;
    intersections.forEach((int,i)=>{
        const idx=i*3;
        if(int.status==='critical'){threeNodeColors[idx]=1;threeNodeColors[idx+1]=0.12;threeNodeColors[idx+2]=0.14;}
        else if(int.status==='medium'){threeNodeColors[idx]=1;threeNodeColors[idx+1]=0.55;threeNodeColors[idx+2]=0;}
        else{threeNodeColors[idx]=0;threeNodeColors[idx+1]=0.9;threeNodeColors[idx+2]=0.45;}
    });
    threeNodeGeo.attributes.color.needsUpdate=true;
}

function updateSimulation() {
    intersections.forEach(int => {
        int.lanes.forEach(lane => {
            if (!lane.manualActive) { lane.vehicleCount=Math.floor(Math.random()*115)+5; lane.averageSpeed=Math.floor(Math.random()*58)+10; }
        });
        const notManual=int.lanes.filter(l=>!l.manualActive);
        if(notManual.length>0){
            const maxLane=notManual.reduce((a,b)=>a.vehicleCount>b.vehicleCount?a:b);
            notManual.forEach(lane=>{ if(lane===maxLane)lane.light='green'; else if(lane.vehicleCount>int.lanes.reduce((s,l)=>s+l.vehicleCount,0)/5)lane.light='yellow'; else lane.light='red'; });
        }
        int.vehicleCount=int.lanes.reduce((s,l)=>s+l.vehicleCount,0);
        int.averageSpeed=Math.round(int.lanes.reduce((s,l)=>s+l.averageSpeed,0)/int.lanes.length);
        int.congestionPct=Math.min(100,Math.round((int.vehicleCount/(120*4))*100*2.5));
        int.status=int.vehicleCount>280?'critical':int.vehicleCount>130?'medium':'low';
    });
    updateGridUI(); updateTopBar(); updateKPIs(); updateThreeColors(); updateTicker();
    if(currentIntersection) refreshDetailData();
    const critical=intersections.filter(i=>i.status==='critical').length;
    setText('nav-badge', critical);
}

function buildGrid() {
    const grid=document.getElementById('city-grid'); if(!grid) return;
    grid.innerHTML='';
    intersections.forEach((int,i)=>{
        const cell=document.createElement('div'); cell.className='grid-cell'; cell.id='cell-'+i;
        cell.innerHTML='<div class="cell-name">'+int.name+'</div><div class="cell-count" id="cc-'+i+'">0</div><div class="cell-speed" id="cs-'+i+'">0 km/h</div><div class="cell-bar-wrap"><div class="cell-bar-fill" id="cb-'+i+'" style="width:0%"></div></div>';
        cell.addEventListener('mouseenter', e=>showTooltip(e,int));
        cell.addEventListener('mousemove', moveTooltip);
        cell.addEventListener('mouseleave', hideTooltip);
        cell.addEventListener('click', ()=>showDetailView(int));
        grid.appendChild(cell);
    });
}

function updateGridUI() {
    intersections.forEach((int,i)=>{
        const cell=document.getElementById('cell-'+i), cc=document.getElementById('cc-'+i), cs=document.getElementById('cs-'+i), cb=document.getElementById('cb-'+i);
        if(!cell) return;
        cell.className='grid-cell status-'+int.status;
        if(cc){cc.textContent=int.vehicleCount; cc.className='cell-count status-'+int.status;}
        if(cs) cs.textContent=int.averageSpeed+' km/h';
        if(cb){cb.style.width=int.congestionPct+'%'; cb.className='cell-bar-fill status-'+int.status;}
    });
}

function updateTopBar() {
    const avgC=Math.round(intersections.reduce((s,i)=>s+i.congestionPct,0)/intersections.length);
    const avgS=Math.round(intersections.reduce((s,i)=>s+i.averageSpeed,0)/intersections.length);
    setText('top-congestion',avgC+'%'); setText('top-speed',avgS+' km/h');
}

function updateKPIs() {
    const avgC=Math.round(intersections.reduce((s,i)=>s+i.congestionPct,0)/intersections.length);
    const avgS=Math.round(intersections.reduce((s,i)=>s+i.averageSpeed,0)/intersections.length);
    const crit=intersections.filter(i=>i.status==='critical').length;
    setText('kpi-congestion',avgC+'%'); setText('kpi-speed',avgS+' km/h');
    setText('kpi-cong-detail',crit+' critical nodes');
}

function showTooltip(e, int) {
    const tt=document.getElementById('tooltip'); if(!tt) return;
    tt.classList.remove('hidden'); tt.classList.add('visible');
    setText('tt-name',int.name); setText('tt-vehicles',int.vehicleCount+' vehicles'); setText('tt-speed',int.averageSpeed+' km/h avg');
    const st=document.getElementById('tt-status'); if(st){st.textContent=int.status.toUpperCase(); st.style.color=statusColor(int.status);}
    moveTooltip(e);
}
function moveTooltip(e) {
    const tt=document.getElementById('tooltip'); if(!tt) return;
    let x=e.clientX+16, y=e.clientY+16; const r=tt.getBoundingClientRect();
    if(x+r.width>window.innerWidth) x=e.clientX-r.width-10;
    if(y+r.height>window.innerHeight) y=e.clientY-r.height-10;
    tt.style.left=x+'px'; tt.style.top=y+'px';
}
function hideTooltip() { const tt=document.getElementById('tooltip'); if(tt){tt.classList.remove('visible');tt.classList.add('hidden');} }

function switchView(name) {
    document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const view=document.getElementById('view-'+name), btn=document.querySelector('[data-view="'+name+'"]');
    if(view) view.classList.remove('hidden');
    if(btn) btn.classList.add('active');
    currentView=name;
    const titles={overview:'TRAFFIC COMMAND CENTER',analytics:'ANALYTICS INTELLIGENCE',incidents:'INCIDENT MANAGEMENT'};
    const subs={overview:'Bhubaneswar Metropolitan Area - Live Feed',analytics:'Real-time traffic pattern analysis',incidents:'AI-powered alerts & recommendations'};
    setText('view-title',titles[name]||name.toUpperCase()); setText('view-sub',subs[name]||'');
    if(name==='analytics') updateAnalytics();
    if(name==='incidents') updateIncidents();
    if(typeof gsap!=='undefined'&&view) gsap.from(view.children,{opacity:0,y:20,duration:0.42,stagger:0.07,ease:'power2.out'});
}

function showDetailView(int) {
    hideTooltip(); currentIntersection=int;
    document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const detail=document.getElementById('view-detail'); detail.classList.remove('hidden');
    setText('view-title','INTERSECTION DETAIL'); setText('view-sub',int.id);
    setText('detail-name',int.name); setText('qs-vehicles',int.vehicleCount); setText('qs-speed',int.averageSpeed);
    setText('detail-id-badge','ID: '+int.id);
    const badge=document.getElementById('detail-status-badge');
    if(badge){badge.textContent=int.status.toUpperCase(); badge.className='status-badge '+int.status;}
    updateSignalDisplay(int); updateLanesGrid(int); updateOverrideGrid(int); updateFlowCompass(int); updateRadarChart(int); updateAIConfidence(int);
    if(signalTimer) clearInterval(signalTimer);
    signalCountdown=30;
    signalTimer=setInterval(()=>{
        signalCountdown=signalCountdown<=1?30:signalCountdown-1;
        setText('sig-countdown',signalCountdown+'s');
        const bar=document.getElementById('sig-bar-fill'); if(bar) bar.style.width=((signalCountdown/30)*100)+'%';
    },1000);
    if(typeof gsap!=='undefined'){
        gsap.from('.detail-topbar',{opacity:0,y:-16,duration:0.38,ease:'power2.out'});
        gsap.from('.detail-body > *',{opacity:0,y:22,duration:0.48,stagger:0.1,ease:'power2.out',delay:0.1});
    }
}

function refreshDetailData() {
    if(!currentIntersection) return;
    updateSignalDisplay(currentIntersection); updateLanesGrid(currentIntersection); updateFlowCompass(currentIntersection);
    setText('qs-vehicles',currentIntersection.vehicleCount); setText('qs-speed',currentIntersection.averageSpeed);
}

function updateSignalDisplay(int) {
    const greenLanes=int.lanes.filter(l=>l.light==='green').map(l=>l.direction);
    const yellowLanes=int.lanes.filter(l=>l.light==='yellow').map(l=>l.direction);
    const phase=greenLanes.length>0?greenLanes.join('-')+' GREEN':yellowLanes.length>0?'YIELD':'ALL RED';
    setText('sig-phase',phase);
    const hasGreen=greenLanes.length>0, hasYellow=yellowLanes.length>0;
    toggleClass('pl-red','active',!hasGreen&&!hasYellow);
    toggleClass('pl-yellow','active',hasYellow&&!hasGreen);
    toggleClass('pl-green','active',hasGreen);
}

function updateLanesGrid(int) {
    const grid=document.getElementById('lanes-grid'); if(!grid) return;
    grid.innerHTML='';
    int.lanes.forEach(lane=>{
        const pct=Math.min(100,Math.round((lane.vehicleCount/120)*100));
        const barColor=lane.vehicleCount>80?'var(--red)':lane.vehicleCount>40?'var(--amber)':'var(--green)';
        const card=document.createElement('div'); card.className='lane-card';
        card.innerHTML='<div class="lane-direction">'+lane.direction.toUpperCase()+'<div class="lane-light-dot '+lane.light+'"></div></div>'
            +'<div class="lane-vehicles">'+lane.vehicleCount+'</div>'
            +'<div class="lane-speed">'+lane.averageSpeed+' km/h</div>'
            +'<div class="lane-bar-wrap"><div class="lane-bar-fill" style="width:'+pct+'%;background:'+barColor+'"></div></div>'
            +'<div class="ai-tag">'+(lane.manualActive?'<i class="fas fa-hand-pointer" style="color:var(--amber)"></i> Manual':'<i class="fas fa-brain"></i> AI Control')+'</div>';
        grid.appendChild(card);
    });
}

function updateOverrideGrid(int) {
    const grid=document.getElementById('override-grid'); if(!grid) return;
    grid.innerHTML='';
    int.lanes.forEach(lane=>{
        const card=document.createElement('div'); card.className='override-card';
        card.innerHTML='<div class="override-dir">'+lane.direction.toUpperCase()+'</div>'
            +'<div class="override-lights">'
            +'<button class="ov-light-btn red-btn '+(lane.light==='red'?'active':'inactive')+'" data-dir="'+lane.direction+'" data-color="red"></button>'
            +'<button class="ov-light-btn yellow-btn '+(lane.light==='yellow'?'active':'inactive')+'" data-dir="'+lane.direction+'" data-color="yellow"></button>'
            +'<button class="ov-light-btn green-btn '+(lane.light==='green'?'active':'inactive')+'" data-dir="'+lane.direction+'" data-color="green"></button>'
            +'</div>'
            +'<div class="override-mode '+(lane.manualActive?'manual':'')+'">'+( lane.manualActive?'Manual':'AI')+'</div>'
            +'<button class="revert-lane-btn" data-dir="'+lane.direction+'"'+(lane.manualActive?'':' disabled')+'>Revert AI</button>';
        grid.appendChild(card);
    });
    grid.querySelectorAll('.ov-light-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
            const lane=currentIntersection.lanes.find(l=>l.direction===btn.dataset.dir);
            if(lane){lane.light=btn.dataset.color;lane.manualActive=true;updateOverrideGrid(currentIntersection);updateLanesGrid(currentIntersection);updateSignalDisplay(currentIntersection);updateFlowCompass(currentIntersection);}
        });
    });
    grid.querySelectorAll('.revert-lane-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
            const lane=currentIntersection.lanes.find(l=>l.direction===btn.dataset.dir);
            if(lane){lane.manualActive=false;lane.light='red';updateOverrideGrid(currentIntersection);updateLanesGrid(currentIntersection);updateSignalDisplay(currentIntersection);}
        });
    });
}

function updateFlowCompass(int) {
    const map={north:'North',east:'East',south:'South',west:'West'};
    const idMap={north:'flow-n',east:'flow-e',south:'flow-s',west:'flow-w'};
    const lgMap={north:'fl-north',east:'fl-east',south:'fl-south',west:'fl-west'};
    Object.keys(map).forEach(d=>{
        const lane=int.lanes.find(l=>l.direction===map[d]); if(!lane) return;
        setText(idMap[d],lane.vehicleCount);
        const lg=document.getElementById(lgMap[d]); if(lg) lg.className='flow-light '+lane.light;
    });
}

function updateRadarChart(int) {
    const ctx=document.getElementById('detail-radar'); if(!ctx) return;
    if(radarChart){radarChart.destroy();radarChart=null;}
    radarChart=new Chart(ctx,{type:'radar',data:{labels:['North','East','South','West'],datasets:[{label:'Vehicles',data:int.lanes.map(l=>l.vehicleCount),backgroundColor:'rgba(0,212,255,0.09)',borderColor:'rgba(0,212,255,0.7)',pointBackgroundColor:'#00d4ff',pointBorderColor:'#fff',borderWidth:2}]},
        options:{responsive:true,maintainAspectRatio:false,scales:{r:{angleLines:{color:'rgba(0,212,255,0.09)'},grid:{color:'rgba(0,212,255,0.07)'},pointLabels:{color:'#5a7a9a',font:{family:'Orbitron',size:8}},ticks:{display:false},beginAtZero:true}},plugins:{legend:{display:false}}}});
}

function updateAIConfidence(int) {
    const canvas=document.getElementById('ai-ring-canvas'); if(!canvas) return;
    const conf=75+Math.floor(Math.random()*20);
    const ctx=canvas.getContext('2d'), cx=canvas.width/2, cy=canvas.height/2, r=52;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.strokeStyle='rgba(0,212,255,0.09)'; ctx.lineWidth=7; ctx.stroke();
    const angle=(conf/100)*Math.PI*2-Math.PI/2;
    ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,angle);
    const grad=ctx.createLinearGradient(cx-r,cy,cx+r,cy); grad.addColorStop(0,'#0066ff'); grad.addColorStop(1,'#00d4ff');
    ctx.strokeStyle=grad; ctx.lineWidth=7; ctx.lineCap='round'; ctx.stroke();
    setText('ai-ring-val',conf+'%');
    const maxLane=int.lanes.reduce((a,b)=>a.vehicleCount>b.vehicleCount?a:b);
    const sug=['Extend green on '+maxLane.direction+' lane by 15s to ease queue','Congestion wave predicted - pre-emptive green recommended','Sync with adjacent node for green-wave corridor','High activity - reduce vehicle throughput','Optimal cycle: 45s based on current density'];
    const sugEl=document.getElementById('ai-suggestion'); if(sugEl) sugEl.querySelector('span').textContent=sug[Math.floor(Math.random()*sug.length)];
}

function updateTicker() {
    const critical=intersections.filter(i=>i.status==='critical');
    const medium=intersections.filter(i=>i.status==='medium');
    const msgs=[];
    critical.slice(0,5).forEach(i=>msgs.push({t:'[CRITICAL] '+i.name+' - '+i.vehicleCount+' vehicles | '+i.averageSpeed+' km/h',cls:'critical'}));
    medium.slice(0,3).forEach(i=>msgs.push({t:'[MODERATE] '+i.name+' - '+i.vehicleCount+' vehicles',cls:'warning'}));
    msgs.push({t:'[OK] AI signal optimization active across all 100 nodes',cls:'ok'});
    msgs.push({t:'[SYS] '+new Date().toLocaleTimeString('en-IN')+' - All sensors nominal',cls:''});
    const inner=document.getElementById('ticker-inner'); if(!inner) return;
    const all=[...msgs,...msgs];
    inner.innerHTML=all.map(m=>'<span class="ticker-item '+m.cls+'">'+m.t+'</span>').join('  |  ');
}

function initAnalytics() {
    const sel=document.getElementById('analytics-select');
    if(sel&&sel.options.length===0){
        bhubaneswarIntersections.forEach(name=>{const opt=document.createElement('option');opt.value=name;opt.textContent=name;sel.appendChild(opt);});
        sel.addEventListener('change',updateAnalytics);
    }
}

function updateAnalytics() { updateTimelineChart(); updateDonutChart(); updateCriticalZones(); updateLaneBarChart(); }

function updateTimelineChart() {
    const ctx=document.getElementById('timeline-chart'); if(!ctx) return;
    if(timelineChart){timelineChart.destroy();timelineChart=null;}
    const hours=Array.from({length:24},(_,i)=>i+':00');
    const peaks=[8,9,17,18,19];
    const data=hours.map((_,i)=>peaks.includes(i)?Math.floor(Math.random()*30)+55:Math.floor(Math.random()*35)+10);
    timelineChart=new Chart(ctx,{type:'line',data:{labels:hours,datasets:[{label:'Congestion %',data,borderColor:'rgba(0,212,255,0.8)',backgroundColor:'rgba(0,212,255,0.05)',fill:true,tension:0.45,pointRadius:2.5,pointBackgroundColor:'#00d4ff',borderWidth:2}]},
        options:{responsive:true,maintainAspectRatio:false,scales:{x:{grid:{color:'rgba(0,212,255,0.04)'},ticks:{color:'#2a3a4a',font:{size:9}}},y:{grid:{color:'rgba(0,212,255,0.04)'},ticks:{color:'#2a3a4a',font:{size:9}},max:100,beginAtZero:true}},plugins:{legend:{display:false}}}});
}

function updateDonutChart() {
    const ctx=document.getElementById('donut-chart'); if(!ctx) return;
    if(donutChart){donutChart.destroy();donutChart=null;}
    const labels=['Cars','Two-Wheelers','Trucks'], data=[52,28,20], colors=['#00d4ff','#00ff88','#ff9900'];
    donutChart=new Chart(ctx,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors.map(c=>c+'77'),borderColor:colors,borderWidth:2}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'72%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.parsed+'%'}}}}});
    const lc=document.getElementById('donut-labels');
    if(lc) lc.innerHTML=labels.map((l,i)=>'<div class="donut-label-item"><div class="donut-dot" style="background:'+colors[i]+'"></div><span>'+l+' '+data[i]+'%</span></div>').join('');
}

function updateCriticalZones() {
    const c=document.getElementById('critical-zones'); if(!c) return;
    const sorted=[...intersections].sort((a,b)=>b.vehicleCount-a.vehicleCount).slice(0,5);
    const mx=sorted[0]?sorted[0].vehicleCount:1;
    c.innerHTML=sorted.map((int,i)=>'<div class="cz-item"><div class="cz-rank">#'+(i+1)+'</div><div class="cz-name">'+int.name+'</div><div class="cz-bar-wrap"><div class="cz-bar-fill" style="width:'+Math.round((int.vehicleCount/mx)*100)+'%"></div></div><div class="cz-pct">'+int.vehicleCount+'</div></div>').join('');
}

function updateLaneBarChart() {
    const ctx=document.getElementById('lane-chart'); if(!ctx) return;
    if(laneBarChart){laneBarChart.destroy();laneBarChart=null;}
    const sel=document.getElementById('analytics-select');
    const name=sel?sel.value:bhubaneswarIntersections[0];
    const int=intersections.find(i=>i.name===name)||intersections[0];
    laneBarChart=new Chart(ctx,{type:'bar',data:{labels:int.lanes.map(l=>l.direction),datasets:[{label:'Vehicles',data:int.lanes.map(l=>l.vehicleCount),backgroundColor:['rgba(0,212,255,0.35)','rgba(0,255,136,0.35)','rgba(255,153,0,0.35)','rgba(255,48,64,0.35)'],borderColor:['#00d4ff','#00ff88','#ff9900','#ff3040'],borderWidth:2,borderRadius:5}]},
        options:{responsive:true,maintainAspectRatio:false,scales:{x:{grid:{display:false},ticks:{color:'#5a7a9a',font:{family:'Orbitron',size:9}}},y:{grid:{color:'rgba(0,212,255,0.04)'},ticks:{color:'#5a7a9a',font:{size:9}},beginAtZero:true}},plugins:{legend:{display:false}}}});
}

function updateIncidents() { updateAIRecs(); updateActiveIncidents(); updateIncidentLog(); }

function updateAIRecs() {
    const c=document.getElementById('ai-recs'); if(!c) return;
    const critical=intersections.filter(i=>i.status==='critical').slice(0,3);
    if(!critical.length){c.innerHTML='<div style="color:var(--green);font-size:0.73rem;padding:10px">No critical recommendations at this time</div>';return;}
    c.innerHTML=critical.map(int=>{
        const maxLane=int.lanes.reduce((a,b)=>a.vehicleCount>b.vehicleCount?a:b);
        return '<div class="ai-rec-item"><div class="ai-rec-header"><i class="fas fa-robot" style="color:var(--cyan);font-size:0.68rem"></i><div class="ai-rec-location">'+int.name+'</div></div>'
            +'<div class="ai-rec-desc">High congestion ('+int.vehicleCount+' vehicles). Extend green on '+maxLane.direction+' lane by 20s.</div>'
            +'<div class="ai-rec-actions"><button class="btn-apply">Apply</button><button class="btn-dismiss">Dismiss</button></div></div>';
    }).join('');
    c.querySelectorAll('.btn-apply').forEach(btn=>{btn.addEventListener('click',()=>{btn.textContent='Applied';btn.style.opacity='0.5';btn.disabled=true;});});
    c.querySelectorAll('.btn-dismiss').forEach(btn=>{btn.addEventListener('click',()=>{const item=btn.closest('.ai-rec-item');item.style.opacity='0';setTimeout(()=>item.remove(),280);});});
}

function updateActiveIncidents() {
    const c=document.getElementById('active-incidents'); if(!c) return;
    const all=[...intersections.filter(i=>i.status==='critical').slice(0,3).map(i=>({location:i.name,desc:i.vehicleCount+' vehicles - heavy congestion',sev:'critical',time:'Just now',tag:'CONGESTION'})),...intersections.filter(i=>i.status==='medium').slice(0,2).map(i=>({location:i.name,desc:i.vehicleCount+' vehicles - moderate flow',sev:'medium',time:'3 min ago',tag:'MODERATE'}))];
    if(!all.length){c.innerHTML='<div style="color:var(--green);font-size:0.73rem;padding:10px">No active incidents</div>';return;}
    c.innerHTML=all.map(inc=>'<div class="incident-item"><div class="inc-severity '+inc.sev+'"></div><div class="inc-body"><div class="inc-location">'+inc.location+'</div><div class="inc-desc">'+inc.desc+'</div><div class="inc-time">'+inc.time+'</div></div><span class="inc-tag '+inc.sev+'">'+inc.tag+'</span></div>').join('');
}

function updateIncidentLog() {
    const c=document.getElementById('incident-log'); if(!c) return;
    const now=new Date();
    const events=['Signal optimized by AI','Congestion detected','Manual override activated','Congestion cleared','Critical threshold reached','Green wave applied','Sensor data updated','Phase adjusted'];
    const sevs=['ok','warning','warning','ok','critical','ok','ok','ok'];
    const logs=Array.from({length:14},(_,i)=>{
        const t=new Date(now.getTime()-(i*7+Math.random()*4)*60000);
        const int=intersections[Math.floor(Math.random()*intersections.length)];
        const ei=Math.floor(Math.random()*events.length);
        return {time:t.toLocaleTimeString('en-IN',{hour12:false,hour:'2-digit',minute:'2-digit'}),loc:int.name,msg:events[ei],sev:sevs[ei]};
    });
    c.innerHTML=logs.map(l=>'<div class="log-item"><span class="log-time">'+l.time+'</span><span class="log-loc">'+l.loc+'</span><span class="log-msg">'+l.msg+'</span><span class="log-sev inc-tag '+l.sev+'">'+l.sev.toUpperCase()+'</span></div>').join('');
}

function updateClock() {
    const now=new Date();
    setText('clock-time',now.toLocaleTimeString('en-IN',{hour12:false}));
    setText('clock-date',now.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}));
}

function animCount(elId,target,suffix) {
    suffix=suffix||'';
    const el=document.getElementById(elId); if(!el) return;
    let v=0; const step=target/45;
    const iv=setInterval(()=>{v=Math.min(v+step,target);el.textContent=Math.round(v)+suffix;if(v>=target)clearInterval(iv);},28);
}

function runLoading(cb) {
    const bar=document.getElementById('ls-bar'), msg=document.getElementById('ls-msg'), screen=document.getElementById('loading-screen');
    const msgs=['INITIALIZING NEXUS INTERFACE...','CONNECTING TO TRAFFIC SENSORS...','LOADING INTERSECTION DATA...','CALIBRATING AI MODELS...','RENDERING COMMAND CENTER...','SYSTEM READY'];
    let p=0;
    const iv=setInterval(()=>{
        p+=16; const mi=Math.min(Math.floor(p/18),msgs.length-1);
        if(bar) bar.style.width=Math.min(100,p)+'%';
        if(msg) msg.textContent=msgs[mi];
        if(p>=100){clearInterval(iv);setTimeout(()=>{
            if(typeof gsap!=='undefined'&&screen){gsap.to(screen,{opacity:0,duration:0.55,ease:'power2.in',onComplete:()=>{screen.style.display='none';cb();}});}
            else{if(screen)screen.style.display='none';cb();}
        },280);}
    },200);
}

document.addEventListener('DOMContentLoaded',()=>{
    runLoading(()=>{
        initThreeJS();
        buildGrid();
        initAnalytics();
        updateSimulation();
        setTimeout(()=>{animCount('kpi-nodes',100);animCount('kpi-ai',87,'%');},200);
        setInterval(updateSimulation,3000);
        updateClock(); setInterval(updateClock,1000);
        setInterval(()=>{const r=(Math.random()*2+2).toFixed(1);setText('sb-data-rate',r+' MB/s');},2000);
        document.querySelectorAll('.nav-btn').forEach(btn=>{btn.addEventListener('click',()=>switchView(btn.dataset.view));});
        const backBtn=document.getElementById('back-btn');
        if(backBtn) backBtn.addEventListener('click',()=>{
            if(signalTimer){clearInterval(signalTimer);signalTimer=null;}
            if(radarChart){radarChart.destroy();radarChart=null;}
            currentIntersection=null; switchView('overview');
        });
        const ovToggle=document.getElementById('override-toggle-btn'), ovPanel=document.getElementById('override-panel');
        if(ovToggle&&ovPanel) ovToggle.addEventListener('click',()=>{
            const hidden=ovPanel.classList.contains('hidden'); ovPanel.classList.toggle('hidden');
            const span=ovToggle.querySelector('span'); if(span) span.textContent=hidden?'Hide Manual Override':'Show Manual Override';
        });
        const revertAllBtn=document.getElementById('revert-ai-btn');
        if(revertAllBtn) revertAllBtn.addEventListener('click',()=>{
            if(!currentIntersection) return;
            currentIntersection.lanes.forEach(l=>{l.manualActive=false;l.light='red';});
            updateLanesGrid(currentIntersection); updateOverrideGrid(currentIntersection); updateSignalDisplay(currentIntersection); updateFlowCompass(currentIntersection);
        });
        const fsBtn=document.getElementById('fullscreen-btn');
        if(fsBtn) fsBtn.addEventListener('click',()=>{
            if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
            else if(document.exitFullscreen) document.exitFullscreen();
        });
        if(typeof gsap!=='undefined'){
            gsap.from('#sidebar',{x:-252,opacity:0,duration:0.65,ease:'power2.out'});
            gsap.from('#topbar',{y:-60,opacity:0,duration:0.5,ease:'power2.out',delay:0.2});
            gsap.from('.kpi-card',{opacity:0,y:28,duration:0.5,stagger:0.08,ease:'power2.out',delay:0.45});
            gsap.from('.grid-panel',{opacity:0,scale:0.97,duration:0.65,ease:'power2.out',delay:0.7});
            gsap.from('#alert-ticker',{opacity:0,y:10,duration:0.4,ease:'power2.out',delay:0.9});
        }
    });
});
