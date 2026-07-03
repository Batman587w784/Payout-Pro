import { useState, useEffect, useRef } from "react";
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import {
  Plus, ArrowLeft, Trash2, ChevronRight, ChevronUp, ChevronDown,
  FileText, Users, Building2, DollarSign, Calendar,
  Upload, LogOut, CheckCircle, Shield, Download,
  Phone, Video, Circle, Square, Play
} from "lucide-react";

// ─── Supabase ─────────────────────────────────────────────────────
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const ADMIN_EMAIL = 'shuffman@tailgateofficial.com';
const APP_NAME = 'Tailgate Payday';
const APP_TAGLINE = 'Tailgate Official Payout Management';

// ─── Storage ──────────────────────────────────────────────────────
// Saves instantly to localStorage (so nothing is ever lost on tab switch)
// AND syncs to Supabase in the background (for cross-device access)
const loadS = async key => {
  try {
    const { data } = await supabase.from('app_data').select('value').eq('key',key).single();
    if (data) { localStorage.setItem(key, data.value); return JSON.parse(data.value); }
  } catch(e) {}
  try { const local = localStorage.getItem(key); return local ? JSON.parse(local) : []; } catch(e) { return []; }
};
const saveS = async (key,val) => {
  const str = JSON.stringify(val);
  localStorage.setItem(key, str); // instant — never lost
  try { await supabase.from('app_data').upsert({key, value: str}); } catch(e) {}
};

// ─── Utils ────────────────────────────────────────────────────────
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmt$ = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(+n||0);
const SM = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const addMonths = (ym,n) => { if(!ym) return ''; let [y,m]=ym.split('-').map(Number); m+=n; while(m>12){m-=12;y++;} return `${y}-${String(m).padStart(2,'0')}`; };
const fmtYM = ym => { if(!ym) return ''; const [y,m]=ym.split('-').map(Number); return `${SM[m-1]} ${y}`; };
const today = () => new Date().toISOString().split('T')[0];
const currYM = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const addDays = (date,n) => { const d=new Date(date); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };
const fmtDate = s => { if(!s) return ''; const [y,m,d]=s.split('-'); return `${SM[+m-1]} ${+d}, ${y}`; };
const initials = name => name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

// Parse "08-May-2026 14:32:02" → "2026-05-08"
const parseCSVDate = str => {
  if (!str) return '';
  try {
    const MO={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const [dp] = str.trim().split(' ');
    const [dd,mon,yyyy] = dp.split('-');
    return `${yyyy}-${MO[mon]}-${String(+dd).padStart(2,'0')}`;
  } catch { return ''; }
};

// Handles both manual periods (discounts*rate) and CSV periods (totalAmount)
const periodAmt = p => p.totalAmount !== undefined ? p.totalAmount : (p.discounts * p.ratePerDiscount);

const matchEmployee = (csvName, employees) => {
  const norm = s => s?.toLowerCase().trim().replace(/\s+/g,' ')||'';
  return employees.find(e => norm(e.name) === norm(csvName));
};

// ─── Payment engine ───────────────────────────────────────────────
function getPayments(empId, deals, assignments) {
  const out = [];
  deals.forEach(deal => {
    ['setter','closer'].forEach(role => {
      if (deal[role]?.employeeId !== empId) return;
      const rate = deal[role].ratePerCard;
      out.push({
        id:`${deal.id}-${role}-up`, date:deal.createdAt?.split('T')[0]||deal.startMonth+'-01',
        type:'upfront', role,
        desc:`${deal.orgName} — ${role==='setter'?'Setter':'Closer'} upfront (25% × ${deal.cardsOrdered} cards @ ${fmt$(rate)})`,
        amount:0.25*deal.cardsOrdered*rate,
        paid:deal.paid?.[`${role}Upfront`]??false,
        dealId:deal.id, payKey:`${role}Upfront`
      });
      deal.monthlyActivations.forEach((act,idx) => {
        if (!act) return;
        const mYM=addMonths(deal.startMonth,idx);
        const [y,m]=mYM.split('-').map(Number);
        out.push({
          id:`${deal.id}-${role}-bk-${idx}`,
          date:`${mYM}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`,
          type:'backend', role,
          desc:`${deal.orgName} — ${role==='setter'?'Setter':'Closer'} backend ${fmtYM(mYM)} (${act} cards)`,
          amount:0.75*act*rate,
          paid:deal.paid?.[`${role}Backend`]?.[idx]??false,
          dealId:deal.id, payKey:`${role}Backend`, idx
        });
      });
    });
  });
  assignments.filter(a=>a.employeeId===empId).forEach(a => {
    a.periods.forEach(p => {
      out.push({
        id:`m-${p.id}`, date:p.endDate, type:'merchant',
        desc:`Merchant discounts — ${fmtDate(p.startDate)} → ${fmtDate(p.endDate)} (${p.discounts} deal${p.discounts!==1?'s':''})`,
        amount:periodAmt(p),
        paid:p.paid, assignmentId:a.id, periodId:p.id
      });
    });
  });
  return out.sort((a,b)=>b.date.localeCompare(a.date));
}

// ─── Styles ───────────────────────────────────────────────────────
const CARD = {background:'var(--color-background-primary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-lg)',overflow:'hidden'};
const INP  = {display:'block',width:'100%',padding:'8px 10px',boxSizing:'border-box',background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-secondary)',borderRadius:'var(--border-radius-md)',color:'var(--color-text-primary)',fontSize:'14px',fontFamily:'var(--font-sans)',outline:'none'};
const BTN  = p => ({display:'inline-flex',alignItems:'center',gap:'5px',padding:'7px 14px',cursor:'pointer',fontSize:'13px',fontFamily:'var(--font-sans)',fontWeight:'500',borderRadius:'var(--border-radius-md)',border:p?'none':'0.5px solid var(--color-border-secondary)',background:p?'#1D9E75':'transparent',color:p?'#04342C':'var(--color-text-primary)'});
const CC = {teal:{bg:'#E1F5EE',tx:'#0F6E56',br:'#5DCAA5'},amber:{bg:'#FAEEDA',tx:'#854F0B',br:'#EF9F27'},blue:{bg:'#E6F1FB',tx:'#185FA5',br:'#85B7EB'},red:{bg:'#FCEBEB',tx:'#A32D2D',br:'#F09595'},gray:{bg:'#F1EFE8',tx:'#5F5E5A',br:'#B4B2A9'}};

// ─── Shared UI ────────────────────────────────────────────────────
const Badge = ({color='gray',children}) => { const c=CC[color]; return <span style={{display:'inline-block',padding:'2px 9px',fontSize:'11px',fontWeight:'500',background:c.bg,color:c.tx,border:`0.5px solid ${c.br}`,borderRadius:'var(--border-radius-md)',whiteSpace:'nowrap'}}>{children}</span>; };
const Metric = ({label,value,color,sub}) => <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'14px 16px'}}><div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginBottom:'6px'}}>{label}</div><div style={{fontSize:'22px',fontWeight:'500',color:color||'var(--color-text-primary)',fontFamily:'var(--font-mono)'}}>{value}</div>{sub&&<div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginTop:'2px'}}>{sub}</div>}</div>;
const Field = ({label,children}) => <div style={{marginBottom:'13px'}}><label style={{display:'block',fontSize:'12px',color:'var(--color-text-secondary)',marginBottom:'5px',fontWeight:'500'}}>{label}</label>{children}</div>;
const HR = () => <div style={{height:'0.5px',background:'var(--color-border-tertiary)',margin:'14px 0'}}/>;

function ModalWrap({title,onClose,children,wide}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'20px'}}>
      <div style={{...CARD,width:'100%',maxWidth:wide?'820px':'500px',maxHeight:'92vh',overflowY:'auto',background:'var(--color-background-primary)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 20px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
          <h3 style={{margin:0,fontSize:'15px',fontWeight:'500'}}>{title}</h3>
          <button onClick={onClose} style={{...BTN(false),padding:'4px 9px',fontSize:'18px',lineHeight:1}}>×</button>
        </div>
        <div style={{padding:'20px'}}>{children}</div>
      </div>
    </div>
  );
}

const EmpPicker = ({employees,value,onChange,label}) => (
  <Field label={label||'Employee'}>
    <select style={INP} value={value} onChange={e=>onChange(e.target.value)}>
      <option value="">Select employee…</option>
      {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
  </Field>
);

// ─── LOGIN PAGE ───────────────────────────────────────────────────
function LoginPage() {
  const [mode,setMode]=useState('signin');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  const submit = async () => {
    setError(''); setSuccess(''); setLoading(true);
    if (mode==='signin') {
      const {error} = await supabase.auth.signInWithPassword({email,password});
      if (error) setError(error.message);
    } else {
      const {error} = await supabase.auth.signUp({email,password});
      if (error) setError(error.message);
      else setSuccess('Account created! You can now sign in.');
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{width:'100%',maxWidth:'400px'}}>
        <div style={{textAlign:'center',marginBottom:'28px'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}><span style={{fontSize:"24px"}}>🏈</span><span style={{fontSize:'20px',fontWeight:'600',color:'#0f172a'}}>Tailgate Payday</span></div>
          <div style={{fontSize:'14px',color:'#64748b'}}>{APP_TAGLINE}</div>
        </div>
        <div style={{...CARD,padding:'28px',background:'#ffffff'}}>
          <div style={{display:'flex',gap:'4px',marginBottom:'20px',background:'#f8fafc',borderRadius:'var(--border-radius-md)',padding:'3px'}}>
            {['signin','signup'].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setError('');setSuccess('');}} style={{flex:1,padding:'8px',border:'none',borderRadius:'var(--border-radius-md)',cursor:'pointer',fontSize:'13px',fontWeight:'500',fontFamily:'var(--font-sans)',background:mode===m?'#ffffff':'transparent',color:mode===m?'#0f172a':'#64748b',boxShadow:mode===m?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
                {m==='signin'?'Sign in':'Create account'}
              </button>
            ))}
          </div>
          <Field label="Email"><input style={INP} type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} autoFocus/></Field>
          <Field label="Password"><input style={INP} type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}/></Field>
          {error&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'14px'}}>{error}</div>}
          {success&&<div style={{background:'#E1F5EE',border:'0.5px solid #5DCAA5',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#0F6E56',marginBottom:'14px'}}>{success}</div>}
          <button style={{...BTN(true),width:'100%',justifyContent:'center',padding:'10px',fontSize:'14px',opacity:loading?0.7:1}} onClick={submit} disabled={loading}>
            {loading?'Please wait…':mode==='signin'?'Sign in':'Create account'}
          </button>
          {mode==='signup'&&<div style={{fontSize:'12px',color:'#64748b',textAlign:'center',marginTop:'12px'}}>Your admin needs to add your email to the employee roster before you can see your payouts.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── EMPLOYEE / CALLER PORTAL ─────────────────────────────────────
function EmployeePortal({employees,deals,assignments,calls,userEmail,onSignOut,onUpdateCall,onSaveRecording}) {
  const [screen,setScreen]=useState('home');
  const [preselect,setPreselect]=useState('');
  const emp = employees.find(e=>e.email?.toLowerCase()===userEmail?.toLowerCase());
  if (!emp) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{...CARD,padding:'32px',textAlign:'center',maxWidth:'420px',background:'#ffffff'}}>
        <Shield size={32} style={{margin:'0 auto 12px',display:'block',color:'#64748b'}}/>
        <div style={{fontWeight:'500',marginBottom:'8px'}}>Account not linked</div>
        <div style={{fontSize:'13px',color:'#64748b',marginBottom:'20px'}}>Your email ({userEmail}) hasn't been added to the roster yet. Contact your admin at shuffman@tailgateofficial.com.</div>
        <button style={BTN(false)} onClick={onSignOut}><LogOut size={13}/>Sign out</button>
      </div>
    </div>
  );

  const myCalls = calls.filter(c=>c.callerId===emp.id);
  const queueCount = myCalls.filter(c=>c.status==='to_call'||c.status==='callback').length;
  const goRecord = id => { setPreselect(id||''); setScreen('calling'); };
  const TABS=[['home','Home',Building2],['calling','Calling',Phone],['payouts','Payouts',DollarSign]];

  return (
    <div style={{minHeight:'100vh',background:'#f1f5f9',padding:'20px'}}>
      <div style={{maxWidth:'820px',margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{width:'40px',height:'40px',borderRadius:'50%',background:'#E1F5EE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'600',color:'#0F6E56'}}>{initials(emp.name)}</div>
            <div><div style={{fontWeight:'500',fontSize:'16px'}}>{emp.name}</div><div style={{fontSize:'12px',color:'#64748b'}}>Merchant caller portal</div></div>
          </div>
          <button style={BTN(false)} onClick={onSignOut}><LogOut size={13}/>Sign out</button>
        </div>

        <div style={{display:'flex',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',border:'0.5px solid var(--color-border-tertiary)',gap:'2px',marginBottom:'18px',width:'fit-content'}}>
          {TABS.map(([key,label,Icon])=>(
            <button key={key} onClick={()=>setScreen(key)} style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'7px 15px',borderRadius:'var(--border-radius-md)',border:'none',cursor:'pointer',fontSize:'13px',fontFamily:'var(--font-sans)',fontWeight:'500',background:screen===key?'#fff':'transparent',color:screen===key?'#0f172a':'#64748b',boxShadow:screen===key?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
              <Icon size={13}/>{label}{key==='home'&&queueCount>0?` (${queueCount})`:''}
            </button>
          ))}
        </div>

        {screen==='home'&&<CallerHome myCalls={myCalls} onUpdateCall={onUpdateCall} onGoRecord={goRecord}/>}
        {screen==='calling'&&<CallerCalling key={preselect||'manual'} myCalls={myCalls} callerName={emp.name} onSaveRecording={onSaveRecording} initialId={preselect}/>}
        {screen==='payouts'&&<CallerPayouts emp={emp} deals={deals} assignments={assignments}/>}
      </div>
    </div>
  );
}

// ─── CSV IMPORT ───────────────────────────────────────────────────
const TIERS = ['$15','$30','$40','$50','Redacted'];
const TIER_AMT = {'$15':15,'$30':30,'$40':40,'$50':50,'Redacted':0};

function CSVImportModal({employees,assignments,onSave,onClose}) {
  const [rows,setRows]=useState([]);
  const [tiers,setTiers]=useState({});
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [step,setStep]=useState('upload');
  const [dragOver,setDragOver]=useState(false);
  const fileRef=useRef();

  const processFile = file => {
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:result=>{
      const parsed = result.data.map((row,i)=>({
        idx:i,
        repName:(row['Select Tailgate Caller']||'').trim(),
        business:(row['Business Name']||'').trim(),
        discountType:(row['Discount Type']||'').trim(),
        specifics:(row['Enter Discount Specifics (fully write all necessary terms)']||'').trim(),
        date:parseCSVDate((row['Added Time']||'').trim()),
      })).filter(r=>r.repName&&r.business);
      const dates=parsed.map(r=>r.date).filter(Boolean).sort();
      if(dates.length){setStartDate(dates[0]);setEndDate(dates[dates.length-1]);}
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 2);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const def={};parsed.forEach(r=>{def[r.idx]=r.date && r.date < cutoffStr ? 'Redacted' : '$15';});
      setTiers(def);setRows(parsed);setStep('assign');
    }});
  };

  const handleDrop=e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)processFile(f);};
  const setAllForRep=(repName,tier)=>{const u={...tiers};rows.filter(r=>r.repName===repName).forEach(r=>{u[r.idx]=tier;});setTiers(u);};

  const byRep={};
  rows.forEach(r=>{if(!byRep[r.repName])byRep[r.repName]=[];byRep[r.repName].push(r);});

  const repSummary=Object.entries(byRep).map(([repName,repRows])=>({
    repName,emp:matchEmployee(repName,employees),
    total:repRows.reduce((s,r)=>s+(TIER_AMT[tiers[r.idx]]||0),0),
    count:repRows.filter(r=>tiers[r.idx]!=='Redacted').length,
    rows:repRows
  }));

  const handleConfirm=()=>{
    const updated=[...assignments];
    repSummary.forEach(({repName:_repName,emp,total,count,rows:rr})=>{
      if(!emp)return;
      const period={id:genId(),startDate,endDate,discounts:count,ratePerDiscount:0,totalAmount:total,source:'csv',paid:false,
        entries:rr.map(r=>({business:r.business,discountType:r.discountType,specifics:r.specifics,tier:tiers[r.idx],amount:TIER_AMT[tiers[r.idx]]||0,date:r.date}))
      };
      const ex=updated.find(a=>a.employeeId===emp.id);
      if(ex)ex.periods=[...ex.periods,period];
      else updated.push({id:genId(),employeeId:emp.id,periods:[period]});
    });
    onSave(updated);
  };

  if(step==='upload') return (
    <ModalWrap title="Import merchant CSV" onClose={onClose} wide>
      <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={handleDrop} onClick={()=>fileRef.current.click()}
        style={{border:`2px dashed ${dragOver?'#1D9E75':'var(--color-border-secondary)'}`,borderRadius:'var(--border-radius-lg)',padding:'56px',textAlign:'center',cursor:'pointer',background:dragOver?'#E1F5EE':'var(--color-background-secondary)',transition:'all 0.15s'}}>
        <Upload size={28} style={{margin:'0 auto 12px',display:'block',color:dragOver?'#0F6E56':'var(--color-text-secondary)'}}/>
        <div style={{fontWeight:'500',marginBottom:'6px'}}>Drop your CSV here or click to browse</div>
        <div style={{fontSize:'13px',color:'var(--color-text-secondary)'}}>Tailgate Discount Submission report</div>
        <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>e.target.files[0]&&processFile(e.target.files[0])}/>
      </div>
    </ModalWrap>
  );

  return (
    <ModalWrap title={`Assign tiers — ${rows.length} rows`} onClose={onClose} wide>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:'10px',alignItems:'flex-end',marginBottom:'14px'}}>
        <Field label="Period start"><input style={INP} type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></Field>
        <Field label="Period end"><input style={INP} type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></Field>
        <div style={{paddingBottom:'13px',fontSize:'12px',color:'var(--color-text-secondary)'}}>Auto-detected from CSV</div>
      </div>

      <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'12px',padding:'10px',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)'}}>
        {repSummary.map(({repName,emp,total,count})=>(
          <div key={repName} style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'4px 10px',background:'var(--color-background-primary)',border:`0.5px solid ${emp?'#5DCAA5':'#EF9F27'}`,borderRadius:'var(--border-radius-md)',fontSize:'12px'}}>
            <span style={{fontWeight:'500'}}>{repName}</span>
            <span style={{color:'var(--color-text-secondary)'}}>{count} deals · {fmt$(total)}</span>
            {!emp&&<span style={{color:'#854F0B',fontSize:'11px'}}>⚠ not in roster</span>}
          </div>
        ))}
      </div>

      <div style={{border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',overflow:'hidden',marginBottom:'14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'130px 1fr 1fr 110px',padding:'8px 12px',background:'var(--color-background-secondary)',fontSize:'11px',fontWeight:'500',color:'var(--color-text-secondary)'}}>
          <div>Rep / Date</div><div>Business</div><div>Discount</div><div>Tier</div>
        </div>
        <div style={{maxHeight:'360px',overflowY:'auto'}}>
          {Object.entries(byRep).map(([repName,repRows])=>(
            <div key={repName}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 12px',background:'#f8fafc',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                <span style={{fontSize:'12px',fontWeight:'600',color:matchEmployee(repName,employees)?'#0F6E56':'#854F0B'}}>{repName}</span>
                <div style={{display:'flex',gap:'3px',alignItems:'center'}}>
                  <span style={{fontSize:'11px',color:'var(--color-text-secondary)',marginRight:'3px'}}>Set all:</span>
                  {TIERS.map(t=>(
                    <button key={t} onClick={()=>setAllForRep(repName,t)} style={{padding:'2px 7px',fontSize:'11px',fontFamily:'var(--font-sans)',cursor:'pointer',border:'0.5px solid var(--color-border-secondary)',borderRadius:'4px',background:'transparent',color:t==='Redacted'?'#A32D2D':'#0F6E56'}}>{t}</button>
                  ))}
                </div>
              </div>
              {repRows.map(r=>(
                <div key={r.idx} style={{display:'grid',gridTemplateColumns:'130px 1fr 1fr 110px',padding:'8px 12px',borderTop:'0.5px solid var(--color-border-tertiary)',alignItems:'center',fontSize:'13px'}}>
                  <div style={{fontSize:'11px',color:'var(--color-text-secondary)'}}>{fmtDate(r.date)}</div>
                  <div style={{paddingRight:'8px'}}>{r.business}</div>
                  <div style={{fontSize:'12px',color:'var(--color-text-secondary)',paddingRight:'8px'}}>{r.discountType}{r.specifics?` — ${r.specifics}`:''}</div>
                  <select style={{...INP,padding:'5px 8px',fontSize:'12px',color:tiers[r.idx]==='Redacted'?'#A32D2D':'#0F6E56',fontWeight:'500'}} value={tiers[r.idx]||'$15'} onChange={e=>setTiers({...tiers,[r.idx]:e.target.value})}>
                    {TIERS.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'14px'}}>
        <Metric label="Total rows" value={rows.length}/>
        <Metric label="Non-redacted" value={rows.filter(r=>tiers[r.idx]!=='Redacted').length}/>
        <Metric label="Total payout" value={fmt$(rows.reduce((s,r)=>s+(TIER_AMT[tiers[r.idx]]||0),0))} color="#0F6E56"/>
      </div>

      {repSummary.some(r=>!r.emp)&&(
        <div style={{background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#854F0B',marginBottom:'14px'}}>
          ⚠ Reps marked "not in roster" will be skipped. Add them in the Employees tab first, then re-import.
        </div>
      )}
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={BTN(true)} onClick={handleConfirm}>Confirm & save</button>
      </div>
    </ModalWrap>
  );
}

// ─── PAYMENT QUEUE ────────────────────────────────────────────────
function PaymentQueue({employees,deals,assignments,onMarkDealPaid,onMarkPeriodPaid}) {
  const allPending=[];
  employees.forEach(emp=>{
    getPayments(emp.id,deals,assignments).filter(p=>!p.paid).forEach(p=>{
      allPending.push({...p,empName:emp.name,empId:emp.id});
    });
  });
  allPending.sort((a,b)=>a.date.localeCompare(b.date));

  const byEmp={};
  allPending.forEach(p=>{if(!byEmp[p.empId])byEmp[p.empId]={name:p.empName,pmts:[]};byEmp[p.empId].pmts.push(p);});

  const confirm=p=>{
    if(p.type==='merchant') onMarkPeriodPaid(p.assignmentId,p.periodId);
    else onMarkDealPaid(p.dealId,p.payKey,p.idx);
  };

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Pending payments" value={allPending.length}/>
        <Metric label="Total outstanding" value={fmt$(allPending.reduce((s,p)=>s+p.amount,0))} color="#854F0B"/>
        <Metric label="Employees owed" value={Object.keys(byEmp).length}/>
      </div>
      {allPending.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <CheckCircle size={32} style={{margin:'0 auto 12px',display:'block',color:'#1D9E75'}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>All caught up!</div>
          <div style={{fontSize:'13px'}}>No pending payments right now</div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {Object.entries(byEmp).map(([empId,{name,pmts}])=>{
            const empTotal=pmts.reduce((s,p)=>s+p.amount,0);
            return (
              <div key={empId} style={CARD}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
                  <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(name)}</div>
                  <div style={{flex:1}}><div style={{fontWeight:'500'}}>{name}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>{pmts.length} pending payment{pmts.length!==1?'s':''}</div></div>
                  <Badge color="amber">{fmt$(empTotal)} owed</Badge>
                </div>
                {pmts.map(p=>(
                  <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',gap:'14px',alignItems:'center',padding:'12px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                    <div style={{fontSize:'12px',color:'var(--color-text-secondary)',whiteSpace:'nowrap'}}>{fmtDate(p.date)}</div>
                    <div><div style={{fontSize:'13px',marginBottom:'3px'}}>{p.desc}</div><Badge color={p.type==='upfront'?'amber':p.type==='backend'?'teal':'blue'}>{p.type==='upfront'?'Deal upfront':p.type==='backend'?'Deal backend':'Merchant'}</Badge></div>
                    <div style={{fontFamily:'var(--font-mono)',fontSize:'15px',fontWeight:'500',color:'#0F6E56',whiteSpace:'nowrap'}}>{fmt$(p.amount)}</div>
                    <button style={{...BTN(true),padding:'6px 12px',fontSize:'12px',whiteSpace:'nowrap'}} onClick={()=>confirm(p)}>
                      <CheckCircle size={13}/>Mark paid
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── EMPLOYEES ────────────────────────────────────────────────────
function EmployeesView({employees,deals,assignments,onAdd,onDelete}) {
  const stats = emp => {
    const p=getPayments(emp.id,deals,assignments);
    return {
      total:p.reduce((s,x)=>s+x.amount,0),
      pending:p.filter(x=>!x.paid).reduce((s,x)=>s+x.amount,0),
      deals:deals.filter(d=>d.setter?.employeeId===emp.id||d.closer?.employeeId===emp.id).length,
      periods:assignments.find(a=>a.employeeId===emp.id)?.periods.length||0
    };
  };
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
        <div><h3 style={{margin:0,fontSize:'16px',fontWeight:'500'}}>Employee roster</h3><div style={{fontSize:'13px',color:'var(--color-text-secondary)',marginTop:'2px'}}>All employees — assign them to deals and merchant roles</div></div>
        <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Add employee</button>
      </div>
      {employees.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <Users size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>No employees yet</div>
          <div style={{fontSize:'13px',marginBottom:'16px'}}>Start here — add your team, then assign them to deals and merchant periods</div>
          <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Add first employee</button>
        </div>
      ):(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'10px'}}>
          {employees.map(emp=>{
            const s=stats(emp);
            return (
              <div key={emp.id} style={{...CARD,padding:'16px',overflow:'visible'}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
                  <div style={{width:'38px',height:'38px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(emp.name)}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:'500',fontSize:'14px'}}>{emp.name}</div>
                    {emp.email&&<div style={{fontSize:'11px',color:'var(--color-text-secondary)'}}>{emp.email}</div>}
                    <div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>{s.deals} deal{s.deals!==1?'s':''} · {s.periods} period{s.periods!==1?'s':''}</div>
                  </div>
                  <button onClick={()=>onDelete(emp.id)} style={{...BTN(false),padding:'5px 8px',color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={12}/></button>
                </div>
                <HR/>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                  <div><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'2px'}}>Total earned</div><div style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500'}}>{fmt$(s.total)}</div></div>
                  <div><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'2px'}}>Outstanding</div><div style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500',color:'#854F0B'}}>{fmt$(s.pending)}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Updated to include email field
function AddEmployeeModal({onAdd,onClose}) {
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  return (
    <ModalWrap title="Add employee" onClose={onClose}>
      <Field label="Full name"><input style={INP} placeholder="e.g. Sarah Johnson" value={name} onChange={e=>setName(e.target.value)} autoFocus/></Field>
      <Field label="Email (they'll use this to log in and see their payouts)"><input style={INP} type="email" placeholder="sarah@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&name&&onAdd(name,email)}/></Field>
      <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'var(--color-text-secondary)',marginBottom:'14px'}}>
        They can go to the site, create an account with this email, and see only their own payouts.
      </div>
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={BTN(true)} onClick={()=>name&&onAdd(name,email)}>Add employee</button>
      </div>
    </ModalWrap>
  );
}

// ─── DEALS ────────────────────────────────────────────────────────
function AddDealModal({employees,onAdd,onClose}) {
  const [f,setF]=useState({orgName:'',cards:'',startMonth:currYM(),sId:'',sRate:'',cId:'',cRate:''});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const upfront=(f.cards&&f.sRate&&f.cRate)?0.25*+f.cards*(+f.sRate+ +f.cRate):null;
  const submit=()=>{
    if(!f.orgName||!f.cards||!f.sId||!f.sRate||!f.cId||!f.cRate) return;
    const sEmp=employees.find(e=>e.id===f.sId), cEmp=employees.find(e=>e.id===f.cId);
    onAdd({orgName:f.orgName,cardsOrdered:+f.cards,startMonth:f.startMonth||currYM(),setter:{employeeId:f.sId,name:sEmp?.name||'',ratePerCard:+f.sRate},closer:{employeeId:f.cId,name:cEmp?.name||'',ratePerCard:+f.cRate}});
  };
  return (
    <ModalWrap title="New deal" onClose={onClose}>
      <Field label="Organization name"><input style={INP} placeholder="e.g. Westside Youth Sports" value={f.orgName} onChange={e=>s('orgName',e.target.value)}/></Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Cards ordered"><input style={INP} type="number" placeholder="500" value={f.cards} onChange={e=>s('cards',e.target.value)}/></Field>
        <Field label="Start month"><input style={INP} type="month" value={f.startMonth} onChange={e=>s('startMonth',e.target.value)}/></Field>
      </div>
      {['setter','closer'].map(role=>(
        <div key={role} style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'13px',marginBottom:'12px'}}>
          <div style={{fontSize:'12px',fontWeight:'500',color:role==='setter'?'#854F0B':'#185FA5',marginBottom:'10px'}}>{role==='setter'?'Appointment setter':'Closer'}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <EmpPicker employees={employees} label="Select employee" value={f[role==='setter'?'sId':'cId']} onChange={v=>s(role==='setter'?'sId':'cId',v)}/>
            <Field label="Rate per card ($)"><input style={INP} type="number" step="0.01" placeholder="1.50" value={f[role==='setter'?'sRate':'cRate']} onChange={e=>s(role==='setter'?'sRate':'cRate',e.target.value)}/></Field>
          </div>
        </div>
      ))}
      {upfront!==null&&<div style={{background:'#E1F5EE',border:'0.5px solid #5DCAA5',borderRadius:'var(--border-radius-md)',padding:'11px 14px',marginBottom:'16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:'13px',color:'#0F6E56'}}>Total upfront owed at signing</span><span style={{fontFamily:'var(--font-mono)',fontWeight:'500',color:'#0F6E56',fontSize:'15px'}}>{fmt$(upfront)}</span></div>}
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={BTN(true)} onClick={submit}>Create deal</button>
      </div>
    </ModalWrap>
  );
}

function DealRow({deal,employees,onClick}) {
  const [hov,setHov]=useState(false);
  const activated=deal.monthlyActivations.reduce((a,b)=>a+b,0);
  const pct=deal.cardsOrdered>0?activated/deal.cardsOrdered:0;
  const upfront=0.25*deal.cardsOrdered*(deal.setter.ratePerCard+deal.closer.ratePerCard);
  const sName=employees.find(e=>e.id===deal.setter?.employeeId)?.name||deal.setter?.name||'—';
  const cName=employees.find(e=>e.id===deal.closer?.employeeId)?.name||deal.closer?.name||'—';
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{display:'flex',alignItems:'center',gap:'16px',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',cursor:'pointer',background:hov?'var(--color-background-secondary)':'transparent',transition:'background 0.12s'}}>
      <div style={{flex:1}}><div style={{fontWeight:'500',fontSize:'14px'}}>{deal.orgName}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginTop:'2px'}}>{deal.cardsOrdered} cards · {sName} (setter) · {cName} (closer) · from {fmtYM(deal.startMonth)}</div></div>
      <div style={{textAlign:'center',minWidth:'110px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'4px'}}>Activated</div><div style={{fontFamily:'var(--font-mono)',fontSize:'13px'}}>{activated} / {deal.cardsOrdered}</div><div style={{width:'80px',height:'3px',background:'var(--color-border-tertiary)',borderRadius:'2px',margin:'5px auto 0'}}><div style={{width:`${Math.min(100,pct*100)}%`,height:'100%',background:'#1D9E75',borderRadius:'2px'}}/></div></div>
      <div style={{textAlign:'right',minWidth:'90px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'4px'}}>Upfront</div><Badge color="amber">{fmt$(upfront)}</Badge></div>
      <ChevronRight size={15} color="var(--color-text-secondary)"/>
    </div>
  );
}

function DealsView({deals,employees,onSelect,onAdd}) {
  const totalUp=deals.reduce((s,d)=>s+0.25*d.cardsOrdered*(d.setter.ratePerCard+d.closer.ratePerCard),0);
  const totalBk=deals.reduce((s,d)=>{const a=d.monthlyActivations.reduce((x,y)=>x+y,0);return s+0.75*a*(d.setter.ratePerCard+d.closer.ratePerCard);},0);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Active deals" value={deals.length}/>
        <Metric label="Upfront owed" value={fmt$(totalUp)} color="#854F0B"/>
        <Metric label="Backend earned" value={fmt$(totalBk)} color="#0F6E56"/>
      </div>
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
          <span style={{fontWeight:'500',fontSize:'14px'}}>All deals</span>
          <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>New deal</button>
        </div>
        {deals.length===0?(
          <div style={{padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
            <FileText size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
            <div style={{fontWeight:'500',marginBottom:'6px'}}>No deals yet</div>
            <div style={{fontSize:'13px',marginBottom:'16px'}}>Add employees first, then create deals</div>
            <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Create deal</button>
          </div>
        ):deals.map(d=><DealRow key={d.id} deal={d} employees={employees} onClick={()=>onSelect(d)}/>)}
      </div>
    </div>
  );
}

function DealDetail({deal,employees,onBack,onUpdateActivation,onDelete}) {
  const [editing,setEditing]=useState(null);
  const [editVal,setEditVal]=useState('');
  const activated=deal.monthlyActivations.reduce((a,b)=>a+b,0);
  const sName=employees.find(e=>e.id===deal.setter?.employeeId)?.name||deal.setter?.name||'—';
  const cName=employees.find(e=>e.id===deal.closer?.employeeId)?.name||deal.closer?.name||'—';
  const reps=[
    {label:'Appointment setter',name:sName,rep:deal.setter,up:0.25*deal.cardsOrdered*deal.setter.ratePerCard,bk:0.75*activated*deal.setter.ratePerCard,color:'amber'},
    {label:'Closer',name:cName,rep:deal.closer,up:0.25*deal.cardsOrdered*deal.closer.ratePerCard,bk:0.75*activated*deal.closer.ratePerCard,color:'blue'}
  ];
  const save=idx=>{onUpdateActivation(deal.id,idx,editVal);setEditing(null);};
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'18px'}}>
        <button style={BTN(false)} onClick={onBack}><ArrowLeft size={14}/>Back</button>
        <div style={{flex:1}}><h2 style={{margin:0,fontSize:'18px',fontWeight:'500'}}>{deal.orgName}</h2><div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>{deal.cardsOrdered} cards · starts {fmtYM(deal.startMonth)}</div></div>
        <button onClick={()=>onDelete(deal.id)} style={{...BTN(false),color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={13}/>Delete</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'18px'}}>
        {reps.map(r=>(
          <div key={r.label} style={CARD}>
            <div style={{padding:'13px 16px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'2px'}}>{r.label}</div><div style={{fontWeight:'500'}}>{r.name}</div></div>
              <Badge color={r.color}>{fmt$(r.rep.ratePerCard)}/card</Badge>
            </div>
            <div style={{padding:'13px 16px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              {[{lbl:'Upfront (25%)',val:r.up,sub:'at signing',col:'#854F0B'},{lbl:'Backend (75%)',val:r.bk,sub:`${activated} activated`,col:'#0F6E56'}].map(x=>(
                <div key={x.lbl} style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'11px 12px'}}>
                  <div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'4px'}}>{x.lbl}</div>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:'16px',fontWeight:'500',color:x.col}}>{fmt$(x.val)}</div>
                  <div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginTop:'2px'}}>{x.sub}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={CARD}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><div style={{fontWeight:'500',fontSize:'14px'}}>Monthly activations</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginTop:'2px'}}>Click any month to update</div></div>
        <div style={{padding:'16px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px'}}>
          {deal.monthlyActivations.map((act,idx)=>{
            const mYM=addMonths(deal.startMonth,idx);
            const bk=0.75*act*(deal.setter.ratePerCard+deal.closer.ratePerCard);
            const isEd=editing===idx;
            return (
              <div key={idx} onClick={()=>{if(!isEd){setEditing(idx);setEditVal(String(act));}}}
                style={{background:'var(--color-background-secondary)',border:`0.5px solid ${act>0?'#5DCAA5':'var(--color-border-tertiary)'}`,borderRadius:'var(--border-radius-md)',padding:'12px',cursor:isEd?'default':'pointer',transition:'border-color 0.15s'}}>
                <div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'6px',fontWeight:'500'}}>{fmtYM(mYM)}</div>
                {isEd?(
                  <div onClick={e=>e.stopPropagation()}>
                    <input style={{...INP,marginBottom:'8px',padding:'6px 8px',fontSize:'13px'}} type="number" value={editVal} autoFocus onChange={e=>setEditVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&save(idx)}/>
                    <div style={{display:'flex',gap:'5px'}}>
                      <button style={{...BTN(true),flex:1,padding:'5px 6px',fontSize:'12px',justifyContent:'center'}} onClick={()=>save(idx)}>Save</button>
                      <button style={{...BTN(false),flex:1,padding:'5px 6px',fontSize:'12px',justifyContent:'center'}} onClick={()=>setEditing(null)}>✕</button>
                    </div>
                  </div>
                ):(
                  <>
                    <div style={{fontFamily:'var(--font-mono)',fontSize:'22px',fontWeight:'500',color:act>0?'#0F6E56':'var(--color-text-secondary)'}}>{act}</div>
                    <div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginTop:'2px'}}>cards</div>
                    {act>0&&<div style={{marginTop:'8px',paddingTop:'8px',borderTop:'0.5px solid var(--color-border-tertiary)',fontSize:'11px',color:'#0F6E56',fontFamily:'var(--font-mono)'}}>+{fmt$(bk)}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MERCHANT REPS ────────────────────────────────────────────────
function AddPeriodModal({employees,onAdd,onClose}) {
  const [f,setF]=useState({empId:'',start:today(),end:'',discounts:'',rate:''});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const amt=(f.discounts&&f.rate)?+f.discounts*+f.rate:null;
  return (
    <ModalWrap title="Add bi-weekly period" onClose={onClose}>
      <EmpPicker employees={employees} label="Merchant rep" value={f.empId} onChange={v=>s('empId',v)}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Period start"><input style={INP} type="date" value={f.start} onChange={e=>s('start',e.target.value)}/></Field>
        <Field label="Period end"><input style={INP} type="date" value={f.end} onChange={e=>s('end',e.target.value)}/></Field>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Discounts obtained"><input style={INP} type="number" placeholder="12" value={f.discounts} onChange={e=>s('discounts',e.target.value)}/></Field>
        <Field label="Rate per discount ($)"><input style={INP} type="number" step="0.01" placeholder="25.00" value={f.rate} onChange={e=>s('rate',e.target.value)}/></Field>
      </div>
      {amt!==null&&<div style={{background:'#E1F5EE',border:'0.5px solid #5DCAA5',borderRadius:'var(--border-radius-md)',padding:'11px 14px',marginBottom:'14px',display:'flex',justifyContent:'space-between'}}><span style={{fontSize:'13px',color:'#0F6E56'}}>Period total</span><span style={{fontFamily:'var(--font-mono)',color:'#0F6E56',fontWeight:'500',fontSize:'15px'}}>{fmt$(amt)}</span></div>}
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={BTN(true)} onClick={()=>{if(f.empId&&f.start&&f.end&&f.discounts&&f.rate) onAdd(f.empId,{startDate:f.start,endDate:f.end,discounts:+f.discounts,ratePerDiscount:+f.rate});}}>Add period</button>
      </div>
    </ModalWrap>
  );
}

function MerchantRepsView({employees,assignments,onAddPeriod,onImportCSV,onTogglePaid,onDeletePeriod,onPayStub}) {
  const [openIds,setOpenIds]=useState({});
  const tog=id=>setOpenIds(p=>({...p,[id]:p[id]===false?true:false}));
  const pendingTotal=assignments.reduce((s,a)=>s+a.periods.filter(p=>!p.paid).reduce((ss,p)=>ss+periodAmt(p),0),0);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Active reps" value={assignments.length}/>
        <Metric label="Pending payouts" value={fmt$(pendingTotal)} color="#854F0B"/>
        <Metric label="Total periods" value={assignments.reduce((s,a)=>s+a.periods.length,0)}/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginBottom:'12px'}}>
        <button style={BTN(false)} onClick={onImportCSV}><Upload size={14}/>Import CSV</button>
        <button style={BTN(true)} onClick={onAddPeriod}><Plus size={14}/>Add period</button>
      </div>
      {assignments.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <DollarSign size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>No merchant periods yet</div>
          <div style={{fontSize:'13px',marginBottom:'16px'}}>Add employees first, then log their discount periods here</div>
          <div style={{display:'flex',gap:'8px',justifyContent:'center'}}>
            <button style={BTN(false)} onClick={onImportCSV}><Upload size={13}/>Import CSV</button>
            <button style={BTN(true)} onClick={onAddPeriod}><Plus size={14}/>Add manually</button>
          </div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {assignments.map(a=>{
            const emp=employees.find(e=>e.id===a.employeeId);
            const pending=a.periods.filter(p=>!p.paid).reduce((s,p)=>s+periodAmt(p),0);
            const isOpen=openIds[a.id]!==false;
            return (
              <div key={a.id} style={CARD}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'13px 18px',cursor:'pointer',borderBottom:isOpen&&a.periods.length>0?'0.5px solid var(--color-border-tertiary)':'none'}} onClick={()=>tog(a.id)}>
                  <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(emp?.name||'?')}</div>
                  <div style={{flex:1}}><div style={{fontWeight:'500',fontSize:'14px'}}>{emp?.name||'Unknown'}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>{a.periods.length} period{a.periods.length!==1?'s':''}</div></div>
                  <div style={{textAlign:'right',marginRight:'8px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>Pending</div><Badge color="amber">{fmt$(pending)}</Badge></div>
                  {isOpen?<ChevronUp size={14} color="var(--color-text-secondary)"/>:<ChevronDown size={14} color="var(--color-text-secondary)"/>}
                </div>
                {isOpen&&a.periods.length>0&&(
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1.6fr 0.6fr 0.7fr 0.9fr auto',padding:'8px 18px',background:'var(--color-background-secondary)',fontSize:'11px',color:'var(--color-text-secondary)',fontWeight:'500'}}>
                      <div>Period</div><div>Deals</div><div>Amount</div><div>Status</div><div/>
                    </div>
                    {a.periods.map(p=>{
                      const amt=periodAmt(p);
                      return (
                        <div key={p.id} style={{display:'grid',gridTemplateColumns:'1.6fr 0.6fr 0.7fr 0.9fr auto',padding:'12px 18px',alignItems:'center',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                          <div style={{fontSize:'13px'}}>
                            {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
                            {p.source==='csv'&&<span style={{marginLeft:'6px'}}><Badge color="blue">CSV</Badge></span>}
                          </div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:'13px'}}>{p.discounts}</div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500',color:'#0F6E56'}}>{fmt$(amt)}</div>
                          <div><button onClick={()=>onTogglePaid(a.id,p.id)} style={{background:'none',border:'none',cursor:'pointer',padding:0}}><Badge color={p.paid?'teal':'amber'}>{p.paid?'✓ Paid':'⏳ Pending'}</Badge></button></div>
                          <div style={{display:'flex',gap:'6px'}}>
                            <button onClick={()=>onPayStub(emp,p)} style={{...BTN(false),fontSize:'12px',padding:'5px 10px',color:'var(--color-text-info)',borderColor:'var(--color-border-info)'}}><FileText size={12}/>Stub</button>
                            <button onClick={()=>onDeletePeriod(a.id,p.id)} style={{...BTN(false),padding:'5px 8px',color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={12}/></button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PAY SHEET PRINT ─────────────────────────────────────────────
function downloadPaySheet(emp, allPayments, start, end) {
  const pmts=allPayments.filter(p=>p.date>=start&&p.date<=end);
  const total=pmts.reduce((s,p)=>s+p.amount,0);
  const paid=pmts.filter(p=>p.paid).reduce((s,p)=>s+p.amount,0);
  const TC={upfront:'#854F0B',backend:'#0F6E56',merchant:'#185FA5'};
  const TL={upfront:'Deal upfront (25%)',backend:'Deal backend (75%)',merchant:'Merchant discounts'};
  const rows=pmts.map(p=>`<tr><td style="padding:9px 12px;font-size:13px;border-bottom:1px solid #f3f4f6;white-space:nowrap">${fmtDate(p.date)}</td><td style="padding:9px 12px;border-bottom:1px solid #f3f4f6"><span style="padding:2px 8px;border-radius:4px;background:${TC[p.type]}22;color:${TC[p.type]};font-size:11px;font-weight:700">${TL[p.type]}</span></td><td style="padding:9px 12px;font-size:13px;border-bottom:1px solid #f3f4f6;color:#555">${p.desc}</td><td style="padding:9px 12px;font-size:13px;text-align:right;font-family:monospace;font-weight:700;border-bottom:1px solid #f3f4f6;white-space:nowrap">${fmt$(p.amount)}</td><td style="padding:9px 12px;text-align:center;border-bottom:1px solid #f3f4f6"><span style="padding:2px 8px;border-radius:4px;background:${p.paid?'#E1F5EE':'#FAEEDA'};color:${p.paid?'#0F6E56':'#854F0B'};font-size:11px;font-weight:700">${p.paid?'Paid':'Pending'}</span></td></tr>`).join('');
  const __html = `<!DOCTYPE html><html><head><title>Pay Sheet — ${emp?.name}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:40px 48px;color:#111;max-width:880px;margin:auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:3px solid #E1F5EE}
  .co{font-size:24px;font-weight:800;color:#0f172a}.co-sub{font-size:12px;color:#888;margin-top:2px}
  .lbl{font-size:12px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em}
  .nm{font-size:20px;font-weight:700;color:#0f172a;margin-top:6px}.per{font-size:13px;color:#555;margin-top:2px}
  .sum{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:22px 0}
  .sm{background:#f8fafc;border-radius:8px;padding:14px 16px;border:1px solid #e2e8f0}
  .sl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:4px}.sv{font-size:20px;font-weight:700}
  table{width:100%;border-collapse:collapse}th{text-align:left;padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;border-bottom:2px solid #e2e8f0}
  .ft{text-align:center;font-size:11px;color:#bbb;margin-top:36px;padding-top:14px;border-top:1px solid #eee}
  @media print{body{padding:24px}}</style>
  </head><body>
  <div class="hdr"><div><div class="co">Tailgate Payday</div><div class="co-sub">Bi-Weekly Pay Sheet</div></div><div style="text-align:right"><div class="lbl">Employee Pay Sheet</div><div class="nm">${emp?.name||'—'}</div><div class="per">${fmtDate(start)} — ${fmtDate(end)}</div></div></div>
  <div class="sum">
    <div class="sm"><div class="sl">Gross pay this period</div><div class="sv" style="color:#0f172a">${fmt$(total)}</div></div>
    <div class="sm"><div class="sl">Already paid</div><div class="sv" style="color:#0F6E56">${fmt$(paid)}</div></div>
    <div class="sm"><div class="sl">Outstanding</div><div class="sv" style="color:#854F0B">${fmt$(total-paid)}</div></div>
  </div>
  ${pmts.length===0?'<p style="text-align:center;color:#aaa;padding:32px;font-size:14px">No payments in this period</p>':`<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th><th style="text-align:center">Status</th></tr></thead><tbody>${rows}</tbody></table>`}
  <div class="ft">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · Tailgate Payday</div>
  </body></html>`;
  const __blob = new Blob([__html], {type:'text/html'});
  const __url = URL.createObjectURL(__blob);
  const __a = document.createElement('a');
  __a.href = __url;
  __a.download = `PaySheet_${(emp?.name||'Employee').replace(/\s+/g,'_')}_${start}_${end}.html`;
  __a.click();
  URL.revokeObjectURL(__url);
}

// ─── PAYROLL ─────────────────────────────────────────────────────
function PayrollView({employees,deals,assignments}) {
  const [periodStart,setPeriodStart]=useState(addDays(today(),-13));
  const [selected,setSelected]=useState(null);
  const periodEnd=addDays(periodStart,13);

  const empData=employees.map(emp=>{
    const all=getPayments(emp.id,deals,assignments);
    const inP=all.filter(p=>p.date>=periodStart&&p.date<=periodEnd);
    return {emp,all,inP,periodTotal:inP.reduce((s,p)=>s+p.amount,0),outstanding:all.filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0)};
  }).filter(d=>d.all.length>0);

  if (selected) {
    const d=empData.find(x=>x.emp.id===selected);
    const {emp,all,inP}=d||{emp:null,all:[],inP:[]};
    return (
      <div>
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'18px'}}>
          <button style={BTN(false)} onClick={()=>setSelected(null)}><ArrowLeft size={14}/>Back</button>
          <div style={{flex:1}}><h2 style={{margin:0,fontSize:'18px',fontWeight:'500'}}>{emp?.name}</h2><div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>Pay sheet: {fmtDate(periodStart)} — {fmtDate(periodEnd)}</div></div>
          <button style={BTN(true)} onClick={()=>downloadPaySheet(emp,all,periodStart,periodEnd)}><Download size={14}/>Download pay sheet</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
          <Metric label="This period" value={fmt$(inP.reduce((s,p)=>s+p.amount,0))} color="#0F6E56"/>
          <Metric label="Outstanding (all time)" value={fmt$(all.filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0))} color="#854F0B"/>
          <Metric label="All-time earned" value={fmt$(all.reduce((s,p)=>s+p.amount,0))}/>
        </div>
        {inP.length>0&&(
          <div style={{...CARD,marginBottom:'16px'}}>
            <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>This pay period ({inP.length} payment{inP.length!==1?'s':''})</span></div>
            {inP.map(p=>(
              <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',gap:'14px',alignItems:'center',padding:'12px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                <div style={{fontSize:'12px',color:'var(--color-text-secondary)',whiteSpace:'nowrap'}}>{fmtDate(p.date)}</div>
                <div><div style={{fontSize:'13px',marginBottom:'3px'}}>{p.desc}</div><Badge color={p.type==='upfront'?'amber':p.type==='backend'?'teal':'blue'}>{p.type==='upfront'?'Deal upfront':p.type==='backend'?'Deal backend':'Merchant'}</Badge></div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:'15px',fontWeight:'500',color:'#0F6E56',whiteSpace:'nowrap'}}>{fmt$(p.amount)}</div>
                <Badge color={p.paid?'teal':'amber'}>{p.paid?'✓ Paid':'⏳ Pending'}</Badge>
              </div>
            ))}
          </div>
        )}
        <div style={{fontWeight:'500',fontSize:'14px',marginBottom:'10px',color:'var(--color-text-secondary)'}}>Complete payment history</div>
        <div style={CARD}>
          {all.length===0?<div style={{padding:'32px',textAlign:'center',color:'var(--color-text-secondary)',fontSize:'13px'}}>No payment history</div>:all.map(p=>(
            <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',gap:'14px',alignItems:'center',padding:'12px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{fontSize:'12px',color:'var(--color-text-secondary)',whiteSpace:'nowrap'}}>{fmtDate(p.date)}</div>
              <div style={{fontSize:'13px'}}>{p.desc}</div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500',color:'#0F6E56',whiteSpace:'nowrap'}}>{fmt$(p.amount)}</div>
              <Badge color={p.paid?'teal':'amber'}>{p.paid?'✓ Paid':'⏳ Pending'}</Badge>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{...CARD,padding:'14px 18px',marginBottom:'18px',overflow:'visible'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
          <Calendar size={15} color="var(--color-text-secondary)"/>
          <span style={{fontSize:'13px',fontWeight:'500'}}>Pay period:</span>
          <input style={{...INP,width:'150px'}} type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/>
          <span style={{fontSize:'13px',color:'var(--color-text-secondary)'}}>→ {fmtDate(periodEnd)}</span>
          <div style={{marginLeft:'auto',display:'flex',gap:'6px'}}>
            <button style={{...BTN(false),padding:'6px 10px'}} onClick={()=>setPeriodStart(addDays(periodStart,-14))}>← Prev</button>
            <button style={{...BTN(false),padding:'6px 10px'}} onClick={()=>setPeriodStart(addDays(today(),-13))}>Current</button>
            <button style={{...BTN(false),padding:'6px 10px'}} onClick={()=>setPeriodStart(addDays(periodStart,14))}>Next →</button>
          </div>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Employees with payments" value={empData.length}/>
        <Metric label="Period gross pay" value={fmt$(empData.reduce((s,d)=>s+d.periodTotal,0))} color="#0F6E56"/>
        <Metric label="Outstanding (all time)" value={fmt$(empData.reduce((s,d)=>s+d.outstanding,0))} color="#854F0B"/>
      </div>
      {empData.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <DollarSign size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>No payroll data yet</div>
          <div style={{fontSize:'13px'}}>Add employees, create deals, and log merchant periods — everything rolls up here automatically</div>
        </div>
      ):(
        <div style={CARD}>
          <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:'500',fontSize:'14px'}}>Bi-weekly pay sheets — {fmtDate(periodStart)} to {fmtDate(periodEnd)}</span>
            <button style={BTN(false)} onClick={()=>empData.forEach(d=>downloadPaySheet(d.emp,d.all,periodStart,periodEnd))}><Download size={13}/>Download all</button>
          </div>
          {empData.map(({emp,all,inP,periodTotal,outstanding})=>(
            <div key={emp.id} style={{display:'flex',alignItems:'center',gap:'16px',padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{width:'38px',height:'38px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(emp.name)}</div>
              <div style={{flex:1}}><div style={{fontWeight:'500',fontSize:'14px'}}>{emp.name}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginTop:'2px'}}>{inP.length} payment{inP.length!==1?'s':''} this period · {all.filter(p=>!p.paid).length} outstanding overall</div></div>
              <div style={{textAlign:'center',minWidth:'100px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>This period</div><div style={{fontFamily:'var(--font-mono)',fontWeight:'500',color:periodTotal>0?'#0F6E56':'var(--color-text-secondary)'}}>{fmt$(periodTotal)}</div></div>
              <div style={{textAlign:'center',minWidth:'100px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>Outstanding</div><Badge color={outstanding>0?'amber':'gray'}>{fmt$(outstanding)}</Badge></div>
              <div style={{display:'flex',gap:'6px'}}>
                <button style={BTN(false)} onClick={()=>setSelected(emp.id)}>View <ChevronRight size={13}/></button>
                <button style={BTN(true)} onClick={()=>downloadPaySheet(emp,all,periodStart,periodEnd)}><Download size={13}/></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PAY STUB MODAL ───────────────────────────────────────────────
function PayStubModal({emp,period,onClose}) {
  const amt=periodAmt(period);

  return (
    <ModalWrap title="Pay stub" onClose={onClose}>
      <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-lg)',padding:'18px',marginBottom:'14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'14px'}}>
          <div><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>Employee</div><div style={{fontWeight:'500'}}>{emp?.name||'—'}</div></div>
          <div><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>Period</div><div style={{fontSize:'13px',fontWeight:'500'}}>{fmtDate(period.startDate)} → {fmtDate(period.endDate)}</div></div>
        </div>
        <HR/>
        {[['Deals / discounts',String(period.discounts)],['Source',period.source==='csv'?'CSV import':'Manual entry']].map(([l,v])=>(
          <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',fontSize:'13px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{color:'var(--color-text-secondary)'}}>{l}</span><span style={{fontFamily:'var(--font-mono)',fontWeight:'500'}}>{v}</span></div>
        ))}
        <div style={{background:'#E1F5EE',border:'0.5px solid #5DCAA5',borderRadius:'var(--border-radius-md)',padding:'13px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'14px'}}>
          <span style={{fontWeight:'500',color:'#0F6E56'}}>Gross pay</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:'22px',fontWeight:'500',color:'#0F6E56'}}>{fmt$(amt)}</span>
        </div>
      </div>
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Close</button>
        <button style={BTN(true)} onClick={()=>downloadStubPDF(emp,period,amt)}><Download size={14}/>Download stub</button>
      </div>
    </ModalWrap>
  );
}

// ═══ MERCHANT CALLING ═════════════════════════════════════════════
const CALL_BUCKET = 'call-recordings';
const CALL_STATUS = {
  to_call:        {label:'To call',        color:'gray'},
  callback:       {label:'Callback',       color:'blue'},
  no_answer:      {label:'No answer',       color:'amber'},
  not_interested: {label:'Not interested',  color:'red'},
  recorded:       {label:'Recorded',        color:'teal'},
};
const VERIFY = {
  pending:  {label:'Awaiting review', color:'amber'},
  approved: {label:'Verified',        color:'teal'},
  rejected: {label:'Needs redo',      color:'red'},
};
const REC_MIME = () => {
  if (typeof MediaRecorder==='undefined') return '';
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
  return types.find(t=>{try{return MediaRecorder.isTypeSupported(t);}catch{return false;}}) || '';
};
const mmss = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;

const ScriptLine = ({label,value}) => (
  <div style={{display:'flex',justifyContent:'space-between',gap:'10px',padding:'3px 0',fontSize:'13px'}}>
    <span style={{color:'#64748b'}}>{label}</span>
    <span style={{fontWeight:'600',textAlign:'right'}}>{value}</span>
  </div>
);

// ── Camera/mic recorder used on the caller's Calling screen ──
function CallRecorder({ call, onSaved }) {
  const [mediaMode,setMediaMode]=useState('video');
  const [camOn,setCamOn]=useState(false);
  const [recording,setRecording]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState(false);
  const videoRef=useRef(null), streamRef=useRef(null), recRef=useRef(null), chunksRef=useRef([]), timerRef=useRef(null);

  const stopStream=()=>{ if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null;} };
  useEffect(()=>()=>{ stopStream(); if(timerRef.current) clearInterval(timerRef.current); },[]);

  const enable=async()=>{
    setError('');
    try{
      const constraints = mediaMode==='video' ? {video:{width:640,height:480},audio:true} : {audio:true};
      const stream=await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current=stream;
      if(mediaMode==='video'&&videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play().catch(()=>{});}
      setCamOn(true);
    }catch{ setError('Could not access your '+(mediaMode==='video'?'camera and microphone':'microphone')+'. Please click "Allow" when your browser asks for permission, then try again.'); }
  };

  const start=()=>{
    if(!streamRef.current){setError('Turn on your '+(mediaMode==='video'?'camera':'microphone')+' first.');return;}
    setError(''); chunksRef.current=[];
    const mime=REC_MIME();
    let rec;
    try{ rec=new MediaRecorder(streamRef.current, mime?{mimeType:mime, videoBitsPerSecond:1000000}:undefined); }
    catch{ setError('Recording is not supported in this browser. Please use Chrome.'); return; }
    rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunksRef.current.push(e.data); };
    rec.onstop=()=>save(rec.mimeType||mime||'video/webm');
    rec.start(); recRef.current=rec;
    setRecording(true); setElapsed(0);
    timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000);
  };

  const stop=()=>{
    if(recRef.current&&recRef.current.state!=='inactive') recRef.current.stop();
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    setRecording(false);
  };

  const save=async(mime)=>{
    setSaving(true); setError('');
    try{
      const ext=mime.includes('mp4')?'mp4':'webm';
      const blob=new Blob(chunksRef.current,{type:mime});
      const path=`calls/${call.id}-${Date.now()}.${ext}`;
      const {error:upErr}=await supabase.storage.from(CALL_BUCKET).upload(path,blob,{contentType:mime,upsert:false});
      if(upErr) throw upErr;
      await onSaved(call.id,{recordingPath:path, recordingMime:mime, durationSec:elapsed, sizeMB:+(blob.size/1048576).toFixed(1), mediaMode});
      stopStream(); setCamOn(false); setDone(true);
    }catch(e){
      setError('Your recording was captured but the upload failed: '+(e.message||e)+'  —  Make sure the "'+CALL_BUCKET+'" storage bucket exists in Supabase.');
    }finally{ setSaving(false); }
  };

  if(done) return (
    <div style={{...CARD,padding:'32px',textAlign:'center'}}>
      <CheckCircle size={34} style={{margin:'0 auto 10px',display:'block',color:'#0F6E56'}}/>
      <div style={{fontWeight:'600',marginBottom:'4px'}}>Recording submitted</div>
      <div style={{fontSize:'13px',color:'#64748b'}}>{call.business} was sent to your admin to verify.</div>
    </div>
  );

  return (
    <div style={{...CARD,padding:'18px'}}>
      {!camOn&&!recording&&(
        <div style={{display:'flex',gap:'6px',marginBottom:'14px',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',width:'fit-content'}}>
          {[['video','Video + audio'],['audio','Audio only']].map(([m,l])=>(
            <button key={m} onClick={()=>setMediaMode(m)} style={{padding:'6px 14px',border:'none',borderRadius:'var(--border-radius-md)',cursor:'pointer',fontSize:'12px',fontWeight:'500',fontFamily:'var(--font-sans)',background:mediaMode===m?'#ffffff':'transparent',color:mediaMode===m?'#0f172a':'#64748b',boxShadow:mediaMode===m?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>{l}</button>
          ))}
        </div>
      )}
      {mediaMode==='video'&&(
        <div style={{position:'relative',background:'#0f172a',borderRadius:'var(--border-radius-md)',overflow:'hidden',aspectRatio:'4 / 3',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <video ref={videoRef} muted playsInline style={{width:'100%',height:'100%',objectFit:'cover',display:camOn?'block':'none'}}/>
          {!camOn&&<div style={{color:'#94a3b8',fontSize:'13px'}}>Camera is off</div>}
          {recording&&<div style={{position:'absolute',top:'10px',left:'10px',display:'flex',alignItems:'center',gap:'6px',background:'rgba(0,0,0,0.55)',borderRadius:'100px',padding:'4px 10px'}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#ef4444',animation:'tgpulse 1s infinite'}}/><span style={{color:'#fff',fontSize:'12px',fontFamily:'var(--font-mono)'}}>{mmss(elapsed)}</span></div>}
        </div>
      )}
      {mediaMode==='audio'&&camOn&&(
        <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'18px',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'center',gap:'10px'}}>
          <span style={{width:'10px',height:'10px',borderRadius:'50%',background:recording?'#ef4444':'#94a3b8',animation:recording?'tgpulse 1s infinite':'none'}}/>
          <span style={{fontSize:'13px',color:'#64748b'}}>{recording?`Recording — ${mmss(elapsed)}`:'Microphone ready'}</span>
        </div>
      )}
      {error&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'12px',lineHeight:1.5}}>{error}</div>}
      <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
        {!camOn&&!recording&&<button style={BTN(false)} onClick={enable}>{mediaMode==='video'?<Video size={14}/>:<Play size={14}/>}Turn on {mediaMode==='video'?'camera':'mic'}</button>}
        {camOn&&!recording&&!saving&&<button style={BTN(true)} onClick={start}><Circle size={13}/>Start recording</button>}
        {recording&&<button style={{...BTN(true),background:'#dc2626',color:'#fff'}} onClick={stop}><Square size={12}/>Stop &amp; submit</button>}
        {saving&&<div style={{fontSize:'13px',color:'#64748b'}}>Uploading…</div>}
      </div>
    </div>
  );
}

// ── Calling screen ──
function CallerCalling({ myCalls, callerName, onSaveRecording, initialId }) {
  const open = myCalls.filter(c=>c.status!=='recorded' || c.verifyStatus==='rejected');
  const [selId,setSelId]=useState(initialId||'');
  const call = myCalls.find(c=>c.id===selId);

  return (
    <div>
      <div style={{...CARD,padding:'16px',marginBottom:'14px'}}>
        <Field label="Which merchant are you calling?">
          <select style={INP} value={selId} onChange={e=>setSelId(e.target.value)}>
            <option value="">Select a merchant…</option>
            {open.map(c=><option key={c.id} value={c.id}>{c.business}{c.contact?` — ${c.contact}`:''}</option>)}
          </select>
        </Field>
        {open.length===0&&<div style={{fontSize:'13px',color:'#64748b'}}>No merchants waiting to be called right now. New ones your admin assigns will show up here.</div>}
      </div>

      {call&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
          <div style={{...CARD,padding:'18px'}}>
            <div style={{fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.6px',color:'#64748b',marginBottom:'12px'}}>Read this on the call</div>
            <div style={{fontSize:'13.5px',lineHeight:1.7,color:'#0f172a'}}>
              <p style={{margin:'0 0 12px'}}>Hi, this is <b>{callerName}</b> with Tailgate Official. Before we go any further, I want to let you know this call is being recorded — is that okay with you?</p>
              <div style={{background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'7px 11px',fontSize:'12px',color:'#854F0B',margin:'0 0 12px',fontWeight:'500'}}>⏸ Wait for them to say “yes.”</div>
              <p style={{margin:'0 0 8px'}}>Great, thank you. I just want to quickly verify your discount details for our records:</p>
              <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'11px 13px',margin:'0 0 12px'}}>
                <ScriptLine label="Business" value={call.business}/>
                <ScriptLine label="Discount" value={call.discount||'—'}/>
                <ScriptLine label="Location(s)" value={call.location||'—'}/>
                <ScriptLine label="Your Tailgate rep" value={callerName}/>
              </div>
              <p style={{margin:'0 0 12px'}}>Does all of that sound correct, and do you agree to this discount as described?</p>
              <div style={{background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'7px 11px',fontSize:'12px',color:'#854F0B',margin:'0 0 12px',fontWeight:'500'}}>⏸ Wait for them to say “yes.”</div>
              <p style={{margin:0}}>Perfect — you’re all set. Thank you!</p>
            </div>
          </div>
          <div>
            <CallRecorder call={call} callerName={callerName} onSaved={onSaveRecording}/>
            <div style={{fontSize:'12px',color:'#64748b',marginTop:'10px',lineHeight:1.5}}>Put the call on <b>speakerphone</b> near your computer so the recording captures both you and them. When you press stop, it uploads and goes to your admin to verify.</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Home / mini-CRM ──
function CallEditor({ call, onUpdateCall, onGoRecord }) {
  const [status,setStatus]=useState(call.status==='recorded'?'to_call':call.status);
  const [cbDate,setCbDate]=useState(call.callbackDate||'');
  const [note,setNote]=useState('');
  const save=()=>{
    const patch={status};
    if(status==='callback') patch.callbackDate=cbDate||today();
    if(note.trim()) patch.notes=(call.notes?call.notes+'\n\n':'')+`${today()}: ${note.trim()}`;
    onUpdateCall(call.id,patch); setNote('');
  };
  return (
    <div style={{padding:'0 18px 16px',background:'var(--color-background-secondary)'}}>
      {call.discount&&<div style={{fontSize:'12px',color:'#64748b',padding:'12px 0 0'}}>Discount to verify: <b style={{color:'#0f172a'}}>{call.discount}</b></div>}
      {call.notes&&<div style={{background:'#fff',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px',fontSize:'12px',color:'#0f172a',whiteSpace:'pre-wrap',margin:'10px 0 0',lineHeight:1.5}}>{call.notes}</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'12px'}}>
        <Field label="Outcome">
          <select style={INP} value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="to_call">To call</option>
            <option value="callback">Call back later</option>
            <option value="no_answer">No answer</option>
            <option value="not_interested">Not interested</option>
          </select>
        </Field>
        {status==='callback'&&<Field label="Call back on"><input style={INP} type="date" value={cbDate} onChange={e=>setCbDate(e.target.value)}/></Field>}
      </div>
      <Field label="Add a note"><textarea style={{...INP,minHeight:'58px',resize:'vertical'}} placeholder="What happened on the call?" value={note} onChange={e=>setNote(e.target.value)}/></Field>
      <div style={{display:'flex',gap:'8px'}}>
        <button style={BTN(false)} onClick={save}>Save update</button>
        <button style={BTN(true)} onClick={()=>onGoRecord(call.id)}><Video size={13}/>Record verification call</button>
      </div>
    </div>
  );
}

function CallerHome({ myCalls, onUpdateCall, onGoRecord }) {
  const order={callback:0,to_call:1,no_answer:2,recorded:3,not_interested:4};
  const sorted=[...myCalls].sort((a,b)=>((order[a.status]??9)-(order[b.status]??9))||((a.callbackDate||'').localeCompare(b.callbackDate||'')));
  const counts={
    to_call: myCalls.filter(c=>c.status==='to_call').length,
    callback: myCalls.filter(c=>c.status==='callback').length,
    recorded: myCalls.filter(c=>c.status==='recorded').length,
  };
  const [openId,setOpenId]=useState('');
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'16px'}}>
        <Metric label="To call" value={counts.to_call}/>
        <Metric label="Callbacks" value={counts.callback} color="#185FA5"/>
        <Metric label="Recorded" value={counts.recorded} color="#0F6E56"/>
      </div>
      <div style={CARD}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Your merchants to call</span></div>
        {sorted.length===0?(
          <div style={{padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>Nothing assigned yet. When your admin assigns merchants for you to call, they’ll show up here.</div>
        ):sorted.map(c=>{
          const st=CALL_STATUS[c.status]||CALL_STATUS.to_call;
          const isOpen=openId===c.id;
          return (
            <div key={c.id} style={{borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div onClick={()=>setOpenId(isOpen?'':c.id)} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'12px',alignItems:'center',padding:'13px 18px',cursor:'pointer'}}>
                <div>
                  <div style={{fontWeight:'500',fontSize:'14px'}}>{c.business}</div>
                  <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{[c.contact,c.phone,c.location].filter(Boolean).join(' · ')||'No contact details'}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                  {c.status==='callback'&&c.callbackDate&&<span style={{fontSize:'11px',color:'#185FA5',fontWeight:'500'}}>{fmtDate(c.callbackDate)}</span>}
                  {c.status==='recorded'&&c.verifyStatus&&<Badge color={VERIFY[c.verifyStatus].color}>{VERIFY[c.verifyStatus].label}</Badge>}
                  <Badge color={st.color}>{st.label}</Badge>
                </div>
              </div>
              {isOpen&&<CallEditor call={c} onUpdateCall={onUpdateCall} onGoRecord={onGoRecord}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Payouts (same content the portal showed before) ──
function CallerPayouts({ emp, deals, assignments }) {
  const payments = getPayments(emp.id,deals,assignments);
  const total   = payments.reduce((s,p)=>s+p.amount,0);
  const pending = payments.filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0);
  const paid    = payments.filter(p=>p.paid).reduce((s,p)=>s+p.amount,0);
  const myDeals = deals.filter(d=>d.setter?.employeeId===emp.id||d.closer?.employeeId===emp.id);
  const myPeriods = (assignments.find(a=>a.employeeId===emp.id)?.periods)||[];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Total earned" value={fmt$(total)}/>
        <Metric label="Already paid" value={fmt$(paid)} color="#0F6E56"/>
        <Metric label="Pending" value={fmt$(pending)} color="#854F0B"/>
      </div>
      {myDeals.length>0&&(
        <div style={{...CARD,marginBottom:'14px'}}>
          <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Your deals</span></div>
          {myDeals.map(d=>{
            const role=d.setter?.employeeId===emp.id?'setter':'closer';
            const rate=d[role].ratePerCard;
            const activated=d.monthlyActivations.reduce((a,b)=>a+b,0);
            const pct=d.cardsOrdered>0?activated/d.cardsOrdered:0;
            const upfront=0.25*d.cardsOrdered*rate, backend=0.75*activated*rate;
            return (
              <div key={d.id} style={{padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'10px'}}>
                  <div><div style={{fontWeight:'500',fontSize:'14px'}}>{d.orgName}</div><div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{role==='setter'?'Appointment setter':'Closer'} · {fmt$(rate)}/card · starts {fmtYM(d.startMonth)}</div></div>
                  <Badge color={role==='setter'?'amber':'blue'}>{role==='setter'?'Setter':'Closer'}</Badge>
                </div>
                <div style={{marginBottom:'10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',color:'#64748b',marginBottom:'4px'}}><span>Cards activated</span><span style={{fontFamily:'var(--font-mono)'}}>{activated} / {d.cardsOrdered}</span></div>
                  <div style={{height:'4px',background:'var(--color-border-tertiary)',borderRadius:'2px'}}><div style={{width:`${Math.min(100,pct*100)}%`,height:'100%',background:'#1D9E75',borderRadius:'2px'}}/></div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                  <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px'}}><div style={{fontSize:'11px',color:'#64748b',marginBottom:'3px'}}>Upfront (25%)</div><div style={{fontFamily:'var(--font-mono)',fontWeight:'500',color:'#854F0B'}}>{fmt$(upfront)}</div></div>
                  <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px'}}><div style={{fontSize:'11px',color:'#64748b',marginBottom:'3px'}}>Backend (75%)</div><div style={{fontFamily:'var(--font-mono)',fontWeight:'500',color:'#0F6E56'}}>{fmt$(backend)}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {myPeriods.length>0&&(
        <div style={{...CARD,marginBottom:'14px'}}>
          <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Your merchant discount periods</span></div>
          {myPeriods.map(p=>(
            <div key={p.id} style={{padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:p.entries?.length?'10px':'0'}}>
                <div><div style={{fontSize:'13px',fontWeight:'500'}}>{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</div><div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{p.discounts} deal{p.discounts!==1?'s':''} · {fmt$(periodAmt(p))}</div></div>
                <div style={{display:'flex',gap:'8px',alignItems:'center'}}>{p.source==='csv'&&<Badge color="blue">CSV</Badge>}<Badge color={p.paid?'teal':'amber'}>{p.paid?'✓ Paid':'⏳ Pending'}</Badge></div>
              </div>
              {p.entries?.length>0&&(
                <div style={{display:'flex',flexWrap:'wrap',gap:'5px',marginTop:'8px'}}>
                  {p.entries.filter(e=>e.tier!=='Redacted').map((e,i)=>(
                    <span key={i} style={{fontSize:'11px',padding:'3px 8px',background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',color:'var(--color-text-primary)'}}>{e.business} <span style={{color:'#0F6E56',fontFamily:'var(--font-mono)',fontWeight:'500'}}>{e.tier}</span></span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={CARD}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Payment history</span></div>
        {payments.length===0?(
          <div style={{padding:'40px',textAlign:'center',color:'var(--color-text-secondary)',fontSize:'13px'}}>No payments yet. Check back once deals are active.</div>
        ):payments.map(p=>(
          <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',gap:'14px',alignItems:'center',padding:'12px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
            <div style={{fontSize:'12px',color:'var(--color-text-secondary)',whiteSpace:'nowrap'}}>{fmtDate(p.date)}</div>
            <div><div style={{fontSize:'13px',marginBottom:'3px'}}>{p.desc}</div><Badge color={p.type==='upfront'?'amber':p.type==='backend'?'teal':'blue'}>{p.type==='upfront'?'Deal upfront':p.type==='backend'?'Deal backend':'Merchant'}</Badge></div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:'15px',fontWeight:'500',color:'#0F6E56',whiteSpace:'nowrap'}}>{fmt$(p.amount)}</div>
            <Badge color={p.paid?'teal':'amber'}>{p.paid?'✓ Paid':'⏳ Pending'}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin: assign calls + verify recordings ──
function VerifyRow({ call, callerName, onVerify }) {
  const [url,setUrl]=useState(''); const [loading,setLoading]=useState(false); const [err,setErr]=useState('');
  const load=async()=>{
    setLoading(true); setErr('');
    try{ const {data,error}=await supabase.storage.from(CALL_BUCKET).createSignedUrl(call.recordingPath,3600); if(error) throw error; setUrl(data.signedUrl); }
    catch(e){ setErr('Could not load recording: '+(e.message||e)); }
    finally{ setLoading(false); }
  };
  const isVideo = call.mediaMode!=='audio';
  return (
    <div style={{padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
      <div style={{marginBottom:'10px'}}>
        <div style={{fontWeight:'500',fontSize:'14px'}}>{call.business}</div>
        <div style={{fontSize:'12px',color:'#64748b'}}>{callerName}{[call.discount,call.location].filter(Boolean).length?' · '+[call.discount,call.location].filter(Boolean).join(' · '):''}{call.durationSec?' · '+mmss(call.durationSec):''}</div>
      </div>
      {!url&&<button style={BTN(false)} onClick={load} disabled={loading}><Play size={13}/>{loading?'Loading…':'Play recording'}</button>}
      {err&&<div style={{fontSize:'12px',color:'#A32D2D',marginTop:'8px'}}>{err}</div>}
      {url&&(isVideo
        ? <video src={url} controls style={{width:'100%',maxWidth:'420px',borderRadius:'var(--border-radius-md)',margin:'0 0 10px',display:'block'}}/>
        : <audio src={url} controls style={{width:'100%',margin:'0 0 10px'}}/>)}
      <div style={{display:'flex',gap:'8px',marginTop:'6px'}}>
        <button style={BTN(true)} onClick={()=>onVerify(call.id,'approved')}><CheckCircle size={13}/>Approve</button>
        <button style={{...BTN(false),color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}} onClick={()=>onVerify(call.id,'rejected')}>Reject / redo</button>
      </div>
    </div>
  );
}

function AdminCallsView({ employees, calls, onVerify, onDelete }) {
  const pending=calls.filter(c=>c.status==='recorded'&&(!c.verifyStatus||c.verifyStatus==='pending'));
  const nameOf=id=>employees.find(e=>e.id===id)?.name||'Unassigned';
  const byCaller={};
  calls.forEach(c=>{ (byCaller[c.callerId]=byCaller[c.callerId]||[]).push(c); });
  return (
    <div>
      <div style={{marginBottom:'16px'}}>
        <h3 style={{margin:0,fontSize:'16px',fontWeight:'500'}}>Merchant calls</h3>
        <div style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Assign merchants for your callers, then verify the recordings they send back</div>
      </div>
      <div style={{...CARD,marginBottom:'16px'}}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',alignItems:'center',gap:'8px'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Awaiting verification</span>{pending.length>0&&<Badge color="amber">{pending.length}</Badge>}</div>
        {pending.length===0?(
          <div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No recordings waiting. Calls your team records will show up here to review.</div>
        ):pending.map(c=><VerifyRow key={c.id} call={c} callerName={nameOf(c.callerId)} onVerify={onVerify}/>)}
      </div>
      {Object.keys(byCaller).length===0?(
        <div style={{...CARD,padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No merchants assigned yet. Use “Assign call” up top to add one.</div>
      ):Object.entries(byCaller).map(([cid,list])=>(
        <div key={cid} style={{...CARD,marginBottom:'12px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
            <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'500',color:'var(--color-text-info)'}}>{initials(nameOf(cid))}</div>
            <div style={{flex:1}}><div style={{fontWeight:'500'}}>{nameOf(cid)}</div><div style={{fontSize:'12px',color:'#64748b'}}>{list.length} merchant{list.length!==1?'s':''}</div></div>
          </div>
          {list.map(c=>{
            const st=CALL_STATUS[c.status]||CALL_STATUS.to_call;
            return (
              <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'12px',alignItems:'center',padding:'11px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                <div><div style={{fontSize:'13px',fontWeight:'500'}}>{c.business}</div><div style={{fontSize:'11px',color:'#64748b'}}>{[c.discount,c.location].filter(Boolean).join(' · ')||'—'}</div></div>
                <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                  {c.status==='recorded'&&c.verifyStatus&&<Badge color={VERIFY[c.verifyStatus].color}>{VERIFY[c.verifyStatus].label}</Badge>}
                  {c.status==='callback'&&c.callbackDate&&<span style={{fontSize:'11px',color:'#185FA5'}}>{fmtDate(c.callbackDate)}</span>}
                  <Badge color={st.color}>{st.label}</Badge>
                </div>
                <button onClick={()=>onDelete(c.id)} style={{...BTN(false),padding:'5px 8px',color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={12}/></button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AddCallModal({ employees, onAdd, onClose }) {
  const [callerId,setCallerId]=useState('');
  const [business,setBusiness]=useState('');
  const [contact,setContact]=useState('');
  const [phone,setPhone]=useState('');
  const [location,setLocation]=useState('');
  const [discount,setDiscount]=useState('');
  const [notes,setNotes]=useState('');
  const ok=callerId&&business.trim();
  const submit=()=>{ if(!ok) return; onAdd({callerId,business:business.trim(),contact:contact.trim(),phone:phone.trim(),location:location.trim(),discount:discount.trim(),notes:notes.trim()}); };
  return (
    <ModalWrap title="Assign a merchant call" onClose={onClose}>
      <EmpPicker employees={employees} value={callerId} onChange={setCallerId} label="Assign to caller"/>
      <Field label="Business name"><input style={INP} value={business} onChange={e=>setBusiness(e.target.value)} placeholder="e.g. Joe's Pizza" autoFocus/></Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Contact name"><input style={INP} value={contact} onChange={e=>setContact(e.target.value)}/></Field>
        <Field label="Phone"><input style={INP} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(555) 000-0000"/></Field>
      </div>
      <Field label="Location(s)"><input style={INP} value={location} onChange={e=>setLocation(e.target.value)} placeholder="e.g. Downtown & Eastside"/></Field>
      <Field label="Discount"><select style={INP} value={discount} onChange={e=>setDiscount(e.target.value)}><option value="">Select…</option>{['$15','$30','$40','$50'].map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
      <Field label="Notes (optional)"><textarea style={{...INP,minHeight:'56px',resize:'vertical'}} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
      <button style={{...BTN(true),width:'100%',justifyContent:'center',marginTop:'6px',opacity:ok?1:0.5}} onClick={submit} disabled={!ok}>Assign call</button>
    </ModalWrap>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────
export default function TailgatePayday() {
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = `
      :root {
        --color-background-primary: #ffffff;
        --color-background-secondary: #f8fafc;
        --color-background-info: #eff6ff;
        --color-text-primary: #0f172a;
        --color-text-secondary: #64748b;
        --color-text-danger: #dc2626;
        --color-text-info: #2563eb;
        --color-border-tertiary: rgba(15,23,42,0.08);
        --color-border-secondary: rgba(15,23,42,0.15);
        --color-border-primary: rgba(15,23,42,0.3);
        --color-border-danger: #fca5a5;
        --color-border-info: #93c5fd;
        --font-sans: system-ui, -apple-system, sans-serif;
        --font-mono: ui-monospace, monospace;
        --border-radius-md: 8px;
        --border-radius-lg: 12px;
      }
      body { margin: 0; background: #f1f5f9; }
      * { box-sizing: border-box; }
      @keyframes tgpulse { 0%,100%{opacity:1} 50%{opacity:.25} }
    `;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  const [session,setSession]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [tab,setTab]=useState('employees');
  const [employees,setEmployees]=useState([]);
  const [deals,setDeals]=useState([]);
  const [assignments,setAssignments]=useState([]);
  const [selectedDeal,setSelectedDeal]=useState(null);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [calls,setCalls]=useState([]);

  // Auth
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return ()=>subscription.unsubscribe();
  },[]);

  // Data load
  useEffect(()=>{
    if(!session) return;
    Promise.all([loadS('po_emp'),loadS('po_deals'),loadS('po_asgn'),loadS('po_calls')]).then(([e,d,a,c])=>{
      setEmployees(Array.isArray(e)?e:[]); setDeals(Array.isArray(d)?d:[]); setAssignments(Array.isArray(a)?a:[]); setCalls(Array.isArray(c)?c:[]); setLoading(false);
    });
  },[session]);

  const setE=v=>{setEmployees(v);saveS('po_emp',v);};
  const setD=v=>{setDeals(v);saveS('po_deals',v);};
  const setA=v=>{setAssignments(v);saveS('po_asgn',v);};
  const setC=v=>{setCalls(v);saveS('po_calls',v);};

  // Merchant call assignments / mini-CRM
  const addCall=rec=>{ setC([...calls,{...rec,id:genId(),status:'to_call',createdAt:new Date().toISOString()}]); setModal(null); };
  const updateCall=(id,patch)=>setC(calls.map(c=>c.id===id?{...c,...patch}:c));
  const saveRecording=(id,meta)=>setC(calls.map(c=>c.id===id?{...c,...meta,status:'recorded',verifyStatus:'pending',recordedAt:new Date().toISOString()}:c));
  const verifyCall=(id,status)=>setC(calls.map(c=>c.id===id?{...c,verifyStatus:status}:c));
  const deleteCall=id=>setC(calls.filter(c=>c.id!==id));

  const exportAll=()=>{
    const data={exportedAt:new Date().toISOString(),employees,deals,assignments,calls};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`tailgate-backup-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const addEmployee=(name,email)=>{ setE([...employees,{id:genId(),name,email:email||'',createdAt:new Date().toISOString()}]); setModal(null); };
  const deleteEmployee=id=>setE(employees.filter(e=>e.id!==id));
  const addDeal=deal=>{ setD([...deals,{...deal,id:genId(),createdAt:new Date().toISOString(),monthlyActivations:Array(12).fill(0),paid:{setterUpfront:false,closerUpfront:false,setterBackend:Array(12).fill(false),closerBackend:Array(12).fill(false)}}]); setModal(null); };
  const updateActivation=(dealId,idx,val)=>{ const u=deals.map(d=>{if(d.id!==dealId) return d; const ma=[...d.monthlyActivations]; ma[idx]=Math.max(0,+val||0); return {...d,monthlyActivations:ma};}); setD(u); setSelectedDeal(u.find(d=>d.id===dealId)||null); };
  const deleteDeal=id=>{ setD(deals.filter(d=>d.id!==id)); setSelectedDeal(null); };
  const addPeriod=(empId,period)=>{ const ex=assignments.find(a=>a.employeeId===empId); if(ex) setA(assignments.map(a=>a.employeeId!==empId?a:{...a,periods:[...a.periods,{...period,id:genId(),paid:false}]})); else setA([...assignments,{id:genId(),employeeId:empId,periods:[{...period,id:genId(),paid:false}]}]); setModal(null); };
  const togglePeriodPaid=(aId,pId)=>setA(assignments.map(a=>a.id!==aId?a:{...a,periods:a.periods.map(p=>p.id!==pId?p:{...p,paid:!p.paid})}));
  const deletePeriod=(aId,pId)=>setA(assignments.map(a=>a.id!==aId?a:{...a,periods:a.periods.filter(p=>p.id!==pId)}).filter(a=>a.periods.length>0));

  // Mark a deal payment as paid (used by payment queue)
  const markDealPaid=(dealId,payKey,idx)=>{
    setD(deals.map(d=>{
      if(d.id!==dealId) return d;
      const paid={...d.paid};
      if(idx!==undefined){const arr=[...paid[payKey]];arr[idx]=true;paid[payKey]=arr;}
      else paid[payKey]=true;
      return {...d,paid};
    }));
  };

  const signOut=()=>supabase.auth.signOut();
  const userEmail=session?.user?.email;
  const isAdmin=userEmail===ADMIN_EMAIL;

  if(authLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#64748b',fontSize:'14px'}}>Loading…</div>;
  if(!session) return <LoginPage/>;
  if(!isAdmin) return <EmployeePortal employees={employees} deals={deals} assignments={assignments} calls={calls} userEmail={userEmail} onSignOut={signOut} onUpdateCall={updateCall} onSaveRecording={saveRecording}/>;
  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'200px',color:'var(--color-text-secondary)',fontSize:'14px'}}>Loading…</div>;

  const TABS=[['employees','Employees',Users],['deals','Deals',Building2],['reps','Merchant Reps',DollarSign],['calls','Calls',Phone],['payments','Payments',CheckCircle],['payroll','Payroll',DollarSign]];

  return (
    <div style={{padding:'20px',maxWidth:'980px',margin:'0 auto',fontFamily:'var(--font-sans)'}}>
      <h2 className="sr-only">Tailgate Payday — Payout management</h2>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'22px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'9px'}}><span style={{fontSize:"20px"}}>🏈</span><span style={{fontSize:'17px',fontWeight:'500'}}>Tailgate Payday</span></div>
        <div style={{display:'flex',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',border:'0.5px solid var(--color-border-tertiary)',gap:'2px'}}>
          {TABS.map(([key,label,Icon])=>(
            <button key={key} onClick={()=>{setTab(key);setSelectedDeal(null);}} style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'6px 13px',borderRadius:'var(--border-radius-md)',border:'none',cursor:'pointer',fontSize:'13px',fontFamily:'var(--font-sans)',fontWeight:'500',background:tab===key?'var(--color-background-primary)':'transparent',color:tab===key?'var(--color-text-primary)':'var(--color-text-secondary)',boxShadow:tab===key?'0 0.5px 2px rgba(0,0,0,0.1)':'none'}}>
              <Icon size={13}/>{label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {['employees','deals','reps','calls'].includes(tab)&&(
            <button style={BTN(true)} onClick={()=>setModal({type:tab==='employees'?'addEmp':tab==='deals'?'addDeal':tab==='calls'?'addCall':'addPeriod'})}>
              <Plus size={14}/>{tab==='employees'?'Employee':tab==='deals'?'Deal':tab==='calls'?'Assign call':'Period'}
            </button>
          )}
          <button style={{...BTN(false),padding:'7px 10px'}} onClick={exportAll} title="Export a backup"><Download size={14}/></button>
          <button style={{...BTN(false),padding:'7px 10px'}} onClick={signOut} title="Sign out"><LogOut size={14}/></button>
        </div>
      </div>

      {tab==='employees'&&<EmployeesView employees={employees} deals={deals} assignments={assignments} onAdd={()=>setModal({type:'addEmp'})} onDelete={deleteEmployee}/>}
      {tab==='deals'&&(selectedDeal?<DealDetail deal={selectedDeal} employees={employees} onBack={()=>setSelectedDeal(null)} onUpdateActivation={updateActivation} onDelete={deleteDeal}/>:<DealsView deals={deals} employees={employees} onSelect={setSelectedDeal} onAdd={()=>setModal({type:'addDeal'})}/>)}
      {tab==='reps'&&<MerchantRepsView employees={employees} assignments={assignments} onAddPeriod={()=>setModal({type:'addPeriod'})} onImportCSV={()=>setModal({type:'importCSV'})} onTogglePaid={togglePeriodPaid} onDeletePeriod={deletePeriod} onPayStub={(emp,p)=>setModal({type:'payStub',data:{emp,p}})}/>}
      {tab==='payments'&&<PaymentQueue employees={employees} deals={deals} assignments={assignments} onMarkDealPaid={markDealPaid} onMarkPeriodPaid={togglePeriodPaid}/>}
      {tab==='payroll'&&<PayrollView employees={employees} deals={deals} assignments={assignments}/>}
      {tab==='calls'&&<AdminCallsView employees={employees} calls={calls} onVerify={verifyCall} onDelete={deleteCall}/>}

      {modal?.type==='addEmp'&&<AddEmployeeModal onAdd={addEmployee} onClose={()=>setModal(null)}/>}
      {modal?.type==='addDeal'&&<AddDealModal employees={employees} onAdd={addDeal} onClose={()=>setModal(null)}/>}
      {modal?.type==='addPeriod'&&<AddPeriodModal employees={employees} onAdd={addPeriod} onClose={()=>setModal(null)}/>}
      {modal?.type==='importCSV'&&<CSVImportModal employees={employees} assignments={assignments} onSave={updated=>{setA(updated);setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal?.type==='payStub'&&<PayStubModal emp={modal.data.emp} period={modal.data.p} onClose={()=>setModal(null)}/>}
      {modal?.type==='addCall'&&<AddCallModal employees={employees} onAdd={addCall} onClose={()=>setModal(null)}/>}
    </div>
  );
}
