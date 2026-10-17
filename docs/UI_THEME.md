# UI Theme Rules (Claude + Codex)

Every page must look like the rest of the app. The app mixes two SAP styles on purpose:

- **Fiori Horizon visual language everywhere**: SAP Horizon colours, flat buttons (white with blue text; one filled blue primary), icon-tab-bar tabs (blue underline), light tables, soft rounded cards, Fiori message strips, light shell (white shell bar + light side navigation).
- **SAP Fiori compact density** (`sapUiSizeCompact`, like the SAP B1 Web Client on desktop): 24px fields and buttons, 13px text, 20px page titles, muted left-aligned labels left of the field, Horizon fields (subtle outline + darker bottom line), header actions as transparent buttons with one filled primary, Fiori responsive tables (row lines only, borderless cell inputs). Documents keep the SAP B1 structure (header, tabs, lines grid).

One page uses one layout; never put Fiori-sized controls inside a classic grid. Do not invent a new look per page.

## Source of truth

- Tokens: `frontend/src/styles/sap-ui.css` `:root` (`--sap-*`: colors, borders, radius, Fiori compact density: control and button height 24px; type scale 12 / 13 / 14 / 20px via `--sap-small-font-size`, `--sap-control-font-size`, `--sap-section-font-size`, `--sap-title-font-size`; weights `--sap-font-weight-regular|semibold|bold`). Loaded once in `App.js`.
- Component classes: reuse an existing family. `sap-ui.css` normalizes these, so they inherit the theme automatically:

| Page type | Class family | Reference page |
|---|---|---|
| Master / setup page | `im-*` — import `modules/item-master/styles/itemMaster.css` | `modules/warehouse/Warehouse.jsx`, `modules/local-setup/LocalSetup.jsx` |
| Marketing document | `sap-document-page`, `sap-document-toolbar` + the document's own family (`so-*`, `del-*`, `po-*`) | `modules/sales-order/` |
| Report | `sap-report-*` | `styles/company-reports.css` |
| Document tabs (Logistics, Accounting, Tax, Electronic Documents, Attachments) | `components/document/` `SalesLogisticsTab`, `PurchaseLogisticsTab`, `DocumentAccountingTab`, `DocumentTaxTab`, `DocumentEDocTab`, `DocumentAttachmentsTab` (built on `DocumentTabLayout`) | any page's `components/*Tab.jsx` wrapper |
| Modal / lookup | `sap-modal-shell__*`, `sap-lookup-modal__*`, `im-modal*` | `components/` |

## Master / setup page skeleton

```jsx
<div className="im-page">
  <div className="im-toolbar">
    <span className="im-toolbar__title">Warehouses - Setup</span>
    <span className={`im-mode-badge im-mode-badge--${mode}`}>{mode.toUpperCase()}</span> {/* add | update | find */}
    <button className="im-btn im-btn--primary">Add</button>
    <button className="im-btn">Cancel</button>
  </div>
  <div className="im-alert im-alert--error">…</div>            {/* or --success */}
  <div className="im-header-card">                              {/* or a white card using --sap-surface/--sap-border */}
    <div className="im-section-title">General</div>
    <div className="im-field-grid">
      <label className="im-field">
        <span className="im-field__label">Code*</span>          {/* right-aligned label left of input */}
        <input className="im-field__input" />                   {/* select: im-field__input im-field__select */}
      </label>
    </div>
  </div>
  <div className="im-tabs"><button className="im-tab im-tab--active">General</button></div>
  <div className="im-tab-panel">…</div>
  <div className="im-grid-wrap"><table className="im-grid">…</table></div>   {/* rows/lines; inputs: im-grid__input */}
</div>
```

## Rules

1. **No hard-coded colors, fonts or sizes** in new CSS. Use `var(--sap-…)` tokens. Page CSS is for layout only (grid, gap, width).
2. **Compact controls and one type scale**: 24px inputs and buttons; 20px page title (bold), 14px section/card titles (semibold), 13px body/labels/buttons (regular; primary button and active tab semibold), 12px meta. No uppercase or letter-spaced labels anywhere (use the `--sap-control-*` / `--sap-*-font-size` tokens, never raw px), label left of input. Header and tab-panel columns are capped (440px / 520px) and right-aligned like SAP, not stretched full width. No large padded "web form" inputs, no stacked label-over-input forms, no rounded cards with shadows.
3. **Toolbar on top** with the page title (`<Name> - Setup` for setup pages), mode badge, and Add/Update (primary) · Cancel · Find buttons, like SAP.
4. **Tables are SAP grids** (`im-grid`): bordered cells, header `#e8edf2`, zebra rows, 3–4px cell padding.
5. **Messages** use `im-alert im-alert--error|--success`. Keep `role="alert"` for errors.
6. **Accessibility stays**: every input has a label (wrapping `<label>` or `htmlFor`), buttons have text, focus is visible.
7. **Do not copy another module's private CSS file** to get a look (e.g. `tax-code-setup/styles/taxCodeSetup.css` into a new page). Import the family's stylesheet or use tokens.
8. **Document tabs are shared**: a page's Logistics/Accounting/Tax/eDoc/Attachments tab is a thin wrapper that passes its header keys (`names`) and SAP field switches (`fields`, `documentType`, `variant`) to the shared component. Never write a new tab layout per page.
9. **Side panel**: the Header UDF / Form Settings panel width is `--sap-side-panel-width` (shared rule at the end of `sap-ui.css`). Never set the layout's sidebar column width in page CSS.
10. **Check it**: open the page next to Warehouse or Item Master in the browser before calling it done. If it looks different, it is wrong.
