const token = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// A source document's OpenQty is the quantity available to copy. It is not
// the new Delivery line's balance. Keep the original order quantity separate
// from the copied Delivery quantity and its as-yet-unknown target balance.
export const applyCopiedDeliveryQuantities = ({
  line = {}, sourceLine = {}, sourceType = '', matrixFields = [], rowUdfFields = [],
} = {}) => {
  const orderedQty = sourceType === 'salesOrder'
    ? String(sourceLine.OrderedQuantity ?? sourceLine.orderedQuantity
      ?? sourceLine.OrderedQty ?? sourceLine.orderedQty
      ?? sourceLine.Quantity ?? sourceLine.quantity ?? '')
    : '';
  const next = { ...line, orderedQty, openQty: '' };
  if (!orderedQty) return next;

  const orderedColumn = matrixFields.find((field) => token(field.label) === 'ORDEREDQTY');
  const udfKey = [orderedColumn?.valueKey, orderedColumn?.fieldName, orderedColumn?.field?.key]
    .find((value) => /^U_/i.test(String(value || '')))
    || rowUdfFields.find((field) => token(field.label) === 'ORDEREDQTY')?.key;
  const currentField = rowUdfFields.find((field) => String(field.key).toUpperCase() === String(udfKey).toUpperCase());
  if (currentField) next.udf = { ...(line.udf || {}), [currentField.key]: orderedQty };
  return next;
};
