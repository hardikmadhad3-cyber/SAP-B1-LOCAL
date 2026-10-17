/**
 * Declarative UDT/UDF/UDO schema for the Gate Pass & Visitor Management module,
 * transcribed 1:1 from the legacy SAP B1 UI-API add-on's form definitions at
 * GATEPASS/GatePass_1.0.5/X64Client/frmMstVstor.xml, frmMstVst.xml,
 * frmVisitor.xml, frmGPin.xml and frmGPout.xml (table/field bindings, combo
 * ValidValues and matrix columns read directly out of each form's XML).
 *
 * Field `type` values map to SAP's BoFieldTypes: 'Alpha' | 'Numeric' | 'Date' | 'Float' | 'Memo'.
 * This file is pure data — no SAP/network calls — mirroring jobWorkSchema.js's
 * shape so gatePassProvisioningService.js / gatePassDbService.js /
 * gatePassService.js can reuse the same generic engine pattern already proven
 * for the Job Work module.
 */

const VALID_VALUES = {
  // frmGPin.xml: item uid="cmbGPstus", alias U_GPSTUS
  GateInStatus: {
    values: [
      { value: 'Open', description: 'Open' },
      { value: 'Closed', description: 'Closed' },
      { value: 'Short Closed', description: 'Short Closed' },
    ],
    defaultValue: 'Open',
  },
  // frmGPout.xml: item uid="cmbGPstus", alias U_GPSTUS
  GateOutStatus: {
    values: [
      { value: 'Open', description: 'Open' },
      { value: 'Closed', description: 'Closed' },
    ],
    defaultValue: 'Open',
  },
  // frmGPin.xml: item uid="cmbIType", alias U_ITYPE
  InwardType: {
    values: [
      { value: 'Purchase', description: 'Purchase' },
      { value: 'Sales Return', description: 'Sales Return' },
      { value: 'Other', description: 'Other' },
    ],
    defaultValue: 'Purchase',
  },
  // frmGPin.xml: item uid="cmbDType", alias U_DOCTYPE
  GateInDocType: {
    values: [
      { value: 'GRPO', description: 'GRPO' },
      { value: 'AR Credit Memo', description: 'AR Credit Memo' },
      { value: 'Goods Receipt', description: 'Goods Receipt' },
    ],
    defaultValue: 'GRPO',
  },
  // frmGPout.xml: item uid="cmbDType", alias U_DTYPE
  GateOutDocType: {
    values: [
      { value: 'AR Invoice', description: 'AR Invoice' },
      { value: 'AP Credit Memo', description: 'AP Credit Memo' },
      { value: 'Goods Issue', description: 'Goods Issue' },
    ],
    defaultValue: 'AR Invoice',
  },
  // frmGPout.xml: item uid="cmbOtype", alias U_OTYPE
  OutwardType: {
    values: [
      { value: 'Sales', description: 'Sales' },
      { value: 'Purchase Return', description: 'Purchase Return' },
      { value: 'Other', description: 'Other' },
    ],
    defaultValue: 'Sales',
  },
  // frmGPin.xml / frmGPout.xml: item uid="tRetType", alias U_RETURNTYPE
  YesNo: {
    values: [{ value: 'Yes', description: 'Yes' }, { value: 'No', description: 'No' }],
    defaultValue: 'No',
  },
  // frmGPin.xml / frmGPout.xml: item uid="cmbRef", alias U_REF
  ReferenceType: {
    values: [{ value: 'Job Work', description: 'Job Work' }, { value: 'Other', description: 'Other' }],
    defaultValue: 'Other',
  },
};

/**
 * Two simple lookup masters (Visitor Type, Visit Type) — single-table UDTs of
 * TableType 'bott_MasterData', matching frmMstVstor.xml (@STVSTR) and
 * frmMstVst.xml (@STVSTT) exactly: both are plain Code/Name maintenance
 * screens (ObjectType STVSTR / STVSTT), auto-exposed by Service Layer as
 * generic OData entities (`/U_<TableName>`) with built-in Code/Name columns —
 * no UserObjectsMD registration required.
 */
const MASTERS = {
  visitorType: {
    menuName: 'Visitor Type',
    menuPath: '/gate-pass/visitor-type',
    table: { name: 'STVSTR', description: 'Visitor Type' },
  },
  visitType: {
    menuName: 'Visit Type',
    menuPath: '/gate-pass/visit-type',
    table: { name: 'STVSTT', description: 'Visit Type' },
  },
};

const getMaster = (masterKey) => {
  const master = MASTERS[masterKey];
  if (!master) {
    const error = new Error(`Unknown Gate Pass master: ${masterKey}`);
    error.statusCode = 404;
    throw error;
  }
  return master;
};

/**
 * The 3 operational transactions (Visitor Log, Gate In, Gate Out), each a
 * registered UDO — header + line write goes to a single generic resource
 * (e.g. POST /STGTPV), same pattern jobWorkSchema.js's TRANSACTIONS use.
 * `Remark`/`Creator` (no U_ prefix) are SAP's own built-in UDO columns, not
 * custom UDFs — they need no provisioning and aren't listed in masterFields.
 */
const TRANSACTIONS = {
  visitorLog: {
    menuName: 'Visitor Log',
    menuPath: '/gate-pass/visitor-log',
    listFields: {
      statusField: 'VOTIME',
      partyCodeField: 'NAME',
      partyNameField: 'ORGN',
      postingDateField: 'VIDATE',
      primaryLineTable: 'STGTVS1',
    },
    masterTable: { name: 'STGTVS', description: 'Gate Pass Visitor Log' },
    childTables: [
      { name: 'STGTVS1', description: 'Gate Pass Visitor Materials', role: 'lines' },
    ],
    masterFields: [
      { name: 'VIDATE', description: 'Visitor In Date', type: 'Date' },
      { name: 'VITIME', description: 'Visitor In Time', type: 'Alpha', size: 10 },
      { name: 'ORGN', description: 'Organization', type: 'Alpha', size: 150 },
      { name: 'NAME', description: 'Visitor Name', type: 'Alpha', size: 150 },
      { name: 'PHENO', description: 'Visitor Phone No', type: 'Alpha', size: 30 },
      { name: 'PERS', description: 'Person To Meet', type: 'Alpha', size: 150 },
      { name: 'ALTER', description: 'Alternate Person', type: 'Alpha', size: 150 },
      { name: 'EPERS', description: 'Additional Person(s)', type: 'Alpha', size: 200 },
      { name: 'DEPT', description: 'Department', type: 'Alpha', size: 100 },
      { name: 'EHOUR', description: 'Expected Duration', type: 'Alpha', size: 50 },
      { name: 'VSTORTY', description: 'Visitor Type', type: 'Alpha', size: 20 },
      { name: 'VSTYPE', description: 'Visit Type', type: 'Alpha', size: 20 },
      { name: 'PURPS', description: 'Purpose', type: 'Memo', size: 50 },
      { name: 'ADDRS', description: 'Address', type: 'Memo', size: 50 },
      { name: 'VODATE', description: 'Visitor Out Date', type: 'Date' },
      { name: 'VOTIME', description: 'Visitor Out Time', type: 'Alpha', size: 10 },
    ],
    childFields: {
      STGTVS1: [
        { name: 'PART', description: 'Particulars', type: 'Alpha', size: 150 },
        { name: 'QTY', description: 'Quantity', type: 'Float' },
        { name: 'DETAIL', description: 'Details', type: 'Alpha', size: 200 },
      ],
    },
    udo: {
      objectType: 'STGTVS',
      name: 'Gate Pass Visitor Log',
      manageSeries: true,
      childTables: ['STGTVS1'],
      findColumns: ['NAME', 'ORGN', 'VIDATE', 'PERS'],
    },
  },

  gateIn: {
    menuName: 'Gate In — Material Inward',
    menuPath: '/gate-pass/gate-in',
    listFields: {
      statusField: 'GPSTUS',
      partyCodeField: 'VCODE',
      partyNameField: 'VNAME',
      postingDateField: 'DOCDATE',
      primaryLineTable: 'STGTPV1',
    },
    masterTable: { name: 'STGTPV', description: 'Gate Pass Material Inward' },
    childTables: [
      { name: 'STGTPV1', description: 'Gate Pass Inward PO Items', role: 'lines' },
      { name: 'STGTPV2', description: 'Gate Pass Inward Additional Items', role: 'lines2' },
    ],
    masterFields: [
      { name: 'DOCDATE', description: 'Gate Entry Date', type: 'Date' },
      { name: 'VEHNO', description: 'Vehicle No', type: 'Alpha', size: 30 },
      { name: 'LRNO', description: 'LR Number', type: 'Alpha', size: 50 },
      { name: 'VCODE', description: 'Customer/Vendor Code', type: 'Alpha', size: 50 },
      { name: 'VNAME', description: 'Customer/Vendor Name', type: 'Alpha', size: 150 },
      { name: 'GENTRY', description: 'Gate Entry No', type: 'Alpha', size: 50 },
      { name: 'VEHDATE', description: 'Vehicle In Date', type: 'Date' },
      { name: 'VEHTIME', description: 'Vehicle In Time', type: 'Alpha', size: 10 },
      { name: 'DOCNO', description: 'Base Document No', type: 'Alpha', size: 50 },
      { name: 'TRSNAME', description: 'Transporter Name', type: 'Alpha', size: 100 },
      { name: 'TRSNO', description: 'Transporter Cont. No', type: 'Alpha', size: 30 },
      { name: 'DUEDATE', description: 'Actual Material Return Date', type: 'Date' },
      { name: 'PURPOSE', description: 'Purpose', type: 'Alpha', size: 200 },
      { name: 'REMARK', description: 'Remark', type: 'Memo', size: 50 },
      { name: 'GPSTUS', description: 'Gate Entry Status', type: 'Alpha', size: 20, validValues: 'GateInStatus' },
      { name: 'ITYPE', description: 'Inward Type', type: 'Alpha', size: 20, validValues: 'InwardType' },
      { name: 'DOCTYPE', description: 'Document Type', type: 'Alpha', size: 20, validValues: 'GateInDocType' },
      { name: 'RETURNTYPE', description: 'Returnable', type: 'Alpha', size: 10, validValues: 'YesNo' },
      { name: 'PTIME', description: 'Punch Time', type: 'Alpha', size: 10 },
      { name: 'CHECK', description: 'Without Base Ref.', type: 'Alpha', size: 3, validValues: 'YesNo' },
      { name: 'REF', description: 'Reference Type', type: 'Alpha', size: 20, validValues: 'ReferenceType' },
    ],
    childFields: {
      STGTPV1: [
        { name: 'PONO', description: 'Doc No', type: 'Alpha', size: 50 },
        { name: 'LINENO', description: 'Line No', type: 'Numeric' },
        { name: 'ICODE', description: 'Item Code', type: 'Alpha', size: 50 },
        { name: 'INAME', description: 'Item Description', type: 'Alpha', size: 150 },
        { name: 'QTY', description: 'Quantity', type: 'Float' },
        { name: 'BALQTY', description: 'Receipt Qty', type: 'Float' },
        { name: 'UOM', description: 'UOM', type: 'Alpha', size: 20 },
        { name: 'RMKS', description: 'Remarks', type: 'Alpha', size: 200 },
      ],
      STGTPV2: [
        { name: 'ADDITM', description: 'Item Description', type: 'Alpha', size: 150 },
        { name: 'ADDQTY', description: 'Quantity', type: 'Float' },
        { name: 'ADDRMK', description: 'Remarks', type: 'Alpha', size: 200 },
      ],
    },
    udo: {
      objectType: 'STGTPV',
      name: 'Gate Pass Material Inward',
      manageSeries: true,
      childTables: ['STGTPV1', 'STGTPV2'],
      findColumns: ['VEHNO', 'LRNO', 'VCODE', 'VNAME', 'DOCDATE', 'GPSTUS'],
    },
  },

  gateOut: {
    menuName: 'Gate Out — Material Outward',
    menuPath: '/gate-pass/gate-out',
    listFields: {
      statusField: 'GPSTUS',
      partyCodeField: 'VCODE',
      partyNameField: 'VNAME',
      postingDateField: 'DOCDATE',
      primaryLineTable: 'STGTPA1',
    },
    masterTable: { name: 'STGTPA', description: 'Gate Pass Material Outward' },
    childTables: [
      { name: 'STGTPA1', description: 'Gate Pass Outward PO/base-doc Items', role: 'lines' },
      { name: 'STGTPA2', description: 'Gate Pass Outward Additional Items', role: 'lines2' },
    ],
    masterFields: [
      { name: 'DOCDATE', description: 'Gate Entry Date', type: 'Date' },
      { name: 'VEHNO', description: 'Vehicle No', type: 'Alpha', size: 30 },
      { name: 'LRNO', description: 'LR Number', type: 'Alpha', size: 50 },
      { name: 'VCODE', description: 'Customer/Vendor Code', type: 'Alpha', size: 50 },
      { name: 'VNAME', description: 'Customer/Vendor Name', type: 'Alpha', size: 150 },
      { name: 'DOCNO', description: 'Base Document No', type: 'Alpha', size: 50 },
      { name: 'TRSNAME', description: 'Transporter Name', type: 'Alpha', size: 100 },
      { name: 'TRSNO', description: 'Transporter Cont. No', type: 'Alpha', size: 30 },
      { name: 'DUEDATE', description: 'Expected Material Return Date', type: 'Date' },
      { name: 'PURPOSE', description: 'Purpose', type: 'Alpha', size: 200 },
      // Real link to the originating Gate In document, for returnable
      // material going back out — the SAP-side "golden arrow" reference
      // (frmGPout.xml also reads @STGTPV.DocEntry directly for its picker).
      { name: 'GPNO', description: 'Reference Gate In DocEntry', type: 'Numeric' },
      { name: 'GPSTUS', description: 'Gate Entry Status', type: 'Alpha', size: 20, validValues: 'GateOutStatus' },
      { name: 'DTYPE', description: 'Document Type', type: 'Alpha', size: 20, validValues: 'GateOutDocType' },
      { name: 'RETURNTYPE', description: 'Returnable', type: 'Alpha', size: 10, validValues: 'YesNo' },
      { name: 'PTIME', description: 'Punch Time', type: 'Alpha', size: 10 },
      { name: 'OTYPE', description: 'Outward Type', type: 'Alpha', size: 20, validValues: 'OutwardType' },
      { name: 'VEHDATE', description: 'Vehicle Out Date', type: 'Date' },
      { name: 'VEHTIME', description: 'Vehicle Out Time', type: 'Alpha', size: 10 },
      { name: 'GPTYPE', description: 'Gate Entry Type', type: 'Alpha', size: 20 },
      { name: 'REF', description: 'Reference Type', type: 'Alpha', size: 20, validValues: 'ReferenceType' },
    ],
    childFields: {
      STGTPA1: [
        { name: 'PONO', description: 'Doc No', type: 'Alpha', size: 50 },
        { name: 'LINENO', description: 'Line No', type: 'Numeric' },
        { name: 'ICODE', description: 'Item Code', type: 'Alpha', size: 50 },
        { name: 'INAME', description: 'Item Description', type: 'Alpha', size: 150 },
        { name: 'QTY', description: 'Quantity', type: 'Float' },
        { name: 'BALQTY', description: 'Receipt Qty', type: 'Float' },
        { name: 'UOM', description: 'UOM', type: 'Alpha', size: 20 },
        { name: 'RMKS', description: 'Remarks', type: 'Alpha', size: 200 },
      ],
      STGTPA2: [
        { name: 'ADDITM', description: 'Item Description', type: 'Alpha', size: 150 },
        { name: 'ADDQTY', description: 'Quantity', type: 'Float' },
        { name: 'ADDRMK', description: 'Remarks', type: 'Alpha', size: 200 },
      ],
    },
    udo: {
      objectType: 'STGTPA',
      name: 'Gate Pass Material Outward',
      manageSeries: true,
      childTables: ['STGTPA1', 'STGTPA2'],
      findColumns: ['VEHNO', 'LRNO', 'VCODE', 'VNAME', 'DOCDATE', 'GPSTUS', 'GPNO'],
    },
  },
};

const getTransaction = (transactionKey) => {
  const transaction = TRANSACTIONS[transactionKey];
  if (!transaction) {
    const error = new Error(`Unknown Gate Pass transaction: ${transactionKey}`);
    error.statusCode = 404;
    throw error;
  }
  return transaction;
};

module.exports = {
  VALID_VALUES,
  MASTERS,
  TRANSACTIONS,
  getMaster,
  getTransaction,
};
