import { useState, useEffect, useRef } from "react";
import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import {
  Plus, ArrowLeft, Trash2, ChevronRight, ChevronUp, ChevronDown,
  FileText, Users, Building2, Receipt, Printer, DollarSign, Calendar,
  Upload, LogOut, CheckCircle, Shield
} from "lucide-react";

// ─── Supabase ─────────────────────────────────────────────────────
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const ADMIN_EMAIL = 'shuffman@tailgateofficial.com';

// ─── Storage ──────────────────────────────────────────────────────
const loadS = async key => { try { const { data } = await supabase.from('app_data').select('value').eq('key',key).single(); return data ? JSON.parse(data.value) : []; } catch { return []; } };
const saveS = async (key,val) => { try { await supabase.from('app_data').upsert({key, value: JSON.stringify(val)}); } catch {} };

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
          <div style={{display:'inline-flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}><Receipt size={24} color="#1D9E75"/><span style={{fontSize:'20px',fontWeight:'600',color:'#0f172a'}}>PayoutPro</span></div>
          <div style={{fontSize:'14px',color:'#64748b'}}>Tailgate Official Payout Management</div>
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

// ─── EMPLOYEE PORTAL ──────────────────────────────────────────────
function EmployeePortal({employees,deals,assignments,userEmail,onSignOut}) {
  const emp = employees.find(e=>e.email?.toLowerCase()===userEmail?.toLowerCase());
  if (!emp) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',background:'#f1f5f9'}}>
      <div style={{...CARD,padding:'32px',textAlign:'center',maxWidth:'420px',background:'#ffffff'}}>
        <Shield size={32} style={{margin:'0 auto 12px',display:'block',color:'#64748b'}}/>
        <div style={{fontWeight:'500',marginBottom:'8px'}}>Account not linked</div>
        <div style={{fontSize:'13px',color:'#64748b',marginBottom:'20px'}}>Your email ({userEmail}) hasn't been added to the employee roster yet. Contact your admin at shuffman@tailgateofficial.com.</div>
        <button style={BTN(false)} onClick={onSignOut}><LogOut size={13}/>Sign out</button>
      </div>
    </div>
  );

  const payments = getPayments(emp.id,deals,assignments);
  const total  = payments.reduce((s,p)=>s+p.amount,0);
  const pending = payments.filter(p=>!p.paid).reduce((s,p)=>s+p.amount,0);
  const paid   = payments.filter(p=>p.paid).reduce((s,p)=>s+p.amount,0);

  return (
    <div style={{minHeight:'100vh',background:'#f1f5f9',padding:'20px'}}>
      <div style={{maxWidth:'720px',margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'22px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{width:'40px',height:'40px',borderRadius:'50%',background:'#E1F5EE',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'600',color:'#0F6E56'}}>{initials(emp.name)}</div>
            <div><div style={{fontWeight:'500',fontSize:'16px'}}>{emp.name}</div><div style={{fontSize:'12px',color:'#64748b'}}>Your payout portal</div></div>
          </div>
          <button style={BTN(false)} onClick={onSignOut}><LogOut size={13}/>Sign out</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
          <Metric label="Total earned" value={fmt$(total)}/>
          <Metric label="Already paid" value={fmt$(paid)} color="#0F6E56"/>
          <Metric label="Pending" value={fmt$(pending)} color="#854F0B"/>
        </div>
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
      const def={};parsed.forEach(r=>{def[r.idx]='$15';});
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
    repSummary.forEach(({repName,emp,total,count,rows:rr})=>{
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
function printPaySheet(emp, allPayments, start, end) {
  const pmts=allPayments.filter(p=>p.date>=start&&p.date<=end);
  const total=pmts.reduce((s,p)=>s+p.amount,0);
  const paid=pmts.filter(p=>p.paid).reduce((s,p)=>s+p.amount,0);
  const TC={upfront:'#854F0B',backend:'#0F6E56',merchant:'#185FA5'};
  const TL={upfront:'Deal upfront (25%)',backend:'Deal backend (75%)',merchant:'Merchant discounts'};
  const rows=pmts.map(p=>`<tr><td style="padding:9px 12px;font-size:13px;border-bottom:1px solid #f3f4f6;white-space:nowrap">${fmtDate(p.date)}</td><td style="padding:9px 12px;border-bottom:1px solid #f3f4f6"><span style="padding:2px 8px;border-radius:4px;background:${TC[p.type]}22;color:${TC[p.type]};font-size:11px;font-weight:700">${TL[p.type]}</span></td><td style="padding:9px 12px;font-size:13px;border-bottom:1px solid #f3f4f6;color:#555">${p.desc}</td><td style="padding:9px 12px;font-size:13px;text-align:right;font-family:monospace;font-weight:700;border-bottom:1px solid #f3f4f6;white-space:nowrap">${fmt$(p.amount)}</td><td style="padding:9px 12px;text-align:center;border-bottom:1px solid #f3f4f6"><span style="padding:2px 8px;border-radius:4px;background:${p.paid?'#E1F5EE':'#FAEEDA'};color:${p.paid?'#0F6E56':'#854F0B'};font-size:11px;font-weight:700">${p.paid?'Paid':'Pending'}</span></td></tr>`).join('');
  const w=window.open('','_blank','width=920,height=720');
  w.document.write(`<!DOCTYPE html><html><head><title>Pay Sheet — ${emp?.name}</title>
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
  <div class="hdr"><div><div class="co">PayoutPro</div><div class="co-sub">Bi-Weekly Pay Sheet</div></div><div style="text-align:right"><div class="lbl">Employee Pay Sheet</div><div class="nm">${emp?.name||'—'}</div><div class="per">${fmtDate(start)} — ${fmtDate(end)}</div></div></div>
  <div class="sum">
    <div class="sm"><div class="sl">Gross pay this period</div><div class="sv" style="color:#0f172a">${fmt$(total)}</div></div>
    <div class="sm"><div class="sl">Already paid</div><div class="sv" style="color:#0F6E56">${fmt$(paid)}</div></div>
    <div class="sm"><div class="sl">Outstanding</div><div class="sv" style="color:#854F0B">${fmt$(total-paid)}</div></div>
  </div>
  ${pmts.length===0?'<p style="text-align:center;color:#aaa;padding:32px;font-size:14px">No payments in this period</p>':`<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th><th style="text-align:center">Status</th></tr></thead><tbody>${rows}</tbody></table>`}
  <div class="ft">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · PayoutPro</div>
  </body></html>`);
  w.document.close(); w.print();
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
          <button style={BTN(true)} onClick={()=>printPaySheet(emp,all,periodStart,periodEnd)}><Printer size={14}/>Print pay sheet</button>
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
            <button style={BTN(false)} onClick={()=>empData.forEach(d=>printPaySheet(d.emp,d.all,periodStart,periodEnd))}><Printer size={13}/>Print all</button>
          </div>
          {empData.map(({emp,all,inP,periodTotal,outstanding})=>(
            <div key={emp.id} style={{display:'flex',alignItems:'center',gap:'16px',padding:'14px 18px',borderBottom:'0.5px solid var(--color-border-tertiary)'}}>
              <div style={{width:'38px',height:'38px',borderRadius:'50%',background:'var(--color-background-info)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'13px',fontWeight:'500',color:'var(--color-text-info)',flexShrink:0}}>{initials(emp.name)}</div>
              <div style={{flex:1}}><div style={{fontWeight:'500',fontSize:'14px'}}>{emp.name}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)',marginTop:'2px'}}>{inP.length} payment{inP.length!==1?'s':''} this period · {all.filter(p=>!p.paid).length} outstanding overall</div></div>
              <div style={{textAlign:'center',minWidth:'100px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>This period</div><div style={{fontFamily:'var(--font-mono)',fontWeight:'500',color:periodTotal>0?'#0F6E56':'var(--color-text-secondary)'}}>{fmt$(periodTotal)}</div></div>
              <div style={{textAlign:'center',minWidth:'100px'}}><div style={{fontSize:'11px',color:'var(--color-text-secondary)',marginBottom:'3px'}}>Outstanding</div><Badge color={outstanding>0?'amber':'gray'}>{fmt$(outstanding)}</Badge></div>
              <div style={{display:'flex',gap:'6px'}}>
                <button style={BTN(false)} onClick={()=>setSelected(emp.id)}>View <ChevronRight size={13}/></button>
                <button style={BTN(true)} onClick={()=>printPaySheet(emp,all,periodStart,periodEnd)}><Printer size={13}/></button>
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
  const print=()=>{
    const w=window.open('','_blank','width=660,height=540');
    w.document.write(`<!DOCTYPE html><html><head><title>Pay Stub — ${emp?.name}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:48px 56px;color:#111;max-width:600px;margin:auto}
    h1{font-size:20px;font-weight:700;margin-bottom:4px}.sub{color:#666;font-size:13px;margin-bottom:36px}
    .g2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
    .fl{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.fv{font-size:15px;font-weight:600}
    .row{display:flex;justify-content:space-between;font-size:14px;padding:10px 0;border-bottom:1px solid #f0f0f0}.row span:last-child{font-family:monospace;font-weight:600}
    .tot{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#E1F5EE;border-radius:8px;margin-top:18px}
    .tl{font-size:15px;font-weight:700;color:#0F6E56}.tv{font-family:monospace;font-size:24px;font-weight:700;color:#0F6E56}
    .ft{text-align:center;font-size:11px;color:#bbb;margin-top:40px;padding-top:14px;border-top:1px solid #eee}
    @media print{body{padding:24px}}</style>
    </head><body>
    <h1>Merchant Discount Pay Stub</h1><div class="sub">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</div>
    <div class="g2"><div><div class="fl">Employee</div><div class="fv">${emp?.name||'—'}</div></div><div><div class="fl">Pay period</div><div class="fv">${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}</div></div></div>
    <div class="row"><span>Deals / discounts</span><span>${period.discounts}</span></div>
    <div class="row"><span>Source</span><span>${period.source==='csv'?'CSV import':'Manual entry'}</span></div>
    <div class="tot"><span class="tl">Gross pay</span><span class="tv">${fmt$(amt)}</span></div>
    <div class="ft">PayoutPro — Merchant Discount Pay Stub</div></body></html>`);
    w.document.close(); w.print();
  };
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
        <button style={BTN(true)} onClick={print}><Printer size={14}/>Print</button>
      </div>
    </ModalWrap>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────
export default function PayoutPro() {
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

  // Auth
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return ()=>subscription.unsubscribe();
  },[]);

  // Data load
  useEffect(()=>{
    if(!session) return;
    Promise.all([loadS('po_emp'),loadS('po_deals'),loadS('po_asgn')]).then(([e,d,a])=>{
      setEmployees(Array.isArray(e)?e:[]); setDeals(Array.isArray(d)?d:[]); setAssignments(Array.isArray(a)?a:[]); setLoading(false);
    });
  },[session]);

  const setE=v=>{setEmployees(v);saveS('po_emp',v);};
  const setD=v=>{setDeals(v);saveS('po_deals',v);};
  const setA=v=>{setAssignments(v);saveS('po_asgn',v);};

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
  if(!isAdmin) return <EmployeePortal employees={employees} deals={deals} assignments={assignments} userEmail={userEmail} onSignOut={signOut}/>;
  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'200px',color:'var(--color-text-secondary)',fontSize:'14px'}}>Loading…</div>;

  const TABS=[['employees','Employees',Users],['deals','Deals',Building2],['reps','Merchant Reps',DollarSign],['payments','Payments',CheckCircle],['payroll','Payroll',Receipt]];

  return (
    <div style={{padding:'20px',maxWidth:'980px',margin:'0 auto',fontFamily:'var(--font-sans)'}}>
      <h2 className="sr-only">PayoutPro — Payout management</h2>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'22px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'9px'}}><Receipt size={20} color="#1D9E75"/><span style={{fontSize:'17px',fontWeight:'500'}}>PayoutPro</span></div>
        <div style={{display:'flex',background:'var(--color-background-secondary)',borderRadius:'var(--border-radius-md)',padding:'3px',border:'0.5px solid var(--color-border-tertiary)',gap:'2px'}}>
          {TABS.map(([key,label,Icon])=>(
            <button key={key} onClick={()=>{setTab(key);setSelectedDeal(null);}} style={{display:'inline-flex',alignItems:'center',gap:'5px',padding:'6px 13px',borderRadius:'var(--border-radius-md)',border:'none',cursor:'pointer',fontSize:'13px',fontFamily:'var(--font-sans)',fontWeight:'500',background:tab===key?'var(--color-background-primary)':'transparent',color:tab===key?'var(--color-text-primary)':'var(--color-text-secondary)',boxShadow:tab===key?'0 0.5px 2px rgba(0,0,0,0.1)':'none'}}>
              <Icon size={13}/>{label}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
          {['employees','deals','reps'].includes(tab)&&(
            <button style={BTN(true)} onClick={()=>setModal({type:tab==='employees'?'addEmp':tab==='deals'?'addDeal':'addPeriod'})}>
              <Plus size={14}/>{tab==='employees'?'Employee':tab==='deals'?'Deal':'Period'}
            </button>
          )}
          <button style={{...BTN(false),padding:'7px 10px'}} onClick={signOut} title="Sign out"><LogOut size={14}/></button>
        </div>
      </div>

      {tab==='employees'&&<EmployeesView employees={employees} deals={deals} assignments={assignments} onAdd={()=>setModal({type:'addEmp'})} onDelete={deleteEmployee}/>}
      {tab==='deals'&&(selectedDeal?<DealDetail deal={selectedDeal} employees={employees} onBack={()=>setSelectedDeal(null)} onUpdateActivation={updateActivation} onDelete={deleteDeal}/>:<DealsView deals={deals} employees={employees} onSelect={setSelectedDeal} onAdd={()=>setModal({type:'addDeal'})}/>)}
      {tab==='reps'&&<MerchantRepsView employees={employees} assignments={assignments} onAddPeriod={()=>setModal({type:'addPeriod'})} onImportCSV={()=>setModal({type:'importCSV'})} onTogglePaid={togglePeriodPaid} onDeletePeriod={deletePeriod} onPayStub={(emp,p)=>setModal({type:'payStub',data:{emp,p}})}/>}
      {tab==='payments'&&<PaymentQueue employees={employees} deals={deals} assignments={assignments} onMarkDealPaid={markDealPaid} onMarkPeriodPaid={togglePeriodPaid}/>}
      {tab==='payroll'&&<PayrollView employees={employees} deals={deals} assignments={assignments}/>}

      {modal?.type==='addEmp'&&<AddEmployeeModal onAdd={addEmployee} onClose={()=>setModal(null)}/>}
      {modal?.type==='addDeal'&&<AddDealModal employees={employees} onAdd={addDeal} onClose={()=>setModal(null)}/>}
      {modal?.type==='addPeriod'&&<AddPeriodModal employees={employees} onAdd={addPeriod} onClose={()=>setModal(null)}/>}
      {modal?.type==='importCSV'&&<CSVImportModal employees={employees} assignments={assignments} onSave={updated=>{setA(updated);setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal?.type==='payStub'&&<PayStubModal emp={modal.data.emp} period={modal.data.p} onClose={()=>setModal(null)}/>}
    </div>
  );
}