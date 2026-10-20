import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client';
import '../item-master/styles/itemMaster.css';
import './localSetup.css';

const yesNo = [['N','No'],['Y','Yes']];
const resourceTypes = [['M','Machine'],['L','Labour'],['O','Other']];
const field = (name,label,type='text',options) => ({name,label,type,options});
const groupAccounts = [
  ['BalInvntAc','Inventory'],['SaleCostAc','Cost of goods sold'],['RevenuesAc','Revenue'],['ExpensesAc','Expense'],
  ['BalanceAcc','Goods clearing'],['TransferAc','Allocation'],['DecreasAc','Inventory offset - decrease'],['IncreasAc','Inventory offset - increase'],
].map(([name,label])=>field(name,`${label} account`,'accounts'));
const objectTypes = [['23','Sales quotation'],['17','Sales order'],['15','Delivery'],['13','A/R invoice'],['14','A/R credit memo'],
  ['540000006','Purchase quotation'],['22','Purchase order'],['20','Goods receipt PO'],['18','A/P invoice'],['19','A/P credit memo'],
  ['1470000113','Purchase request'],['2','Business partner'],['4','Item'],['24','Incoming payment'],['46','Outgoing payment'],
  ['30','Journal entry'],['59','Goods receipt'],['60','Goods issue'],['67','Inventory transfer'],['1250000001','Transfer request'],['202','Production order']];
const CONFIG = {
  'item-groups': { title:'Item Groups', key:'ItmsGrpCod', fields:[field('ItmsGrpNam','Group name'),field('Locked','Locked','select',yesNo),field('UgpEntry','Default UoM group','uomGroups'),...groupAccounts], defaults:{Locked:'N'} },
  'bp-groups': { title:'BP Groups', key:'GroupCode', fields:[field('GroupName','Group name'),field('GroupType','Type','select',[['C','Customer'],['S','Vendor']])], defaults:{GroupType:'C'} },
  'sales-employees': { title:'Sales Employees', key:'SlpCode', fields:[field('SlpName','Employee name'),field('Active','Active','select',yesNo),field('Commission','Commission %','number'),field('Memo','Remarks')], defaults:{Active:'Y',Commission:0} },
  currencies: { title:'Currencies', key:'CurrCode', manualKey:true, fields:[field('CurrCode','Currency code'),field('CurrName','Currency name'),field('DocCurrCod','Document currency code')] },
  locations: { title:'Locations', key:'Code', fields:[field('Location','Location name')] },
  states: { title:'States', key:'Code', manualKey:true, fields:[field('Country','Country','countries'),field('Code','State code'),field('Name','State name')], defaults:{Country:'IN'} },
  'cash-discounts': { title:'Cash Discounts', key:'Code', manualKey:true, fields:[field('Code','Code'),field('TableDesc','Name'),field('BaseDate','Base date','select',[['P','Posting date'],['T','Document date'],['S','System date'],['C','Closing date']])], defaults:{BaseDate:'P',CashDiscountLines:[{NumOfDays:10,Discount:2}]} },
  'payment-methods': { title:'Payment Methods', key:'PayMethCod', manualKey:true, fields:[field('PayMethCod','Code'),field('Descript','Description'),field('Type','Direction','select',[['I','Incoming'],['O','Outgoing']]),field('BankTransf','Payment means','select',[['T','Bank transfer'],['C','Check'],['B','Bill of exchange']]),field('GLAccount','G/L account','accounts'),field('Active','Active','select',yesNo)], defaults:{Type:'O',BankTransf:'T',Active:'Y'} },
  'gl-determination': { title:'G/L Account Determination', key:'AbsEntry', editOnly:true, columns:['PeriodCat','PeriodName'], fields:[
    ['LinkAct_1','Domestic receivables'],['LinkAct_10','Domestic payables'],['LinkAct_3','Cash'],['LinkAct_18','Opening balance'],
    ['DfltIncom','Revenue'],['DfltExpn','Expense'],['COGM_Act','Cost of goods sold'],['BalanceAct','Goods clearing'],['AlocCstAct','Allocation'],['DftStockOB','Opening warehouse balance'],['RoundAcct','Rounding'],['DecreasAc','Inventory offset - decrease'],['IncreasAc','Inventory offset - increase'],['CashDscAR','Cash discount (sales)'],['CashDscAP','Cash discount (purchasing)'],['WipAcct','Work in process'],['WipVarAcct','WIP variance'],['ResAcct','Resource absorption'],
  ].map(([name,label])=>field(name,`${label} account`,'accounts')) },
  'numbering-series': { title:'Numbering Series', key:'Series', columns:['SeriesName','ObjectCode','DocSubType','Indicator','NextNumber','LastNum','Locked'], fields:[
    field('SeriesName','Series name'),field('ObjectCode','Document / master','select',objectTypes),field('DocSubType','Subtype','select',[['--','Standard'],['GA','GST tax invoice'],['C','Customer / lead'],['S','Vendor']]),
    field('Indicator','Fiscal indicator','periods'),field('BPLId','Branch','branches'),field('InitialNum','First number','number'),field('NextNumber','Next number','number'),field('LastNum','Last number','number'),
    field('BeginStr','Prefix'),field('EndStr','Suffix'),field('Locked','Locked','select',yesNo),
  ], defaults:{ObjectCode:'17',DocSubType:'--',InitialNum:1,NextNumber:1,LastNum:999999999,Locked:'N',BeginStr:'',EndStr:'',BPLId:''} },
  'posting-periods': { title:'Monthly Posting Periods', key:'AbsEntry', editOnly:true, columns:['Code','F_RefDate','T_RefDate','PeriodStat'], fields:[field('Name','Period name'),field('PeriodStat','Status','select',[['N','Unlocked'],['Y','Locked']]),field('F_DueDate','Due date from','date'),field('T_DueDate','Due date to','date'),field('F_TaxDate','Document date from','date'),field('T_TaxDate','Document date to','date')] },
  'exchange-rates': { title:'Exchange Rates', key:'Currency', columns:['RateDate','Currency','Rate'], fields:[field('Currency','Currency','currencies'),field('RateDate','Date','date'),field('Rate','Local currency per 1 foreign unit','number')], defaults:{Rate:1} },
  'account-template': { title:'Chart of Accounts Template', key:'AcctCode', editOnly:true, columns:['AcctCode','AcctName','FatherNum','Postable'], fields:[] },
  resources: { title:'Resources', key:'ResCode', manualKey:true, columns:['ResCode','ResName','ResType','StdCost','validFor'], fields:[
    field('ResCode','Resource No.'),field('ResName','Description'),field('ResType','Type','select',resourceTypes),field('ResGrpCod','Resource group','resourceGroups'),
    field('UnitOfMsr','Unit of measure'),field('IssueMthd','Issue method','select',[['M','Manual'],['B','Backflush']]),field('DfltWH','Default warehouse','warehouses'),
    field('StdCost','Standard cost per unit','number'),field('ResAcct','Resource account','accounts'),field('validFor','Active','select',yesNo),field('Remarks','Remarks'),
  ], defaults:{ResType:'M',IssueMthd:'M',StdCost:0,validFor:'Y'} },
  'resource-groups': { title:'Resource Groups', key:'ResGrpCod', fields:[field('ResGrpNam','Group name'),field('ResType','Type','select',resourceTypes)], defaults:{ResType:'M'} },
  'route-stages': { title:'Route Stages', key:'AbsEntry', columns:['AbsEntry','Code','Desc'], fields:[field('Code','Code'),field('Desc','Description')] },
};
const message = (error) => error.response?.data?.message || error.message;
const display = (value) => value == null ? '' : /^\d{4}-\d{2}-\d{2}T/.test(String(value)) ? String(value).slice(0,10) : String(value);
const rowKey = (kind,row) => kind === 'states' ? `${row.Country}:${row.Code}` : kind === 'exchange-rates' ? `${display(row.RateDate)}:${row.Currency}` : row[CONFIG[kind].key];

function SetupPage({kind}) {
  const config = CONFIG[kind];
  const [data,setData] = useState({rows:[]});
  const [form,setForm] = useState({...config.defaults});
  const [selected,setSelected] = useState(null);
  const [busy,setBusy] = useState(true);
  const [notice,setNotice] = useState(null);
  const [search,setSearch] = useState('');
  const [year,setYear] = useState({Indicator:'',StartDate:''});
  const base = `/local-setup/${kind}`;
  useEffect(()=>{
    let active = true;
    api.get(base).then((r)=>{if(active) setData(r.data);}).catch((e)=>{if(active) setNotice({error:true,text:message(e)});}).finally(()=>{if(active) setBusy(false);});
    return ()=>{active=false;};
  },[base]);
  const reset = ()=>{setSelected(null);setForm(structuredClone(config.defaults || {}));setNotice(null);};
  const change = (name,value)=>setForm((prev)=>({...prev,[name]:value}));
  const perform = async (operation) => {
    setBusy(true);setNotice(null);
    try {
      await operation();
      setData((await api.get(base)).data);
      setSelected(null);setForm(structuredClone(config.defaults || {}));
      setNotice({text:'Saved successfully.'});
    } catch(e) {setNotice({error:true,text:message(e)});}
    finally {setBusy(false);}
  };
  const save = (event)=>{
    event.preventDefault();
    const payload = Object.fromEntries(config.fields.map((f)=>[f.name,f.type==='date'?display(form[f.name]):form[f.name] ?? '']));
    if (kind === 'cash-discounts') payload.CashDiscountLines = form.CashDiscountLines;
    return perform(()=>selected == null || kind === 'exchange-rates' ? api.post(base,payload) : api.patch(`${base}/${encodeURIComponent(selected)}`,payload));
  };
  const action = (name,payload)=>perform(()=>api.post(`${base}/actions/${name}`,payload));
  const options = (f)=>f.options || ({
    accounts:(data.accounts || []).map((a)=>[a.AcctCode,`${a.AcctCode} - ${a.AcctName}`]),
    branches:(data.branches || []).map((b)=>[b.BPLId,b.BPLName]),
    periods:(data.periods || []).map((p)=>[p.Indicator,p.Indicator]),
    countries:(data.countries || []).map((c)=>[c.Code,c.Name]),
    currencies:(data.currencies || []).map((c)=>[c.CurrCode,`${c.CurrCode} - ${c.CurrName}`]),
    uomGroups:(data.uomGroups || []).map((g)=>[g.UgpEntry,g.UgpName]),
    warehouses:(data.warehouses || []).map((w)=>[w.WhsCode,`${w.WhsCode} - ${w.WhsName}`]),
    resourceGroups:(data.resourceGroups || []).map((g)=>[g.ResGrpCod,g.ResGrpNam]),
  }[f.type]);
  const columns = config.columns || [config.key,...config.fields.slice(0,3).map((f)=>f.name).filter((name)=>name!==config.key)];
  const labels = { ItmsGrpCod:'Code',GroupCode:'Code',SlpCode:'Code',Series:'Series',AbsEntry:'ID',Code:'Code',
    F_RefDate:'Posting date from',T_RefDate:'Posting date to',PeriodCat:'Fiscal category',PeriodName:'Name',
    AcctCode:'Account code',AcctName:'Account name',FatherNum:'Parent account',Postable:'Account type',
    ...Object.fromEntries(config.fields.map((f)=>[f.name,f.label])) };
  const cell = (column,value) => {
    if (column==='Postable') return value==='Y'?'Active':'Title';
    const f = config.fields.find((entry)=>entry.name===column);
    return f?.options?.find(([code])=>String(code)===String(value))?.[1] || display(value);
  };
  const fixedSeries = ['ObjectCode','DocSubType','Indicator','BPLId','InitialNum','BeginStr','EndStr'];
  const mode = selected==null ? 'add' : 'update';
  const showForm = config.fields.length>0 && (!config.editOnly || selected!=null);
  return <div className="im-page local-setup">
    <div className="im-toolbar">
      <span className="im-toolbar__title">{config.title} - Setup</span>
      {showForm && <span className={`im-mode-badge im-mode-badge--${mode}`}>{mode==='add'?'ADD':'UPDATE'}</span>}
      {!config.editOnly && <button className="im-btn" disabled={busy} onClick={reset}>New</button>}
    </div>
    {notice && <div role={notice.error?'alert':'status'} className={`im-alert im-alert--${notice.error?'error':'success'}`}>{notice.text}</div>}
    {kind==='posting-periods' && <section className="ls-card">
      <div className="im-section-title">Create a financial year with 12 monthly periods</div>
      <form onSubmit={(e)=>{e.preventDefault();action('create-months',year);}} className="im-field-grid">
        <label className="im-field"><span className="im-field__label">Fiscal indicator</span><input className="im-field__input" required maxLength={10} value={year.Indicator} onChange={(e)=>setYear({...year,Indicator:e.target.value})} placeholder="2027-28" disabled={busy}/></label>
        <label className="im-field"><span className="im-field__label">Financial year start</span><input className="im-field__input" required type="date" value={year.StartDate} onChange={(e)=>setYear({...year,StartDate:e.target.value})} disabled={busy}/></label>
        <div className="im-field"><button className="im-btn im-btn--primary" disabled={busy}>Create 12 months</button></div>
      </form>
      <p className="ls-note">Select an unused, unlocked annual period below to split it into months. Existing fiscal indicators and series remain linked.</p>
      {selected!=null && <button className="im-btn" disabled={busy} onClick={()=>action('split-period',{AbsEntry:selected})}>Split selected annual period into months</button>}
    </section>}
    {kind==='gl-determination' && <p className="ls-card ls-note">Select a fiscal category and assign its default accounts. Item-group and warehouse accounts are maintained on their own pages and take precedence over these defaults when documents post.</p>}
    {kind==='account-template' && <section className="ls-card">
      <div className="im-section-title">Local starter chart</div>
      <p className="ls-note">Add five title accounts and group the nine starter accounts below them. Existing codes and balances are preserved. Conflicting accounts stop the entire operation.</p>
      <div className="im-grid-wrap"><table className="im-grid"><thead><tr><th>Code</th><th>Name</th><th>Parent</th><th>Type</th></tr></thead><tbody>{(data.template || []).map((a)=><tr key={a.AcctCode}><td>{a.AcctCode}</td><td>{a.AcctName}</td><td>{a.FatherNum || '—'}</td><td>{a.Postable==='Y'?'Active':'Title'}</td></tr>)}</tbody></table></div>
      <div className="ls-actions"><button className="im-btn im-btn--primary" disabled={busy || !data.template} onClick={()=>action('apply',{})}>Apply displayed template</button></div>
    </section>}
    {showForm && <form onSubmit={save} className="ls-card">
      <div className="im-section-title">{selected==null?'New record':`Edit ${form.SeriesName || form.PeriodCat || form.Name || form.Code || selected}`}</div>
      <fieldset className="ls-fieldset" disabled={busy}><div className="im-field-grid">{config.fields.map((f)=>{
        const choices = options(f);
        const readOnly = selected!=null && ((config.manualKey && (f.name===config.key || f.name==='Country')) || (kind==='numbering-series' && fixedSeries.includes(f.name)));
        return <label key={f.name} className="im-field"><span className="im-field__label" title={f.label}>{f.label}</span>{choices ? <select className="im-field__input im-field__select" disabled={readOnly} value={form[f.name] ?? ''} onChange={(e)=>change(f.name,e.target.value)}>
          {!f.options && <option value="">Select…</option>}{choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select> : <input className={`im-field__input${readOnly?' im-field__input--readonly':''}`} type={f.type} readOnly={readOnly} value={display(form[f.name])} step={f.type==='number'?'any':undefined} onChange={(e)=>change(f.name,e.target.value)} />}</label>;
      })}</div>
      {kind==='cash-discounts' && <div className="ls-tiers"><div className="im-section-title">Day-count discount tiers</div>
        <div className="im-grid-wrap"><table className="im-grid"><thead><tr><th>#</th><th>Days</th><th>Discount %</th><th></th></tr></thead><tbody>{(form.CashDiscountLines || []).map((line,index)=><tr key={index}>
          <td>{index+1}</td>
          <td><input className="im-grid__input" aria-label="Days" type="number" min="0" required value={line.NumOfDays} onChange={(e)=>change('CashDiscountLines',form.CashDiscountLines.map((l,i)=>i===index?{...l,NumOfDays:e.target.value}:l))}/></td>
          <td><input className="im-grid__input" aria-label="Discount %" type="number" min="0" max="100" step="0.000001" required value={line.Discount} onChange={(e)=>change('CashDiscountLines',form.CashDiscountLines.map((l,i)=>i===index?{...l,Discount:e.target.value}:l))}/></td>
          <td><button className="im-btn" type="button" onClick={()=>change('CashDiscountLines',form.CashDiscountLines.filter((_,i)=>i!==index))}>Remove tier {index+1}</button></td>
        </tr>)}</tbody></table></div>
        <div className="ls-actions"><button className="im-btn" type="button" onClick={()=>change('CashDiscountLines',[...(form.CashDiscountLines || []),{NumOfDays:0,Discount:0}])}>Add tier</button></div></div>}
      <div className="ls-actions"><button className="im-btn im-btn--primary" type="submit">{busy?'Saving…':'Save'}</button>
      {selected!=null && <button className="im-btn" type="button" onClick={reset}>Cancel</button>}
      {kind==='numbering-series' && selected!=null && <button className="im-btn" type="button" onClick={()=>action('set-default',{Series:selected})}>Make default for object / subtype</button>}</div>
      </fieldset>
    </form>}
    <section className="ls-card ls-card--last"><div className="ls-list-head"><div className="im-section-title">Existing records</div>
      <label className="im-field"><span className="im-field__label ls-search-label">Search</span><input className="im-field__input" value={search} onChange={(e)=>setSearch(e.target.value)} type="search"/></label></div>
      {busy && <p role="status" className="ls-note">Loading…</p>}
      <div className="im-grid-wrap"><table className="im-grid"><thead><tr>{columns.map((c)=><th key={c}>{labels[c] || c}</th>)}{kind==='numbering-series' && <th>Default</th>}{config.fields.length>0 && <th>Action</th>}</tr></thead>
        <tbody>{data.rows.filter((r)=>Object.values(r).some((v)=>display(v).toLowerCase().includes(search.toLowerCase()))).map((row)=><tr key={rowKey(kind,row)} className={rowKey(kind,row)===selected?'ls-row--selected':undefined}>
          {columns.map((c)=><td key={c}>{cell(c,row[c])}</td>)}{kind==='numbering-series' && <td>{(data.defaults || []).some((d)=>d.DfltSeries===row.Series)?'Yes':''}</td>}
          {config.fields.length>0 && <td><button className="im-btn" disabled={busy} onClick={()=>{setSelected(rowKey(kind,row));setForm({...row});setNotice(null);}}>Edit</button></td>}
        </tr>)}</tbody></table></div>{!busy && !data.rows.length && <p className="ls-note">No records yet.</p>}
    </section>
  </div>;
}
export default function LocalSetup() {
  const {kind} = useParams();
  return CONFIG[kind] ? <SetupPage key={kind} kind={kind}/> : <p role="alert">Setup page not found.</p>;
}
