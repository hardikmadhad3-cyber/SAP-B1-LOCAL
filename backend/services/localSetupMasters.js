// Definitions used by the same local SL writer as the existing master pages.
module.exports = ({ slError }) => ({
  ItemGroups: {
    table: 'OITB', key: 'ItmsGrpCod', generatedKey: true, uniqueKey: 'ItmsGrpNam', label: 'Item group',
    required: { ItmsGrpNam: 'item group name' },
    fields: { Number: 'ItmsGrpCod', GroupName: 'ItmsGrpNam', DefaultUoMGroup: 'UgpEntry',
      PlanningSystem: 'PlaningSys', ProcurementMethod: 'PrcrmntMtd', OrderIntervals: 'OrdrIntrvl',
      OrderMultiple: 'OrdrMulti', MinimumOrderQuantity: 'MinOrdrQty', ToleranceDays: 'ToleranDay',
      InventorySystem: 'InvntSys' },
    flags: ['Locked'], accounts: ['BalInvntAc','SaleCostAc','RevenuesAc','ExpensesAc','BalanceAcc','TransferAc','DecreasAc','IncreasAc'],
    enums: { PlanningSystem: { bop_None: 'N', bop_MRP: 'M' }, ProcurementMethod: { bom_Buy: 'B', bom_Make: 'M' },
      InventorySystem: { bis_MovingAverage: 'A', bis_FIFO: 'F', bis_Standard: 'S', bis_SNB: 'B' },
      ItemClass: { itcService: 1, itcMaterial: 2 } },
    validate: async (client, row, existing) => {
      for (const key of ['OrdrMulti','MinOrdrQty','LeadTime','ToleranDay']) {
        if (row[key] != null && (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) throw slError(400, `${key} cannot be negative.`);
      }
      if (existing?.Locked === 'Y' && row.ItmsGrpNam !== existing.ItmsGrpNam) throw slError(400, 'Unlock the item group before renaming it.');
    },
  },
  BusinessPartnerGroups: {
    table: 'OCRG', key: 'GroupCode', generatedKey: true, label: 'BP group',
    required: { GroupName: 'BP group name', GroupType: 'BP group type' }, fields: { Code: 'GroupCode', Name: 'GroupName', Type: 'GroupType' },
    enums: { Type: { bbpgt_CustomerGroup: 'C', bbpgt_VendorGroup: 'S' } },
    validate: async (client, row, existing) => {
      if (!['C','S'].includes(row.GroupType)) throw slError(400, 'BP group type must be customer or vendor.');
      if (existing && existing.GroupType !== row.GroupType && (await client.query('SELECT 1 FROM "OCRD" WHERE "GroupCode"=$1 LIMIT 1', [existing.GroupCode])).rowCount) {
        throw slError(400, 'A BP group in use cannot change type.');
      }
    },
  },
  SalesPersons: {
    table: 'OSLP', key: 'SlpCode', generatedKey: true, uniqueKey: 'SlpName', label: 'Sales employee',
    required: { SlpName: 'sales employee name' },
    fields: { SalesEmployeeCode: 'SlpCode', SalesEmployeeName: 'SlpName', Remarks: 'Memo', CommissionPercent: 'Commission' }, flags: ['Active'],
  },
  Currencies: {
    table: 'OCRN', key: 'CurrCode', label: 'Currency', required: { CurrCode: 'currency code', CurrName: 'currency name' },
    fields: { Code: 'CurrCode', Name: 'CurrName', DocumentsCode: 'DocCurrCod' },
    validate: async (client, row) => {
      if (!/^[A-Z]{3}$/.test(row.CurrCode)) throw slError(400, 'Use a three-letter uppercase currency code.');
    },
  },
  Locations: {
    table: 'OLCT', key: 'Code', generatedKey: true, uniqueKey: 'Location', label: 'Location',
    required: { Location: 'location name' }, fields: { Name: 'Location' },
  },
  CashDiscounts: {
    table: 'OCDC', key: 'Code', label: 'Cash discount', required: { Code: 'cash discount code', TableDesc: 'cash discount name' },
    fields: { Name: 'TableDesc' },
    children: { CashDiscountLines: { table: 'CDC1', parentKey: 'CdcCode', lineKey: 'LineId', fields: {} } },
    validate: async (client, row, existing, children) => {
      // shortcut: day-count policies only; add calendar-date policies when a payment caller needs them.
      if (row.ByDate && row.ByDate !== 'N') throw slError(400, 'Use a day-count cash discount policy.');
      if ((!existing || children.CashDiscountLines) && !children.CashDiscountLines?.length) throw slError(400, 'Add at least one cash discount tier.');
    },
  },
  PaymentMethods: {
    table: 'OPYM', key: 'PayMethCod', label: 'Payment method',
    required: { PayMethCod: 'payment method code', Descript: 'payment method description', Type: 'payment direction' },
    fields: { Code: 'PayMethCod', Description: 'Descript' }, flags: ['Active'], accounts: ['GLAccount'],
  },
  GLAccountDetermination: {
    table: 'OACP', key: 'AbsEntry', generatedKey: true, uniqueKey: 'PeriodCat', label: 'Fiscal category',
    required: { PeriodCat: 'fiscal category', PeriodName: 'fiscal category name', FinancYear: 'fiscal year start', Year: 'fiscal year' }, fields: {},
    accounts: ['LinkAct_1','LinkAct_10','LinkAct_3','LinkAct_18','DfltIncom','DfltExpn','COGM_Act','BalanceAct','AlocCstAct','DftStockOB','RoundAcct','DecreasAc','IncreasAc','CashDscAR','CashDscAP','WipAcct','WipVarAcct','ResAcct'],
  },
  // Production resources (SAP Resources module): machines, labour or other capacity
  // issued to production orders at their standard cost.
  ResourceGroups: {
    table: 'ORSB', key: 'ResGrpCod', generatedKey: true, uniqueKey: 'ResGrpNam', label: 'Resource group',
    required: { ResGrpNam: 'resource group name' }, fields: { Code: 'ResGrpCod', Name: 'ResGrpNam', Type: 'ResType' },
    enums: { Type: { rtMachine: 'M', rtLabor: 'L', rtOther: 'O' } },
    usedBy: [['ORSC', 'ResGrpCod']],
    validate: async (client, row) => {
      if (!['M', 'L', 'O'].includes(row.ResType || 'M')) throw slError(400, 'Resource type must be machine, labour or other.');
    },
  },
  Resources: {
    table: 'ORSC', key: 'ResCode', label: 'Resource', required: { ResCode: 'resource code', ResName: 'resource name' },
    fields: { Code: 'ResCode', Name: 'ResName', Type: 'ResType', ResourceGroup: 'ResGrpCod', UnitOfMeasure: 'UnitOfMsr',
      IssueMethod: 'IssueMthd', DefaultWarehouse: 'DfltWH', StandardCost: 'StdCost', ResourceAccount: 'ResAcct' },
    enums: { Type: { rtMachine: 'M', rtLabor: 'L', rtOther: 'O' }, IssueMethod: { im_Manual: 'M', im_Backflush: 'B' } },
    flags: ['validFor'], accounts: ['ResAcct'],
    usedBy: [['ITT1', 'Code'], ['WOR1', 'ItemCode']],
    validate: async (client, row) => {
      if (!['M', 'L', 'O'].includes(row.ResType || 'M')) throw slError(400, 'Resource type must be machine, labour or other.');
      if (!['M', 'B'].includes(row.IssueMthd || 'M')) throw slError(400, 'Issue method must be manual or backflush.');
      if (Number(row.StdCost || 0) < 0) throw slError(400, 'The standard cost cannot be negative.');
      // A resource code shares the BOM / production order "No." column with item codes.
      if ((await client.query('SELECT 1 FROM "OITM" WHERE "ItemCode" = $1', [row.ResCode])).rowCount) throw slError(400, `"${row.ResCode}" is already an item code.`);
      if (row.ResGrpCod != null && row.ResGrpCod !== '' && !(await client.query('SELECT 1 FROM "ORSB" WHERE "ResGrpCod" = $1', [row.ResGrpCod])).rowCount) {
        throw slError(400, `Resource group ${row.ResGrpCod} does not exist.`);
      }
      if (row.DfltWH && !(await client.query('SELECT 1 FROM "OWHS" WHERE "WhsCode" = $1', [row.DfltWH])).rowCount) throw slError(400, `Warehouse "${row.DfltWH}" does not exist.`);
    },
  },
  RouteStages: {
    table: 'ORST', key: 'AbsEntry', generatedKey: true, uniqueKey: 'Code', label: 'Route stage',
    required: { Code: 'route stage code' }, fields: { InternalNumber: 'AbsEntry', Description: 'Desc' },
    usedBy: [['ITT2', 'StgEntry'], ['WOR4', 'StgEntry']],
  },
});
