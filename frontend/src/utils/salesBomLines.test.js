import {
  calculateSalesBomComponentQuantity,
  expandSalesBomLines,
  isSalesBomDefinition,
  isSalesBomComponentLine,
  normalizeSalesBomDocumentLines,
} from './salesBomLines';

describe('salesBomLines', () => {
  test('treats a missing BOM response as a normal inventory item', () => {
    expect(isSalesBomDefinition(null)).toBe(false);
    expect(isSalesBomDefinition(undefined)).toBe(false);
    const lines = [{ itemNo: 'D474', quantity: '1' }];
    expect(expandSalesBomLines({ lines, lineIndex: 0, parentLine: lines[0], bom: null })).toBe(lines);
  });

  test('calculates component quantities from the BOM parent ratio', () => {
    expect(calculateSalesBomComponentQuantity(3, 8, 2)).toBe(12);
    expect(calculateSalesBomComponentQuantity(3, 4, 2)).toBe(6);
    expect(calculateSalesBomComponentQuantity(3, 4, 0)).toBeNull();
    expect(calculateSalesBomComponentQuantity('', 4, 2)).toBeNull();
  });

  test('expands a Sales BOM in visual order without duplicating an existing group', () => {
    const source = [{ itemNo: 'KIT', quantity: '3' }, { itemNo: 'NORMAL', quantity: '1' }];
    const bom = {
      TreeCode: 'KIT',
      TreeType: 'iSalesTree',
      Quantity: 2,
      ProductTreeLines: [
        { ItemCode: 'B', Quantity: 4, VisualOrder: 2, ChildNum: 1 },
        { ItemCode: 'A', Quantity: 8, VisualOrder: 1, ChildNum: 0 },
      ],
    };
    const createComponentLine = (line, context) => ({
      itemNo: line.ItemCode,
      quantity: String(context.documentQuantity),
    });

    const expanded = expandSalesBomLines({
      lines: source,
      lineIndex: 0,
      parentLine: source[0],
      bom,
      createComponentLine,
      groupId: 'group-1',
    });

    expect(expanded.map((line) => line.itemNo)).toEqual(['KIT', 'A', 'B', 'NORMAL']);
    expect(expanded.map((line) => line.quantity)).toEqual(['3', '12', '6', '1']);

    const reexpanded = expandSalesBomLines({
      lines: expanded,
      lineIndex: 0,
      parentLine: expanded[0],
      bom,
      createComponentLine,
      groupId: 'group-2',
    });

    expect(reexpanded.map((line) => line.itemNo)).toEqual(['KIT', 'A', 'B', 'NORMAL']);
    expect(reexpanded.filter((line) => line.bomRole === 'component')).toHaveLength(2);
  });

  test('does not expand a Sales BOM with an invalid parent quantity', () => {
    const source = [{ itemNo: 'KIT', quantity: '3' }];
    const expanded = expandSalesBomLines({
      lines: source,
      lineIndex: 0,
      parentLine: source[0],
      bom: {
        TreeCode: 'KIT',
        TreeType: 'iSalesTree',
        Quantity: 0,
        ProductTreeLines: [{ ItemCode: 'A', Quantity: 8 }],
      },
      createComponentLine: (line) => ({ itemNo: line.ItemCode }),
    });

    expect(expanded).toEqual(source);
  });

  test('reconstructs saved Sales BOM groups from ParentLineNum', () => {
    const normalized = normalizeSalesBomDocumentLines([
      { lineNum: 0, itemNo: 'KIT', quantity: '2', treeType: 'iSalesTree' },
      { lineNum: 1, itemNo: 'A', quantity: '8', parentLineNum: 0 },
      { lineNum: 2, itemNo: 'NORMAL', quantity: '1' },
    ], '17');

    expect(normalized[0].bomRole).toBe('parent');
    expect(normalized[1].bomRole).toBe('component');
    expect(normalized[0].bomGroupId).toBe(normalized[1].bomGroupId);
    expect(normalized[1].bomBaseQuantity).toBe(2);
    expect(normalized[1].bomComponentQuantity).toBe(8);
    expect(normalized[2].bomRole).toBe('');
  });

  test('reconstructs Sales BOM groups after duplicate line identities are cleared', () => {
    const normalized = normalizeSalesBomDocumentLines([
      { itemNo: 'KIT', quantity: '2', treeType: 'iSalesTree', bomType: 'S', bomRole: 'parent' },
      { itemNo: 'A', quantity: '8', parentLineNum: 0, treeType: 'iIngredient', bomType: 'S', bomRole: 'component' },
      { itemNo: 'B', quantity: '2', parentLineNum: 0, treeType: 'iIngredient', bomType: 'S', bomRole: 'component' },
    ], 'duplicate');

    expect(normalized[0]).toMatchObject({ bomRole: 'parent', bomType: 'S', bomParentLineNum: null });
    expect(normalized[1]).toMatchObject({ bomRole: 'component', bomType: 'S', bomParentLineNum: 0 });
    expect(normalized[2].bomGroupId).toBe(normalized[0].bomGroupId);
  });

  test('reconstructs a saved Sales BOM when SAP omits component parent line numbers', () => {
    const normalized = normalizeSalesBomDocumentLines([
      { lineNum: 7, itemNo: 'KIT', quantity: '2', treeType: 'S' },
      { lineNum: 8, itemNo: 'A', quantity: '8', treeType: 'I' },
      { lineNum: 9, itemNo: 'B', quantity: '2', treeType: 'I' },
      { lineNum: 10, itemNo: 'NORMAL', quantity: '1', treeType: '' },
    ], 'saved-order');

    expect(normalized[0].bomRole).toBe('parent');
    expect(normalized[1]).toMatchObject({ bomRole: 'component', bomParentLineNum: 7 });
    expect(normalized[2].bomGroupId).toBe(normalized[0].bomGroupId);
    expect(normalized[3].bomRole).toBe('');
  });

  test('does not treat non-Sales BOM document trees as Sales BOM groups', () => {
    const normalized = normalizeSalesBomDocumentLines([
      { lineNum: 0, itemNo: 'ASSEMBLY', quantity: '1', treeType: 'iAssemblyTree' },
      { lineNum: 1, itemNo: 'PART', quantity: '1', parentLineNum: 0, treeType: 'iIngredient' },
    ], '18');

    expect(normalized[0].bomRole).toBe('');
    expect(normalized[1].bomRole).toBe('');
  });

  test('identifies only Sales BOM component lines as non-billable display lines', () => {
    expect(isSalesBomComponentLine({ bomType: 'S', bomRole: 'component' })).toBe(true);
    expect(isSalesBomComponentLine({ bomType: 'S', bomRole: 'parent' })).toBe(false);
    expect(isSalesBomComponentLine({ bomType: 'P', bomRole: 'component' })).toBe(false);
  });
});
