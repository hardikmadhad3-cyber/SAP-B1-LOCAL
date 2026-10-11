import { useEffect, useState } from 'react';
import { buildStandardSalesCompanyQueryColumns } from '../modules/sales-order/documentLayout';
import { useCompanyScopedFormSettings } from './formSettingsStorage';
import {
  getSalesDocumentCompanyScopeKey,
  isSalesDocumentFieldMetadataReady,
} from './salesDocumentLiveFields';

// Keep the published SQL column list, labels, and per-user preferences on the
// same current-company field definitions for standard item document pages.
export const useStandardSalesFormSettings = ({
  formKey,
  readSavedFormSettings,
  headerUdfDefinitions,
  rowUdfDefinitions,
  matrixColumnDefinitions,
  companyId,
  companyDb,
  hydratedFieldMetadataScope,
  includeLineNumber = true,
}) => {
  const scope = getSalesDocumentCompanyScopeKey({ companyId, companyDb });
  const [publishedMatrixLayout, setPublishedMatrixLayout] = useState(null);
  const matrixFields = publishedMatrixLayout?.scope === scope
    ? publishedMatrixLayout.columns
    : matrixColumnDefinitions;
  const [settings, setSettings, storageKey, replaceSettings, status] = useCompanyScopedFormSettings(
    formKey,
    readSavedFormSettings,
    [headerUdfDefinitions, rowUdfDefinitions, matrixFields],
    { saveMode: 'explicit', followPublishedVersion: true },
  );
  const queryLayout = status.queryLayout;
  const metadataReady = hydratedFieldMetadataScope === undefined
    ? Boolean(matrixColumnDefinitions?.length)
    : isSalesDocumentFieldMetadataReady({
        companyId,
        companyDb,
        hydratedScope: hydratedFieldMetadataScope,
      });

  useEffect(() => {
    if (!queryLayout?.isPublished || !metadataReady) {
      setPublishedMatrixLayout(null);
      return;
    }
    const columns = buildStandardSalesCompanyQueryColumns({
      queryLayout,
      liveMatrixColumns: matrixColumnDefinitions,
      rowUdfFields: rowUdfDefinitions,
      includeLineNumber,
    });
    setPublishedMatrixLayout({
      scope,
      version: queryLayout.version,
      columns: columns || matrixColumnDefinitions,
    });
  }, [includeLineNumber, matrixColumnDefinitions, metadataReady, queryLayout, rowUdfDefinitions, scope]);

  const publishedReady = !queryLayout?.isPublished
    || (publishedMatrixLayout?.scope === scope && publishedMatrixLayout?.version === queryLayout.version);
  return [settings, setSettings, storageKey, replaceSettings, status,
    matrixFields, status.loaded && metadataReady && publishedReady];
};
