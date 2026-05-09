import { useState, useEffect } from "react";
import {
  Plus, ArrowLeft, Trash2, ChevronRight, ChevronUp, ChevronDown,
  FileText, Users, Building2, Receipt, Printer, DollarSign, Calendar
} from "lucide-react";

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

// ─── Storage ──────────────────────────────────────────────────────
// FOR VERCEL: replace these two functions with:
//   const loadS = async key => { try { return JSON.parse(localStorage.getItem(key))||[]; } catch { return []; } };
//   const saveS = async (key,val) => { try { localStorage.setItem(key,JSON.stringify(val)); } catch {} };
const loadS = async key => { try { return JSON.parse(localStorage.getItem(key))||[]; } catch { return []; } };
const saveS = async (key,val) => { try { localStorage.setItem(key,JSON.stringify(val)); } catch {} };

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
        dealId:deal.id, key:`${role}Upfront`
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
          dealId:deal.id, key:`${role}Backend`, idx
        });
      });
    });
  });
  assignments.filter(a=>a.employeeId===empId).forEach(a => {
    a.periods.forEach(p => {
      out.push({
        id:`m-${p.id}`, date:p.endDate, type:'merchant',
        desc:`Merchant discounts — ${fmtDate(p.startDate)} → ${fmtDate(p.endDate)} (${p.discounts} discounts)`,
        amount:p.discounts*p.ratePerDiscount,
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
      <div style={{...CARD,width:'100%',maxWidth:wide?'700px':'500px',maxHeight:'92vh',overflowY:'auto'}}>
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
                  <div style={{flex:1}}><div style={{fontWeight:'500',fontSize:'14px'}}>{emp.name}</div><div style={{fontSize:'12px',color:'var(--color-text-secondary)'}}>{s.deals} deal{s.deals!==1?'s':''} · {s.periods} period{s.periods!==1?'s':''}</div></div>
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

function AddEmployeeModal({onAdd,onClose}) {
  const [name,setName]=useState('');
  return (
    <ModalWrap title="Add employee" onClose={onClose}>
      <Field label="Full name"><input style={INP} placeholder="e.g. Sarah Johnson" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&name&&onAdd(name)} autoFocus/></Field>
      <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
        <button style={BTN(false)} onClick={onClose}>Cancel</button>
        <button style={BTN(true)} onClick={()=>name&&onAdd(name)}>Add employee</button>
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

function MerchantRepsView({employees,assignments,onAddPeriod,onTogglePaid,onDeletePeriod,onPayStub}) {
  const [openIds,setOpenIds]=useState({});
  const tog=id=>setOpenIds(p=>({...p,[id]:p[id]===false?true:false}));
  const pendingTotal=assignments.reduce((s,a)=>s+a.periods.filter(p=>!p.paid).reduce((ss,p)=>ss+p.discounts*p.ratePerDiscount,0),0);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px',marginBottom:'18px'}}>
        <Metric label="Active reps" value={assignments.length}/>
        <Metric label="Pending payouts" value={fmt$(pendingTotal)} color="#854F0B"/>
        <Metric label="Total periods" value={assignments.reduce((s,a)=>s+a.periods.length,0)}/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'12px'}}>
        <button style={BTN(true)} onClick={onAddPeriod}><Plus size={14}/>Add period</button>
      </div>
      {assignments.length===0?(
        <div style={{...CARD,padding:'48px',textAlign:'center',color:'var(--color-text-secondary)'}}>
          <DollarSign size={32} style={{margin:'0 auto 12px',display:'block',opacity:0.4}}/>
          <div style={{fontWeight:'500',marginBottom:'6px'}}>No merchant periods yet</div>
          <div style={{fontSize:'13px',marginBottom:'16px'}}>Add employees first, then log their discount periods here</div>
          <button style={BTN(true)} onClick={onAddPeriod}><Plus size={14}/>Add period</button>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {assignments.map(a=>{
            const emp=employees.find(e=>e.id===a.employeeId);
            const pending=a.periods.filter(p=>!p.paid).reduce((s,p)=>s+p.discounts*p.ratePerDiscount,0);
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
                    <div style={{display:'grid',gridTemplateColumns:'1.6fr 0.7fr 0.7fr 0.7fr 0.9fr auto',padding:'8px 18px',background:'var(--color-background-secondary)',fontSize:'11px',color:'var(--color-text-secondary)',fontWeight:'500'}}>
                      <div>Period</div><div>Discounts</div><div>Rate</div><div>Amount</div><div>Status</div><div/>
                    </div>
                    {a.periods.map(p=>{
                      const amt=p.discounts*p.ratePerDiscount;
                      return (
                        <div key={p.id} style={{display:'grid',gridTemplateColumns:'1.6fr 0.7fr 0.7fr 0.7fr 0.9fr auto',padding:'12px 18px',alignItems:'center',borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                          <div style={{fontSize:'13px'}}>{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:'13px'}}>{p.discounts}</div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:'13px'}}>{fmt$(p.ratePerDiscount)}</div>
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
  const amt=period.discounts*period.ratePerDiscount;
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
    <div class="row"><span>Rate per discount</span><span>${fmt$(period.ratePerDiscount)}</span></div>
    <div class="row"><span>Discounts obtained</span><span>${period.discounts}</span></div>
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
        {[['Rate per discount',fmt$(period.ratePerDiscount)],['Discounts obtained',String(period.discounts)]].map(([l,v])=>(
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

  const [tab,setTab]=useState('employees');
  const [employees,setEmployees]=useState([]);
  const [deals,setDeals]=useState([]);
  const [assignments,setAssignments]=useState([]);
  const [selectedDeal,setSelectedDeal]=useState(null);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);

  useEffect(()=>{
    Promise.all([loadS('po_emp'),loadS('po_deals'),loadS('po_asgn')]).then(([e,d,a])=>{
      setEmployees(Array.isArray(e)?e:[]); setDeals(Array.isArray(d)?d:[]); setAssignments(Array.isArray(a)?a:[]); setLoading(false);
    });
  },[]);

  const setE=v=>{setEmployees(v);saveS('po_emp',v);};
  const setD=v=>{setDeals(v);saveS('po_deals',v);};
  const setA=v=>{setAssignments(v);saveS('po_asgn',v);};

  const addEmployee=name=>{ setE([...employees,{id:genId(),name,createdAt:new Date().toISOString()}]); setModal(null); };
  const deleteEmployee=id=>setE(employees.filter(e=>e.id!==id));
  const addDeal=deal=>{ setD([...deals,{...deal,id:genId(),createdAt:new Date().toISOString(),monthlyActivations:Array(12).fill(0),paid:{setterUpfront:false,closerUpfront:false,setterBackend:Array(12).fill(false),closerBackend:Array(12).fill(false)}}]); setModal(null); };
  const updateActivation=(dealId,idx,val)=>{ const u=deals.map(d=>{if(d.id!==dealId) return d; const ma=[...d.monthlyActivations]; ma[idx]=Math.max(0,+val||0); return {...d,monthlyActivations:ma};}); setD(u); setSelectedDeal(u.find(d=>d.id===dealId)||null); };
  const deleteDeal=id=>{ setD(deals.filter(d=>d.id!==id)); setSelectedDeal(null); };
  const addPeriod=(empId,period)=>{ const ex=assignments.find(a=>a.employeeId===empId); if(ex) setA(assignments.map(a=>a.employeeId!==empId?a:{...a,periods:[...a.periods,{...period,id:genId(),paid:false}]})); else setA([...assignments,{id:genId(),employeeId:empId,periods:[{...period,id:genId(),paid:false}]}]); setModal(null); };
  const togglePeriodPaid=(aId,pId)=>setA(assignments.map(a=>a.id!==aId?a:{...a,periods:a.periods.map(p=>p.id!==pId?p:{...p,paid:!p.paid})}));
  const deletePeriod=(aId,pId)=>setA(assignments.map(a=>a.id!==aId?a:{...a,periods:a.periods.filter(p=>p.id!==pId)}).filter(a=>a.periods.length>0));

  const TABS=[['employees','Employees',Users],['deals','Deals',Building2],['reps','Merchant Reps',DollarSign],['payroll','Payroll',Receipt]];

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'200px',color:'var(--color-text-secondary)',fontSize:'14px'}}>Loading…</div>;

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
        <button style={BTN(true)} onClick={()=>setModal({type:tab==='employees'?'addEmp':tab==='deals'?'addDeal':tab==='reps'?'addPeriod':null})}>
          <Plus size={14}/>{tab==='employees'?'Employee':tab==='deals'?'Deal':tab==='reps'?'Period':''}
        </button>
      </div>

      {tab==='employees'&&<EmployeesView employees={employees} deals={deals} assignments={assignments} onAdd={()=>setModal({type:'addEmp'})} onDelete={deleteEmployee}/>}
      {tab==='deals'&&(selectedDeal?<DealDetail deal={selectedDeal} employees={employees} onBack={()=>setSelectedDeal(null)} onUpdateActivation={updateActivation} onDelete={deleteDeal}/>:<DealsView deals={deals} employees={employees} onSelect={setSelectedDeal} onAdd={()=>setModal({type:'addDeal'})}/>)}
      {tab==='reps'&&<MerchantRepsView employees={employees} assignments={assignments} onAddPeriod={()=>setModal({type:'addPeriod'})} onTogglePaid={togglePeriodPaid} onDeletePeriod={deletePeriod} onPayStub={(emp,p)=>setModal({type:'payStub',data:{emp,p}})}/>}
      {tab==='payroll'&&<PayrollView employees={employees} deals={deals} assignments={assignments}/>}

      {modal?.type==='addEmp'&&<AddEmployeeModal onAdd={addEmployee} onClose={()=>setModal(null)}/>}
      {modal?.type==='addDeal'&&<AddDealModal employees={employees} onAdd={addDeal} onClose={()=>setModal(null)}/>}
      {modal?.type==='addPeriod'&&<AddPeriodModal employees={employees} onAdd={addPeriod} onClose={()=>setModal(null)}/>}
      {modal?.type==='payStub'&&<PayStubModal emp={modal.data.emp} period={modal.data.p} onClose={()=>setModal(null)}/>}
    </div>
  );
}
