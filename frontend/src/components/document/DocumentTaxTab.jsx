import React from 'react';
import { DocCheckbox, DocField, DocTabColumn, DocTabColumns, DocTabPanel } from './DocumentTabLayout';

// SAP B1 (India) Tax tab for every marketing document. Sales documents show
// Export, purchase documents show Import. `names` maps to the page's header
// keys (GRPO saves `formNo` / `importTax`); `dutyOptions` / `transactionOptions`
// let a page keep the values it already stores. `children` renders extra rows
// after Duty Status (A/P reference fields, original invoice on credit memos).
const ensureSavedOption = (options, value) => {
  const normalized = String(value ?? '');
  if (!normalized || options.some((option) => String(option.value) === normalized)) return options;
  return [...options, { value: normalized, label: normalized }];
};

export const TAX_TRANSACTION_CATEGORIES = [
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'SEZ', label: 'SEZ' },
  { value: 'EXP', label: 'Export' },
];

export const TAX_DUTY_STATUS_OPTIONS = [
  { value: 'Y', label: 'With Payment of Duty' },
  { value: 'N', label: 'Without Payment of Duty' },
];

const DIFFERENTIAL_RATES = ['100', '75', '50', '25'];

const DEFAULT_NAMES = {
  transactionCategory: 'transactionCategory',
  formNo: 'taxFormNo',
  dutyStatus: 'dutyStatus',
  exportFlag: 'exportFlag',
  importFlag: 'importTax',
  supplyCovered: 'supplyCovered',
  differentialTaxRate: 'differentialTaxRate',
};

export default function DocumentTaxTab({
  variant = 'sales',
  header = {},
  onHeaderChange,
  onOpenTaxInfoModal,
  isEditable = true,
  names: nameOverrides = {},
  dutyOptions = TAX_DUTY_STATUS_OPTIONS,
  transactionOptions: transactionCategoryOptions = TAX_TRANSACTION_CATEGORIES,
  hideDutyStatus = false,
  // What an unsaved Supply Covered flag shows; Sales Order treats empty as on.
  supplyCoveredDefault = false,
  children,
}) {
  const names = { ...DEFAULT_NAMES, ...nameOverrides };
  // No change handler means a read-only tab (avoids uncontrolled-input warnings).
  const disabled = !isEditable || typeof onHeaderChange !== 'function';
  const field = (key) => header[names[key]];
  const transactionOptions = ensureSavedOption(transactionCategoryOptions, field('transactionCategory'));
  const dutyStatusOptions = ensureSavedOption(dutyOptions, field('dutyStatus'));
  const rateOptions = ensureSavedOption(DIFFERENTIAL_RATES.map((rate) => ({ value: rate, label: rate })), field('differentialTaxRate'));
  const flagKey = variant === 'purchase' ? 'importFlag' : 'exportFlag';

  return (
    <DocTabPanel className="sap-doc-tab--tax">
      <DocTabColumns>
        <DocTabColumn>
          <DocField label="Tax Information">
            <button type="button" className="sap-doc-field__lookup-btn" onClick={onOpenTaxInfoModal} disabled={disabled} aria-label="Tax Information">...</button>
          </DocField>

          <DocField label="Transaction Category">
            {(id) => (
              <select id={id} name={names.transactionCategory} value={field('transactionCategory') || ''} onChange={onHeaderChange} disabled={disabled}>
                <option value="" />
                {transactionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
          </DocField>

          <DocField label="Form No.">
            {(id) => <input id={id} name={names.formNo} value={field('formNo') || ''} onChange={onHeaderChange} disabled={disabled} />}
          </DocField>

          {!hideDutyStatus ? (
            <DocField label="Duty Status">
              {(id) => (
                <select id={id} name={names.dutyStatus} value={field('dutyStatus') || dutyStatusOptions[0]?.value || ''} onChange={onHeaderChange} disabled={disabled}>
                  {dutyStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )}
            </DocField>
          ) : null}

          {children}

          <DocCheckbox
            label="Supply Covered under Sec 7 of IGST Act"
            name={names.supplyCovered}
            checked={field('supplyCovered') == null ? supplyCoveredDefault : Boolean(field('supplyCovered'))}
            onChange={onHeaderChange}
            disabled={disabled}
          />

          <DocField label="Differential % of Tax Rate">
            {(id) => (
              <select id={id} name={names.differentialTaxRate} value={String(field('differentialTaxRate') || '100')} onChange={onHeaderChange} disabled={disabled}>
                {rateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
          </DocField>
        </DocTabColumn>

        <DocTabColumn>
          <DocCheckbox
            label={variant === 'purchase' ? 'Import' : 'Export'}
            name={names[flagKey]}
            checked={Boolean(field(flagKey))}
            onChange={onHeaderChange}
            disabled={disabled}
          />
        </DocTabColumn>
      </DocTabColumns>
    </DocTabPanel>
  );
}
