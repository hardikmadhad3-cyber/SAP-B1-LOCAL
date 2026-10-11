import React, { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import useDocumentSeries from './useDocumentSeries';
import apiClient from '../api/client';
import { getActiveToken } from '../auth/storage';
import { readGeneralSettings } from '../utils/generalSettingsStorage';
jest.mock('../utils/generalSettingsStorage', () => ({ readGeneralSettings: jest.fn() }));
jest.mock('../api/client', () => ({ get: jest.fn() }));
jest.mock('../auth/storage', () => ({ getActiveToken: jest.fn() }));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; };
function useHarness(props) {
  const [header,setHeader]=useState({postingDate:'2026-02-15',series:'',nextNumber:'',branch:''});
  const [refData,setRefData]=useState({});
  const [pageState,setPageState]=useState({});
  useDocumentSeries({endpoint:props.endpoint || '/sales-order',companyKey:props.company,currentDocEntry:props.docEntry,
    refreshKey:props.revision,header,setHeader,setRefData,setPageState});
  return {header,refData,pageState,setHeader};
}
const response = (id,name='Series',extra={}) => ({data:{series:[{Series:id,SeriesName:name,NextNumber:335,IsDefault:true}],manualAllowed:true,...extra}});
beforeEach(()=>{jest.clearAllMocks();getActiveToken.mockReturnValue('company-a-token');readGeneralSettings.mockReturnValue({});});

test.each([
 ['/sales-order','salesSeries',443], ['/delivery','deliverySeries',445],
 ['/sales-quotation','salesQuotationSeries',446], ['/ar-invoice','arInvoiceSeries',447],
 ['/ar-credit-memo','arCreditMemoSeries',448], ['/purchase-order','purchaseOrderSeries',449],
 ['/grpo','grpoSeries',450], ['/ap-invoice','apInvoiceSeries',451],
 ['/ap-credit-memo','apCreditMemoSeries',452], ['/services/ar-invoice','arInvoiceSeries',447],
])('applies saved user preference on %s instead of SAP default',async(endpoint,key,id)=>{
 readGeneralSettings.mockReturnValue({[key]:String(id)});
 apiClient.get.mockResolvedValue({data:{series:[{Series:1,IsDefault:true,NextNumber:10},{Series:id,NextNumber:20}]}});
 const {result}=renderHook(useHarness,{initialProps:{company:'A',endpoint}});
 await waitFor(()=>expect(result.current.header.series).toBe(String(id)));
 expect(result.current.header.nextNumber).toBe('20');
});

test.each([{Series:443,Locked:'Y'},{Series:443,Eligible:false},{Series:443,IsLoadedDocumentSeries:true},null])('falls back when configured series is unavailable: %s',async(row)=>{
 readGeneralSettings.mockReturnValue({salesSeries:'443'});
 apiClient.get.mockResolvedValue({data:{series:[{Series:1,IsDefault:true},...(row?[row]:[])]}});
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('1'));
});

test('preserves an eligible user choice on refresh and restores preference for a new blank document',async()=>{
 readGeneralSettings.mockReturnValue({salesSeries:'443'});
 apiClient.get.mockResolvedValue({data:{series:[{Series:1,IsDefault:true},{Series:443},{Series:444}]}});
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A',revision:0}});
 await waitFor(()=>expect(result.current.header.series).toBe('443'));
 act(()=>result.current.setHeader(h=>({...h,series:'444'})));
 rerender({company:'A',revision:1});
 await waitFor(()=>expect(result.current.header.series).toBe('444'));
 act(()=>result.current.setHeader(h=>({...h,series:''})));
 rerender({company:'A',revision:2});
 await waitFor(()=>expect(result.current.header.series).toBe('443'));
});

test('switching company or user reads their own preference even with overlapping series',async()=>{
 readGeneralSettings.mockReturnValue({salesSeries:'443'});
 apiClient.get.mockResolvedValue({data:{series:[{Series:1,IsDefault:true},{Series:443},{Series:445}]}});
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('443'));
 readGeneralSettings.mockReturnValue({salesSeries:'445'});
 getActiveToken.mockReturnValue('company-b-token');
 rerender({company:'B'});
 await waitFor(()=>expect(result.current.header.series).toBe('445'));
 readGeneralSettings.mockReturnValue({});
 getActiveToken.mockReturnValue('different-user-token');
 rerender({company:'B'});
 await waitFor(()=>expect(result.current.header.series).toBe('1'));
});
test('loads default and preview without refetch loop',async()=>{
 apiClient.get.mockResolvedValue(response(127));
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('127'));
 expect(result.current.header.nextNumber).toBe('335');
 expect(apiClient.get).toHaveBeenCalledTimes(1);
});
test('loads SAP series while the document branch is blank',async()=>{
 apiClient.get.mockResolvedValue(response(237,'TRA-2627'));
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('237'));
 expect(result.current.header.branch).toBe('');
 expect(result.current.header.nextNumber).toBe('335');
 expect(apiClient.get).toHaveBeenCalledTimes(1);
 expect(apiClient.get.mock.calls[0][1].params.branch).toBe('');
 expect(result.current.pageState.seriesError).toBe('');
});
test('ignores old company response even when series IDs overlap',async()=>{
 const old=deferred(),next=deferred();apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A'}});
 getActiveToken.mockReturnValue('company-b-token');rerender({company:'B'});
 await act(async()=>next.resolve(response(127,'B')));
 await act(async()=>old.resolve(response(127,'A')));
 expect(result.current.refData.series[0].SeriesName).toBe('B');
});
test('posting date change ignores an earlier response and clears old preview',async()=>{
 const old=deferred(),next=deferred();apiClient.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 act(()=>result.current.setHeader(h=>({...h,postingDate:'2026-07-01'})));
 await act(async()=>next.resolve(response(128)));
 await act(async()=>old.resolve(response(127)));
 expect(result.current.header.series).toBe('128');
 expect(apiClient.get.mock.calls[1][1].params.date).toBe('2026-07-01');
});
test('errors clear choices and manual availability without retry loop',async()=>{
 apiClient.get.mockRejectedValue({response:{data:{message:'SAP mapping missing'}}});
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.pageState.seriesError).toBe('SAP mapping missing'));
 expect(result.current.refData).toMatchObject({series:[],manualAllowed:false});
 expect(result.current.header.series).toBe('');
 expect(apiClient.get).toHaveBeenCalledTimes(1);
});
test('multiple eligible series select first when SAP supplies no default',async()=>{
 apiClient.get.mockResolvedValue({data:{series:[{Series:1},{Series:2}],manualAllowed:false}});
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.pageState.seriesLoading).toBe(false));
 expect(result.current.header.series).toBe('1');
 expect(result.current.refData.series).toHaveLength(2);
});
test('explicit New/copy refresh updates the target number for an unchanged context',async()=>{
 apiClient.get.mockResolvedValueOnce(response(127)).mockResolvedValueOnce(response(127,'Series',{series:[{Series:127,NextNumber:336}]}));
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A',revision:0}});
 await waitFor(()=>expect(result.current.header.nextNumber).toBe('335'));
 act(()=>result.current.setHeader(h=>({...h,series:'',nextNumber:''})));
 rerender({company:'A',revision:1});
 await waitFor(()=>expect(result.current.header.nextNumber).toBe('336'));
});
test('historical documents do not reload creation series',()=>{
 apiClient.get.mockResolvedValue(response(127));
 renderHook(useHarness,{initialProps:{company:'A',docEntry:42}});
 expect(apiClient.get).not.toHaveBeenCalled();
});
test('selection survives only while eligible, manual only when explicitly allowed',async()=>{
 apiClient.get.mockResolvedValueOnce(response(127)).mockResolvedValueOnce(response(128,'Other',{manualAllowed:false}));
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A',revision:0}});
 await waitFor(()=>expect(result.current.header.series).toBe('127'));
 act(()=>result.current.setHeader(h=>({...h,series:'manual'})));
 rerender({company:'A',revision:1});
 await waitFor(()=>expect(result.current.header.series).toBe('128'));
});

test('displays SAP period choices even when the entered date has no posting period',async()=>{
 apiClient.get.mockResolvedValue({data:{series:[{Series:137,SeriesName:'JKLYSQ25',NextNumber:1,IsDefault:true,Eligible:true,IsCurrentPeriod:false,PostingEligible:false}],manualAllowed:true,postingPeriodValid:false,periodContextSource:'last-configured-period',reason:''}});
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('137'));
 expect(result.current.header.nextNumber).toBe('1');
 expect(result.current.refData.manualAllowed).toBe(true);
 expect(result.current.pageState.seriesError).toBe('');
});

test('requester branch does not become the document numbering branch',async()=>{
 apiClient.get.mockResolvedValue(response(311,'New1'));
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.header.series).toBe('311'));
 act(()=>result.current.setHeader(h=>({...h,requesterBranch:'-2',branch:'',postingDate:'2026-09-09'})));
 await waitFor(()=>expect(apiClient.get).toHaveBeenCalledTimes(2));
 expect(apiClient.get.mock.calls[1][1].params.branch).toBe('');
 await waitFor(()=>expect(result.current.header.series).toBe('311'));
});

test('opening a saved document cancels draft series loading without overwriting its number', async()=>{
 const pending=deferred();apiClient.get.mockReturnValue(pending.promise);
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'A'}});
 await waitFor(()=>expect(result.current.pageState.seriesLoading).toBe(true));
 act(()=>result.current.setHeader(h=>({...h,series:'275',docNo:'405',nextNumber:'405'})));
 rerender({company:'A',docEntry:6447});
 await waitFor(()=>expect(result.current.pageState.seriesLoading).toBe(false));
 await act(async()=>pending.resolve(response(127)));
 expect(result.current.header.docNo).toBe('405');
 expect(result.current.header.series).toBe('275');
 expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('GST subtype changes ignore old invoice responses and take each subtype number preview',async()=>{
 const old=deferred();
 apiClient.get.mockReturnValueOnce(old.promise)
  .mockResolvedValueOnce(response(271,'JKLD2627',{series:[{Series:271,NextNumber:1,IsDefault:true}]}))
  .mockResolvedValueOnce(response(275,'JKLDN26',{series:[{Series:275,NextNumber:8,IsDefault:true}]}));
 const {result}=renderHook(useHarness,{initialProps:{company:'A'}});
 act(()=>result.current.setHeader(h=>({...h,transactionType:'Bill Of Supply',series:'',nextNumber:''})));
 await waitFor(()=>expect(result.current.header.nextNumber).toBe('1'));
 await act(async()=>old.resolve(response(274,'CAN2627')));
 expect(result.current.header.series).toBe('271');
 expect(apiClient.get.mock.calls[1][1].params.transactionType).toBe('Bill Of Supply');
 act(()=>result.current.setHeader(h=>({...h,transactionType:'GST Debit Memo',series:'',nextNumber:''})));
 await waitFor(()=>expect(result.current.header.nextNumber).toBe('8'));
 expect(result.current.header.series).toBe('275');
 expect(apiClient.get.mock.calls[2][1].params.transactionType).toBe('GST Debit Memo');
});

test('same company ID with a changed database/server scope invalidates overlapping series selections',async()=>{
 apiClient.get.mockResolvedValueOnce(response(274,'Old',{series:[{Series:272},{Series:274,IsDefault:true}]}))
  .mockResolvedValueOnce(response(272,'New',{series:[{Series:274},{Series:272,NextNumber:1587,IsDefault:true}]}));
 const {result,rerender}=renderHook(useHarness,{initialProps:{company:'company4/serverA/dbA/user1'}});
 await waitFor(()=>expect(result.current.header.series).toBe('274'));
 rerender({company:'company4/serverB/dbB/user1'});
 await waitFor(()=>expect(result.current.header.series).toBe('272'));
 expect(result.current.header.nextNumber).toBe('1587');
});
