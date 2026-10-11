const normalizeCode = (value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export const findServiceAccount = (accounts = [], code = '') => {
  const target = normalizeCode(code);
  if (!target) return null;
  return accounts.find((account) => [account.code, account.formatCode, account.AcctCode, account.FormatCode]
    .some((candidate) => normalizeCode(candidate) === target)) || null;
};

export const populateServiceAccountLine = (line = {}, selected = {}, accounts = []) => {
  const requestedCode = selected.value ?? selected.code ?? line.glAccount ?? '';
  const account = findServiceAccount(accounts, requestedCode);
  const name = String(selected.accountName || selected.description || selected.name
    || account?.name || account?.AcctName || '').trim();
  return {
    ...line,
    glAccount: String(account?.code || requestedCode).trim(),
    glAccountName: name,
    description: String(line.description || '').trim()
      && String(line.description).trim() !== String(line.glAccountName || '').trim()
      ? line.description : name,
  };
};

export const hydrateServiceAccountLine = (line = {}, accounts = []) => {
  if (String(line.glAccountName || '').trim() || !line.glAccount) return line;
  const account = findServiceAccount(accounts, line.glAccount);
  return account ? { ...line, glAccountName: account.name || '' } : line;
};
