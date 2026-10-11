let bomGroupSequence = 0;

const toFiniteNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toParentLineNum = (line = {}) => {
  const value = line.parentLineNum ?? line.ParentLineNum ?? line.bomParentLineNum;
  const number = toFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
};

const toLineNum = (line = {}, fallback = null) => {
  const number = toFiniteNumber(line.lineNum ?? line.LineNum);
  return number !== null ? number : fallback;
};

const isSalesTreeType = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'S' || normalized === 'ISALESTREE' || normalized === 'SALESTREE';
};

const isSalesBomIngredientTreeType = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'I' || normalized === 'IINGREDIENT' || normalized === 'INGREDIENT';
};

const getOrderedBomLines = (lines = []) => (
  (Array.isArray(lines) ? lines : [])
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const leftVisualOrder = toFiniteNumber(left.line?.VisualOrder);
      const rightVisualOrder = toFiniteNumber(right.line?.VisualOrder);
      if (leftVisualOrder !== null && rightVisualOrder !== null && leftVisualOrder !== rightVisualOrder) {
        return leftVisualOrder - rightVisualOrder;
      }

      const leftChildNum = toFiniteNumber(left.line?.ChildNum);
      const rightChildNum = toFiniteNumber(right.line?.ChildNum);
      if (leftChildNum !== null && rightChildNum !== null && leftChildNum !== rightChildNum) {
        return leftChildNum - rightChildNum;
      }

      return left.index - right.index;
    })
    .map(({ line }) => line)
);

export const createSalesBomGroupId = () => {
  bomGroupSequence += 1;
  return `sales-bom-${Date.now()}-${bomGroupSequence}`;
};

export const isSalesBomDefinition = (bom) => isSalesTreeType(bom?.TreeType);

export const isSalesBomComponentLine = (line = {}) => (
  line.bomType === 'S' && line.bomRole === 'component'
);

export const createEmptySalesBomMetadata = () => ({
  bomType: '',
  bomRole: '',
  bomTreeCode: '',
  bomGroupId: '',
  bomParentIndex: null,
  bomParentLineNum: null,
  bomBaseQuantity: null,
  bomComponentQuantity: null,
  bomChildNum: null,
  bomVisualOrder: null,
  bomQuantityManuallyEdited: false,
  bomComponentManuallyEdited: false,
  treeType: '',
  parentLineNum: null,
});

export const clearSalesBomMetadata = (line = {}) => ({
  ...line,
  ...createEmptySalesBomMetadata(),
});

export const replaceSalesBomSelection = (lines = [], lineIndex, replacementLine) => {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const currentLine = sourceLines[lineIndex];
  if (!currentLine) return sourceLines;

  const replacement = clearSalesBomMetadata(replacementLine);
  if (currentLine.bomRole !== 'parent' || !currentLine.bomGroupId) {
    return sourceLines.map((line, index) => (index === lineIndex ? replacement : line));
  }

  const groupId = currentLine.bomGroupId;
  const withoutGroup = sourceLines.filter((line) => line.bomGroupId !== groupId);
  const insertionIndex = sourceLines
    .slice(0, lineIndex)
    .filter((line) => line.bomGroupId !== groupId)
    .length;

  return [
    ...withoutGroup.slice(0, insertionIndex),
    replacement,
    ...withoutGroup.slice(insertionIndex),
  ];
};

export const calculateSalesBomComponentQuantity = (
  parentDocumentQuantity,
  componentBomQuantity,
  parentBomQuantity,
) => {
  const parentQuantity = toFiniteNumber(parentDocumentQuantity);
  const componentQuantity = toFiniteNumber(componentBomQuantity);
  const baseQuantity = toFiniteNumber(parentBomQuantity);

  if (parentQuantity === null || componentQuantity === null || baseQuantity === null || baseQuantity <= 0) {
    return null;
  }

  return parentQuantity * (componentQuantity / baseQuantity);
};

export const expandSalesBomLines = ({
  lines = [],
  lineIndex,
  parentLine,
  bom,
  createComponentLine,
  groupId = createSalesBomGroupId(),
}) => {
  if (!isSalesBomDefinition(bom) || typeof createComponentLine !== 'function') return lines;

  const parentBomQuantity = toFiniteNumber(bom.Quantity);
  if (parentBomQuantity === null || parentBomQuantity <= 0) return lines;

  const sourceLines = replaceSalesBomSelection(lines, lineIndex, parentLine);
  const currentParent = sourceLines[lineIndex];
  if (!currentParent) return sourceLines;

  const safeParentBomQuantity = parentBomQuantity;
  const parentLineNum = toLineNum(currentParent);
  const parent = {
    ...currentParent,
    bomType: 'S',
    bomRole: 'parent',
    bomTreeCode: String(bom.TreeCode || currentParent.itemNo || '').trim(),
    bomGroupId: groupId,
    bomParentIndex: null,
    bomParentLineNum: null,
    bomBaseQuantity: safeParentBomQuantity,
    bomComponentQuantity: null,
    bomChildNum: null,
    bomVisualOrder: null,
    bomQuantityManuallyEdited: false,
    bomComponentManuallyEdited: false,
    treeType: 'iSalesTree',
    parentLineNum: null,
  };

  const components = getOrderedBomLines(bom.ProductTreeLines).map((bomLine, componentIndex) => {
    const componentBomQuantity = toFiniteNumber(bomLine?.Quantity);
    const documentQuantity = calculateSalesBomComponentQuantity(
      parent.quantity,
      componentBomQuantity,
      safeParentBomQuantity,
    );
    const metadata = {
      bomType: 'S',
      bomRole: 'component',
      bomTreeCode: parent.bomTreeCode,
      bomGroupId: groupId,
      bomParentIndex: lineIndex,
      bomParentLineNum: parentLineNum,
      bomBaseQuantity: safeParentBomQuantity,
      bomComponentQuantity: componentBomQuantity,
      bomChildNum: toFiniteNumber(bomLine?.ChildNum),
      bomVisualOrder: toFiniteNumber(bomLine?.VisualOrder),
      bomQuantityManuallyEdited: false,
      bomComponentManuallyEdited: false,
      treeType: String(bomLine?.TreeType || 'iIngredient').trim(),
      parentLineNum,
    };

    return {
      ...createComponentLine(bomLine, {
        componentIndex,
        documentQuantity,
        parent,
      }),
      ...metadata,
    };
  });

  return [
    ...sourceLines.slice(0, lineIndex),
    parent,
    ...components,
    ...sourceLines.slice(lineIndex + 1),
  ];
};

export const normalizeSalesBomDocumentLines = (lines = [], documentKey = 'document') => {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const lineByNumber = new Map();

  sourceLines.forEach((line, index) => {
    lineByNumber.set(toLineNum(line, index), line);
  });

  return sourceLines.map((line, index) => {
    const lineNum = toLineNum(line, index);
    const parentLineNum = toParentLineNum(line);
    const referencedParent = parentLineNum !== null ? lineByNumber.get(parentLineNum) : null;
    const referencedParentIsSalesBom = referencedParent && (
      isSalesTreeType(referencedParent.treeType ?? referencedParent.TreeType)
      || referencedParent.bomType === 'S'
    );
    const hasExplicitSalesBomParent = (
      parentLineNum !== null
      && parentLineNum !== lineNum
      && Boolean(referencedParentIsSalesBom)
    );
    const inferredParentIndex = sourceLines.slice(0, index).map((candidate, candidateIndex) => (
      isSalesTreeType(candidate.treeType ?? candidate.TreeType) || candidate.bomRole === 'parent'
        ? candidateIndex
        : -1
    )).filter((candidateIndex) => candidateIndex >= 0).pop();
    const inferredParent = inferredParentIndex != null ? sourceLines[inferredParentIndex] : null;
    const hasInferredSalesBomParent = (
      parentLineNum === null
      && isSalesBomIngredientTreeType(line.treeType ?? line.TreeType)
      && Boolean(inferredParent)
      && (isSalesTreeType(inferredParent.treeType ?? inferredParent.TreeType) || inferredParent.bomType === 'S')
    );
    const isComponent = hasExplicitSalesBomParent || hasInferredSalesBomParent;
    const isParent = !isComponent && (
      isSalesTreeType(line.treeType ?? line.TreeType) || line.bomRole === 'parent'
    );

    if (!isComponent && !isParent) return clearSalesBomMetadata(line);

    const resolvedParentLineNum = isComponent
      ? (hasExplicitSalesBomParent ? parentLineNum : toLineNum(inferredParent, inferredParentIndex))
      : lineNum;
    const parentLine = isComponent ? lineByNumber.get(resolvedParentLineNum) : line;
    const parentIndex = sourceLines.indexOf(parentLine);
    const parentQuantity = toFiniteNumber(parentLine?.quantity ?? parentLine?.Quantity);
    const componentQuantity = isComponent
      ? toFiniteNumber(line.quantity ?? line.Quantity)
      : null;
    const treeCode = String(parentLine?.itemNo ?? parentLine?.ItemCode ?? '').trim();
    const groupId = `sales-bom-${documentKey}-${resolvedParentLineNum}`;

    return {
      ...line,
      bomType: 'S',
      bomRole: isComponent ? 'component' : 'parent',
      bomTreeCode: treeCode,
      bomGroupId: groupId,
      bomParentIndex: isComponent ? parentIndex : null,
      bomParentLineNum: isComponent ? resolvedParentLineNum : null,
      bomBaseQuantity: parentQuantity !== null && parentQuantity > 0 ? parentQuantity : 1,
      bomComponentQuantity: componentQuantity,
      bomChildNum: toFiniteNumber(line.bomChildNum ?? line.ChildNum),
      bomVisualOrder: toFiniteNumber(line.bomVisualOrder ?? line.VisualOrder),
      bomQuantityManuallyEdited: Boolean(line.bomQuantityManuallyEdited),
      bomComponentManuallyEdited: Boolean(line.bomComponentManuallyEdited),
      treeType: String(line.treeType ?? line.TreeType ?? (isParent ? 'iSalesTree' : 'iIngredient')).trim(),
      parentLineNum: isComponent ? resolvedParentLineNum : null,
    };
  });
};
