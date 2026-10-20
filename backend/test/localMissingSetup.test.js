const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('../db/pgDb');
const env = require('../config/env');
const { withLocalCompany } = require('./helpers/localCompany');
const setup = require('../services/localSetupService');
const sap = require('../services/sapService');
test.after(()=>pg.closeAll());

test('monthly ranges include leap February and reject invalid starts',()=>{
  const months = setup.months('2027-04-01');
  assert.equal(months.length,12);
  assert.deepEqual(months[10],{from:'2028-02-01',to:'2028-02-29'});
  assert.equal(months[11].to,'2028-03-31');
  for(const date of ['2026-13-01','2026-00-01','2026-04-02','bad']) assert.throws(()=>setup.months(date));
});

test('M6 masters round-trip into existing readers and enforce setup rules', {skip:!env.databaseUrl},async()=>{
  await withLocalCompany('m6',async({asUser,sql})=>asUser(async()=>{
    const masters = require('../services/masterDataDbService');
    await setup.save('item-groups',null,{ItmsGrpNam:'Raw Materials',Locked:'N',BalInvntAc:'120000',RevenuesAc:'400000'});
    const group = (await setup.list('item-groups')).rows.find((r)=>r.ItmsGrpNam==='Raw Materials');
    assert.ok((await require('../services/itemDbService').getItemGroups()).some((r)=>String(r.code)===String(group.ItmsGrpCod)));
    await assert.rejects(setup.save('item-groups',null,{ItmsGrpNam:'raw materials'}));
    await setup.save('item-groups',group.ItmsGrpCod,{ItmsGrpNam:'Materials',BalInvntAc:null});
    assert.equal((await sql('SELECT "BalInvntAc" FROM "OITB" WHERE "ItmsGrpCod"=$1',[group.ItmsGrpCod])).rows[0].BalInvntAc,null);
    const inline = await require('../services/itemService').createItemGroup({GroupName:'Inline group',DefaultUoMGroup:1,LeadTime:3});
    assert.equal(inline.name,'Inline group');
    assert.equal((await sql('SELECT "LeadTime" FROM "OITB" WHERE "ItmsGrpCod"=$1',[inline.code])).rows[0].LeadTime,3);

    await setup.save('bp-groups',null,{GroupName:'Trade',GroupType:'C'});
    await setup.save('bp-groups',null,{GroupName:'Trade',GroupType:'S'});
    const bpGroup=(await setup.list('bp-groups')).rows.find((r)=>r.GroupName==='Trade' && r.GroupType==='C');
    await sql('INSERT INTO "OCRD" ("CardCode","CardName","CardType","GroupCode") VALUES (\'C1\',\'Customer\',\'C\',$1)',[bpGroup.GroupCode]);
    await assert.rejects(setup.save('bp-groups',bpGroup.GroupCode,{GroupType:'S'}),/cannot change type/);
    await setup.save('sales-employees',null,{SlpName:"O'Brien",Active:'Y',Commission:5,Memo:'Sales'});
    const search = await sap.request({url:"/SalesPersons?$filter=SalesEmployeeName eq 'O''Brien'&$select=SalesEmployeeCode,SalesEmployeeName"});
    assert.equal(search.data.value[0].SalesEmployeeName,"O'Brien");
    assert.equal(search.data.value.length,1);
    await assert.rejects(setup.save('sales-employees',null,{SlpName:'Bad',Commission:101}));
    await assert.rejects(sap.request({url:"/SalesPersons?$filter=SlpName ne 'x'"}),/does not support/);

    await setup.save('currencies',null,{CurrCode:'USD',CurrName:'US Dollar',DocCurrCod:'USD'});
    await setup.save('exchange-rates',null,{Currency:'USD',RateDate:'2026-10-11',Rate:'83.123456'});
    assert.equal((await sap.request({method:'POST',url:'/SBOBobService_GetCurrencyRate',data:{Currency:'USD',Date:'2026-10-11'}})).data.value,83.123456);
    await setup.save('exchange-rates',null,{Currency:'USD',RateDate:'2026-10-11',Rate:84});
    assert.equal((await setup.list('exchange-rates')).rows.length,1);
    await assert.rejects(setup.save('exchange-rates',null,{Currency:'INR',RateDate:'2026-10-11',Rate:2}),/must be 1/);
    await assert.rejects(setup.save('exchange-rates',null,{Currency:'USD',RateDate:'2026-10-11',Rate:0}),/greater than zero/);
    await setup.save('states',null,{Country:'IN',Code:'GJ',Name:'Gujarat'});
    await setup.save('states','IN:GJ',{Country:'IN',Code:'GJ',Name:'Gujarat State'});
    assert.ok((await masters.lookupStates('IN')).some((r)=>r.code==='GJ'));
    await assert.rejects(setup.save('states','IN:GJ',{Country:'IN',Code:'MH',Name:'Other'}),/cannot change/);
    await setup.save('locations',null,{Location:'Factory'});
    assert.ok((await masters.lookupWarehouseLocations()).some((r)=>r.name==='Factory'));

    await setup.save('cash-discounts',null,{Code:'EARLY',TableDesc:'Early payment',BaseDate:'P',CashDiscountLines:[{NumOfDays:10,Discount:2},{NumOfDays:20,Discount:1}]});
    await setup.save('payment-methods',null,{PayMethCod:'BANK',Descript:'Bank transfer',Type:'O',BankTransf:'T',Active:'Y',GLAccount:'100000'});
    const terms = await sap.request({method:'POST',url:'/PaymentTermsTypes',data:{PaymentTermsGroupName:'Net30',NumberOfAdditionalDays:30,DiscountCode:'EARLY',PaymentMethod:'BANK'}});
    const loaded = await masters.getPaymentTerms(terms.data.GroupNumber);
    assert.equal(loaded.DiscountCode,'EARLY');assert.equal(loaded.PaymentMethod,'BANK');
    assert.equal((await sap.request({url:'/CashDiscounts?$select=Code,Name&$top=200'})).data.value[0].Name,'Early payment');
    assert.equal((await sap.request({url:'/PaymentMethods?$select=Code,Description&$top=200'})).data.value[0].Code,'BANK');
    await assert.rejects(setup.save('cash-discounts','EARLY',{CashDiscountLines:[{NumOfDays:1,Discount:110}]}));
    assert.equal((await setup.list('cash-discounts')).rows[0].CashDiscountLines.length,2,'invalid replacement rolls back');

    await setup.action('account-template','apply');
    await setup.action('account-template','apply');
    assert.equal((await sql('SELECT count(*)::int AS n FROM "OACT"')).rows[0].n,18, 'starter chart + template titles + WIP, variance (017) and resource absorption (019) accounts');
    assert.equal((await masters.getAccount('120000')).FatherAccountKey,'ASSETS');
    await assert.rejects(setup.save('item-groups',group.ItmsGrpCod,{BalInvntAc:'ASSETS'}),/title account/);
    const category=(await setup.list('gl-determination')).rows[0];
    await setup.save('gl-determination',category.AbsEntry,{LinkAct_1:'110000',DfltIncom:'400000',COGM_Act:'500000'});
    assert.equal((await setup.list('gl-determination')).rows[0].DfltIncom,'400000');
    await assert.rejects(setup.save('gl-determination',category.AbsEntry,{DfltIncom:'REVENUE'}),/title account/);
    await sql('UPDATE "OACT" SET "AcctName"=\'Custom cash\' WHERE "AcctCode"=\'100000\'');
    await assert.rejects(setup.action('account-template','apply'),/differs from the template/);
    assert.equal((await masters.getAccount('100000')).Name,'Custom cash');
  }));
});

test('M6 periods, series, permissions and company isolation', {skip:!env.databaseUrl},async()=>{
  await withLocalCompany('m6periods',async({asUser,sql})=>asUser(async()=>{
    const annual=(await setup.list('posting-periods')).rows[0];
    await setup.action('posting-periods','split-period',{AbsEntry:annual.AbsEntry});
    assert.equal((await setup.list('posting-periods')).rows.length,12);
    const results=await Promise.allSettled([1,2].map(()=>setup.action('posting-periods','create-months',{Indicator:'2027-28',StartDate:'2027-04-01'})));
    assert.equal(results.filter((r)=>r.status==='fulfilled').length,1,'concurrent overlapping years cannot both succeed');
    assert.equal((await setup.list('posting-periods')).rows.length,24);
    const series={SeriesName:'Orders 27',ObjectCode:'17',DocSubType:'--',Indicator:'2027-28',InitialNum:1,NextNumber:1,LastNum:100,Locked:'N',BeginStr:'',EndStr:'',BPLId:''};
    await setup.save('numbering-series',null,series);
    const saved=(await setup.list('numbering-series')).rows.find((r)=>r.SeriesName===series.SeriesName);
    await setup.action('numbering-series','set-default',{Series:saved.Series});
    assert.equal((await sql('SELECT "DfltSeries" FROM "ONNM" WHERE "ObjectCode"=\'17\'')).rows[0].DfltSeries,saved.Series);
    await assert.rejects(setup.save('numbering-series',null,{...series,SeriesName:'Overlap'}),/overlaps/);
    await assert.rejects(setup.save('numbering-series',saved.Series,{InitialNum:2,NextNumber:2}),/cannot change/);
    await setup.save('numbering-series',saved.Series,{NextNumber:50});
    await assert.rejects(setup.save('numbering-series',saved.Series,{NextNumber:49}),/backwards/);
    await setup.save('numbering-series',saved.Series,{Locked:'Y'});
    await assert.rejects(setup.action('numbering-series','set-default',{Series:saved.Series}),/unlocked/);
    const october=(await setup.list('posting-periods')).rows.find((r)=>String(r.Code).endsWith('-07') && r.Indicator==='2026-27');
    await sql('INSERT INTO "OCRD" ("CardCode","CardName","CardType","GroupCode") VALUES (\'C1\',\'Customer\',\'C\',1)');
    const quotationSeries=(await setup.list('numbering-series')).rows.find((r)=>r.ObjectCode==='23').Series;
    const order=await sap.request({method:'POST',url:'/Quotations',data:{Series:quotationSeries,CardCode:'C1',DocType:'dDocument_Service',DocDate:'2026-10-11',DocumentLines:[{ItemDescription:'Service',AccountCode:'400000',Quantity:1,UnitPrice:10}]}});
    await setup.save('posting-periods',october.AbsEntry,{PeriodStat:'Y'});
    await assert.rejects(sap.request({method:'PATCH',url:`/Quotations(${order.data.DocEntry})`,data:{Comments:'change'}}),/locked/);
    await setup.save('posting-periods',october.AbsEntry,{PeriodStat:'N'});
    await setup.save('posting-periods',october.AbsEntry,{T_DueDate:'2027-06-30'});
    await assert.rejects(setup.save('posting-periods',october.AbsEntry,{T_DueDate:'2025-01-01'}));
    assert.equal((await setup.list('posting-periods')).rows.find((r)=>r.AbsEntry===october.AbsEntry).T_DueDate.toISOString().slice(0,10),'2027-06-30');
    await sap.request({method:'PATCH',url:`/Quotations(${order.data.DocEntry})`,data:{Comments:'change'}});
    await assert.rejects(sap.request({method:'PATCH',url:`/Quotations(${order.data.DocEntry})`,data:{DocDueDate:'2027-07-01'}}),/due-date range/);
    await assert.rejects(sap.request({method:'PATCH',url:`/Quotations(${order.data.DocEntry})`,data:{TaxDate:'2027-07-01'}}),/document-date range/);

    await withLocalCompany('m6other',async({asUser:other})=>other(async()=>{
      assert.equal((await setup.list('posting-periods')).rows.length,1);
      assert.ok(!(await setup.list('numbering-series')).rows.some((r)=>r.SeriesName==='Orders 27'));
    }));

    const express=require('express');
    const {getRequestContext,runWithRequestContext}=require('../services/requestContextService');
    const authDb=require('../services/authDbService');
    const auth={...getRequestContext().req.auth};
    auth.roleId=(await authDb.getUserRoleForCompany(auth.userId,auth.companyId)).RoleId;
    await require('../services/authService').getMenuForRole(auth.roleId,auth.companyId);
    const app=express();app.use(express.json());
    app.use((req,res,next)=>{req.auth={...auth,roleId:req.headers['x-deny'] ? -1 : auth.roleId};runWithRequestContext(req,next);});
    app.use('/api/local-setup',require('../routes/localSetupRoutes'));
    const server=await new Promise((resolve)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    try{
      const url=`http://127.0.0.1:${server.address().port}/api/local-setup`;
      for(const kind of Object.keys(setup.SETUPS)) assert.equal((await fetch(`${url}/${kind}`)).status,200,kind);
      assert.equal((await fetch(`${url}/currencies`,{headers:{'x-deny':'1'}})).status,403);
      assert.equal((await fetch(`${url}/account-template/actions/apply`,{method:'POST',headers:{'x-deny':'1','content-type':'application/json'},body:'{}'})).status,403);
      assert.equal((await fetch(`${url}/unknown`)).status,404);
    }finally{await new Promise((resolve)=>server.close(resolve));}
  }));
});
