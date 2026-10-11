import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompanyScopedFormSettings } from './formSettingsStorage';
import { buildServiceCompanyQueryColumns } from './serviceDocumentLiveFields';
import {
  getSalesDocumentCompanyScopeKey,
  isSalesDocumentFieldMetadataReady,
} from './salesDocumentLiveFields';

/**
 * Keeps service-document Form Settings tied to both the authenticated company
 * and the company schema that produced the current matrix definitions.
 *
 * Schema hydration is a replacement, not a user edit. Visibility changes stay
 * as an explicit draft until the user presses Save in the Form Settings panel.
 */
const useServiceDocumentFormSettings = ({
  company,
  baseStorageKey,
  readSavedFormSettings,
  headerUdfDefinitions,
  rowUdfDefinitions,
  matrixColumnDefinitions,
}) => {
  const activeScope = useMemo(() => getSalesDocumentCompanyScopeKey({
    companyId: company?.companyId || '',
    companyDb: company?.dbName || '',
  }), [company?.companyId, company?.dbName]);
  const [hydratedScope, setHydratedScope] = useState('');
  const [publishedMatrixLayout, setPublishedMatrixLayout] = useState(null);
  const effectiveMatrixColumns = publishedMatrixLayout?.scope === activeScope
    ? publishedMatrixLayout.columns : matrixColumnDefinitions;
  const [
    formSettings,
    setFormSettings,
    formSettingsStorageKey,
    replaceFormSettings,
    formSettingsStatus,
  ] = useCompanyScopedFormSettings(
    baseStorageKey,
    readSavedFormSettings,
    [headerUdfDefinitions, rowUdfDefinitions, effectiveMatrixColumns],
    { saveMode: 'explicit', followPublishedVersion: true },
  );

  const metadataReady = isSalesDocumentFieldMetadataReady({
    companyId: company?.companyId || '',
    companyDb: company?.dbName || '',
    hydratedScope,
  });
  const queryLayout = formSettingsStatus.queryLayout;
  useEffect(() => {
    if (!queryLayout?.isPublished || !metadataReady) {
      setPublishedMatrixLayout(null);
      return;
    }
    setPublishedMatrixLayout({
      scope: activeScope,
      version: queryLayout.version,
      columns: buildServiceCompanyQueryColumns({
        queryLayout,
        liveMatrixColumns: matrixColumnDefinitions,
        rowUdfFields: rowUdfDefinitions,
      }) || matrixColumnDefinitions,
    });
  }, [activeScope, matrixColumnDefinitions, metadataReady, queryLayout, rowUdfDefinitions]);
  const formSettingsReady = formSettingsStatus.loaded && metadataReady && (
    !queryLayout?.isPublished || (
      publishedMatrixLayout?.scope === activeScope && publishedMatrixLayout?.version === queryLayout.version
    )
  );

  const clearMetadataScope = useCallback(() => {
    setHydratedScope('');
  }, []);

  const hydrateFormSettings = useCallback((headerUdfs, rowUdfs, matrixColumns) => {
    replaceFormSettings(readSavedFormSettings(
      headerUdfs,
      rowUdfs,
      matrixColumns,
      formSettingsStorageKey,
    ));
    setHydratedScope(activeScope);
  }, [activeScope, formSettingsStorageKey, readSavedFormSettings, replaceFormSettings]);

  useEffect(() => {
    if (!formSettingsReady || formSettingsStatus.hasUnsavedChanges) return;
    replaceFormSettings(readSavedFormSettings(
      headerUdfDefinitions,
      rowUdfDefinitions,
      effectiveMatrixColumns,
      formSettingsStorageKey,
    ));
  }, [
    formSettingsReady,
    formSettingsStatus.hasUnsavedChanges,
    formSettingsStorageKey,
    headerUdfDefinitions,
    effectiveMatrixColumns,
    readSavedFormSettings,
    replaceFormSettings,
    rowUdfDefinitions,
  ]);

  return {
    formSettings,
    setFormSettings,
    formSettingsStorageKey,
    formSettingsStatus,
    formSettingsReady,
    hydrateFormSettings,
    clearMetadataScope,
    effectiveMatrixColumns,
  };
};

export default useServiceDocumentFormSettings;
