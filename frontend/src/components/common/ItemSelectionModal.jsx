import React, { useEffect, useState } from 'react';
import SapLookupModal from './SapLookupModal';

const getItemCode = (item) => item?.ItemCode || item?.itemCode || '';
const getItemName = (item) => item?.ItemName || item?.itemName || item?.Dscription || '';
const getForeignName = (item) => item?.ForeignName || item?.FrgnName || item?.foreignName || '';
const getItemGroup = (item) =>
  item?.ItemGroup ||
  item?.ItemsGroupName ||
  item?.ItmsGrpNam ||
  item?.ItemsGroupCode ||
  item?.ItmsGrpCod ||
  '';
const getInStock = (item) => {
  const parsed = Number(item?.InStock ?? item?.OnHand ?? item?.QuantityOnStock ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function ItemSelectionModal({ isOpen, onClose, onSelect, items = [], loading, initialQuery = '' }) {
  const [searchQuery, setSearchQuery] = useState('');
  const safeItems = Array.isArray(items) ? items : [];

  useEffect(() => {
    if (!isOpen) return;
    const pendingQuery = initialQuery || window.__sapB1PendingLookupQuery || '';
    window.__sapB1PendingLookupQuery = '';
    setSearchQuery(pendingQuery);
  }, [isOpen, initialQuery]);

  const handleSelect = (item) => {
    const selection = onSelect(item);
    setSearchQuery('');
    onClose();
    Promise.resolve(selection).finally(() => window.SapB1TabNavigation?.completeLookup?.());
  };

  return (
    <SapLookupModal
      open={isOpen}
      title="List of Items"
      columns={[
        { key: 'rowNumber', label: '#', width: 44, render: (_item, index) => index + 1 },
        { key: 'itemCode', label: 'Item No.', width: 120, render: getItemCode },
        { key: 'itemName', label: 'Item Description', render: getItemName },
        { key: 'inStock', label: 'In Stock', width: 100, align: 'right', render: (item) => getInStock(item).toFixed(2) },
        { key: 'itemGroup', label: 'Item Group', width: 150, render: getItemGroup },
        { key: 'foreignName', label: 'Foreign Name', width: 150, render: getForeignName },
      ]}
      rows={safeItems}
      loading={loading}
      initialQuery={searchQuery}
      consumePendingQuery={false}
      searchPlaceholder="Search by Item Code, Description, Group, or Foreign Name"
      emptyMessage="No items found"
      onClose={() => {
        setSearchQuery('');
        onClose();
      }}
      onSelect={handleSelect}
      width="min(940px, calc(100vw - 40px))"
    />
  );
}
