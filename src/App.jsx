import { useState, useEffect, useRef } from "react";
import Papa from 'papaparse';
import {
  Plus, ArrowLeft, Trash2, ChevronRight, ChevronUp, ChevronDown,
  FileText, Users, Building2, DollarSign, Calendar,
  Upload, LogOut, CheckCircle, Shield, Download,
  Phone, Video, Circle, Square, Play,
  Info, Clock, PhoneOff, XCircle, MapPin, AlertTriangle, Pause
} from "lucide-react";
import { supabase } from './supabaseClient';
import SignAgreement from './pages/SignAgreement';
import AgreementPanel from './components/AgreementPanel';

// ─── Supabase ─────────────────────────────────────────────────────
const ADMIN_EMAIL = 'shuffman@tailgateofficial.com';
const APP_NAME = 'Tailgate Payday';
const APP_TAGLINE = 'Tailgate Official Payout Management';
// Fixed sign-up form the merchant uses to get on the card (callers can't change this).
// The merchant's name + email are auto-filled into the Zoho link.
const SIGNUP_FORM_BASE = 'https://sign.zoho.com/zsfl/me6QHiMds18lYnMe0ILA?i=9923';
const signupLink = (name,email) => `${SIGNUP_FORM_BASE}&recipient_name=${encodeURIComponent(name||'')}&recipient_email=${encodeURIComponent(email||'')}`;

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
const addDays = (date,n) => { const d=new Date(date); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };
// Whole days from today until a YYYY-MM-DD date (positive = future, negative = overdue)
const daysUntil = d => d ? Math.round((new Date(d+'T00:00:00') - new Date(today()+'T00:00:00'))/86400000) : null;
const GROUP_DEADLINE_DAYS = 7; // every imported group should be finished within a week
const fmtDate = s => { if(!s) return ''; const [y,m,d]=s.split('-'); return `${SM[+m-1]} ${+d}, ${y}`; };
const fmtTime = t => { if(!t) return ''; const [h,m]=t.split(':').map(Number); const ap=h<12?'AM':'PM'; return `${h%12||12}:${String(m).padStart(2,'0')} ${ap}`; };
const fmtDateTime = (d,t) => d ? `${fmtDate(d)}${t?` at ${fmtTime(t)}`:''}` : '';
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

function ModalWrap({title,onClose,children,wide,maxWidth}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'20px'}}>
      <div style={{...CARD,width:'100%',maxWidth:maxWidth||(wide?'820px':'500px'),maxHeight:'92vh',overflowY:'auto',background:'var(--color-background-primary)'}}>
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

// Assign to one or more callers (toggle chips)
const MultiEmpPicker = ({employees,value=[],onChange,label}) => (
  <Field label={label||'Assign to callers'}>
    {employees.length===0?(
      <div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>Add employees first.</div>
    ):(
      <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
        {employees.map(e=>{ const on=value.includes(e.id); return (
          <button key={e.id} type="button" onClick={()=>onChange(on?value.filter(x=>x!==e.id):[...value,e.id])}
            style={{padding:'6px 12px',cursor:'pointer',fontFamily:'var(--font-sans)',fontSize:'12px',fontWeight:'500',borderRadius:'100px',border:`1px solid ${on?'#5DCAA5':'var(--color-border-tertiary)'}`,background:on?'#E1F5EE':'var(--color-background-primary)',color:on?'#0F6E56':'#0f172a'}}>{e.name}</button>
        );})}
      </div>
    )}
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
    if (mode==='reset') {
      const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: window.location.origin});
      if (error) setError(error.message);
      else setSuccess('If that email has an account, a password reset link is on its way — check your inbox (and spam).');
    } else if (mode==='signin') {
      const {error} = await supabase.auth.signInWithPassword({email,password});
      if (error) setError(error.message);
    } else {
      const {error} = await supabase.auth.signUp({email,password});
      if (error) setError(error.message);
      else setSuccess('Account created! If the app doesn’t open yet, your admin still needs to add you — they’ll see your request and set you up.');
    }
    setLoading(false);
  };
  const swap = m => { setMode(m); setError(''); setSuccess(''); };
  const btnLabel = mode==='reset'?'Send reset link':mode==='signin'?'Sign in':'Create account';

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{width:'100%',maxWidth:'400px'}}>
        <div style={{textAlign:'center',marginBottom:'28px'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}><span style={{fontSize:'20px',fontWeight:'600',color:'#0f172a'}}>Tailgate Payday</span></div>
          <div style={{fontSize:'14px',color:'#64748b'}}>{APP_TAGLINE}</div>
        </div>
        <div style={{...CARD,padding:'28px',background:'#ffffff'}}>
          {mode==='reset'?(
            <div style={{marginBottom:'18px'}}>
              <div style={{fontSize:'16px',fontWeight:'600',color:'#0f172a'}}>Reset your password</div>
              <div style={{fontSize:'13px',color:'#64748b',marginTop:'4px'}}>Enter your email and we’ll send you a link to set a new password.</div>
            </div>
          ):(
            <div style={{display:'flex',gap:'4px',marginBottom:'20px',background:'#f8fafc',borderRadius:'var(--border-radius-md)',padding:'3px'}}>
              {['signin','signup'].map(m=>(
                <button key={m} onClick={()=>swap(m)} style={{flex:1,padding:'8px',border:'none',borderRadius:'var(--border-radius-md)',cursor:'pointer',fontSize:'13px',fontWeight:'500',fontFamily:'var(--font-sans)',background:mode===m?'#ffffff':'transparent',color:mode===m?'#0f172a':'#64748b',boxShadow:mode===m?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>
                  {m==='signin'?'Sign in':'Create account'}
                </button>
              ))}
            </div>
          )}
          <Field label="Email"><input style={INP} type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} autoFocus/></Field>
          {mode!=='reset'&&<Field label="Password"><input style={INP} type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}/></Field>}
          {mode==='signin'&&<div style={{textAlign:'right',marginTop:'-6px',marginBottom:'12px'}}><button onClick={()=>swap('reset')} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:'12px',color:'#185FA5',fontFamily:'var(--font-sans)'}}>Forgot your password?</button></div>}
          {error&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'14px'}}>{error}</div>}
          {success&&<div style={{background:'#E1F5EE',border:'0.5px solid #5DCAA5',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#0F6E56',marginBottom:'14px'}}>{success}</div>}
          <button style={{...BTN(true),width:'100%',justifyContent:'center',padding:'10px',fontSize:'14px',opacity:loading?0.7:1}} onClick={submit} disabled={loading}>
            {loading?'Please wait…':btnLabel}
          </button>
          {mode==='reset'&&<div style={{textAlign:'center',marginTop:'12px'}}><button onClick={()=>swap('signin')} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:'12px',color:'#64748b',fontFamily:'var(--font-sans)'}}>← Back to sign in</button></div>}
          {mode==='signup'&&<div style={{fontSize:'12px',color:'#64748b',textAlign:'center',marginTop:'12px'}}>Your admin needs to add your email to the employee roster before you can see your payouts.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── SET-NEW-PASSWORD (after a reset link) ────────────────────────
function ResetPasswordPage({ onDone, onCancel }) {
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const submit=async()=>{
    setError('');
    if(password.length<6){ setError('Password must be at least 6 characters.'); return; }
    if(password!==confirm){ setError('Those passwords don’t match.'); return; }
    setLoading(true);
    const {error}=await supabase.auth.updateUser({password});
    setLoading(false);
    if(error) setError(error.message); else onDone();
  };
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{width:'100%',maxWidth:'400px'}}>
        <div style={{textAlign:'center',marginBottom:'28px'}}>
          <div style={{fontSize:'20px',fontWeight:'600',color:'#0f172a'}}>Tailgate Payday</div>
          <div style={{fontSize:'14px',color:'#64748b',marginTop:'4px'}}>Choose a new password</div>
        </div>
        <div style={{...CARD,padding:'28px',background:'#ffffff'}}>
          <Field label="New password"><input style={INP} type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} autoFocus/></Field>
          <Field label="Confirm new password"><input style={INP} type="password" placeholder="••••••••" value={confirm} onChange={e=>setConfirm(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}/></Field>
          {error&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'14px'}}>{error}</div>}
          <button style={{...BTN(true),width:'100%',justifyContent:'center',padding:'10px',fontSize:'14px',opacity:loading?0.7:1}} onClick={submit} disabled={loading}>{loading?'Saving…':'Set new password'}</button>
          <div style={{textAlign:'center',marginTop:'12px'}}><button onClick={onCancel} style={{background:'none',border:'none',padding:0,cursor:'pointer',fontSize:'12px',color:'#64748b',fontFamily:'var(--font-sans)'}}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

// ─── EMPLOYEE / CALLER PORTAL ─────────────────────────────────────
function EmployeePortal({employees,deals,assignments,calls,orgs,userEmail,onSignOut,onUpdateCall,onAddRecordingTake,onRequestAccess}) {
  const [screen,setScreen]=useState('home');
  const [logId,setLogId]=useState('');
  const emp = employees.find(e=>e.email?.toLowerCase()===userEmail?.toLowerCase());
  const requested = useRef(false);
  useEffect(()=>{ // once: if a signed-in user isn't on the roster, flag it for the admin
    if(!emp && userEmail && onRequestAccess && !requested.current){ requested.current=true; onRequestAccess(userEmail); }
  });
  if (!emp) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{...CARD,padding:'32px',textAlign:'center',maxWidth:'420px',background:'#ffffff'}}>
        <Shield size={32} style={{margin:'0 auto 12px',display:'block',color:'#64748b'}}/>
        <div style={{fontWeight:'500',marginBottom:'8px'}}>Almost there</div>
        <div style={{fontSize:'13px',color:'#64748b',marginBottom:'20px'}}>Your email ({userEmail}) isn't on the roster yet. Your admin has been notified of your request and will add you shortly. You can also reach them at shuffman@tailgateofficial.com.</div>
        <button style={BTN(false)} onClick={onSignOut}><LogOut size={13}/>Sign out</button>
      </div>
    </div>
  );

  const myCalls = calls.filter(c=>leadVisibleTo(c,emp.id));
  const queueCount = myCalls.filter(c=>c.status==='to_call'||c.status==='callback'||c.status==='no_answer').length;
  const logCall = myCalls.find(c=>c.id===logId); // derived fresh so recordings update live
  const TABS=[['home','My Leads',Building2],['crm','CRM',Users],['agreements','Agreements',FileText],['payouts','Payouts',DollarSign]];

  return (
    <div style={{minHeight:'100vh',background:'#f1f5f9',padding:'20px'}}>
      <div style={{maxWidth:'1100px',margin:'0 auto'}}>
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

        {screen==='home'&&<CallerHome myCalls={myCalls} onOpenLog={c=>setLogId(c.id)}/>}
        {screen==='crm'&&<CallerCRM myCalls={myCalls} onOpenLog={c=>setLogId(c.id)} onWorkQueue={()=>setScreen('home')}/>}
        {screen==='agreements'&&<CallerAgreements/>}
        {screen==='payouts'&&<CallerPayouts emp={emp} deals={deals} assignments={assignments}/>}
      </div>
      {logCall&&<LogCallModal call={logCall} callerName={emp.name} callerEmail={emp.email} myCallerId={emp.id} orgs={orgs} onUpdateCall={onUpdateCall} onAddRecordingTake={onAddRecordingTake} onClose={()=>setLogId('')}/>}
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
            {!emp&&<span style={{color:'#854F0B',fontSize:'11px'}}>not in roster</span>}
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
          Reps marked "not in roster" will be skipped. Add them in the Employees tab first, then re-import.
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
function EmployeesView({employees,deals,assignments,signups=[],onAdd,onAddRequest,onDismissRequest,onDelete}) {
  const stats = emp => {
    const p=getPayments(emp.id,deals,assignments);
    return {
      total:p.reduce((s,x)=>s+x.amount,0),
      pending:p.filter(x=>!x.paid).reduce((s,x)=>s+x.amount,0),
      deals:deals.filter(d=>d.setter?.employeeId===emp.id||d.closer?.employeeId===emp.id).length,
      periods:assignments.find(a=>a.employeeId===emp.id)?.periods.length||0
    };
  };
  const pendingReq=signups.filter(s=>!employees.some(e=>e.email?.toLowerCase()===s.email.toLowerCase()));
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
        <div><h3 style={{margin:0,fontSize:'16px',fontWeight:'500'}}>Employee roster</h3><div style={{fontSize:'13px',color:'var(--color-text-secondary)',marginTop:'2px'}}>All employees — assign them to deals and merchant roles</div></div>
        <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Add employee</button>
      </div>
      {pendingReq.length>0&&(
        <div style={{...CARD,marginBottom:'16px',border:'1px solid #EF9F27'}}>
          <div style={{padding:'12px 16px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',alignItems:'center',gap:'8px',background:'#FAEEDA'}}>
            <span style={{fontWeight:'600',fontSize:'14px',color:'#854F0B'}}>Access requests</span>
            <Badge color="amber">{pendingReq.length}</Badge>
            <span style={{fontSize:'12px',color:'#854F0B'}}>— people who created an account but aren’t on the roster yet</span>
          </div>
          {pendingReq.map(s=>(
            <div key={s.email} style={{display:'flex',alignItems:'center',gap:'12px',padding:'11px 16px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:'13px',fontWeight:'500'}}>{s.email}</div><div style={{fontSize:'11px',color:'var(--color-text-secondary)'}}>Requested {fmtDate((s.requestedAt||'').split('T')[0])}</div></div>
              <button style={{...BTN(true),padding:'5px 12px',fontSize:'12px'}} onClick={()=>onAddRequest(s.email)}><Plus size={12}/>Add to roster</button>
              <button style={{...BTN(false),padding:'5px 10px',fontSize:'12px'}} onClick={()=>onDismissRequest(s.email)}>Dismiss</button>
            </div>
          ))}
        </div>
      )}
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
function AddEmployeeModal({onAdd,onClose,initialEmail}) {
  const [name,setName]=useState('');
  const [email,setEmail]=useState(initialEmail||'');
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

// ─── ORGANIZATIONS ────────────────────────────────────────────────
const ORG_TYPES = ['School','Youth football','Youth sports','Booster club','Church','Nonprofit','Business','Other'];

function AddOrgModal({onAdd,onClose}) {
  const [f,setF]=useState({name:'',type:'',city:'',state:'',notes:''});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const ok=f.name.trim();
  return (
    <ModalWrap title="Add organization" onClose={onClose}>
      <Field label="Organization name"><input style={INP} placeholder="e.g. Lexington Youth Football" value={f.name} onChange={e=>s('name',e.target.value)} autoFocus/></Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Type"><select style={INP} value={f.type} onChange={e=>s('type',e.target.value)}><option value="">Select…</option>{ORG_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="City / town"><input style={INP} value={f.city} onChange={e=>s('city',e.target.value)} placeholder="Lexington"/></Field>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="State"><input style={INP} value={f.state} onChange={e=>s('state',e.target.value)} placeholder="KY"/></Field>
        <Field label="Contact / notes (optional)"><input style={INP} value={f.notes} onChange={e=>s('notes',e.target.value)}/></Field>
      </div>
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={{...BTN(true),opacity:ok?1:0.5}} disabled={!ok} onClick={()=>ok&&onAdd({name:f.name.trim(),type:f.type,city:f.city.trim(),state:f.state.trim(),notes:f.notes.trim()})}>Add organization</button>
      </div>
    </ModalWrap>
  );
}

function OrgsView({orgs,onAdd,onDelete}) {
  const [q,setQ]=useState('');
  const ql=q.trim().toLowerCase();
  const filtered=orgs.filter(o=>!ql||[o.name,o.city,o.state,o.type].some(v=>(v||'').toLowerCase().includes(ql)));
  const distinct=key=>new Set(orgs.map(o=>(o[key]||'').toLowerCase().trim()).filter(Boolean)).size;
  const byState={};
  filtered.forEach(o=>{ const k=(o.state||'').trim()||'No state'; (byState[k]=byState[k]||[]).push(o); });
  const states=Object.entries(byState).sort((a,b)=>a[0].localeCompare(b[0]));
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px',gap:'10px',flexWrap:'wrap'}}>
        <div><h3 style={{margin:0,fontSize:'16px',fontWeight:'500'}}>Organizations</h3><div style={{fontSize:'13px',color:'var(--color-text-secondary)',marginTop:'2px'}}>Groups you work with — callers see who’s nearby while they’re on a call</div></div>
        <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Add organization</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'16px'}}>
        <Metric label="Organizations" value={orgs.length}/>
        <Metric label="Cities covered" value={distinct('city')}/>
        <Metric label="States covered" value={distinct('state')}/>
      </div>
      {orgs.length>0&&<input style={{...INP,marginBottom:'14px'}} placeholder="Search by name, city, state, or type…" value={q} onChange={e=>setQ(e.target.value)}/>}
      {orgs.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <Building2 size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>No organizations yet</div>
          <div style={{fontSize:'13px',marginBottom:'16px'}}>Add the schools and groups you work with, and where they are</div>
          <button style={BTN(true)} onClick={onAdd}><Plus size={14}/>Add first organization</button>
        </div>
      ):states.map(([state,list])=>(
        <div key={state} style={{...CARD,marginBottom:'12px'}}>
          <div style={{padding:'10px 16px',borderBottom:'0.5px solid var(--color-border-tertiary)',background:'var(--color-background-secondary)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:'600',fontSize:'13px'}}>{state}</span>
            <span style={{fontSize:'12px',color:'#64748b'}}>{list.length}</span>
          </div>
          {list.map(o=>(
            <div key={o.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'12px',alignItems:'center',padding:'11px 16px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{minWidth:0}}><div style={{fontSize:'14px',fontWeight:'500'}}>{o.name}</div><div style={{fontSize:'12px',color:'#64748b'}}>{[o.city,o.notes].filter(Boolean).join(' · ')||'—'}</div></div>
              {o.type?<Badge color="blue">{o.type}</Badge>:<span/>}
              <button onClick={()=>onDelete(o.id)} style={{...BTN(false),padding:'5px 8px',color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      ))}
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
                          <div><button onClick={()=>onTogglePaid(a.id,p.id)} style={{background:'none',border:'none',cursor:'pointer',padding:0}}><Badge color={p.paid?'teal':'amber'}>{p.paid?'Paid':'Pending'}</Badge></button></div>
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
                <Badge color={p.paid?'teal':'amber'}>{p.paid?'Paid':'Pending'}</Badge>
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
              <Badge color={p.paid?'teal':'amber'}>{p.paid?'Paid':'Pending'}</Badge>
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
  completed:      {label:'Completed',      color:'teal'},
  needs_info:     {label:'Needs info',     color:'amber'},
  callback:       {label:'Callback',       color:'blue'},
  no_answer:      {label:'No answer',      color:'gray'},
  not_interested: {label:'Not interested', color:'red'},
  interested:     {label:'Interested',     color:'teal'}, // legacy
  send_info:      {label:'Send info',      color:'blue'}, // legacy
  recorded:       {label:'Recorded',       color:'teal'}, // legacy
};
const VERIFY = {
  pending:  {label:'Awaiting review', color:'amber'},
  approved: {label:'Verified',        color:'teal'},
  rejected: {label:'Needs redo',      color:'red'},
};
// Filesystem-safe slug for organizing recordings in the storage bucket
const slug = s => (s||'').toString().toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'x';
const REC_MAX_SEC = 15 * 60;        // auto-stop recordings at 15 minutes
const FOLLOWUP_TOUCHES = 3;         // "send me more info" track = 3 touches
// The name to slug into a recording's filename (best info we have at record time)
const callContactName = c => {
  const dm = c?.decisionMaker;
  const full = dm ? [dm.firstName,dm.lastName].filter(Boolean).join(' ') : '';
  return full || c?.spokeTo || c?.contact || 'contact';
};
const REC_MIME = () => {
  if (typeof MediaRecorder==='undefined') return '';
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
  return types.find(t=>{try{return MediaRecorder.isTypeSupported(t);}catch{return false;}}) || '';
};
const mmss = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;

// ── Camera/mic recorder — always available; keeps EVERY take; review before submitting ──
function CallRecorder({ call, callerName, onTakeSaved, onUseTake, submittedTake }) {
  const [mediaMode,setMediaMode]=useState('video');
  const [camOn,setCamOn]=useState(false);
  const [recording,setRecording]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [review,setReview]=useState(null); // {take, url} of the take just captured
  const videoRef=useRef(null), streamRef=useRef(null), recRef=useRef(null), chunksRef=useRef([]), timerRef=useRef(null);
  const takeCounter=useRef(call.recordings?.length||0); // continue numbering across redos

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
    setError(''); setReview(null); chunksRef.current=[];
    const mime=REC_MIME();
    let rec;
    try{ rec=new MediaRecorder(streamRef.current, mime?{mimeType:mime, videoBitsPerSecond:1000000}:undefined); }
    catch{ setError('Recording is not supported in this browser. Please use Chrome.'); return; }
    rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunksRef.current.push(e.data); };
    rec.onstop=()=>save(rec.mimeType||mime||'video/webm');
    rec.start(); recRef.current=rec;
    setRecording(true); setElapsed(0);
    timerRef.current=setInterval(()=>setElapsed(s=>{ const n=s+1; if(n>=REC_MAX_SEC) stop(); return n; }),1000);
  };

  const stop=()=>{
    if(recRef.current&&recRef.current.state!=='inactive') recRef.current.stop();
    if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}
    setRecording(false);
  };

  // Every stop uploads immediately (nothing is ever lost) then goes to a review step.
  const save=async(mime)=>{
    setSaving(true); setError('');
    try{
      const ext=mime.includes('mp4')?'mp4':'webm';
      const blob=new Blob(chunksRef.current,{type:mime});
      const takeNum=takeCounter.current+1; takeCounter.current=takeNum;
      const path=`calls/${slug(callerName)}/${slug(call.business)}/${today()}_${slug(call.business)}_${slug(callContactName(call))}_take${takeNum}.${ext}`;
      const {error:upErr}=await supabase.storage.from(CALL_BUCKET).upload(path,blob,{contentType:mime,upsert:false});
      if(upErr) throw upErr;
      const take={recordingPath:path, recordingMime:mime, durationSec:elapsed, sizeMB:+(blob.size/1048576).toFixed(1), mediaMode, take:takeNum, recordedAt:new Date().toISOString()};
      await onTakeSaved(take); // persisted to the lead right away — a fat-fingered redo never loses the original
      setReview({take, url:URL.createObjectURL(blob)});
    }catch(e){
      setError('Your recording was captured but the upload failed: '+(e.message||e)+'  —  Make sure the "'+CALL_BUCKET+'" storage bucket exists in Supabase.');
    }finally{ setSaving(false); }
  };

  const recordAgain=()=>{ if(review?.url) URL.revokeObjectURL(review.url); setReview(null); };
  const isVideo = mediaMode==='video';

  return (
    <div style={{...CARD,padding:'18px'}}>
      {!camOn&&!recording&&!review&&(
        <div style={{display:'flex',gap:'6px',marginBottom:'14px',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',width:'fit-content'}}>
          {[['video','Video + audio'],['audio','Audio only']].map(([m,l])=>(
            <button key={m} onClick={()=>setMediaMode(m)} style={{padding:'6px 14px',border:'none',borderRadius:'var(--border-radius-md)',cursor:'pointer',fontSize:'12px',fontWeight:'500',fontFamily:'var(--font-sans)',background:mediaMode===m?'#ffffff':'transparent',color:mediaMode===m?'#0f172a':'#64748b',boxShadow:mediaMode===m?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>{l}</button>
          ))}
        </div>
      )}

      {review ? (
        <div style={{marginBottom:'12px'}}>
          {review.take.mediaMode!=='audio'
            ? <video src={review.url} controls style={{width:'100%',borderRadius:'var(--border-radius-md)',display:'block',background:'#0f172a'}}/>
            : <audio src={review.url} controls style={{width:'100%'}}/>}
          <div style={{fontSize:'12px',color:'#64748b',marginTop:'8px'}}>Take {review.take.take} · {mmss(review.take.durationSec)} · {review.take.sizeMB} MB — saved. Review it, then use it or record again.</div>
        </div>
      ) : isVideo ? (
        <div style={{position:'relative',background:'#0f172a',borderRadius:'var(--border-radius-md)',overflow:'hidden',aspectRatio:'4 / 3',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <video ref={videoRef} muted playsInline style={{width:'100%',height:'100%',objectFit:'cover',display:camOn?'block':'none'}}/>
          {!camOn&&<div style={{color:'#94a3b8',fontSize:'13px'}}>Camera is off</div>}
          {recording&&<div style={{position:'absolute',top:'10px',left:'10px',display:'flex',alignItems:'center',gap:'6px',background:'rgba(0,0,0,0.55)',borderRadius:'100px',padding:'4px 10px'}}><span style={{width:'8px',height:'8px',borderRadius:'50%',background:'#ef4444',animation:'tgpulse 1s infinite'}}/><span style={{color:'#fff',fontSize:'12px',fontFamily:'var(--font-mono)'}}>{mmss(elapsed)}</span></div>}
        </div>
      ) : camOn && (
        <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'18px',marginBottom:'12px',display:'flex',alignItems:'center',justifyContent:'center',gap:'10px'}}>
          <span style={{width:'10px',height:'10px',borderRadius:'50%',background:recording?'#ef4444':'#94a3b8',animation:recording?'tgpulse 1s infinite':'none'}}/>
          <span style={{fontSize:'13px',color:'#64748b'}}>{recording?`Recording — ${mmss(elapsed)}`:'Microphone ready'}</span>
        </div>
      )}

      {error&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'12px',lineHeight:1.5}}>{error}</div>}

      <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        {review ? (
          <>
            <button style={BTN(true)} onClick={()=>onUseTake(review.take)}><CheckCircle size={13}/>Use this recording</button>
            <button style={BTN(false)} onClick={recordAgain}><Circle size={13}/>Record again</button>
          </>
        ) : (
          <>
            {!camOn&&!recording&&<button style={BTN(false)} onClick={enable}>{isVideo?<Video size={14}/>:<Play size={14}/>}Turn on {isVideo?'camera':'mic'}</button>}
            {camOn&&!recording&&!saving&&<button style={BTN(true)} onClick={start}><Circle size={13}/>Start recording</button>}
            {recording&&<button style={{...BTN(true),background:'#dc2626',color:'#fff'}} onClick={stop}><Square size={12}/>Stop</button>}
            {saving&&<div style={{fontSize:'13px',color:'#64748b'}}>Uploading…</div>}
          </>
        )}
        {submittedTake!=null&&<span style={{marginLeft:'auto'}}><Badge color="teal">Using take {submittedTake}</Badge></span>}
      </div>
      {recording&&<div style={{fontSize:'11px',color:'#94a3b8',marginTop:'8px'}}>Auto-stops at 15:00.</div>}
    </div>
  );
}

// ── Log Call cockpit — one focused view per lead: record anytime, read the script, pick an outcome ──
const OUTCOMES = [
  ['completed',     'Completed',      'teal',  'Agreed — video required', CheckCircle],
  ['needs_info',    'Needs more info','amber', 'Warm — follow up',        Info],
  ['callback',      'Call back',      'blue',  'Schedule date & time',    Clock],
  ['no_answer',     'No answer',      'gray',  'Stays in rotation',       PhoneOff],
  ['not_interested','Not interested', 'red',   'Keep their info',         XCircle],
];
// Standardized business-type / category options
const BUSINESS_TYPES = ['Fast food','Pizza','Casual dining','Bakery/coffee shop','Healthy','Ethnic','International','Food truck','High-end','Nightlife','Other'];

// What a call is worth (caller payout) — $5 to $75 in $5 steps
const PAYOUT_AMOUNTS = Array.from({length:15},(_,i)=>(i+1)*5);
const leadValue = c => { if(c?.value!=null&&c.value!=='') return +c.value||0; const d=(c?.discount||'').toString().replace(/[^0-9.]/g,''); return d?+d:0; };
const parseMoney = s => { const n=parseFloat((s==null?'':s).toString().replace(/[^0-9.]/g,'')); return isNaN(n)?0:n; };
// Multi-caller pool + claim model: a lead can be shared with several callers until one
// logs an outcome ("claims" it); after that only the claimer sees it.
const leadPool = c => (c?.callerIds&&c.callerIds.length) ? c.callerIds : (c?.callerId ? [c.callerId] : []);
const leadClaimed = c => !!c?.callerId && c.status!=='to_call';
const leadVisibleTo = (c,id) => leadClaimed(c) ? c.callerId===id : leadPool(c).includes(id);
const leadAssignedTo = (c,id) => (c.callerId===id) || (!leadClaimed(c)&&leadPool(c).includes(id)); // admin attribution
const ValuePicker = ({value,onChange}) => (
  <div style={{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'156px',overflowY:'auto',padding:'2px'}}>
    {PAYOUT_AMOUNTS.map(a=>{ const on=+value===a; return (
      <button key={a} type="button" onClick={()=>onChange(a)} style={{padding:'6px 10px',minWidth:'48px',cursor:'pointer',fontFamily:'var(--font-sans)',fontSize:'12px',fontWeight:'600',borderRadius:'var(--border-radius-md)',border:`1px solid ${on?'#5DCAA5':'var(--color-border-tertiary)'}`,background:on?'#E1F5EE':'var(--color-background-primary)',color:on?'#0F6E56':'#0f172a'}}>${a}</button>
    );})}
  </div>
);
const ValueSelect = ({value,onChange}) => (
  <select style={{...INP,width:'auto',padding:'5px 8px',fontSize:'12px'}} value={value||''} onChange={e=>onChange(e.target.value?+e.target.value:0)}>
    <option value="">$ —</option>
    {PAYOUT_AMOUNTS.map(a=><option key={a} value={a}>${a}</option>)}
  </select>
);
// Small field helpers for the Log Call form (module-level so inputs keep focus across renders)
const Wait = ({children}) => <div style={{display:'flex',alignItems:'center',gap:'7px',background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'7px 11px',fontSize:'12px',color:'#854F0B',margin:'0 0 12px',fontWeight:'500'}}><Pause size={13} style={{flexShrink:0}}/><span>{children||'Wait for them to say “yes.”'}</span></div>;
const DMFields = ({dm,set}) => (
  <div style={{display:'grid',gridTemplateColumns:'90px 1fr 1fr',gap:'8px'}}>
    <Field label="Title"><input style={INP} placeholder="Owner" value={dm.title} onChange={e=>set('title',e.target.value)}/></Field>
    <Field label="First name"><input style={INP} value={dm.firstName} onChange={e=>set('firstName',e.target.value)}/></Field>
    <Field label="Last name"><input style={INP} value={dm.lastName} onChange={e=>set('lastName',e.target.value)}/></Field>
  </div>
);
const ContactFields = ({email,setEmail,phone,setPhone}) => (
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
    <Field label="Email"><input style={INP} type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
    <Field label="Phone"><input style={INP} value={phone} onChange={e=>setPhone(e.target.value)}/></Field>
  </div>
);
const NoteField = ({note,setNote}) => (
  <Field label="Add a note"><textarea style={{...INP,minHeight:'58px',resize:'vertical'}} placeholder="What happened on the call?" value={note} onChange={e=>setNote(e.target.value)}/></Field>
);

function LogCallModal({ call, callerName, callerEmail, myCallerId, orgs=[], onUpdateCall, onAddRecordingTake, onClose }) {
  const [outcome,setOutcome]=useState(null);
  const [submittedTake,setSubmittedTake]=useState(call.submittedTake??null);
  const [dm,setDm]=useState(call.decisionMaker||{title:'',firstName:'',lastName:''});
  const [spokeTo,setSpokeTo]=useState(call.spokeTo||'');
  const [email,setEmail]=useState(call.email||'');
  const [phone,setPhone]=useState(call.phone||'');
  const [businessName,setBusinessName]=useState(call.business||'');
  const [businessType,setBusinessType]=useState(call.businessType||call.category||'');
  const [addresses,setAddresses]=useState(call.addresses?.length?call.addresses:[{street:call.location||'',city:'',state:''}]);
  const [offerDetails,setOfferDetails]=useState(call.offerDetails||'');
  const [cbDate,setCbDate]=useState(call.callbackDate||addDays(today(),2));
  const [cbTime,setCbTime]=useState(call.callbackTime||'');
  const [note,setNote]=useState('');
  const initFirst=(call.decisionMaker?.firstName)||(call.spokeTo||call.contact||'').trim().split(/\s+/)[0]||'there';
  const initBiz=call.business||'your business';
  const [emailSubject,setEmailSubject]=useState(`${initFirst!=='there'?initFirst+' - ':''}${initBiz} info from Tailgate Fundraising`);
  const [emailBody,setEmailBody]=useState(`Hi ${initFirst},\n\nGreat speaking with you today. As promised, here's a bit more about partnering with Tailgate Fundraising for ${initBiz}.\n\nHere's the short version of what this looks like for you:\n\nThere is no cost to you. No fee, no commitment, nothing to buy. You offer a discount to cardholders, and your team honors it in person when someone shows the card. That's the whole ask.\n\nWhat you get is exposure to everyone supporting the cause. Every family, student, and supporter who buys a card sees your business on it, and they carry it with them. Most local advertising asks you to pay and hope. This puts you in front of people who are already choosing where to spend locally, and it ties your name to something the community cares about.\n\nIt also drives foot traffic rather than impressions. A card in someone's wallet is a reason to walk in your door instead of driving past.\n\nLater this month we're launching a reporting dashboard, so you'll be able to see how your offer is actually performing, similar to what you'd expect from Google Analytics. Redemptions, traffic, and how you compare to other partners on the card. You'll get access as soon as it goes live.\n\nWhenever you're ready, just use the sign-up link below to get on the card. Any questions, reply right here.`);
  const [emailed,setEmailed]=useState(false);
  const [sending,setSending]=useState(false);
  const [emailErr,setEmailErr]=useState('');
  // Completed outcome: choose Form (e-sign) or Verbal (record video)
  const [completeMode,setCompleteMode]=useState(null); // null | 'form' | 'verbal'
  const [agreementId,setAgreementId]=useState(null);
  const [creatingAgr,setCreatingAgr]=useState(false);
  const [agreementErr,setAgreementErr]=useState('');

  const setDmF=(k,v)=>setDm(d=>({...d,[k]:v}));
  const setAddr=(i,k,v)=>setAddresses(a=>a.map((x,j)=>j===i?{...x,[k]:v}:x));
  const addAddr=()=>setAddresses(a=>[...a,{street:'',city:'',state:''}]);
  const rmAddr=i=>setAddresses(a=>a.filter((_,j)=>j!==i));
  const addrLine=a=>[a.street,a.city,a.state].filter(Boolean).join(', ');

  const contactName=[dm.firstName,dm.lastName].filter(Boolean).join(' ')||spokeTo||call.contact||'[contact name]';
  const position=dm.title||'[position]';
  const addrText=addresses.map(addrLine).filter(Boolean).join(' • ')||'[address, city, state]';
  const offerText=offerDetails||'[offer details]';

  // "Completed" requires an actual video recording of the confirmation
  const submittedRec=(call.recordings||[]).find(r=>r.take===submittedTake);
  const hasVideoTake=!!submittedRec && submittedRec.mediaMode!=='audio';

  // Profile header bits + the rest of what we already know about this lead
  const leadAddress=(call.addresses?.map(addrLine).filter(Boolean).join(' • '))||call.location||'';
  const leadSchool=call.school||'';
  // Organizations we already work with near this merchant — great trust-builder on the call
  const lc=leadCity(call).toLowerCase(), ls=leadState(call).toLowerCase();
  const nearbyOrgs=(orgs||[]).filter(o=>{ const oc=(o.city||'').toLowerCase().trim(), os=(o.state||'').toLowerCase().trim(); return (oc&&oc===lc)||(os&&os===ls); }).slice(0,10);
  const leadInfo=[
    ['Contact', call.contact||call.spokeTo],
    ['Phone', call.phone],
    ['Email', call.email],
    ['Category', call.businessType||call.category],
    ['More', call.additionalInfo],
  ].filter(([,v])=>v);

  const withNote=base=>note.trim()?((base?base+'\n\n':'')+`${today()}: ${note.trim()}`):base;
  // Logging any outcome claims the lead for this caller (removes it from other callers' pool)
  const commit=patch=>{ onUpdateCall(call.id,{...patch, ...(myCallerId?{callerId:myCallerId}:{}), notes:withNote(call.notes||'')}); onClose(); };
  // Info email — one-click server send via Resend (Supabase Edge Function). The personalized
  // Zoho sign-up link (merchant name + email pre-filled) and the caller's name are auto-appended.
  const emailTo=email||call.email;
  const merchantName=[dm.firstName,dm.lastName].filter(Boolean).join(' ')||spokeTo||call.contact||'';
  const fullEmailBody=()=>`${emailBody}\n\n${signupLink(merchantName,emailTo)}\n\nThanks,\n${callerName}`;
  const sendEmail=async()=>{
    setSending(true); setEmailErr('');
    try{
      const {data,error}=await supabase.functions.invoke('send-info-email',{body:{to:emailTo,subject:emailSubject,text:fullEmailBody(),replyTo:callerEmail||undefined}});
      if(error) throw error;
      if(data&&data.error) throw new Error(data.error);
      setEmailed(true);
    }catch(e){ setEmailErr('Couldn’t send automatically ('+(e.message||e)+'). Tap below to send from your own email app instead.'); }
    finally{ setSending(false); }
  };
  const openMailto=()=>{ window.location.href=`mailto:${encodeURIComponent(emailTo||'')}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(fullEmailBody())}`; setEmailed(true); };

  // e-signature: lazily create the agreement row only when the rep picks Form.
  // created_by defaults to auth.uid() (RLS); prefill snapshots the fields shown.
  const createAgreement=async()=>{
    const prefill={
      business_name: businessName||call.business||'',
      contact_person: merchantName,
      phone: phone||call.phone||'',
      email: emailTo||'',
      address: (addresses.map(addrLine).filter(Boolean).join(', '))||leadAddress||call.location||'',
      discount_offered: offerDetails||'',
    };
    const {data,error}=await supabase.from('agreements').insert({
      merchant_id: call.id, school: call.school||null,
      template_version:'discount-partnership-v1', prefill, status:'draft',
    }).select('id').single();
    if(error) throw error;
    return data.id;
  };
  const startForm=async()=>{
    setCreatingAgr(true); setAgreementErr('');
    try{ const id=await createAgreement(); setAgreementId(id); setCompleteMode('form'); }
    catch(e){ setAgreementErr('Could not start the agreement ('+(e.message||e)+'). Deploy the agreements table, or use Verbal.'); }
    finally{ setCreatingAgr(false); }
  };
  const saveFormCompleted=()=>{
    const loc=addresses.map(addrLine).filter(Boolean).join(' | ');
    commit({ status:'completed', verifyStatus:'pending', agreementId, decisionMaker:dm, spokeTo, email, phone,
      business:businessName||call.business, businessType, category:businessType, addresses, location:loc||call.location||'', offerDetails });
  };

  const save=()=>{
    const loc=addresses.map(addrLine).filter(Boolean).join(' | ');
    const details={ decisionMaker:dm, spokeTo, email, phone, business:businessName||call.business,
      businessType, category:businessType, addresses, location:loc||call.location||'', offerDetails };
    if(outcome==='completed'){
      if(!hasVideoTake) return; // guarded by the disabled button too
      commit({ status:'completed', verifyStatus:'pending', submittedTake, recordedAt:new Date().toISOString(), ...details });
    } else if(outcome==='needs_info'){
      commit({ status:'needs_info', ...(submittedTake!=null?{submittedTake}:{}), ...details, ...(emailed?{infoEmailedAt:new Date().toISOString()}:{}) });
    } else if(outcome==='callback'){
      commit({ status:'callback', callbackDate:cbDate, callbackTime:cbTime, spokeTo, email, phone, decisionMaker:dm });
    } else if(outcome==='no_answer'){
      commit({ status:'no_answer', ...(spokeTo?{spokeTo}:{}) });
    } else if(outcome==='not_interested'){
      commit({ status:'not_interested', spokeTo, email, phone, decisionMaker:dm });
    }
  };
  const detailsForm=(
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(290px,1fr))',gap:'0 18px'}}>
      <div>
        <DMFields dm={dm} set={setDmF}/>
        <ContactFields email={email} setEmail={setEmail} phone={phone} setPhone={setPhone}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
          <Field label="Business name"><input style={INP} value={businessName} onChange={e=>setBusinessName(e.target.value)}/></Field>
          <Field label="Business type">
            <select style={INP} value={businessType} onChange={e=>setBusinessType(e.target.value)}>
              <option value="">Select…</option>
              {businessType&&!BUSINESS_TYPES.includes(businessType)&&<option value={businessType}>{businessType}</option>}
              {BUSINESS_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div>
        <label style={{display:'block',fontSize:'12px',color:'var(--color-text-secondary)',marginBottom:'5px',fontWeight:'500'}}>Address(es) — confirm every location</label>
        {addresses.map((a,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'1.6fr 1fr 0.8fr auto',gap:'6px',marginBottom:'6px'}}>
            <input style={INP} placeholder="Street" value={a.street} onChange={e=>setAddr(i,'street',e.target.value)}/>
            <input style={INP} placeholder="City" value={a.city} onChange={e=>setAddr(i,'city',e.target.value)}/>
            <input style={INP} placeholder="State" value={a.state} onChange={e=>setAddr(i,'state',e.target.value)}/>
            <button style={{...BTN(false),padding:'5px 8px'}} onClick={()=>addresses.length>1?rmAddr(i):setAddr(i,'street','')} title="Remove"><Trash2 size={12}/></button>
          </div>
        ))}
        <button style={{...BTN(false),padding:'5px 10px',fontSize:'12px',marginBottom:'12px'}} onClick={addAddr}><Plus size={12}/>Add location</button>
        <Field label="Offer / discount details (enter what they agreed to)"><textarea style={{...INP,minHeight:'70px',resize:'vertical'}} value={offerDetails} onChange={e=>setOfferDetails(e.target.value)}/></Field>
        <NoteField note={note} setNote={setNote}/>
      </div>
    </div>
  );

  return (
    <ModalWrap title={`Log call — ${call.business}`} onClose={onClose} wide maxWidth="1060px">
      {/* Lead profile — name + address on the left, school/group top-right */}
      <div style={{...CARD,background:'var(--color-background-secondary)',padding:'16px',marginBottom:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'16px'}}>
          <div style={{minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
              <span style={{fontSize:'20px',fontWeight:'600',color:'#0f172a'}}>{call.business||'Unknown business'}</span>
              {call.group&&<span style={{background:'var(--color-background-info)',border:'1px solid var(--color-border-info)',borderRadius:'100px',padding:'3px 12px',fontSize:'12px',fontWeight:'600',color:'#185FA5'}}>Calling for {call.group}</span>}
              {leadValue(call)>0&&<span style={{background:'#E1F5EE',border:'1px solid #5DCAA5',borderRadius:'100px',padding:'3px 12px',fontSize:'14px',fontWeight:'700',color:'#0F6E56'}}>${leadValue(call)} payout</span>}
            </div>
            {leadAddress&&<div style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'13px',color:'#64748b',marginTop:'4px'}}><MapPin size={13} style={{flexShrink:0}}/><span>{leadAddress}</span></div>}
          </div>
          {leadSchool&&(
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:'10px',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.6px',fontWeight:'600'}}>School / Group</div>
              <div style={{fontSize:'14px',fontWeight:'500',color:'#0f172a',marginTop:'2px'}}>{leadSchool}</div>
            </div>
          )}
        </div>
        {leadInfo.length>0&&(
          <div style={{display:'flex',flexWrap:'wrap',gap:'5px 20px',marginTop:'12px',fontSize:'13px',color:'#0f172a',lineHeight:1.5,borderTop:'0.5px solid var(--color-border-tertiary)',paddingTop:'12px'}}>
            {leadInfo.map(([label,val])=><span key={label}><span style={{color:'#64748b'}}>{label}: </span>{val}</span>)}
          </div>
        )}
        {call.notes&&<div style={{background:'var(--color-background-primary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px',fontSize:'12px',color:'#0f172a',whiteSpace:'pre-wrap',margin:'12px 0 0',lineHeight:1.5}}><b style={{color:'#64748b'}}>Notes</b><br/>{call.notes}</div>}
      </div>

      {nearbyOrgs.length>0&&(
        <div style={{background:'var(--color-background-info)',border:'0.5px solid var(--color-border-info)',borderRadius:'var(--border-radius-lg)',padding:'14px 16px',marginBottom:'16px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',fontWeight:'600',color:'#185FA5',marginBottom:'8px'}}><MapPin size={13}/>Groups we already work with near {leadCity(call)}</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
            {nearbyOrgs.map(o=><span key={o.id} style={{fontSize:'12px',padding:'3px 10px',background:'#fff',border:'0.5px solid var(--color-border-info)',borderRadius:'100px',color:'#0f172a'}}>{o.name}{o.type?` · ${o.type}`:''}{o.city?` · ${o.city}`:''}</span>)}
          </div>
          <div style={{fontSize:'11px',color:'#64748b',marginTop:'8px'}}>Mention these to build trust — “we already partner with a few groups right by you.”</div>
        </div>
      )}

      {/* Outcome buttons — the very first action */}
      <div style={{fontWeight:'600',fontSize:'16px',margin:'0 0 12px'}}>How did the call go?</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'12px',marginBottom:'16px'}}>
        {OUTCOMES.map(([key,label,color,sub,Icon])=>{
          const on=outcome===key; const c=CC[color];
          return (
            <button key={key} onClick={()=>setOutcome(key)}
              style={{aspectRatio:'1 / 1',minHeight:'138px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'10px',textAlign:'center',padding:'14px',cursor:'pointer',borderRadius:'var(--border-radius-lg)',
                border:`1px solid ${on?c.br:'var(--color-border-tertiary)'}`,background:on?c.bg:'var(--color-background-primary)',
                boxShadow:on?`0 0 0 2px ${c.br}`:'none',fontFamily:'var(--font-sans)',transition:'all 0.12s'}}>
              <Icon size={28} color={on?c.tx:'#64748b'} strokeWidth={1.75}/>
              <div style={{fontSize:'14px',fontWeight:'600',color:on?c.tx:'#0f172a'}}>{label}</div>
              <div style={{fontSize:'11px',color:'#64748b',lineHeight:1.3}}>{sub}</div>
            </button>
          );
        })}
      </div>

      {outcome==='completed'&&(
        <div style={{...CARD,padding:'16px',marginBottom:'16px'}}>
          {completeMode===null&&(
            <div>
              <div style={{fontSize:'13.5px',lineHeight:1.6,color:'#0f172a',background:'var(--color-background-secondary)',borderLeft:'3px solid #1D9E75',borderRadius:'8px',padding:'12px 14px',marginBottom:'14px'}}>Great, that all sounds good. Would you prefer we do this by a quick <b>form</b> I text or email you, or a <b>verbal</b> agreement right now?</div>
              <div style={{display:'flex',gap:'10px'}}>
                <button style={{...BTN(true),flex:1,justifyContent:'center',opacity:creatingAgr?0.7:1}} disabled={creatingAgr} onClick={startForm}><FileText size={14}/>{creatingAgr?'Preparing…':'Send agreement (form)'}</button>
                <button style={{...BTN(false),flex:1,justifyContent:'center'}} onClick={()=>setCompleteMode('verbal')}><Video size={14}/>Verbal — record</button>
              </div>
              {agreementErr&&<div style={{fontSize:'12px',color:'#A32D2D',marginTop:'10px'}}>{agreementErr}</div>}
            </div>
          )}
          {completeMode==='verbal'&&(
            <>
              <div style={{display:'flex',alignItems:'flex-start',gap:'8px',background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'11px 13px',fontSize:'13px',color:'#854F0B',marginBottom:'14px',fontWeight:'500',lineHeight:1.5}}><Video size={16} style={{flexShrink:0,marginTop:'1px'}}/><span>Be sure to record a video of you confirming the discount with them — a video is <b>required</b> to mark this Completed. Scroll down, record, and tap “Use this recording.”</span></div>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#0F6E56',marginBottom:'12px'}}>Confirm their details</div>
              {detailsForm}
              <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:hasVideoTake?'#0F6E56':'#A32D2D',margin:'0 0 10px',fontWeight:'500'}}>{hasVideoTake?<CheckCircle size={13}/>:<AlertTriangle size={13}/>}<span>{hasVideoTake?'Video attached — this goes to your admin to verify and pay.':'No video attached yet — record one below to enable saving.'}</span></div>
              <button style={{...BTN(true),width:'100%',justifyContent:'center',opacity:hasVideoTake?1:0.5}} disabled={!hasVideoTake} onClick={save}><CheckCircle size={14}/>Save completed</button>
            </>
          )}
          {completeMode==='form'&&(
            <>
              <AgreementPanel initialStep="channel" agreementId={agreementId} businessName={businessName||call.business} defaultPhone={phone||call.phone||''} defaultEmail={emailTo||''} onVerbal={()=>setCompleteMode('verbal')}/>
              <button style={{...BTN(true),width:'100%',justifyContent:'center',marginTop:'12px'}} onClick={saveFormCompleted}><CheckCircle size={14}/>Save — mark completed</button>
              <div style={{fontSize:'12px',color:'#64748b',marginTop:'8px',lineHeight:1.5}}>Once they sign (you’ll see it update above), mark this completed — the signed agreement is the record, no video needed.</div>
            </>
          )}
        </div>
      )}
      {outcome==='needs_info'&&(
        <div style={{...CARD,padding:'16px',marginBottom:'16px'}}>
          <div style={{fontSize:'12px',fontWeight:'600',color:'#854F0B',marginBottom:'4px'}}>Their details</div>
          <div style={{fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>They’re interested but need more info or time to decide. Grab everything you can and follow up.</div>
          {detailsForm}

          <div style={{borderTop:'0.5px solid var(--color-border-tertiary)',marginTop:'8px',paddingTop:'14px'}}>
            <div style={{fontSize:'12px',fontWeight:'600',color:'#185FA5',marginBottom:'10px'}}>Send them the info by email</div>
            {emailTo?(
              <>
                <Field label="To"><input style={{...INP,background:'var(--color-background-secondary)'}} value={emailTo} readOnly/></Field>
                <Field label="Subject"><input style={INP} value={emailSubject} onChange={e=>setEmailSubject(e.target.value)}/></Field>
                <Field label="Message (edit anything — add the specific details you discussed)"><textarea style={{...INP,minHeight:'120px',resize:'vertical'}} value={emailBody} onChange={e=>setEmailBody(e.target.value)}/></Field>
                <div style={{background:'var(--color-background-secondary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px',fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>
                  Auto-added to the bottom (can’t be changed): the sign-up link (with {merchantName||'their name'} + their email pre-filled) and your name, <b style={{color:'#0f172a'}}>{callerName}</b>. Replies come back to you.
                </div>
                {emailed?(
                  <div style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'13px',color:'#0F6E56',marginBottom:'10px',fontWeight:'600'}}><CheckCircle size={14}/>Sent to {emailTo}. Now Save below.</div>
                ):(
                  <button style={{...BTN(true),width:'100%',justifyContent:'center',marginBottom:'8px',opacity:sending?0.7:1}} disabled={sending} onClick={sendEmail}><FileText size={14}/>{sending?'Sending…':'Send info email'}</button>
                )}
                {emailErr&&<div style={{fontSize:'12px',color:'#A32D2D',marginBottom:'8px'}}>{emailErr}</div>}
                {emailErr&&<button style={{...BTN(false),width:'100%',justifyContent:'center',marginBottom:'8px'}} onClick={openMailto}>Open in my email app instead</button>}
              </>
            ):(
              <div style={{fontSize:'13px',color:'#854F0B',marginBottom:'12px'}}>Add their email in the details above to send them the info.</div>
            )}
          </div>
          {emailTo&&!emailed&&<div style={{fontSize:'12px',color:'#854F0B',marginBottom:'8px',fontWeight:'500'}}>Send the info email above before you save.</div>}
          <button style={{...BTN(true),width:'100%',justifyContent:'center'}} onClick={save}>Save — needs more info</button>
        </div>
      )}
      {outcome==='callback'&&(
        <div style={{...CARD,padding:'16px',marginBottom:'16px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
            <Field label="Call back on"><input style={INP} type="date" value={cbDate} onChange={e=>setCbDate(e.target.value)}/></Field>
            <Field label="At (time)"><input style={INP} type="time" value={cbTime} onChange={e=>setCbTime(e.target.value)}/></Field>
            <Field label="Who did you speak to?"><input style={INP} value={spokeTo} onChange={e=>setSpokeTo(e.target.value)}/></Field>
          </div>
          <ContactFields email={email} setEmail={setEmail} phone={phone} setPhone={setPhone}/>
          <NoteField note={note} setNote={setNote}/>
          <button style={{...BTN(true),width:'100%',justifyContent:'center'}} onClick={save}>Save callback</button>
        </div>
      )}
      {outcome==='no_answer'&&(
        <div style={{...CARD,padding:'16px',marginBottom:'16px'}}>
          <div style={{fontSize:'13px',color:'#64748b',marginBottom:'12px'}}>Logs a no-answer — this lead stays in your rotation to try again.</div>
          <NoteField note={note} setNote={setNote}/>
          <button style={{...BTN(true),width:'100%',justifyContent:'center'}} onClick={save}>Save</button>
        </div>
      )}
      {outcome==='not_interested'&&(
        <div style={{...CARD,padding:'16px',marginBottom:'16px'}}>
          <div style={{fontSize:'13px',color:'#64748b',marginBottom:'12px'}}>Not interested — still keep whatever contact info you got.</div>
          <Field label="Who did you speak to? (owner/contact)"><input style={INP} value={spokeTo} onChange={e=>setSpokeTo(e.target.value)}/></Field>
          <ContactFields email={email} setEmail={setEmail} phone={phone} setPhone={setPhone}/>
          <NoteField note={note} setNote={setNote}/>
          <button style={{...BTN(true),width:'100%',justifyContent:'center'}} onClick={save}>Save</button>
        </div>
      )}

      {/* Script + recorder moved below the outcome buttons */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px',marginTop:'4px'}}>
        <div style={{...CARD,padding:'16px'}}>
          <div style={{fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.6px',color:'#64748b',marginBottom:'10px'}}>Recording script — read once they’re interested</div>
          <div style={{fontSize:'13px',lineHeight:1.65,color:'#0f172a'}}>
            <p style={{margin:'0 0 12px'}}>“Great, this all sounds good. If you don’t mind, I’m just going to run through everything again to make sure we get all the details correct. Before we go any further, I want to let you know this call is being recorded — is that okay with you?”</p>
            <Wait>Wait ~2 seconds for a “yes.”</Wait>
            <p style={{margin:'0 0 12px'}}>“This is <b>{callerName}</b> with Tailgate Fundraising, on <b>{fmtDate(today())}</b>. I am now recording this call with the permission of <b>{contactName}</b>, who is the <b>{position}</b> of <b>{businessName||'[business name]'}</b>, correct?”</p>
            <Wait/>
            <p style={{margin:'0 0 12px'}}>“Do you also certify that you are authorized to approve this discount agreement, and that your official address is <b>{addrText}</b>?” <span style={{color:'#64748b'}}>(for multiple locations, list them all)</span></p>
            <Wait/>
            <p style={{margin:'0 0 12px'}}>“Appreciate it. I just want to confirm your offer of <b>{offerText}</b>. You agree that our company, along with our partners and affiliates, has the unrestricted right to market, package, and sell this offer to any organization, individual, or group we choose, correct?”</p>
            <Wait/>
            <p style={{margin:'0 0 12px'}}>“And do you understand that if for any reason you ever want to cancel or update a discount, you have the option to by contacting us via our website <b>JoinTailgate.com</b>?”</p>
            <Wait/>
            <p style={{margin:0}}>“Perfect — what we’ll send you is an email with access to our performance dashboard to track analytics and keep you up to date with your deals. Besides that, you’re all set. Thanks again!”</p>
          </div>
        </div>
        <div>
          <CallRecorder call={call} callerName={callerName} submittedTake={submittedTake}
            onTakeSaved={take=>onAddRecordingTake(call.id,take)} onUseTake={take=>setSubmittedTake(take.take)}/>
          <div style={{fontSize:'12px',color:'#64748b',marginTop:'10px',lineHeight:1.5}}>Put the call on <b>speakerphone</b> near your computer so the recording captures both voices. Every take is saved — you can re-record and pick the good one.</div>
        </div>
      </div>
    </ModalWrap>
  );
}

// ── My Leads — concise, batched list; each lead opens the Log Call cockpit ──
const LEAD_BATCH = 10;
// Shared lead row used by both My Leads sections
function LeadRow({ c, onOpenLog }) {
  const st=CALL_STATUS[c.status]||CALL_STATUS.to_call;
  const overdue=c.status==='callback'&&c.callbackDate&&c.callbackDate<today();
  return (
    <div style={{display:'grid',gridTemplateColumns:'34px 1fr auto auto',gap:'12px',alignItems:'center',padding:'12px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
      <div style={{width:'34px',height:'34px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:'600',color:'var(--color-text-info)'}}>{initials(c.contact||c.business||'?')}</div>
      <div style={{minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}><span style={{fontWeight:'500',fontSize:'14px'}}>{c.business}</span>{c.group&&<span style={{fontSize:'11px',color:'#185FA5',background:'var(--color-background-info)',borderRadius:'100px',padding:'1px 8px',fontWeight:'500'}}>{c.group}</span>}</div>
        <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{[c.contact,c.phone,c.location].filter(Boolean).join(' · ')||'No contact details'}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',justifyContent:'flex-end'}}>
        {!leadClaimed(c)&&leadPool(c).length>1&&<Badge color="gray">{leadPool(c).length} can see</Badge>}
        {leadValue(c)>0&&<span style={{background:'#E1F5EE',border:'1px solid #5DCAA5',borderRadius:'100px',padding:'2px 10px',fontSize:'12px',fontWeight:'700',color:'#0F6E56',whiteSpace:'nowrap'}}>${leadValue(c)}</span>}
        {c.status==='callback'&&c.callbackDate&&<span style={{fontSize:'11px',color:overdue?'#A32D2D':'#185FA5',fontWeight:'500'}}>{overdue?'Due ':''}{fmtDateTime(c.callbackDate,c.callbackTime)}</span>}
        {(c.status==='completed'||c.status==='interested'||c.status==='recorded')&&c.verifyStatus&&<Badge color={VERIFY[c.verifyStatus].color}>{VERIFY[c.verifyStatus].label}</Badge>}
        <Badge color={st.color}>{st.label}</Badge>
      </div>
      <button style={{...BTN(true),padding:'6px 12px',fontSize:'12px',whiteSpace:'nowrap'}} onClick={()=>onOpenLog(c)}><Phone size={12}/>Log Call</button>
    </div>
  );
}

// Per-group progress toward the 7-day finish goal (min lead date + 7 days)
const computeGroupStats = list => {
  const map={};
  list.forEach(c=>{ const g=c.group||'Other'; (map[g]=map[g]||[]).push(c); });
  return Object.entries(map).map(([group,items])=>{
    const total=items.length;
    const called=items.filter(leadContacted).length;
    const start=items.map(c=>(c.createdAt||'').split('T')[0]).filter(Boolean).sort()[0]||today();
    const due=addDays(start,GROUP_DEADLINE_DAYS);
    return {group,total,called,pct:total?Math.round(called/total*100):0,due,left:daysUntil(due)};
  }).sort((a,b)=>(a.pct-b.pct)||((a.left??0)-(b.left??0)));
};
function GroupProgressCard({ calls }) {
  const stats=computeGroupStats(calls);
  const rows=stats.some(s=>s.group!=='Other')?stats.filter(s=>s.group!=='Other'):stats;
  if(rows.length===0) return null;
  return (
    <div style={{...CARD,marginBottom:'14px'}}>
      <div style={{padding:'12px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'600',fontSize:'14px'}}>Group goals</span><span style={{fontSize:'12px',color:'#64748b',marginLeft:'8px'}}>finish each within {GROUP_DEADLINE_DAYS} days</span></div>
      {rows.map(s=>{
        const done=s.pct>=100, overdue=!done&&s.left<0, soon=!done&&s.left>=0&&s.left<=2;
        const barCol=done?'#1D9E75':overdue?'#A32D2D':soon?'#EF9F27':'#1D9E75';
        const dueLabel=done?'Done 🎉':overdue?`${-s.left}d overdue`:s.left===0?'Due today':`${s.left}d left`;
        const dueCol=done?'#0F6E56':overdue?'#A32D2D':soon?'#854F0B':'#185FA5';
        return (
          <div key={s.group} style={{padding:'12px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'7px'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:'500',fontSize:'14px'}}>{s.group}</div>
                <div style={{fontSize:'12px',color:'#64748b'}}>{s.called} of {s.total} called · {s.total-s.called} left</div>
              </div>
              <span style={{fontSize:'12px',fontWeight:'700',color:dueCol,whiteSpace:'nowrap'}}>{dueLabel}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500',color:done?'#0F6E56':'#0f172a',minWidth:'38px',textAlign:'right'}}>{s.pct}%</span>
            </div>
            <div style={{height:'8px',background:'var(--color-border-tertiary)',borderRadius:'4px',overflow:'hidden'}}><div style={{width:`${Math.min(100,s.pct)}%`,height:'100%',background:barCol,borderRadius:'4px',transition:'width 0.3s'}}/></div>
          </div>
        );
      })}
    </div>
  );
}

function CallerHome({ myCalls, onOpenLog }) {
  const t=today();
  const [area,setArea]=useState('all');
  const [groupF,setGroupF]=useState('all');
  const [sort,setSort]=useState('priority');
  const [search,setSearch]=useState('');
  const [shownU,setShownU]=useState(LEAD_BATCH);
  const [shownR,setShownR]=useState(LEAD_BATCH);
  const order={callback:0,completed:1,interested:1,recorded:1,needs_info:2,no_answer:3,not_interested:4};
  // "Up next" = never contacted, or a callback whose date has arrived / passed
  const isUrgent=c=>c.status==='to_call'||(c.status==='callback'&&(c.callbackDate||'')<=t);
  const states=[...new Set(myCalls.map(leadState))].sort();
  const groups=[...new Set(myCalls.map(c=>c.group).filter(Boolean))].sort();
  const q=search.trim().toLowerCase();
  const keep=c=>(area==='all'||leadState(c)===area)&&(groupF==='all'||c.group===groupF)&&(!q||[c.business,c.contact,c.phone,c.email,leadCity(c),c.group].some(v=>(v||'').toLowerCase().includes(q)));
  const sortList=(list,isU)=>{
    if(sort==='pay') return [...list].sort((a,b)=>leadValue(b)-leadValue(a)||(a.business||'').localeCompare(b.business||''));
    if(sort==='area') return [...list].sort((a,b)=>leadState(a).localeCompare(leadState(b))||leadCity(a).localeCompare(leadCity(b)));
    if(isU) return [...list].sort((a,b)=>{ const ac=a.status==='callback'?0:1,bc=b.status==='callback'?0:1; return (ac-bc)||((a.callbackDate||'').localeCompare(b.callbackDate||'')); });
    return [...list].sort((a,b)=>((order[a.status]??9)-(order[b.status]??9))||((a.callbackDate||'').localeCompare(b.callbackDate||'')));
  };
  const urgent=sortList(myCalls.filter(c=>keep(c)&&isUrgent(c)),true);
  const rest=sortList(myCalls.filter(c=>keep(c)&&!isUrgent(c)),false);
  const counts={
    to_call: myCalls.filter(c=>c.status==='to_call').length,
    callback: myCalls.filter(c=>c.status==='callback').length,
    needs_info: myCalls.filter(c=>c.status==='needs_info').length,
    completed: myCalls.filter(c=>c.status==='completed'||c.status==='interested'||c.status==='recorded').length,
  };
  const uVis=urgent.slice(0,shownU), uRem=urgent.length-uVis.length;
  const rVis=rest.slice(0,shownR), rRem=rest.length-rVis.length;
  const selStyle={...INP,width:'auto',padding:'6px 9px',fontSize:'12px'};
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'14px'}}>
        <Metric label="To call" value={counts.to_call}/>
        <Metric label="Callbacks" value={counts.callback} color="#185FA5"/>
        <Metric label="Needs info" value={counts.needs_info} color="#854F0B"/>
        <Metric label="Completed" value={counts.completed} color="#0F6E56"/>
      </div>
      <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap',marginBottom:'14px'}}>
        <input style={{...selStyle,flex:'1 1 180px',minWidth:'150px'}} placeholder="Search leads — name, contact, city…" value={search} onChange={e=>{setSearch(e.target.value);setShownU(LEAD_BATCH);setShownR(LEAD_BATCH);}}/>
        {groups.length>0&&<select style={selStyle} value={groupF} onChange={e=>{setGroupF(e.target.value);setShownU(LEAD_BATCH);setShownR(LEAD_BATCH);}}>
          <option value="all">All groups</option>
          {groups.map(g=><option key={g} value={g}>{g}</option>)}
        </select>}
        <select style={selStyle} value={area} onChange={e=>{setArea(e.target.value);setShownU(LEAD_BATCH);setShownR(LEAD_BATCH);}}>
          <option value="all">All areas</option>
          {states.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select style={selStyle} value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="priority">Sort: Priority</option>
          <option value="pay">Sort: Highest pay</option>
          <option value="area">Sort: Location</option>
        </select>
      </div>

      <GroupProgressCard calls={myCalls}/>

      <div style={{...CARD,marginBottom:'14px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
          <span style={{fontWeight:'600',fontSize:'14px'}}>Up next — new leads & due callbacks</span>
          {urgent.length>0&&<Badge color="amber">{urgent.length}</Badge>}
        </div>
        {urgent.length===0?(
          <div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>You’re all caught up — nothing new or due right now.</div>
        ):uVis.map(c=><LeadRow key={c.id} c={c} onOpenLog={onOpenLog}/>)}
        {uRem>0&&(
          <div style={{padding:'14px 18px',textAlign:'center'}}>
            <button style={BTN(false)} onClick={()=>setShownU(s=>s+LEAD_BATCH)}>{uRem} more — Show {Math.min(LEAD_BATCH,uRem)}</button>
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
          <span style={{fontWeight:'500',fontSize:'14px'}}>Everything else</span>
          <span style={{fontSize:'12px',color:'#64748b'}}>{myCalls.length} total</span>
        </div>
        {myCalls.length===0?(
          <div style={{padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>Nothing assigned yet. When your admin imports or assigns merchants for you to call, they’ll show up here.</div>
        ):rest.length===0?(
          <div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>Everyone you’ve already logged will collect here.</div>
        ):rVis.map(c=><LeadRow key={c.id} c={c} onOpenLog={onOpenLog}/>)}
        {rRem>0&&(
          <div style={{padding:'14px 18px',textAlign:'center'}}>
            <button style={BTN(false)} onClick={()=>setShownR(s=>s+LEAD_BATCH)}>{rRem} more — Show {Math.min(LEAD_BATCH,rRem)}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CRM board — logged leads grouped into columns (ClickUp-style) ──
const CRM_COLS = [
  ['needs_info',    'Needs info',     'amber'],
  ['completed',     'Completed',      'teal'],
  ['callback',      'Call back',      'blue'],
  ['no_answer',     'No answer',      'gray'],
  ['not_interested','Not interested', 'red'],
];
function CallerCRM({ myCalls, onOpenLog, onWorkQueue }) {
  const inCol=(c,key)=>key==='completed'?(c.status==='completed'||c.status==='interested'||c.status==='recorded'):c.status===key;
  const uncontacted=myCalls.filter(c=>c.status==='to_call').length;
  return (
    <div>
      {uncontacted>0&&(
        <button onClick={onWorkQueue}
          style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',padding:'16px',marginBottom:'16px',cursor:'pointer',fontFamily:'var(--font-sans)',
            borderRadius:'var(--border-radius-lg)',border:'1.5px solid #EF9F27',background:'#FAEEDA',color:'#854F0B',fontWeight:'700',fontSize:'16px'}}>
          <Phone size={18}/>
          <span>{uncontacted} {uncontacted===1?'person needs':'people need'} to be contacted</span>
          <ChevronRight size={18}/>
        </button>
      )}
      <div style={{fontSize:'13px',color:'#64748b',marginBottom:'14px'}}>Everyone you’ve logged, grouped by where they stand. Click a card to update it.</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(200px,1fr))',gap:'12px',overflowX:'auto',paddingBottom:'6px'}}>
        {CRM_COLS.map(([key,label,color])=>{
          const c=CC[color]; const items=myCalls.filter(x=>inCol(x,key));
          return (
            <div key={key} style={{...CARD,background:'var(--color-background-secondary)',minWidth:0,alignSelf:'start'}}>
              <div style={{padding:'10px 12px',borderBottom:`2px solid ${c.br}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:'600',fontSize:'13px',color:c.tx}}>{label}</span>
                <Badge color={color}>{items.length}</Badge>
              </div>
              <div style={{padding:'8px',display:'flex',flexDirection:'column',gap:'8px',minHeight:'60px'}}>
                {items.length===0?(
                  <div style={{fontSize:'12px',color:'#94a3b8',textAlign:'center',padding:'16px 8px'}}>Empty</div>
                ):items.map(x=>(
                  <button key={x.id} onClick={()=>onOpenLog(x)} style={{textAlign:'left',background:'var(--color-background-primary)',border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',padding:'10px 11px',cursor:'pointer',fontFamily:'var(--font-sans)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:'6px'}}><div style={{fontWeight:'500',fontSize:'13px',color:'#0f172a'}}>{x.business}</div>{leadValue(x)>0&&<span style={{fontSize:'12px',fontWeight:'700',color:'#0F6E56',whiteSpace:'nowrap'}}>${leadValue(x)}</span>}</div>
                    <div style={{fontSize:'11px',color:'#64748b',marginTop:'2px'}}>{[leadCity(x),x.phone].filter(Boolean).join(' · ')||'—'}</div>
                    {x.status==='callback'&&x.callbackDate&&<div style={{fontSize:'11px',color:x.callbackDate<today()?'#A32D2D':'#185FA5',fontWeight:'500',marginTop:'3px'}}>Call back {fmtDateTime(x.callbackDate,x.callbackTime)}</div>}
                    {(x.status==='completed'||x.status==='interested'||x.status==='recorded')&&x.verifyStatus&&<div style={{marginTop:'4px'}}><Badge color={VERIFY[x.verifyStatus].color}>{VERIFY[x.verifyStatus].label}</Badge></div>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Agreements the rep has sent — track who hasn't signed yet ──
const AGR_STATUS = {
  draft:  {label:'Draft — not sent',    color:'gray'},
  sent:   {label:'Sent — awaiting open', color:'blue'},
  viewed: {label:'Opened — not signed',  color:'amber'},
  signed: {label:'Signed',               color:'teal'},
  void:   {label:'Void',                 color:'red'},
};
const AGR_PENDING = ['draft','sent','viewed'];
function CallerAgreements() {
  const [rows,setRows]=useState(null); // null = loading
  const [err,setErr]=useState('');
  const [filter,setFilter]=useState('pending');
  useEffect(()=>{
    let active=true;
    const fetchRows=async()=>{
      const {data,error}=await supabase.from('agreements')
        .select('id,prefill,status,created_at,updated_at').order('created_at',{ascending:false});
      if(!active) return;
      if(error){ setErr(error.message); setRows([]); } else { setErr(''); setRows(data||[]); }
    };
    fetchRows();
    const ch=supabase.channel('agreements-list')
      .on('postgres_changes',{event:'*',schema:'public',table:'agreements'},fetchRows)
      .subscribe();
    return ()=>{ active=false; supabase.removeChannel(ch); };
  },[]);
  const all=rows||[];
  const waiting=all.filter(a=>AGR_PENDING.includes(a.status)).length;
  const signed=all.filter(a=>a.status==='signed').length;
  const shown=all.filter(a=>filter==='all'?true:filter==='signed'?a.status==='signed':AGR_PENDING.includes(a.status));
  const TABS=[['pending',`Waiting on (${waiting})`],['signed',`Signed (${signed})`],['all',`All (${all.length})`]];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'16px'}}>
        <Metric label="Waiting on" value={waiting} color="#854F0B"/>
        <Metric label="Signed" value={signed} color="#0F6E56"/>
        <Metric label="Total sent" value={all.length}/>
      </div>
      <div style={{display:'flex',gap:'6px',marginBottom:'14px',flexWrap:'wrap'}}>
        {TABS.map(([k,label])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{...BTN(filter===k),padding:'6px 12px',fontSize:'12px'}}>{label}</button>
        ))}
      </div>
      {err&&<div style={{background:'#FCEBEB',border:'0.5px solid #F09595',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#A32D2D',marginBottom:'14px'}}>Couldn’t load agreements: {err}</div>}
      <div style={CARD}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Your agreements</span></div>
        {rows===null?(
          <div style={{padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>Loading…</div>
        ):shown.length===0?(
          <div style={{padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>{all.length===0?'No agreements yet. When you send one from a call, it shows up here.':'Nothing in this filter.'}</div>
        ):shown.map(a=>{
          const st=AGR_STATUS[a.status]||AGR_STATUS.draft;
          const when=(a.updated_at||a.created_at||'').split('T')[0];
          return (
            <div key={a.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'12px',alignItems:'center',padding:'12px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:'500',fontSize:'14px'}}>{a.prefill?.business_name||'Agreement'}</div>
                <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{a.status==='signed'?'Signed':'Last update'} {fmtDate(when)}</div>
              </div>
              <Badge color={st.color}>{st.label}</Badge>
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
                <div style={{display:'flex',gap:'8px',alignItems:'center'}}>{p.source==='csv'&&<Badge color="blue">CSV</Badge>}<Badge color={p.paid?'teal':'amber'}>{p.paid?'Paid':'Pending'}</Badge></div>
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
            <Badge color={p.paid?'teal':'amber'}>{p.paid?'Paid':'Pending'}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin: verify recordings + approve straight into payouts ──
function VerifyRow({ call, callerName, onApprove, onReject }) {
  const recs = call.recordings?.length ? call.recordings
    : (call.recordingPath ? [{recordingPath:call.recordingPath, mediaMode:call.mediaMode, durationSec:call.durationSec, take:1}] : []);
  const submitted = recs.find(r=>r.take===call.submittedTake) || recs[recs.length-1] || null;
  const [sel,setSel]=useState(submitted);
  const [url,setUrl]=useState(''); const [loading,setLoading]=useState(false); const [err,setErr]=useState('');
  const [amt,setAmt]=useState(leadValue(call)||'');
  const load=async(rec)=>{
    setSel(rec); setLoading(true); setErr(''); setUrl('');
    try{ const {data,error}=await supabase.storage.from(CALL_BUCKET).createSignedUrl(rec.recordingPath,3600); if(error) throw error; setUrl(data.signedUrl); }
    catch(e){ setErr('Could not load recording: '+(e.message||e)); }
    finally{ setLoading(false); }
  };
  const isVideo=(sel||submitted)?.mediaMode!=='audio';
  const dmName=call.decisionMaker?[call.decisionMaker.title,call.decisionMaker.firstName,call.decisionMaker.lastName].filter(Boolean).join(' '):'';
  const addr=call.addresses?.map(a=>[a.street,a.city,a.state].filter(Boolean).join(', ')).filter(Boolean).join(' • ');
  const amtNum=parseFloat(amt);
  return (
    <div style={{padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
      <div style={{marginBottom:'10px'}}>
        <div style={{fontWeight:'500',fontSize:'14px'}}>{call.business}</div>
        <div style={{fontSize:'12px',color:'#64748b'}}>{callerName}{submitted?.durationSec?' · '+mmss(submitted.durationSec):''}{recs.length>1?` · ${recs.length} takes`:''}</div>
      </div>
      {(dmName||addr||call.offerDetails||call.email||call.phone)&&(
        <div style={{background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'10px 12px',fontSize:'12px',color:'#0f172a',marginBottom:'10px',lineHeight:1.6}}>
          {dmName&&<div><span style={{color:'#64748b'}}>Decision maker: </span>{dmName}</div>}
          {(call.email||call.phone)&&<div><span style={{color:'#64748b'}}>Contact: </span>{[call.email,call.phone].filter(Boolean).join(' · ')}</div>}
          {addr&&<div><span style={{color:'#64748b'}}>Address: </span>{addr}</div>}
          {call.offerDetails&&<div><span style={{color:'#64748b'}}>Offer: </span>{call.offerDetails}</div>}
        </div>
      )}
      {recs.length>1&&(
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'8px'}}>
          {recs.map(r=>(
            <button key={r.take} onClick={()=>load(r)} style={{...BTN(false),padding:'4px 9px',fontSize:'11px',...(r.take===call.submittedTake?{borderColor:'#5DCAA5',color:'#0F6E56'}:{})}}>Take {r.take}{r.take===call.submittedTake?' (chosen)':''}</button>
          ))}
        </div>
      )}
      {!url&&submitted&&<button style={BTN(false)} onClick={()=>load(submitted)} disabled={loading}><Play size={13}/>{loading?'Loading…':'Play recording'}</button>}
      {!submitted&&(call.agreementId?<div style={{fontSize:'12px',color:'#185FA5'}}>Completed via signed e-agreement (no recording).</div>:<div style={{fontSize:'12px',color:'#854F0B'}}>No recording attached to this call.</div>)}
      {err&&<div style={{fontSize:'12px',color:'#A32D2D',marginTop:'8px'}}>{err}</div>}
      {url&&(isVideo
        ? <video src={url} controls style={{width:'100%',maxWidth:'420px',borderRadius:'var(--border-radius-md)',margin:'10px 0',display:'block'}}/>
        : <audio src={url} controls style={{width:'100%',margin:'10px 0'}}/>)}
      <div style={{marginTop:'12px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
          <span style={{fontSize:'12px',color:'#64748b'}}>Payout</span>
          <input style={{...INP,width:'110px',padding:'6px 9px'}} type="number" step="5" placeholder="0.00" value={amt} onChange={e=>setAmt(e.target.value)}/>
          <span style={{fontSize:'11px',color:'#94a3b8'}}>or pick:</span>
        </div>
        <ValuePicker value={+amt} onChange={setAmt}/>
        <div style={{display:'flex',gap:'8px',marginTop:'10px'}}>
          <button style={{...BTN(true),opacity:amtNum>0?1:0.5}} disabled={!(amtNum>0)} onClick={()=>onApprove(call.id,amtNum)}><CheckCircle size={13}/>Approve &amp; pay {amtNum>0?fmt$(amtNum):''}</button>
          <button style={{...BTN(false),color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}} onClick={()=>onReject(call.id)}>Reject / redo</button>
        </div>
      </div>
    </div>
  );
}

const Bar = ({pct,color='#1D9E75'}) => <div style={{height:'6px',background:'var(--color-border-tertiary)',borderRadius:'3px',overflow:'hidden'}}><div style={{width:`${Math.min(100,pct)}%`,height:'100%',background:color,borderRadius:'3px'}}/></div>;
const leadContacted = c => c.status!=='to_call';
const leadDone = c => c.status==='completed'||c.status==='interested'||c.status==='recorded';
const leadState = c => { const s=(c.addresses?.[0]?.state||'').trim(); if(s) return s; const l=(c.location||'').trim(); if(l.includes(',')) return l.split(',').pop().trim(); return 'Unknown'; };
const leadCity  = c => { const ci=(c.addresses?.[0]?.city||'').trim(); if(ci) return ci; const l=(c.location||'').trim(); if(l.includes(',')) return l.split(',')[0].trim(); return l||'—'; };

const leadGroup = (c,by) => by==='city'?leadCity(c):by==='school'?(c.school||'No school/org'):by==='group'?(c.group||'No group'):leadState(c);

function AdminCallsView({ employees, calls, onApprove, onReject, onDelete, onImport, onMarkTouch, onSetValue }) {
  const [areaCaller,setAreaCaller]=useState('all');
  const [groupBy,setGroupBy]=useState('group');
  const [openState,setOpenState]=useState('');
  const pending=calls.filter(c=>(c.status==='completed'||c.status==='interested'||c.status==='recorded')&&(c.submittedTake!=null||c.recordingPath)&&(!c.verifyStatus||c.verifyStatus==='pending'));
  const followUps=calls.filter(c=>c.status==='send_info');
  const nameOf=id=>employees.find(e=>e.id===id)?.name||'Unassigned';

  const callerIdSet=new Set();
  calls.forEach(c=>{ leadPool(c).forEach(id=>callerIdSet.add(id)); if(c.callerId) callerIdSet.add(c.callerId); });
  const callerStats=[...callerIdSet].filter(Boolean).map(cid=>{ const list=calls.filter(c=>leadAssignedTo(c,cid));
    return {cid, name:nameOf(cid), total:list.length, called:list.filter(leadContacted).length, done:list.filter(leadDone).length};
  }).filter(s=>s.total>0).sort((a,b)=>b.total-a.total);

  const areaCalls=areaCaller==='all'?calls:calls.filter(c=>leadAssignedTo(c,areaCaller));
  const groupMap={};
  areaCalls.forEach(c=>{ const k=leadGroup(c,groupBy); (groupMap[k]=groupMap[k]||[]).push(c); });
  const areas=Object.entries(groupMap).map(([state,list])=>({state,total:list.length,called:list.filter(leadContacted).length,list})).sort((a,b)=>b.total-a.total);

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'16px',gap:'10px'}}>
        <div>
          <h3 style={{margin:0,fontSize:'16px',fontWeight:'500'}}>Merchant calls</h3>
          <div style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Track who’s calling where, verify recordings, and approve straight into payouts</div>
        </div>
        <button style={BTN(false)} onClick={onImport}><Upload size={14}/>Import leads</button>
      </div>

      {/* Awaiting verification — the payout action */}
      <div style={{...CARD,marginBottom:'16px'}}>
        <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',alignItems:'center',gap:'8px'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Awaiting verification</span>{pending.length>0&&<Badge color="amber">{pending.length}</Badge>}</div>
        {pending.length===0?(
          <div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No recordings waiting. Completed calls your team records show up here to review and pay.</div>
        ):pending.map(c=><VerifyRow key={c.id} call={c} callerName={nameOf(c.callerId)} onApprove={onApprove} onReject={onReject}/>)}
      </div>

      {followUps.length>0&&(
        <div style={{...CARD,marginBottom:'16px'}}>
          <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',display:'flex',alignItems:'center',gap:'8px'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Follow-up track</span><Badge color="blue">{followUps.length}</Badge></div>
          {followUps.map(c=>{
            const done=c.followUp?.touchesDone||0; const complete=done>=FOLLOWUP_TOUCHES;
            return (
              <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'12px',alignItems:'center',padding:'11px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                <div><div style={{fontSize:'13px',fontWeight:'500'}}>{c.business}</div><div style={{fontSize:'11px',color:'#64748b'}}>{nameOf(c.callerId)}</div></div>
                <div style={{fontSize:'11px',color:'#64748b',textAlign:'right'}}>{done}/{FOLLOWUP_TOUCHES} sent</div>
                {complete?<Badge color="teal">Done</Badge>:<button style={{...BTN(false),padding:'5px 10px',fontSize:'12px'}} onClick={()=>onMarkTouch(c.id)}>Mark touch sent</button>}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-caller progress */}
      {callerStats.length>0&&(
        <div style={{...CARD,marginBottom:'16px'}}>
          <div style={{padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}><span style={{fontWeight:'500',fontSize:'14px'}}>Caller progress</span></div>
          {callerStats.map(s=>{
            const pct=s.total?Math.round(s.called/s.total*100):0;
            return (
              <div key={s.cid} style={{padding:'13px 18px',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'8px'}}>
                  <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(s.name)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:'500',fontSize:'14px'}}>{s.name}</div>
                    <div style={{fontSize:'12px',color:'#64748b'}}>{s.called} of {s.total} called · {s.done} completed · {s.total-s.called} left</div>
                  </div>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:'15px',fontWeight:'500',color:'#0F6E56'}}>{pct}%</div>
                </div>
                <Bar pct={pct}/>
              </div>
            );
          })}
        </div>
      )}

      {/* By area / group */}
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px',padding:'13px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)',flexWrap:'wrap'}}>
          <span style={{fontWeight:'500',fontSize:'14px'}}>Coverage by {groupBy==='city'?'city':groupBy==='school'?'school':groupBy==='group'?'group / org':'state'}</span>
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
            <select style={{...INP,width:'auto',padding:'6px 9px',fontSize:'12px'}} value={groupBy} onChange={e=>{setGroupBy(e.target.value);setOpenState('');}}>
              <option value="group">By group / org</option>
              <option value="state">By state</option>
              <option value="city">By city / town</option>
              <option value="school">By school</option>
            </select>
            <select style={{...INP,width:'auto',padding:'6px 9px',fontSize:'12px'}} value={areaCaller} onChange={e=>setAreaCaller(e.target.value)}>
              <option value="all">All callers</option>
              {callerStats.map(s=><option key={s.cid} value={s.cid}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {areas.length===0?(
          <div style={{padding:'40px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No leads yet. Use “Import leads” or “Assign call” to add some.</div>
        ):areas.map(a=>{
          const pct=a.total?Math.round(a.called/a.total*100):0; const open=openState===a.state;
          const start=a.list.map(c=>(c.createdAt||'').split('T')[0]).filter(Boolean).sort()[0];
          const left=(groupBy==='group'&&start)?daysUntil(addDays(start,GROUP_DEADLINE_DAYS)):null;
          const done=pct>=100;
          return (
            <div key={a.state} style={{borderTop:'0.5px solid var(--color-border-tertiary)'}}>
              <div onClick={()=>setOpenState(open?'':a.state)} style={{padding:'12px 18px',cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'8px'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:'500',fontSize:'14px'}}>{a.state}</div>
                    <div style={{fontSize:'12px',color:'#64748b'}}>{a.called} of {a.total} called · {a.total-a.called} left</div>
                  </div>
                  {left!=null&&!done&&<span style={{fontSize:'12px',fontWeight:'700',color:left<0?'#A32D2D':left<=2?'#854F0B':'#185FA5',whiteSpace:'nowrap'}}>{left<0?`${-left}d overdue`:left===0?'Due today':`${left}d left`}</span>}
                  <div style={{fontFamily:'var(--font-mono)',fontSize:'14px',fontWeight:'500',color:pct>=50?'#0F6E56':'#854F0B'}}>{pct}%</div>
                  {open?<ChevronUp size={15} color="var(--color-text-secondary)"/>:<ChevronDown size={15} color="var(--color-text-secondary)"/>}
                </div>
                <Bar pct={pct} color={pct>=50?'#1D9E75':'#EF9F27'}/>
              </div>
              {open&&[...a.list].sort((x,y)=>leadCity(x).localeCompare(leadCity(y))||(x.business||'').localeCompare(y.business||'')).map(c=>{
                const st=CALL_STATUS[c.status]||CALL_STATUS.to_call;
                return (
                  <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto',gap:'12px',alignItems:'center',padding:'10px 18px 10px 30px',borderTop:'0.5px solid var(--color-border-tertiary)',background:'var(--color-background-secondary)'}}>
                    <div style={{minWidth:0}}><div style={{fontSize:'13px',fontWeight:'500'}}>{c.business}</div><div style={{fontSize:'11px',color:'#64748b'}}>{[groupBy!=='group'?c.group:null,leadCity(c),c.callerId?nameOf(c.callerId):(!leadClaimed(c)&&leadPool(c).length>1?`${leadPool(c).length} callers`:null)].filter(Boolean).join(' · ')}</div></div>
                    <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
                      {c.payout?.amount!=null?<Badge color="teal">{fmt$(c.payout.amount)} paid</Badge>:<span title="What this call pays the caller"><ValueSelect value={leadValue(c)||''} onChange={v=>onSetValue(c.id,v)}/></span>}
                      {c.status==='callback'&&c.callbackDate&&<span style={{fontSize:'11px',color:'#185FA5'}}>{fmtDateTime(c.callbackDate,c.callbackTime)}</span>}
                      <Badge color={st.color}>{st.label}</Badge>
                    </div>
                    <button onClick={()=>onDelete(c.id)} style={{...BTN(false),padding:'5px 8px',color:'var(--color-text-danger)',borderColor:'var(--color-border-danger)'}}><Trash2 size={12}/></button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddCallModal({ employees, onAdd, onClose }) {
  const [callerIds,setCallerIds]=useState([]);
  const [group,setGroup]=useState('');
  const [business,setBusiness]=useState('');
  const [contact,setContact]=useState('');
  const [phone,setPhone]=useState('');
  const [location,setLocation]=useState('');
  const [value,setValue]=useState(0);
  const [notes,setNotes]=useState('');
  const ok=callerIds.length&&business.trim();
  const submit=()=>{ if(!ok) return; onAdd({callerIds,group:group.trim(),business:business.trim(),contact:contact.trim(),phone:phone.trim(),location:location.trim(),value,notes:notes.trim()}); };
  return (
    <ModalWrap title="Assign a merchant call" onClose={onClose}>
      <MultiEmpPicker employees={employees} value={callerIds} onChange={setCallerIds} label="Assign to caller(s) — tap to add more"/>
      <Field label="Calling for (group / organization)"><input style={INP} value={group} onChange={e=>setGroup(e.target.value)} placeholder="e.g. South Carolina IFC"/></Field>
      <Field label="Business name"><input style={INP} value={business} onChange={e=>setBusiness(e.target.value)} placeholder="e.g. Joe's Pizza" autoFocus/></Field>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
        <Field label="Contact name"><input style={INP} value={contact} onChange={e=>setContact(e.target.value)}/></Field>
        <Field label="Phone"><input style={INP} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(555) 000-0000"/></Field>
      </div>
      <Field label="Location(s)"><input style={INP} value={location} onChange={e=>setLocation(e.target.value)} placeholder="e.g. Downtown & Eastside"/></Field>
      <Field label={`What this call pays the caller${value?` — $${value}`:''}`}><ValuePicker value={value} onChange={setValue}/></Field>
      <div style={{fontSize:'12px',color:'#64748b',marginTop:'-4px',marginBottom:'12px'}}>This is the caller’s payout for closing it — not the merchant’s discount. The caller fills in the actual discount (e.g. 15% off) on the call.</div>
      <Field label="Notes (optional)"><textarea style={{...INP,minHeight:'56px',resize:'vertical'}} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
      <button style={{...BTN(true),width:'100%',justifyContent:'center',marginTop:'6px',opacity:ok?1:0.5}} onClick={submit} disabled={!ok}>Assign call</button>
    </ModalWrap>
  );
}

// ── Bulk lead import — drop a CSV, map its columns, assign the batch to a caller ──
const LEAD_FIELDS = [
  ['business','Business name',true],
  ['contact','Contact / decision maker',false],
  ['phone','Phone',false],
  ['email','Email',false],
  ['street','Address',false],
  ['city','City',false],
  ['state','State',false],
  ['category','Category / business type',false],
  ['school','School',false],
  ['value','Payout per call ($)',false],
  ['additionalInfo','Additional info',false],
  ['notes','Notes',false],
];
const LEAD_GUESS = {
  business:/business|company|organi|name of|account/i, contact:/contact|owner|decision|\brep\b|first name|person|manager/i,
  phone:/phone|tel|mobile|cell/i, email:/e-?mail/i, street:/address|street|addr/i, city:/city|town/i,
  state:/state|region|province/i, category:/categor|type|industry|service|vertical/i, school:/school|institution|district|college|university/i,
  value:/payout|reward|worth|call value|per[- ]?call|price/i,
  additionalInfo:/additional|info|detail|specific/i, notes:/note|comment|remark/i,
};

function LeadImportModal({ employees, onImport, onClose }) {
  const [step,setStep]=useState('upload');
  const [headers,setHeaders]=useState([]);
  const [rows,setRows]=useState([]);
  const [map,setMap]=useState({});
  const [callerIds,setCallerIds]=useState([]);
  const [group,setGroup]=useState('');
  const [batchValue,setBatchValue]=useState(0);
  const [dragOver,setDragOver]=useState(false);
  const fileRef=useRef();

  const processFile=file=>{
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:res=>{
      const hdrs=(res.meta.fields||[]).filter(Boolean);
      const used=new Set(); const m={};
      LEAD_FIELDS.forEach(([f])=>{ const hit=hdrs.find(h=>!used.has(h)&&LEAD_GUESS[f]&&LEAD_GUESS[f].test(h)); if(hit){m[f]=hit;used.add(hit);} else m[f]=''; });
      setHeaders(hdrs); setRows(res.data); setMap(m); setStep('map');
    }});
  };
  const handleDrop=e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)processFile(f);};
  const get=(r,f)=>map[f]?(r[map[f]]||'').toString().trim():'';
  const build=r=>{
    const addr={street:get(r,'street'),city:get(r,'city'),state:get(r,'state')};
    const hasAddr=addr.street||addr.city||addr.state;
    return {
      business:get(r,'business'), contact:get(r,'contact'), phone:get(r,'phone'), email:get(r,'email'),
      location:[addr.city,addr.state].filter(Boolean).join(', '), addresses:hasAddr?[addr]:[],
      category:get(r,'category'), businessType:get(r,'category'), school:get(r,'school'),
      additionalInfo:get(r,'additionalInfo'), notes:get(r,'notes'), group:group.trim(),
      value:(map.value?parseMoney(get(r,'value')):0)||batchValue||0,
    };
  };
  const validRows=rows.filter(r=>map.business&&(r[map.business]||'').toString().trim());
  const confirm=()=>{ if(!callerIds.length) return; onImport(validRows.map(build), callerIds); };

  if(step==='upload') return (
    <ModalWrap title="Import merchant leads" onClose={onClose} wide>
      <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={handleDrop} onClick={()=>fileRef.current.click()}
        style={{border:`2px dashed ${dragOver?'#1D9E75':'var(--color-border-secondary)'}`,borderRadius:'var(--border-radius-lg)',padding:'56px',textAlign:'center',cursor:'pointer',background:dragOver?'#E1F5EE':'var(--color-background-secondary)',transition:'all 0.15s'}}>
        <Upload size={28} style={{margin:'0 auto 12px',display:'block',color:dragOver?'#0F6E56':'var(--color-text-secondary)'}}/>
        <div style={{fontWeight:'500',marginBottom:'6px'}}>Drop your lead list here or click to browse</div>
        <div style={{fontSize:'13px',color:'var(--color-text-secondary)'}}>Any CSV — you’ll map the columns on the next step</div>
        <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={e=>e.target.files[0]&&processFile(e.target.files[0])}/>
      </div>
    </ModalWrap>
  );

  return (
    <ModalWrap title={`Map columns — ${validRows.length} leads`} onClose={onClose} wide>
      <div style={{marginBottom:'12px'}}><Field label="Calling for (group / organization) — shown to callers"><input style={INP} value={group} onChange={e=>setGroup(e.target.value)} placeholder="e.g. South Carolina IFC"/></Field></div>
      <div style={{marginBottom:'12px'}}><MultiEmpPicker employees={employees} value={callerIds} onChange={setCallerIds} label="Assign these leads to caller(s) — tap to add more"/></div>
      <div style={{marginBottom:'12px'}}>
        <label style={{display:'block',fontSize:'12px',color:'var(--color-text-secondary)',marginBottom:'5px',fontWeight:'500'}}>{map.value?'Fallback payout — used only for rows where your “Payout per call” column is blank':'Standard payout for this whole batch (or map a “Payout per call” column below for per-lead amounts)'}{batchValue?` — $${batchValue}`:''}</label>
        <ValuePicker value={batchValue} onChange={setBatchValue}/>
      </div>
      <div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginBottom:'8px'}}>Match each field to a column from your file. We guessed where we could.</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'14px'}}>
        {LEAD_FIELDS.map(([f,label,req])=>(
          <div key={f} style={{display:'grid',gridTemplateColumns:'150px 1fr',gap:'8px',alignItems:'center'}}>
            <span style={{fontSize:'12px',color:req?'#0f172a':'var(--color-text-secondary)',fontWeight:req?'600':'400'}}>{label}{req?' *':''}</span>
            <select style={{...INP,padding:'6px 8px',fontSize:'12px'}} value={map[f]||''} onChange={e=>setMap({...map,[f]:e.target.value})}>
              <option value="">— none —</option>
              {headers.map(h=><option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div style={{border:'0.5px solid var(--color-border-tertiary)',borderRadius:'var(--border-radius-md)',overflow:'hidden',marginBottom:'14px'}}>
        <div style={{padding:'8px 12px',background:'var(--color-background-secondary)',fontSize:'11px',fontWeight:'500',color:'var(--color-text-secondary)'}}>Preview (first {Math.min(5,validRows.length)} of {validRows.length})</div>
        <div style={{maxHeight:'220px',overflowY:'auto'}}>
          {validRows.slice(0,5).map((r,i)=>{const b=build(r);return (
            <div key={i} style={{padding:'8px 12px',borderTop:'0.5px solid var(--color-border-tertiary)',fontSize:'12px'}}>
              <span style={{fontWeight:'500'}}>{b.business||'—'}</span>
              {b.value>0&&<span style={{fontWeight:'700',color:'#0F6E56',marginLeft:'8px'}}>${b.value}</span>}
              <span style={{color:'var(--color-text-secondary)'}}>{[b.contact,b.phone,b.email,[b.addresses[0]?.city,b.addresses[0]?.state].filter(Boolean).join(', ')].filter(Boolean).length?' — '+[b.contact,b.phone,b.email,[b.addresses[0]?.city,b.addresses[0]?.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '):''}</span>
            </div>
          );})}
        </div>
      </div>
      {!map.business&&<div style={{display:'flex',alignItems:'center',gap:'7px',background:'#FAEEDA',border:'0.5px solid #EF9F27',borderRadius:'var(--border-radius-md)',padding:'10px 14px',fontSize:'13px',color:'#854F0B',marginBottom:'14px'}}><AlertTriangle size={14} style={{flexShrink:0}}/><span>Pick which column is the <b>Business name</b> — it’s required.</span></div>}
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={()=>setStep('upload')}>Back</button>
        <button style={{...BTN(true),opacity:(callerIds.length&&map.business&&validRows.length)?1:0.5}} disabled={!(callerIds.length&&map.business&&validRows.length)} onClick={confirm}>Import {validRows.length} leads</button>
      </div>
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
  const [orgs,setOrgs]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [calls,setCalls]=useState([]);
  const [signups,setSignups]=useState([]);
  const [recovery,setRecovery]=useState(false);

  // Auth
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      setSession(session);
      if(event==='PASSWORD_RECOVERY') setRecovery(true);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Data load
  useEffect(()=>{
    if(!session) return;
    Promise.all([loadS('po_emp'),loadS('po_deals'),loadS('po_asgn'),loadS('po_calls'),loadS('po_signups'),loadS('po_orgs')]).then(([e,d,a,c,s,o])=>{
      setEmployees(Array.isArray(e)?e:[]); setDeals(Array.isArray(d)?d:[]); setAssignments(Array.isArray(a)?a:[]); setCalls(Array.isArray(c)?c:[]); setSignups(Array.isArray(s)?s:[]); setOrgs(Array.isArray(o)?o:[]); setLoading(false);
    });
  },[session]);

  const setE=v=>{setEmployees(v);saveS('po_emp',v);};
  const setD=v=>{setDeals(v);saveS('po_deals',v);};
  const setA=v=>{setAssignments(v);saveS('po_asgn',v);};
  const setC=v=>{setCalls(v);saveS('po_calls',v);};
  const setSU=v=>{setSignups(v);saveS('po_signups',v);};
  const setO=v=>{setOrgs(v);saveS('po_orgs',v);};
  const addOrg=o=>{ setO([...orgs,{...o,id:genId(),createdAt:new Date().toISOString()}]); setModal(null); };
  const deleteOrg=id=>setO(orgs.filter(o=>o.id!==id));
  // A signed-in user with no roster match — log it once so the admin can add them
  const requestAccess=email=>{
    const em=(email||'').toLowerCase();
    if(!em || signups.some(s=>s.email.toLowerCase()===em) || employees.some(e=>e.email?.toLowerCase()===em)) return;
    setSU([...signups,{email,requestedAt:new Date().toISOString()}]);
  };
  const dismissSignup=email=>setSU(signups.filter(s=>s.email.toLowerCase()!==(email||'').toLowerCase()));

  // Merchant call assignments / mini-CRM
  const addCall=rec=>{ setC([...calls,{...rec,id:genId(),status:'to_call',createdAt:new Date().toISOString()}]); setModal(null); };
  const addLeads=(leads,callerIds)=>{ const ls=leads.map(l=>({...l,id:genId(),callerIds,status:'to_call',createdAt:new Date().toISOString()})); setC([...calls,...ls]); setModal(null); };
  const updateCall=(id,patch)=>setC(calls.map(c=>c.id===id?{...c,...patch}:c));
  // Every recorded take is persisted immediately so a redo can never lose the original
  const addRecordingTake=(id,take)=>setC(calls.map(c=>c.id===id?{...c,recordings:[...(c.recordings||[]),take]}:c));
  const rejectCall=id=>setC(calls.map(c=>c.id===id?{...c,verifyStatus:'rejected'}:c));
  const markTouch=id=>setC(calls.map(c=>{ if(c.id!==id) return c; const done=(c.followUp?.touchesDone||0)+1; return {...c,followUp:{touchesDone:done,nextDue:done>=FOLLOWUP_TOUCHES?null:addDays(today(),2)}}; }));
  const deleteCall=id=>setC(calls.filter(c=>c.id!==id));

  // Approve a confirmed call → post one standalone entry into the caller's merchant payouts.
  // Reuses the po_asgn period structure so it flows into Merchant Reps, Payments & Payroll untouched.
  const approveCall=(callId,amount)=>{
    const call=calls.find(c=>c.id===callId); if(!call||call.verifyStatus==='approved') return;
    const empId=call.callerId; const periodId=genId(); const amt=+amount||0;
    const period={id:periodId,startDate:today(),endDate:today(),discounts:1,ratePerDiscount:0,totalAmount:amt,source:'call',paid:false,callId,
      entries:[{business:call.business||'',discountType:call.discount||'',specifics:call.offerDetails||'',amount:amt,date:today()}]};
    const ex=assignments.find(a=>a.employeeId===empId);
    const assignmentId=ex?ex.id:genId();
    setA(ex ? assignments.map(a=>a.employeeId!==empId?a:{...a,periods:[...a.periods,period]})
           : [...assignments,{id:assignmentId,employeeId:empId,periods:[period]}]);
    setC(calls.map(c=>c.id!==callId?c:{...c,verifyStatus:'approved',payout:{amount:amt,assignmentId,periodId,postedAt:new Date().toISOString()}}));
  };

  const exportAll=()=>{
    const data={exportedAt:new Date().toISOString(),employees,deals,assignments,calls};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`tailgate-backup-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const addEmployee=(name,email)=>{ setE([...employees,{id:genId(),name,email:email||'',createdAt:new Date().toISOString()}]); if(email) setSU(signups.filter(s=>s.email.toLowerCase()!==email.toLowerCase())); setModal(null); };
  const deleteEmployee=id=>setE(employees.filter(e=>e.id!==id));
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

  // Public merchant signing page (no auth) — /sign/<token>. Handled before the app.
  const signMatch = window.location.pathname.match(/^\/sign\/(.+)$/);
  if(signMatch) return <SignAgreement token={decodeURIComponent(signMatch[1])}/>;

  if(authLoading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#64748b',fontSize:'14px'}}>Loading…</div>;
  if(recovery) return <ResetPasswordPage onDone={()=>setRecovery(false)} onCancel={()=>{setRecovery(false);signOut();}}/>;
  if(!session) return <LoginPage/>;
  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#64748b',fontSize:'14px'}}>Loading…</div>;
  if(!isAdmin) return <EmployeePortal employees={employees} deals={deals} assignments={assignments} calls={calls} orgs={orgs} userEmail={userEmail} onSignOut={signOut} onUpdateCall={updateCall} onAddRecordingTake={addRecordingTake} onRequestAccess={requestAccess}/>;

  const TABS=[['employees','Employees',Users],['orgs','Organizations',Building2],['reps','Merchant Reps',DollarSign],['calls','Calls',Phone],['payments','Payments',CheckCircle],['payroll','Payroll',DollarSign]];

  return (
    <div style={{padding:'20px',maxWidth:'980px',margin:'0 auto',fontFamily:'var(--font-sans)'}}>
      <h2 className="sr-only">Tailgate Payday — Payout management</h2>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'22px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'9px'}}><span style={{fontSize:'17px',fontWeight:'500'}}>Tailgate Payday</span></div>
        <div style={{display:'flex',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',border:'0.5px solid var(--color-border-tertiary)',gap:'2px'}}>
          {TABS.map(([key,label,Icon])=>(
            <button key={key} onClick={()=>setTab(key)} style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'6px 13px',borderRadius:'var(--border-radius-md)',border:'none',cursor:'pointer',fontSize:'13px',fontFamily:'var(--font-sans)',fontWeight:'500',background:tab===key?'var(--color-background-primary)':'transparent',color:tab===key?'var(--color-text-primary)':'var(--color-text-secondary)',boxShadow:tab===key?'0 0.5px 2px rgba(0,0,0,0.1)':'none'}}>
              <Icon size={13}/>{label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {['employees','orgs','reps','calls'].includes(tab)&&(
            <button style={BTN(true)} onClick={()=>setModal({type:tab==='employees'?'addEmp':tab==='orgs'?'addOrg':tab==='calls'?'addCall':'addPeriod'})}>
              <Plus size={14}/>{tab==='employees'?'Employee':tab==='orgs'?'Organization':tab==='calls'?'Assign call':'Period'}
            </button>
          )}
          <button style={{...BTN(false),padding:'7px 10px'}} onClick={exportAll} title="Export a backup"><Download size={14}/></button>
          <button style={{...BTN(false),padding:'7px 10px'}} onClick={signOut} title="Sign out"><LogOut size={14}/></button>
        </div>
      </div>

      {tab==='employees'&&<EmployeesView employees={employees} deals={deals} assignments={assignments} signups={signups} onAdd={()=>setModal({type:'addEmp'})} onAddRequest={email=>setModal({type:'addEmp',data:{email}})} onDismissRequest={dismissSignup} onDelete={deleteEmployee}/>}
      {tab==='orgs'&&<OrgsView orgs={orgs} onAdd={()=>setModal({type:'addOrg'})} onDelete={deleteOrg}/>}
      {tab==='reps'&&<MerchantRepsView employees={employees} assignments={assignments} onAddPeriod={()=>setModal({type:'addPeriod'})} onImportCSV={()=>setModal({type:'importCSV'})} onTogglePaid={togglePeriodPaid} onDeletePeriod={deletePeriod} onPayStub={(emp,p)=>setModal({type:'payStub',data:{emp,p}})}/>}
      {tab==='payments'&&<PaymentQueue employees={employees} deals={deals} assignments={assignments} onMarkDealPaid={markDealPaid} onMarkPeriodPaid={togglePeriodPaid}/>}
      {tab==='payroll'&&<PayrollView employees={employees} deals={deals} assignments={assignments}/>}
      {tab==='calls'&&<AdminCallsView employees={employees} calls={calls} onApprove={approveCall} onReject={rejectCall} onDelete={deleteCall} onImport={()=>setModal({type:'importLeads'})} onMarkTouch={markTouch} onSetValue={(id,value)=>updateCall(id,{value})}/>}

      {modal?.type==='addEmp'&&<AddEmployeeModal initialEmail={modal.data?.email} onAdd={addEmployee} onClose={()=>setModal(null)}/>}
      {modal?.type==='addOrg'&&<AddOrgModal onAdd={addOrg} onClose={()=>setModal(null)}/>}
      {modal?.type==='addPeriod'&&<AddPeriodModal employees={employees} onAdd={addPeriod} onClose={()=>setModal(null)}/>}
      {modal?.type==='importCSV'&&<CSVImportModal employees={employees} assignments={assignments} onSave={updated=>{setA(updated);setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal?.type==='payStub'&&<PayStubModal emp={modal.data.emp} period={modal.data.p} onClose={()=>setModal(null)}/>}
      {modal?.type==='addCall'&&<AddCallModal employees={employees} onAdd={addCall} onClose={()=>setModal(null)}/>}
      {modal?.type==='importLeads'&&<LeadImportModal employees={employees} onImport={addLeads} onClose={()=>setModal(null)}/>}
    </div>
  );
}
